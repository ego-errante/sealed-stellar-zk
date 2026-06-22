#![no_std]
//! JobManager: two-actor confidential-query marketplace.
//! Buyer submits a query request over a registered dataset; owner accepts and fulfills with a
//! RISC Zero Groth16 proof. `fulfill` verifies the proof via the router and BINDS it to this exact
//! dataset + query + guest, so the owner cannot fake or substitute a result.
use crate::registry::DatasetRegistryClient;
use risc0_interface::RiscZeroVerifierRouterClient;
use soroban_sdk::{contract, contractimpl, contracttype, Address, Bytes, BytesN, Env, Vec};

mod registry;

const DAY_IN_LEDGERS: u32 = 17_280;
const TTL_BUMP: u32 = 90 * DAY_IN_LEDGERS;
const TTL_THRESHOLD: u32 = TTL_BUMP - DAY_IN_LEDGERS;
const JOURNAL_LEN: u32 = 95;
const MAX_FILTER_BYTECODE: u32 = 512;

#[contracttype]
#[derive(Clone, PartialEq, Eq)]
pub enum RequestStatus {
    Pending,
    Accepted,
    Rejected,
    Completed,
}

/// Query params carried in the request — the binding inputs. Mirrors cdm-shared's canonical encoding.
#[contracttype]
#[derive(Clone)]
pub struct QueryParams {
    pub op: u32,
    pub target_field: u32,
    pub filter_bytecode: Bytes,
    pub consts: Vec<u64>,
    pub weights: Vec<u32>,
}

#[contracttype]
#[derive(Clone)]
pub struct Request {
    pub buyer: Address,
    pub dataset_id: u64,
    pub params: QueryParams,
    pub status: RequestStatus,
    pub result: u64,
    pub k_met: bool,
    pub overflow: bool,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Registry,
    Router,
    ImageId,
    NextId,
    Request(u64),
    LastUse(Address, u64),
}

struct JournalView {
    root: BytesN<32>,
    query_hash: BytesN<32>,
    op: u8,
    num_columns: u32,
    k: u64,
    result: u64,
    k_met: bool,
    overflow: bool,
}

#[contract]
pub struct JobManager;

#[contractimpl]
impl JobManager {
    pub fn __constructor(env: Env, registry: Address, router: Address, image_id: BytesN<32>) {
        let s = env.storage().instance();
        s.set(&DataKey::Registry, &registry);
        s.set(&DataKey::Router, &router);
        s.set(&DataKey::ImageId, &image_id);
        s.set(&DataKey::NextId, &1u64);
    }

    /// Buyer submits a query. Enforces per-(buyer,dataset) cooldown.
    pub fn submit_request(env: Env, buyer: Address, dataset_id: u64, params: QueryParams) -> u64 {
        buyer.require_auth();
        assert!(params.op <= 5, "bad op");
        assert!(
            params.filter_bytecode.len() <= MAX_FILTER_BYTECODE,
            "filter too long"
        );

        let ds = DatasetRegistryClient::new(&env, &Self::registry(&env)).get_dataset(&dataset_id);

        // cooldown
        let now = env.ledger().timestamp();
        let last_key = DataKey::LastUse(buyer.clone(), dataset_id);
        if ds.cooldown_sec > 0 {
            if let Some(last) = env.storage().persistent().get::<_, u64>(&last_key) {
                assert!(now >= last + ds.cooldown_sec as u64, "cooldown active");
            }
        }
        env.storage().persistent().set(&last_key, &now);
        env.storage()
            .persistent()
            .extend_ttl(&last_key, TTL_THRESHOLD, TTL_BUMP);

        let id: u64 = env.storage().instance().get(&DataKey::NextId).unwrap_or(1);
        let req = Request {
            buyer,
            dataset_id,
            params,
            status: RequestStatus::Pending,
            result: 0,
            k_met: false,
            overflow: false,
        };
        Self::write_request(&env, id, &req);
        env.storage().instance().set(&DataKey::NextId, &(id + 1));
        id
    }

    pub fn accept_request(env: Env, owner: Address, request_id: u64) {
        owner.require_auth();
        let mut req = Self::read_request(&env, request_id);
        assert!(req.status == RequestStatus::Pending, "not pending");
        let ds = DatasetRegistryClient::new(&env, &Self::registry(&env)).get_dataset(&req.dataset_id);
        assert!(owner == ds.owner, "only dataset owner");
        req.status = RequestStatus::Accepted;
        Self::write_request(&env, request_id, &req);
    }

    pub fn reject_request(env: Env, owner: Address, request_id: u64) {
        owner.require_auth();
        let mut req = Self::read_request(&env, request_id);
        assert!(req.status == RequestStatus::Pending, "not pending");
        let ds = DatasetRegistryClient::new(&env, &Self::registry(&env)).get_dataset(&req.dataset_id);
        assert!(owner == ds.owner, "only dataset owner");
        req.status = RequestStatus::Rejected;
        Self::write_request(&env, request_id, &req);
    }

    /// Owner fulfills an accepted request with a Groth16 proof. Verifies + binds before storing.
    pub fn fulfill(env: Env, owner: Address, request_id: u64, seal: Bytes, journal: Bytes) {
        owner.require_auth();
        let mut req = Self::read_request(&env, request_id);
        assert!(req.status == RequestStatus::Accepted, "request not accepted");
        let ds = DatasetRegistryClient::new(&env, &Self::registry(&env)).get_dataset(&req.dataset_id);
        assert!(owner == ds.owner, "only dataset owner");

        // (a) verify the proof through the router (panics on invalid proof / wrong image_id)
        let image_id: BytesN<32> = env.storage().instance().get(&DataKey::ImageId).unwrap();
        let router: Address = env.storage().instance().get(&DataKey::Router).unwrap();
        let journal_digest: BytesN<32> = env.crypto().sha256(&journal).into();
        RiscZeroVerifierRouterClient::new(&env, &router).verify(&seal, &image_id, &journal_digest);

        // (b) decode the fixed-layout journal and (c) bind it to this dataset + query + guest
        let jv = Self::decode_journal(&env, &journal);
        assert!(jv.root == ds.merkle_root, "root mismatch");
        assert!(jv.num_columns == ds.num_columns, "num_columns mismatch");
        assert!(jv.op as u32 == req.params.op, "op mismatch");
        assert!(jv.k == ds.k, "k mismatch");
        let expected_qh = Self::rebuild_query_hash(&env, &req.params, ds.k);
        assert!(jv.query_hash == expected_qh, "query_hash mismatch");

        // (d) store the verified result
        req.result = jv.result;
        req.k_met = jv.k_met;
        req.overflow = jv.overflow;
        req.status = RequestStatus::Completed;
        Self::write_request(&env, request_id, &req);
    }

    pub fn get_request(env: Env, request_id: u64) -> Request {
        Self::read_request(&env, request_id)
    }

    pub fn get_result(env: Env, request_id: u64) -> (u64, bool, bool) {
        let req = Self::read_request(&env, request_id);
        assert!(req.status == RequestStatus::Completed, "not completed");
        (req.result, req.k_met, req.overflow)
    }
}

// ---- internals ----
impl JobManager {
    fn registry(env: &Env) -> Address {
        env.storage().instance().get(&DataKey::Registry).unwrap()
    }

    fn read_request(env: &Env, id: u64) -> Request {
        env.storage()
            .persistent()
            .get(&DataKey::Request(id))
            .expect("request not found")
    }

    fn write_request(env: &Env, id: u64, req: &Request) {
        let key = DataKey::Request(id);
        env.storage().persistent().set(&key, req);
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_THRESHOLD, TTL_BUMP);
    }

    /// Rebuild sha256(canonical_query_bytes) — must match cdm-shared byte-for-byte.
    fn rebuild_query_hash(env: &Env, p: &QueryParams, k: u64) -> BytesN<32> {
        let mut buf = Bytes::new(env);
        buf.push_back(p.op as u8);
        buf.extend_from_array(&(p.target_field as u16).to_le_bytes());
        buf.extend_from_array(&k.to_le_bytes());
        buf.extend_from_array(&(p.filter_bytecode.len() as u16).to_le_bytes());
        buf.append(&p.filter_bytecode);
        buf.extend_from_array(&(p.consts.len() as u16).to_le_bytes());
        for c in p.consts.iter() {
            buf.extend_from_array(&c.to_le_bytes());
        }
        buf.extend_from_array(&(p.weights.len() as u16).to_le_bytes());
        for w in p.weights.iter() {
            buf.extend_from_array(&(w as u16).to_le_bytes());
        }
        env.crypto().sha256(&buf).into()
    }

    fn decode_journal(env: &Env, journal: &Bytes) -> JournalView {
        assert!(journal.len() == JOURNAL_LEN, "bad journal length");
        let mut b = [0u8; 95];
        journal.copy_into_slice(&mut b);
        let root: [u8; 32] = b[0..32].try_into().unwrap();
        let qh: [u8; 32] = b[32..64].try_into().unwrap();
        JournalView {
            root: BytesN::from_array(env, &root),
            query_hash: BytesN::from_array(env, &qh),
            op: b[64],
            num_columns: u32::from_le_bytes(b[65..69].try_into().unwrap()),
            k: u64::from_le_bytes(b[69..77].try_into().unwrap()),
            // bytes 77..85 = count (committed in the journal; not stored on-chain for the MVP)
            result: u64::from_le_bytes(b[85..93].try_into().unwrap()),
            k_met: b[93] != 0,
            overflow: b[94] != 0,
        }
    }
}

#[cfg(test)]
mod test;

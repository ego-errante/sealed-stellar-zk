#![cfg(test)]
extern crate std;

use crate::{JobManager, JobManagerClient, QueryParams};
use dataset_registry::{DatasetRegistry, DatasetRegistryClient};
use groth16_verifier::RiscZeroGroth16Verifier;
use soroban_sdk::{
    testutils::{storage::Instance as _, Address as _},
    vec, Address, Bytes, BytesN, Env, Vec,
};

struct Fixture {
    seal: Bytes,
    image_id: BytesN<32>,
    journal: Bytes,
    root: BytesN<32>,
    journal_bytes: std::vec::Vec<u8>,
}

fn load_fixture(env: &Env) -> Fixture {
    load_named(env, "count_proof.txt")
}

fn load_named(env: &Env, name: &str) -> Fixture {
    let path = std::format!("/work/contracts/job-manager/fixtures/{}", name);
    let content = std::fs::read_to_string(&path).unwrap();
    let mut lines = content.lines();
    let seal = Bytes::from_slice(env, &hex::decode(lines.next().unwrap()).unwrap());
    let image_id_b: [u8; 32] = hex::decode(lines.next().unwrap()).unwrap().try_into().unwrap();
    let journal_bytes = hex::decode(lines.next().unwrap()).unwrap();
    let journal = Bytes::from_slice(env, &journal_bytes);
    let root_b: [u8; 32] = journal_bytes[0..32].try_into().unwrap();
    Fixture {
        seal,
        image_id: BytesN::from_array(env, &image_id_b),
        journal,
        root: BytesN::from_array(env, &root_b),
        journal_bytes,
    }
}

/// Params matching the host's proof: COUNT, filter field[1] (age) > 30, consts=[30].
fn count_params(env: &Env) -> QueryParams {
    QueryParams {
        op: 3,
        target_field: 0,
        filter_bytecode: Bytes::from_array(env, &[0x01, 0x00, 0x01, 0x02, 0x00, 0x00, 0x10]),
        consts: vec![env, 30u64],
        weights: Vec::new(env),
    }
}

/// Params matching the SUM proof: SUM of field[2] (balance) where field[1] (age) > 30.
fn sum_params(env: &Env) -> QueryParams {
    QueryParams {
        op: 1,
        target_field: 2,
        filter_bytecode: Bytes::from_array(env, &[0x01, 0x00, 0x01, 0x02, 0x00, 0x00, 0x10]),
        consts: vec![env, 30u64],
        weights: Vec::new(env),
    }
}

/// Deploy registry + verifier (acts as router: same verify() interface) + job manager.
/// Returns (registry_id, jobmanager_id, owner, buyer, dataset_id).
fn deploy(
    env: &Env,
    image_id: &BytesN<32>,
    root: &BytesN<32>,
    cooldown: u32,
) -> (Address, Address, Address, Address, u64) {
    env.mock_all_auths();
    let reg_id = env.register(DatasetRegistry, ());
    let reg = DatasetRegistryClient::new(env, &reg_id);
    let owner = Address::generate(env);
    let dataset_id = reg.register_dataset(&owner, root, &3u32, &5u64, &2u64, &cooldown);
    let v_id = env.register(RiscZeroGroth16Verifier, ());
    let jm_id = env.register(JobManager, (reg_id.clone(), v_id.clone(), image_id.clone()));
    let buyer = Address::generate(env);
    (reg_id, jm_id, owner, buyer, dataset_id)
}

#[test]
fn fulfill_happy_path() {
    let env = Env::default();
    let fx = load_fixture(&env);
    let (_reg, jm_id, owner, buyer, did) = deploy(&env, &fx.image_id, &fx.root, 0);
    let jm = JobManagerClient::new(&env, &jm_id);
    let rid = jm.submit_request(&buyer, &did, &count_params(&env));
    jm.accept_request(&owner, &rid);
    jm.fulfill(&owner, &rid, &fx.seal, &fx.journal);
    assert_eq!(jm.get_result(&rid), (3u64, true, false));
}

#[test]
fn fulfill_sum_happy_path() {
    // a real Groth16 SUM proof (op=1, target field 2, age>30) → contract binds result 310 (50+250+10)
    let env = Env::default();
    let fx = load_named(&env, "sum_proof.txt");
    let (_reg, jm_id, owner, buyer, did) = deploy(&env, &fx.image_id, &fx.root, 0);
    let jm = JobManagerClient::new(&env, &jm_id);
    let rid = jm.submit_request(&buyer, &did, &sum_params(&env));
    jm.accept_request(&owner, &rid);
    jm.fulfill(&owner, &rid, &fx.seal, &fx.journal);
    assert_eq!(jm.get_result(&rid), (310u64, true, false));
}

#[test]
#[should_panic]
fn fulfill_rejects_tampered_journal() {
    let env = Env::default();
    let fx = load_fixture(&env);
    let (_reg, jm_id, owner, buyer, did) = deploy(&env, &fx.image_id, &fx.root, 0);
    let jm = JobManagerClient::new(&env, &jm_id);
    let rid = jm.submit_request(&buyer, &did, &count_params(&env));
    jm.accept_request(&owner, &rid);
    let mut jb = fx.journal_bytes.clone();
    jb[90] ^= 0xFF; // flip a byte → sha256 differs → verify fails
    let bad = Bytes::from_slice(&env, &jb);
    jm.fulfill(&owner, &rid, &fx.seal, &bad);
}

#[test]
#[should_panic]
fn fulfill_rejects_wrong_dataset_root() {
    let env = Env::default();
    let fx = load_fixture(&env);
    let wrong_root = BytesN::from_array(&env, &[0x11u8; 32]);
    let (_reg, jm_id, owner, buyer, did) = deploy(&env, &fx.image_id, &wrong_root, 0);
    let jm = JobManagerClient::new(&env, &jm_id);
    let rid = jm.submit_request(&buyer, &did, &count_params(&env));
    jm.accept_request(&owner, &rid);
    jm.fulfill(&owner, &rid, &fx.seal, &fx.journal); // proof valid, root binding fails
}

#[test]
#[should_panic]
fn fulfill_rejects_query_param_mismatch() {
    let env = Env::default();
    let fx = load_fixture(&env);
    let (_reg, jm_id, owner, buyer, did) = deploy(&env, &fx.image_id, &fx.root, 0);
    let jm = JobManagerClient::new(&env, &jm_id);
    let mut p = count_params(&env);
    p.consts = vec![&env, 40u64]; // threshold 40 ≠ 30 → query_hash mismatch
    let rid = jm.submit_request(&buyer, &did, &p);
    jm.accept_request(&owner, &rid);
    jm.fulfill(&owner, &rid, &fx.seal, &fx.journal);
}

#[test]
#[should_panic]
fn fulfill_rejects_wrong_image_id() {
    let env = Env::default();
    let fx = load_fixture(&env);
    let wrong_img = BytesN::from_array(&env, &[0xFFu8; 32]);
    let (_reg, jm_id, owner, buyer, did) = deploy(&env, &wrong_img, &fx.root, 0);
    let jm = JobManagerClient::new(&env, &jm_id);
    let rid = jm.submit_request(&buyer, &did, &count_params(&env));
    jm.accept_request(&owner, &rid);
    jm.fulfill(&owner, &rid, &fx.seal, &fx.journal); // image_id mismatch → verify fails
}

#[test]
#[should_panic]
fn cooldown_blocks_rapid_requests() {
    let env = Env::default();
    let fx = load_fixture(&env);
    let (_reg, jm_id, _owner, buyer, did) = deploy(&env, &fx.image_id, &fx.root, 100);
    let jm = JobManagerClient::new(&env, &jm_id);
    jm.submit_request(&buyer, &did, &count_params(&env));
    jm.submit_request(&buyer, &did, &count_params(&env)); // within cooldown → panic
}

/// WEIGHTED_SUM params (op=0) with a weight per column.
fn weighted_params(env: &Env, weights: std::vec::Vec<u32>) -> QueryParams {
    let mut w = Vec::new(env);
    for x in weights {
        w.push_back(x);
    }
    QueryParams {
        op: 0,
        target_field: 0,
        filter_bytecode: Bytes::new(env),
        consts: Vec::new(env),
        weights: w,
    }
}

#[test]
#[should_panic]
fn submit_rejects_target_field_over_u16() {
    // target_field is u16 in the canonical query hash + guest; a u32 value >65535 would truncate.
    let env = Env::default();
    let fx = load_fixture(&env);
    let (_reg, jm_id, _owner, buyer, did) = deploy(&env, &fx.image_id, &fx.root, 0);
    let jm = JobManagerClient::new(&env, &jm_id);
    let mut p = count_params(&env);
    p.target_field = 70_000;
    jm.submit_request(&buyer, &did, &p);
}

#[test]
#[should_panic]
fn submit_rejects_weight_over_u16() {
    // weights are u16 in the hash + guest; >65535 would truncate (and proverlib rejects it).
    let env = Env::default();
    let fx = load_fixture(&env);
    let (_reg, jm_id, _owner, buyer, did) = deploy(&env, &fx.image_id, &fx.root, 0);
    let jm = JobManagerClient::new(&env, &jm_id);
    // dataset has 3 columns, so length is valid; the out-of-range value is what's rejected.
    jm.submit_request(&buyer, &did, &weighted_params(&env, std::vec![1, 2, 70_000]));
}

#[test]
#[should_panic]
fn submit_rejects_weighted_sum_wrong_weights_len() {
    // WEIGHTED_SUM needs one weight per column; a short vector silently computes a partial sum.
    let env = Env::default();
    let fx = load_fixture(&env);
    let (_reg, jm_id, _owner, buyer, did) = deploy(&env, &fx.image_id, &fx.root, 0);
    let jm = JobManagerClient::new(&env, &jm_id);
    jm.submit_request(&buyer, &did, &weighted_params(&env, std::vec![1, 2])); // 2 != num_columns 3
}

#[test]
#[should_panic]
fn submit_rejects_nonweighted_with_weights() {
    // A non-WEIGHTED_SUM op carrying weights is meaningless and would perturb the bound query_hash.
    let env = Env::default();
    let fx = load_fixture(&env);
    let (_reg, jm_id, _owner, buyer, did) = deploy(&env, &fx.image_id, &fx.root, 0);
    let jm = JobManagerClient::new(&env, &jm_id);
    let mut p = count_params(&env); // op=3 COUNT
    p.weights = { let mut w = Vec::new(&env); w.push_back(1u32); w };
    jm.submit_request(&buyer, &did, &p);
}

#[test]
fn submit_request_bumps_instance_ttl() {
    // The instance holds Registry/Router/ImageId/NextId; without a TTL bump it archives and every
    // entrypoint that unwraps them panics permanently. submit_request must extend it.
    let env = Env::default();
    let fx = load_fixture(&env);
    let (_reg, jm_id, _owner, buyer, did) = deploy(&env, &fx.image_id, &fx.root, 0);
    let jm = JobManagerClient::new(&env, &jm_id);
    jm.submit_request(&buyer, &did, &count_params(&env));
    let ttl = env.as_contract(&jm_id, || env.storage().instance().get_ttl());
    assert!(
        ttl >= crate::TTL_BUMP - 100,
        "instance TTL not extended (got {})",
        ttl
    );
}

#[test]
fn submit_accepts_weighted_sum_correct_len() {
    let env = Env::default();
    let fx = load_fixture(&env);
    let (_reg, jm_id, _owner, buyer, did) = deploy(&env, &fx.image_id, &fx.root, 0);
    let jm = JobManagerClient::new(&env, &jm_id);
    let rid = jm.submit_request(&buyer, &did, &weighted_params(&env, std::vec![1, 2, 3]));
    assert_eq!(rid, 1);
}

#[test]
fn get_request_count_tracks_submissions() {
    // Deterministic enumeration: callers iterate 1..=count instead of probing until an ambiguous trap.
    let env = Env::default();
    let fx = load_fixture(&env);
    let (_reg, jm_id, _owner, buyer, did) = deploy(&env, &fx.image_id, &fx.root, 0);
    let jm = JobManagerClient::new(&env, &jm_id);
    assert_eq!(jm.get_request_count(), 0);
    jm.submit_request(&buyer, &did, &count_params(&env));
    jm.submit_request(&buyer, &did, &count_params(&env));
    assert_eq!(jm.get_request_count(), 2);
}

#[test]
fn effective_overflow_suppressed_under_k() {
    // Overflow is only meaningful when the result is released; under k-anon suppression it must be
    // cleared so a suppressed-but-overflowing aggregate can't leak that a small subset overflowed.
    assert!(!crate::effective_overflow(true, false));
    assert!(crate::effective_overflow(true, true));
    assert!(!crate::effective_overflow(false, true));
    assert!(!crate::effective_overflow(false, false));
}

#[test]
fn rebuild_query_hash_matches_cdm_shared() {
    // The contract re-derives the query hash with a hand-written encoder; this locks it to
    // cdm-shared's canonical encoder (which the guest uses) so the two can't silently drift.
    let env = Env::default();
    // (op, target_field, k, bytecode, consts, weights)
    let cases: std::vec::Vec<(u32, u32, u64, std::vec::Vec<u8>, std::vec::Vec<u64>, std::vec::Vec<u32>)> = std::vec![
        (3, 0, 2, std::vec![], std::vec![], std::vec![]),
        (1, 2, 2, std::vec![0x01, 0x00, 0x01, 0x02, 0x00, 0x00, 0x10], std::vec![30], std::vec![]),
        (0, 0, 5, std::vec![], std::vec![], std::vec![1, 2, 3]),
        (4, 65_535, 7, std::vec![0x10], std::vec![1, 2], std::vec![]),
    ];
    for (op, tf, k, bc, consts, weights) in cases {
        let mut fb = Bytes::new(&env);
        for b in &bc {
            fb.push_back(*b);
        }
        let mut cv = Vec::new(&env);
        for c in &consts {
            cv.push_back(*c);
        }
        let mut wv = Vec::new(&env);
        for w in &weights {
            wv.push_back(*w);
        }
        let params = QueryParams {
            op,
            target_field: tf,
            filter_bytecode: fb,
            consts: cv,
            weights: wv,
        };
        let got = JobManager::rebuild_query_hash(&env, &params, k);
        let weights_u16: std::vec::Vec<u16> = weights.iter().map(|w| *w as u16).collect();
        let expected = cdm_shared::query_hash(op as u8, tf as u16, k, &bc, &consts, &weights_u16);
        assert_eq!(got.to_array(), expected, "mismatch for op {}", op);
    }
}

#[test]
#[should_panic]
fn fulfill_rejects_wrong_request_id() {
    // The fixture proof is bound to request_id 1. Submitting an identical second request (id 2) and
    // trying to fulfill IT with the same proof must fail the request_id binding — i.e. a valid proof
    // for one request can't be replayed to fulfill a different (otherwise identical) request.
    let env = Env::default();
    let fx = load_fixture(&env);
    let (_reg, jm_id, owner, buyer, did) = deploy(&env, &fx.image_id, &fx.root, 0);
    let jm = JobManagerClient::new(&env, &jm_id);
    let _rid1 = jm.submit_request(&buyer, &did, &count_params(&env)); // id 1 — what the proof binds to
    let rid2 = jm.submit_request(&buyer, &did, &count_params(&env)); // id 2 — identical params
    jm.accept_request(&owner, &rid2);
    jm.fulfill(&owner, &rid2, &fx.seal, &fx.journal); // journal.request_id == 1 != 2 → panic
}

#[test]
#[should_panic]
fn fulfill_requires_accepted() {
    let env = Env::default();
    let fx = load_fixture(&env);
    let (_reg, jm_id, owner, buyer, did) = deploy(&env, &fx.image_id, &fx.root, 0);
    let jm = JobManagerClient::new(&env, &jm_id);
    let rid = jm.submit_request(&buyer, &did, &count_params(&env));
    jm.fulfill(&owner, &rid, &fx.seal, &fx.journal); // not accepted → panic
}

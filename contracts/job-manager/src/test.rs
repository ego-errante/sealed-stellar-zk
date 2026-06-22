#![cfg(test)]
extern crate std;

use crate::{JobManager, JobManagerClient, QueryParams};
use dataset_registry::{DatasetRegistry, DatasetRegistryClient};
use groth16_verifier::RiscZeroGroth16Verifier;
use soroban_sdk::{testutils::Address as _, vec, Address, Bytes, BytesN, Env, Vec};

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

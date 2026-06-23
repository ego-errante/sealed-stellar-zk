#![cfg(test)]
extern crate std;

use crate::{DatasetRegistry, DatasetRegistryClient};
use soroban_sdk::{testutils::Address as _, Address, BytesN, Env};

fn setup() -> (Env, DatasetRegistryClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register(DatasetRegistry, ());
    let client = DatasetRegistryClient::new(&env, &id);
    (env, client)
}

fn root(env: &Env, b: u8) -> BytesN<32> {
    BytesN::from_array(env, &[b; 32])
}

#[test]
fn register_then_get() {
    let (env, client) = setup();
    let owner = Address::generate(&env);
    let r = root(&env, 0xAB);
    let id = client.register_dataset(&owner, &r, &3u32, &5u64, &2u64, &60u32);
    assert_eq!(id, 1);
    let ds = client.get_dataset(&id);
    assert_eq!(ds.owner, owner);
    assert_eq!(ds.merkle_root, r);
    assert_eq!(ds.num_columns, 3);
    assert_eq!(ds.row_count, 5);
    assert_eq!(ds.k, 2);
    assert_eq!(ds.cooldown_sec, 60);
    assert_eq!(client.get_dataset_count(), 1);
}

#[test]
fn ids_increment() {
    let (env, client) = setup();
    let owner = Address::generate(&env);
    let r = root(&env, 1);
    let id1 = client.register_dataset(&owner, &r, &2u32, &3u64, &1u64, &0u32);
    let id2 = client.register_dataset(&owner, &r, &2u32, &3u64, &1u64, &0u32);
    assert_eq!(id1, 1);
    assert_eq!(id2, 2);
    assert_eq!(client.get_dataset_count(), 2);
}

#[test]
#[should_panic]
fn rejects_zero_rows() {
    let (env, client) = setup();
    let owner = Address::generate(&env);
    client.register_dataset(&owner, &root(&env, 1), &2u32, &0u64, &1u64, &0u32);
}

#[test]
#[should_panic]
fn rejects_zero_columns() {
    let (env, client) = setup();
    let owner = Address::generate(&env);
    client.register_dataset(&owner, &root(&env, 1), &0u32, &3u64, &1u64, &0u32);
}

#[test]
#[should_panic]
fn rejects_zero_root() {
    let (env, client) = setup();
    let owner = Address::generate(&env);
    client.register_dataset(&owner, &root(&env, 0), &2u32, &3u64, &1u64, &0u32);
}

#[test]
#[should_panic]
fn rejects_zero_k() {
    // k=0 would make k_met = (count >= 0) always true, disabling k-anonymity entirely.
    let (env, client) = setup();
    let owner = Address::generate(&env);
    client.register_dataset(&owner, &root(&env, 1), &2u32, &3u64, &0u64, &0u32);
}

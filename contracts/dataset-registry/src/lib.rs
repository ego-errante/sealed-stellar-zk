#![no_std]
//! DatasetRegistry: owners commit a dataset (Merkle root + schema + k-anonymity + cooldown).
//! The root is the public commitment; raw rows live off-chain with the owner.
use soroban_sdk::{contract, contractimpl, contracttype, Address, BytesN, Env};

const DAY_IN_LEDGERS: u32 = 17_280;
const TTL_BUMP: u32 = 90 * DAY_IN_LEDGERS;
const TTL_THRESHOLD: u32 = TTL_BUMP - DAY_IN_LEDGERS;

#[contracttype]
#[derive(Clone)]
pub struct Dataset {
    pub owner: Address,
    pub merkle_root: BytesN<32>,
    pub num_columns: u32,
    pub row_count: u64,
    pub k: u64,
    pub cooldown_sec: u32,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    NextId,
    Dataset(u64),
}

#[contract]
pub struct DatasetRegistry;

#[contractimpl]
impl DatasetRegistry {
    pub fn __constructor(env: Env) {
        env.storage().instance().set(&DataKey::NextId, &1u64);
    }

    pub fn register_dataset(
        env: Env,
        owner: Address,
        merkle_root: BytesN<32>,
        num_columns: u32,
        row_count: u64,
        k: u64,
        cooldown_sec: u32,
    ) -> u64 {
        owner.require_auth();
        assert!(row_count > 0, "row_count must be > 0");
        assert!(num_columns > 0, "num_columns must be > 0");
        // k must be >= 1: k=0 makes k_met = (count >= 0) always true, voiding k-anonymity.
        assert!(k >= 1, "k must be >= 1");
        assert!(
            merkle_root != BytesN::from_array(&env, &[0u8; 32]),
            "merkle_root must be non-zero"
        );

        let id: u64 = env.storage().instance().get(&DataKey::NextId).unwrap_or(1);
        let ds = Dataset {
            owner,
            merkle_root,
            num_columns,
            row_count,
            k,
            cooldown_sec,
        };
        let key = DataKey::Dataset(id);
        env.storage().persistent().set(&key, &ds);
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_THRESHOLD, TTL_BUMP);
        env.storage().instance().set(&DataKey::NextId, &(id + 1));
        env.storage().instance().extend_ttl(TTL_THRESHOLD, TTL_BUMP);
        id
    }

    pub fn get_dataset(env: Env, dataset_id: u64) -> Dataset {
        let key = DataKey::Dataset(dataset_id);
        let ds: Dataset = env
            .storage()
            .persistent()
            .get(&key)
            .expect("dataset not found");
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_THRESHOLD, TTL_BUMP);
        ds
    }

    pub fn get_dataset_count(env: Env) -> u64 {
        let next: u64 = env.storage().instance().get(&DataKey::NextId).unwrap_or(1);
        next - 1
    }
}

#[cfg(test)]
mod test;

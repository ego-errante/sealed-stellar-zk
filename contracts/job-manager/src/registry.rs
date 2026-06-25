//! Client-only interface to the DatasetRegistry contract.
//!
//! Defined here — rather than depending on the `dataset-registry` *contract* crate — so the
//! registry's `#[contractimpl]` exports (`__constructor`, `register_dataset`, …) don't leak into
//! THIS contract's wasm. Linking a full contract crate as a dependency duplicates the
//! `#[no_mangle]` export symbols and corrupts the export table (it dropped our own
//! `__constructor`). This mirrors how `risc0-interface` exposes the router as a `#[contractclient]`.
//!
//! The `Dataset` layout MUST match `dataset_registry::Dataset` byte-for-byte (same field order /
//! types) so cross-contract `get_dataset` return values deserialize correctly. A test asserts the
//! real registry contract round-trips through this client.
use soroban_sdk::{contractclient, contracttype, Address, BytesN, Env, String, Vec};

#[contracttype]
#[derive(Clone)]
pub struct Dataset {
    pub owner: Address,
    pub merkle_root: BytesN<32>,
    pub num_columns: u32,
    pub row_count: u64,
    pub k: u64,
    pub cooldown_sec: u32,
    pub column_names: Vec<String>,
}

// The trait exists only so `#[contractclient]` can generate `DatasetRegistryClient`; the trait
// name itself is never referenced, hence the allow.
#[allow(dead_code)]
#[contractclient(name = "DatasetRegistryClient")]
pub trait DatasetRegistry {
    fn get_dataset(env: Env, dataset_id: u64) -> Dataset;
}

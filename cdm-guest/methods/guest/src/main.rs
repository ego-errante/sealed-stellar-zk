// CDM query guest: prove a confidential aggregate over a committed dataset.
//
// Thin wrapper: read the QueryInput, run the shared computation (Merkle root + filtered aggregate +
// k-anonymity + query_hash), and commit the fixed-layout 95-byte journal as raw bytes so the Soroban
// contract can sha256 it (for the verifier) and byte-slice it (for the bindings). All real logic and
// its tests live in `cdm-shared`.
use cdm_shared::{compute_journal, encode_journal, QueryInput};
use risc0_zkvm::guest::env;

fn main() {
    let input: QueryInput = env::read();
    let journal = compute_journal(&input).expect("aggregation failed");
    env::commit_slice(&encode_journal(&journal));
}

// CDM host: build a tiny dataset, prove the confidential COUNT with Groth16, verify locally,
// and emit (seal, image_id, journal_digest) — the three values the Stellar verifier consumes.
use methods::{CDM_QUERY_ELF, CDM_QUERY_ID};
use risc0_ethereum_contracts::encode_seal;
use risc0_zkvm::{default_prover, ExecutorEnv, ProverOpts};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;

#[derive(Serialize, Deserialize)]
struct Query {
    rows: Vec<Vec<u64>>,
    col: u32,
    threshold: u64,
    k: u64,
}

#[derive(Serialize, Deserialize, Debug)]
struct QueryOutput {
    root: [u8; 32],
    col: u32,
    threshold: u64,
    k: u64,
    count: u64,
    k_met: bool,
}

fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::filter::EnvFilter::from_default_env())
        .init();

    // Sample dataset: rows = [id, age, balance]. Query: COUNT rows where age (col 1) > 30, need k>=2.
    // Expected: rows with age 40, 33, 51 match -> count = 3, k_met = true.
    let q = Query {
        rows: vec![
            vec![1, 25, 100],
            vec![2, 40, 50],
            vec![3, 33, 250],
            vec![4, 19, 999],
            vec![5, 51, 10],
        ],
        col: 1,
        threshold: 30,
        k: 2,
    };

    let env = ExecutorEnv::builder().write(&q).unwrap().build().unwrap();

    let prover = default_prover();
    let opts = ProverOpts::groth16();
    println!("proving with Groth16 (this can take a few minutes)...");
    let prove_info = prover
        .prove_with_opts(env, CDM_QUERY_ELF, &opts)
        .unwrap();
    let receipt = prove_info.receipt;

    // Verify the receipt locally (what a third party / the chain attests to).
    receipt.verify(CDM_QUERY_ID).unwrap();
    println!("local receipt.verify() OK");

    let out: QueryOutput = receipt.journal.decode().unwrap();
    println!("journal decoded: {out:?}");
    println!("merkle_root = {}", hex::encode(out.root));

    // Three values the Stellar RISC Zero verifier expects.
    let seal = encode_seal(&receipt).unwrap();
    let image_id = risc0_zkvm::compute_image_id(CDM_QUERY_ELF).unwrap();
    let journal_digest: [u8; 32] = Sha256::digest(&receipt.journal.bytes).into();

    let proof = format!(
        "{}\n{}\n{}\n",
        hex::encode(&seal),
        hex::encode(image_id.as_bytes()),
        hex::encode(journal_digest)
    );
    fs::write("proof.txt", &proof).unwrap();
    println!("wrote proof.txt ({} byte seal)", seal.len());
}

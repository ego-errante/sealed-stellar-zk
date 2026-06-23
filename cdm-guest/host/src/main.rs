//! CDM prover CLI. Two subcommands:
//!   register --data rows.csv
//!       → prints the Merkle root + schema the owner registers on-chain (DatasetRegistry).
//!   prove --data rows.csv --params q.json [--out proof.txt]
//!       → proves the confidential aggregate with Groth16 and writes the fixture the Soroban
//!         contract consumes: proof.txt = seal_hex \n image_id_hex \n raw_journal_hex (103 bytes;
//!         the contract recomputes sha256(journal) itself, exactly like JobManager.fulfill does).
use cdm_shared::{decode_journal, merkle};
use clap::{Parser, Subcommand};
use methods::CDM_QUERY_ELF;
use proverlib::{parse_csv, to_query_input, ProveParams};
use risc0_ethereum_contracts::encode_seal;
use risc0_zkvm::{default_prover, compute_image_id, ExecutorEnv, ProverOpts};
use std::fs;

#[derive(Parser)]
#[command(name = "cdm-prover", about = "CDM ZK prover: register datasets, prove confidential aggregates")]
struct Cli {
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// Hash a CSV dataset → Merkle root + schema (the public commitment to register on-chain).
    Register {
        #[arg(long)]
        data: String,
    },
    /// Prove a query over a CSV dataset; writes seal + image_id + 103-byte journal to --out.
    Prove {
        #[arg(long)]
        data: String,
        #[arg(long)]
        params: String,
        #[arg(long, default_value = "proof.txt")]
        out: String,
    },
}

fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::filter::EnvFilter::from_default_env())
        .init();

    match Cli::parse().cmd {
        Cmd::Register { data } => register(&data),
        Cmd::Prove { data, params, out } => prove(&data, &params, &out),
    }
}

fn read_rows(path: &str) -> Vec<Vec<u64>> {
    let text = fs::read_to_string(path).unwrap_or_else(|e| panic!("read {}: {}", path, e));
    parse_csv(&text).unwrap_or_else(|e| panic!("parse {}: {}", path, e))
}

fn register(data: &str) {
    let rows = read_rows(data);
    let root = merkle::merkle_root(&rows);
    // machine-readable lines: `key<TAB>value` so callers (prover-service) can scrape easily.
    println!("merkle_root\t{}", hex::encode(root));
    println!("num_columns\t{}", rows[0].len());
    println!("row_count\t{}", rows.len());
}

fn prove(data: &str, params_path: &str, out: &str) {
    let rows = read_rows(data);
    let params_json =
        fs::read_to_string(params_path).unwrap_or_else(|e| panic!("read {}: {}", params_path, e));
    let params = ProveParams::from_json(&params_json).unwrap_or_else(|e| panic!("{}", e));
    let input = to_query_input(rows, &params).unwrap_or_else(|e| panic!("{}", e));

    let env = ExecutorEnv::builder().write(&input).unwrap().build().unwrap();
    let opts = ProverOpts::groth16();
    eprintln!("proving with Groth16 (this can take a few minutes)…");
    let receipt = default_prover()
        .prove_with_opts(env, CDM_QUERY_ELF, &opts)
        .unwrap()
        .receipt;

    let image_id = compute_image_id(CDM_QUERY_ELF).unwrap();
    receipt.verify(image_id).unwrap();
    let journal = receipt.journal.bytes.clone();
    eprintln!(
        "local receipt.verify() OK; journal {} bytes; decoded = {:?}",
        journal.len(),
        decode_journal(&journal)
    );

    let seal = encode_seal(&receipt).unwrap();
    let out_str = format!(
        "{}\n{}\n{}\n",
        hex::encode(&seal),
        hex::encode(image_id.as_bytes()),
        hex::encode(&journal)
    );
    fs::write(out, &out_str).unwrap_or_else(|e| panic!("write {}: {}", out, e));
    eprintln!("wrote {} ({}-byte seal, {}-byte journal)", out, seal.len(), journal.len());
    // image_id on stdout so the deploy step can capture it.
    println!("image_id\t{}", hex::encode(image_id.as_bytes()));
}

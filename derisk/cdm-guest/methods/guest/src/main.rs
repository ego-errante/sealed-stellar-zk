// CDM query guest: prove a confidential aggregate over a committed dataset.
//
// Reads a small dataset + query params, then commits to the journal:
//   - the Merkle root of the dataset (binds the result to a specific committed dataset)
//   - the query params (col, threshold, k)
//   - COUNT of rows matching `row[col] > threshold`
//   - whether k-anonymity holds (count >= k)
//
// The ZK proof attests: "for the dataset whose Merkle root is R, exactly `count` rows match the
// predicate, and k-anonymity is/isn't met" — without revealing any row.
use risc0_zkvm::guest::env;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[derive(Serialize, Deserialize)]
struct Query {
    rows: Vec<Vec<u64>>,
    col: u32,
    threshold: u64,
    k: u64,
}

#[derive(Serialize, Deserialize)]
struct QueryOutput {
    root: [u8; 32],
    col: u32,
    threshold: u64,
    k: u64,
    count: u64,
    k_met: bool,
}

fn leaf_hash(row: &[u64]) -> [u8; 32] {
    let mut h = Sha256::new();
    for v in row {
        h.update(v.to_le_bytes());
    }
    h.finalize().into()
}

fn merkle_root(rows: &[Vec<u64>]) -> [u8; 32] {
    if rows.is_empty() {
        return [0u8; 32];
    }
    let mut level: Vec<[u8; 32]> = rows.iter().map(|r| leaf_hash(r)).collect();
    while level.len() > 1 {
        let mut next = Vec::with_capacity(level.len().div_ceil(2));
        let mut i = 0;
        while i < level.len() {
            let left = level[i];
            let right = if i + 1 < level.len() { level[i + 1] } else { level[i] };
            let mut h = Sha256::new();
            h.update(left);
            h.update(right);
            next.push(h.finalize().into());
            i += 2;
        }
        level = next;
    }
    level[0]
}

fn main() {
    let q: Query = env::read();

    let root = merkle_root(&q.rows);

    let col = q.col as usize;
    let mut count = 0u64;
    for row in &q.rows {
        if col < row.len() && row[col] > q.threshold {
            count += 1;
        }
    }
    let k_met = count >= q.k;

    let out = QueryOutput {
        root,
        col: q.col,
        threshold: q.threshold,
        k: q.k,
        count,
        k_met,
    };
    env::commit(&out);
}

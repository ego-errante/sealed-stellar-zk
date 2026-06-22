//! Shared encoding for the CDM ZK marketplace: canonical query bytes, the 95-byte journal layout,
//! and the sha256 Merkle scheme. Used by the guest and the host CLI; the Soroban contract mirrors
//! the same byte order (guarded by a cross-impl test vector).

use sha2::{Digest, Sha256};

pub mod agg;
pub mod vm;

pub mod merkle {
    use super::{Digest, Sha256};

    /// Leaf = sha256(concat of each u64 field, little-endian).
    pub fn leaf_hash(row: &[u64]) -> [u8; 32] {
        let mut h = Sha256::new();
        for v in row {
            h.update(v.to_le_bytes());
        }
        h.finalize().into()
    }

    /// Pairwise sha256 Merkle root; odd node duplicated. Empty -> zero hash.
    pub fn merkle_root(rows: &[Vec<u64>]) -> [u8; 32] {
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
}

/// Canonical, fixed-order encoding of the query params (no divisor; AVG = sum/count).
/// `op(u8) | target_field(u16 LE) | k(u64 LE) | bytecode_len(u16) | bytecode |
///  consts_len(u16) | consts(u64 LE each) | weights_len(u16) | weights(u16 LE each)`
pub fn canonical_query_bytes(
    op: u8,
    target_field: u16,
    k: u64,
    filter_bytecode: &[u8],
    consts: &[u64],
    weights: &[u16],
) -> Vec<u8> {
    let mut out = Vec::new();
    out.push(op);
    out.extend_from_slice(&target_field.to_le_bytes());
    out.extend_from_slice(&k.to_le_bytes());
    out.extend_from_slice(&(filter_bytecode.len() as u16).to_le_bytes());
    out.extend_from_slice(filter_bytecode);
    out.extend_from_slice(&(consts.len() as u16).to_le_bytes());
    for c in consts {
        out.extend_from_slice(&c.to_le_bytes());
    }
    out.extend_from_slice(&(weights.len() as u16).to_le_bytes());
    for w in weights {
        out.extend_from_slice(&w.to_le_bytes());
    }
    out
}

/// sha256 of the canonical query encoding — bound on-chain against the journal's query_hash.
pub fn query_hash(
    op: u8,
    target_field: u16,
    k: u64,
    filter_bytecode: &[u8],
    consts: &[u64],
    weights: &[u16],
) -> [u8; 32] {
    Sha256::digest(canonical_query_bytes(
        op,
        target_field,
        k,
        filter_bytecode,
        consts,
        weights,
    ))
    .into()
}

pub const JOURNAL_LEN: usize = 95;

/// The guest's public output. Byte layout (offsets):
/// root 0..32 | query_hash 32..64 | op 64 | num_columns 65..69 (u32 LE) |
/// k 69..77 | count 77..85 | result 85..93 (all u64 LE) | k_met 93 | overflow 94
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Journal {
    pub root: [u8; 32],
    pub query_hash: [u8; 32],
    pub op: u8,
    pub num_columns: u32,
    pub k: u64,
    pub count: u64,
    pub result: u64,
    pub k_met: bool,
    pub overflow: bool,
}

pub fn encode_journal(j: &Journal) -> [u8; JOURNAL_LEN] {
    let mut b = [0u8; JOURNAL_LEN];
    b[0..32].copy_from_slice(&j.root);
    b[32..64].copy_from_slice(&j.query_hash);
    b[64] = j.op;
    b[65..69].copy_from_slice(&j.num_columns.to_le_bytes());
    b[69..77].copy_from_slice(&j.k.to_le_bytes());
    b[77..85].copy_from_slice(&j.count.to_le_bytes());
    b[85..93].copy_from_slice(&j.result.to_le_bytes());
    b[93] = j.k_met as u8;
    b[94] = j.overflow as u8;
    b
}

pub fn decode_journal(bytes: &[u8]) -> Option<Journal> {
    if bytes.len() != JOURNAL_LEN {
        return None;
    }
    let mut root = [0u8; 32];
    root.copy_from_slice(&bytes[0..32]);
    let mut query_hash = [0u8; 32];
    query_hash.copy_from_slice(&bytes[32..64]);
    Some(Journal {
        root,
        query_hash,
        op: bytes[64],
        num_columns: u32::from_le_bytes(bytes[65..69].try_into().ok()?),
        k: u64::from_le_bytes(bytes[69..77].try_into().ok()?),
        count: u64::from_le_bytes(bytes[77..85].try_into().ok()?),
        result: u64::from_le_bytes(bytes[85..93].try_into().ok()?),
        k_met: bytes[93] != 0,
        overflow: bytes[94] != 0,
    })
}

/// Guest input (shared by guest + host so the struct can't drift).
#[derive(serde::Serialize, serde::Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct QueryInput {
    pub rows: Vec<Vec<u64>>,
    pub op: u8,
    pub target_field: u16,
    pub k: u64,
    pub filter_bytecode: Vec<u8>,
    pub consts: Vec<u64>,
    pub weights: Vec<u16>,
}

/// The full guest computation: Merkle root + filtered aggregate + query_hash → Journal.
/// The guest is just `commit_slice(encode_journal(compute_journal(input)?))`.
pub fn compute_journal(input: &QueryInput) -> Result<Journal, agg::AggError> {
    let root = merkle::merkle_root(&input.rows);
    let num_columns = input.rows.first().map(|r| r.len() as u32).unwrap_or(0);
    let qh = query_hash(
        input.op,
        input.target_field,
        input.k,
        &input.filter_bytecode,
        &input.consts,
        &input.weights,
    );
    let a = agg::run(
        input.op,
        input.target_field,
        input.k,
        &input.weights,
        &input.filter_bytecode,
        &input.consts,
        &input.rows,
    )?;
    Ok(Journal {
        root,
        query_hash: qh,
        op: input.op,
        num_columns,
        k: input.k,
        count: a.count,
        result: a.result,
        k_met: a.k_met,
        overflow: a.overflow,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merkle_root_matches_derisk_frozen_vector() {
        let rows = vec![
            vec![1u64, 25, 100],
            vec![2, 40, 50],
            vec![3, 33, 250],
            vec![4, 19, 999],
            vec![5, 51, 10],
        ];
        assert_eq!(
            hex::encode(merkle::merkle_root(&rows)),
            "bad285cb8effd6c429a1ae614c80fe5bc017d974b257df1728320cf5dbf2873c"
        );
    }

    #[test]
    fn canonical_query_bytes_count_no_filter() {
        let got = canonical_query_bytes(3, 0, 2, &[], &[], &[]);
        let expected = vec![
            3u8, // op
            0, 0, // target_field u16 LE
            2, 0, 0, 0, 0, 0, 0, 0, // k u64 LE
            0, 0, // bytecode_len
            0, 0, // consts_len
            0, 0, // weights_len
        ];
        assert_eq!(got, expected);
    }

    #[test]
    fn canonical_query_bytes_with_filter_and_const() {
        // COUNT, target 1, k=2, filter: PUSH_FIELD 0, PUSH_CONST 0, GT (age>30); consts=[30]
        let bytecode = vec![0x01u8, 0x00, 0x00, 0x02, 0x00, 0x00, 0x10];
        let got = canonical_query_bytes(3, 1, 2, &bytecode, &[30], &[]);
        let mut expected = vec![3u8, 1, 0]; // op, target_field LE
        expected.extend_from_slice(&2u64.to_le_bytes()); // k
        expected.extend_from_slice(&7u16.to_le_bytes()); // bytecode_len
        expected.extend_from_slice(&bytecode);
        expected.extend_from_slice(&1u16.to_le_bytes()); // consts_len
        expected.extend_from_slice(&30u64.to_le_bytes()); // const
        expected.extend_from_slice(&0u16.to_le_bytes()); // weights_len
        assert_eq!(got, expected);
    }

    #[test]
    fn query_hash_is_sha256_of_canonical() {
        let qh = query_hash(1, 2, 5, &[0x10], &[7], &[1, 2]);
        let direct: [u8; 32] =
            Sha256::digest(canonical_query_bytes(1, 2, 5, &[0x10], &[7], &[1, 2])).into();
        assert_eq!(qh, direct);
    }

    #[test]
    fn journal_roundtrip_and_layout() {
        let j = Journal {
            root: [0xAB; 32],
            query_hash: [0xCD; 32],
            op: 3,
            num_columns: 4,
            k: 2,
            count: 3,
            result: 42,
            k_met: true,
            overflow: false,
        };
        let enc = encode_journal(&j);
        assert_eq!(enc.len(), JOURNAL_LEN);
        assert_eq!(enc[64], 3); // op offset
        assert_eq!(&enc[65..69], &4u32.to_le_bytes()); // num_columns
        assert_eq!(&enc[69..77], &2u64.to_le_bytes()); // k
        assert_eq!(enc[93], 1); // k_met
        assert_eq!(enc[94], 0); // overflow
        assert_eq!(decode_journal(&enc), Some(j));
    }

    #[test]
    fn decode_rejects_wrong_length() {
        assert_eq!(decode_journal(&[0u8; 94]), None);
        assert_eq!(decode_journal(&[0u8; 96]), None);
    }

    #[test]
    fn compute_journal_for_count_query() {
        let mut bc = Vec::new();
        bc.push(0x01);
        bc.extend_from_slice(&1u16.to_be_bytes()); // PUSH_FIELD 1 (age)
        bc.push(0x02);
        bc.extend_from_slice(&0u16.to_be_bytes()); // PUSH_CONST 0
        bc.push(0x10); // GT  → age > 30
        let consts = vec![30u64];
        let input = QueryInput {
            rows: vec![
                vec![1, 25, 100],
                vec![2, 40, 50],
                vec![3, 33, 250],
                vec![4, 19, 999],
                vec![5, 51, 10],
            ],
            op: agg::OP_COUNT,
            target_field: 0,
            k: 2,
            filter_bytecode: bc.clone(),
            consts: consts.clone(),
            weights: vec![],
        };
        let j = compute_journal(&input).unwrap();
        assert_eq!(
            hex::encode(j.root),
            "bad285cb8effd6c429a1ae614c80fe5bc017d974b257df1728320cf5dbf2873c"
        );
        assert_eq!(j.query_hash, query_hash(agg::OP_COUNT, 0, 2, &bc, &consts, &[]));
        assert_eq!(j.op, 3);
        assert_eq!(j.num_columns, 3);
        assert_eq!(j.k, 2);
        assert_eq!(j.count, 3);
        assert_eq!(j.result, 3);
        assert!(j.k_met);
        assert!(!j.overflow);
        assert_eq!(decode_journal(&encode_journal(&j)), Some(j));
    }

    // filter age>30 keeps balances 50,250,10 (count 3); shared by the SUM/AVG journal tests.
    fn age_gt_30_input(op: u8, target_field: u16) -> QueryInput {
        let mut bc = Vec::new();
        bc.push(0x01);
        bc.extend_from_slice(&1u16.to_be_bytes()); // PUSH_FIELD 1 (age)
        bc.push(0x02);
        bc.extend_from_slice(&0u16.to_be_bytes()); // PUSH_CONST 0
        bc.push(0x10); // GT
        QueryInput {
            rows: vec![
                vec![1, 25, 100],
                vec![2, 40, 50],
                vec![3, 33, 250],
                vec![4, 19, 999],
                vec![5, 51, 10],
            ],
            op,
            target_field,
            k: 2,
            filter_bytecode: bc,
            consts: vec![30u64],
            weights: vec![],
        }
    }

    #[test]
    fn compute_journal_for_sum_query() {
        let input = age_gt_30_input(agg::OP_SUM, 2);
        let j = compute_journal(&input).unwrap();
        assert_eq!(j.op, agg::OP_SUM);
        assert_eq!(j.count, 3);
        assert_eq!(j.result, 310); // 50+250+10
        assert!(j.k_met);
        assert!(!j.overflow);
        // the journal carries the same query_hash the contract will rebind against
        assert_eq!(
            j.query_hash,
            query_hash(agg::OP_SUM, 2, 2, &input.filter_bytecode, &input.consts, &[])
        );
        assert_eq!(decode_journal(&encode_journal(&j)), Some(j));
    }

    #[test]
    fn compute_journal_for_avg_query() {
        let input = age_gt_30_input(agg::OP_AVG, 2);
        let j = compute_journal(&input).unwrap();
        assert_eq!(j.op, agg::OP_AVG);
        assert_eq!(j.result, 10333); // floor(310*100/3) ×100 fixed-point
        assert!(j.k_met);
    }
}

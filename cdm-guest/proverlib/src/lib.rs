//! Prover-CLI input parsing: CSV dataset → `Vec<Vec<u64>>`, query params JSON → `QueryInput`.
//! Kept dependency-light (no risc0/methods) so it's fast to unit-test. The CLI binary (`host`)
//! and the prover-service both build on these functions.
use cdm_shared::QueryInput;
use serde::Deserialize;

/// Parse a CSV of unsigned integers — one row per non-blank line, comma-separated `u64` cells.
/// No header. Every row must have the same number of columns. Whitespace around cells is trimmed.
pub fn parse_csv(text: &str) -> Result<Vec<Vec<u64>>, String> {
    let mut rows: Vec<Vec<u64>> = Vec::new();
    for (lineno, raw) in text.lines().enumerate() {
        let line = raw.trim();
        if line.is_empty() {
            continue;
        }
        let mut row = Vec::new();
        for cell in line.split(',') {
            let c = cell.trim();
            let v: u64 = c
                .parse()
                .map_err(|_| format!("line {}: '{}' is not a u64", lineno + 1, c))?;
            row.push(v);
        }
        if let Some(first) = rows.first() {
            if row.len() != first.len() {
                return Err(format!(
                    "line {}: {} columns, expected {}",
                    lineno + 1,
                    row.len(),
                    first.len()
                ));
            }
        }
        rows.push(row);
    }
    if rows.is_empty() {
        return Err("no data rows".into());
    }
    Ok(rows)
}

/// Query parameters as supplied on the CLI / over the wire (JSON). `filter_bytecode` is a hex
/// string (the compiled filter DSL); `weights` are `u16` (validated to fit on deserialize).
#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub struct ProveParams {
    pub op: u8,
    pub target_field: u16,
    pub k: u64,
    #[serde(default)]
    pub filter_bytecode: String,
    #[serde(default)]
    pub consts: Vec<u64>,
    #[serde(default)]
    pub weights: Vec<u16>,
}

impl ProveParams {
    pub fn from_json(s: &str) -> Result<ProveParams, String> {
        serde_json::from_str(s).map_err(|e| format!("bad params json: {}", e))
    }
}

/// Combine a parsed dataset and query params into the guest's `QueryInput`.
pub fn to_query_input(rows: Vec<Vec<u64>>, params: &ProveParams) -> Result<QueryInput, String> {
    let filter_bytecode = if params.filter_bytecode.is_empty() {
        Vec::new()
    } else {
        hex::decode(&params.filter_bytecode)
            .map_err(|e| format!("filter_bytecode not hex: {}", e))?
    };
    Ok(QueryInput {
        rows,
        op: params.op,
        target_field: params.target_field,
        k: params.k,
        filter_bytecode,
        consts: params.consts.clone(),
        weights: params.weights.clone(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_csv_basic() {
        let rows = parse_csv("1,25,100\n2,40,50").unwrap();
        assert_eq!(rows, vec![vec![1, 25, 100], vec![2, 40, 50]]);
    }

    #[test]
    fn parse_csv_trims_and_skips_blank_lines() {
        let rows = parse_csv("\n 1, 25 ,100 \n\n2,40,50\n").unwrap();
        assert_eq!(rows, vec![vec![1, 25, 100], vec![2, 40, 50]]);
    }

    #[test]
    fn parse_csv_rejects_ragged_rows() {
        let err = parse_csv("1,2,3\n4,5").unwrap_err();
        assert!(err.contains("expected 3"), "got: {}", err);
    }

    #[test]
    fn parse_csv_rejects_non_numeric() {
        let err = parse_csv("1,2,3\n4,five,6").unwrap_err();
        assert!(err.contains("not a u64"), "got: {}", err);
    }

    #[test]
    fn parse_csv_rejects_empty() {
        assert!(parse_csv("\n  \n").is_err());
    }

    #[test]
    fn params_from_json_full() {
        let p = ProveParams::from_json(
            r#"{"op":1,"target_field":2,"k":3,"filter_bytecode":"01000102000010","consts":[30],"weights":[1,2,3]}"#,
        )
        .unwrap();
        assert_eq!(
            p,
            ProveParams {
                op: 1,
                target_field: 2,
                k: 3,
                filter_bytecode: "01000102000010".into(),
                consts: vec![30],
                weights: vec![1, 2, 3],
            }
        );
    }

    #[test]
    fn params_from_json_minimal_defaults() {
        // no filter / consts / weights → empty defaults (e.g. COUNT over all rows)
        let p = ProveParams::from_json(r#"{"op":3,"target_field":0,"k":2}"#).unwrap();
        assert_eq!(p.filter_bytecode, "");
        assert!(p.consts.is_empty());
        assert!(p.weights.is_empty());
    }

    #[test]
    fn to_query_input_decodes_filter_hex() {
        let p = ProveParams::from_json(
            r#"{"op":1,"target_field":2,"k":2,"filter_bytecode":"01000102000010","consts":[30],"weights":[]}"#,
        )
        .unwrap();
        let qi = to_query_input(vec![vec![1, 25, 100]], &p).unwrap();
        assert_eq!(qi.op, 1);
        assert_eq!(qi.target_field, 2);
        assert_eq!(qi.k, 2);
        assert_eq!(qi.filter_bytecode, vec![0x01, 0x00, 0x01, 0x02, 0x00, 0x00, 0x10]);
        assert_eq!(qi.consts, vec![30]);
        assert_eq!(qi.rows, vec![vec![1, 25, 100]]);
    }

    #[test]
    fn to_query_input_empty_filter() {
        let p = ProveParams::from_json(r#"{"op":3,"target_field":0,"k":1}"#).unwrap();
        let qi = to_query_input(vec![vec![1]], &p).unwrap();
        assert!(qi.filter_bytecode.is_empty());
    }

    #[test]
    fn to_query_input_rejects_bad_hex() {
        let p = ProveParams::from_json(r#"{"op":3,"target_field":0,"k":1,"filter_bytecode":"xyz"}"#)
            .unwrap();
        assert!(to_query_input(vec![vec![1]], &p).is_err());
    }
}

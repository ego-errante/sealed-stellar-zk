//! Aggregation over a dataset: apply the filter per row, accumulate per op, enforce k-anonymity.
//! Op order matches mini-cdm constants.ts. Full op set: COUNT/SUM/AVG/WEIGHTED_SUM/MIN/MAX with
//! sticky overflow tracking. AVG is ×100 fixed-point (`floor(sum*100/count)`), no divisor —
//! diverges from mini-cdm's AVG_P-with-divisor. WEIGHTED_SUM = Σ_kept-rows Σ_i row[i]·weights[i].

use crate::vm::{eval_filter, FilterError};

pub const OP_WEIGHTED_SUM: u8 = 0;
pub const OP_SUM: u8 = 1;
pub const OP_AVG: u8 = 2;
pub const OP_COUNT: u8 = 3;
pub const OP_MIN: u8 = 4;
pub const OP_MAX: u8 = 5;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AggResult {
    pub count: u64,
    pub result: u64,
    pub k_met: bool,
    pub overflow: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AggError {
    Filter(FilterError),
    UnsupportedOp(u8),
    /// A referenced column index (target_field or weight index) is outside the row width.
    FieldOutOfRange(usize),
}

/// Run the query over `rows`. Result is ZEROED when k-anonymity is not met. Aggregates use
/// wrapping arithmetic with a sticky `overflow` flag (mirrors mini-cdm's FHE overflow tracking):
/// the wrapped value is still returned, but `overflow=true` marks it as not meaningful.
pub fn run(
    op: u8,
    target_field: u16,
    k: u64,
    weights: &[u16],
    bytecode: &[u8],
    consts: &[u64],
    rows: &[Vec<u64>],
) -> Result<AggResult, AggError> {
    if op > OP_MAX {
        return Err(AggError::UnsupportedOp(op));
    }
    let tf = target_field as usize;

    let mut count: u64 = 0;
    let mut sum: u64 = 0; // SUM / AVG accumulator
    let mut wsum: u64 = 0; // WEIGHTED_SUM accumulator
    let mut minv: u64 = 0;
    let mut maxv: u64 = 0;
    let mut minmax_init = false;
    let mut overflow = false;

    for row in rows {
        if !eval_filter(bytecode, consts, row).map_err(AggError::Filter)? {
            continue;
        }
        count += 1;
        match op {
            OP_COUNT => {}
            OP_SUM | OP_AVG => {
                let v = field(row, tf)?;
                let (n, o) = sum.overflowing_add(v);
                overflow |= o;
                sum = n;
            }
            OP_WEIGHTED_SUM => {
                let mut row_ws: u64 = 0;
                for (i, w) in weights.iter().enumerate() {
                    let fv = field(row, i)?;
                    let (wv, mo) = fv.overflowing_mul(*w as u64);
                    overflow |= mo;
                    let (n, ao) = row_ws.overflowing_add(wv);
                    overflow |= ao;
                    row_ws = n;
                }
                let (n, o) = wsum.overflowing_add(row_ws);
                overflow |= o;
                wsum = n;
            }
            OP_MIN => {
                let v = field(row, tf)?;
                minv = if minmax_init { minv.min(v) } else { v };
                minmax_init = true;
            }
            OP_MAX => {
                let v = field(row, tf)?;
                maxv = if minmax_init { maxv.max(v) } else { v };
                minmax_init = true;
            }
            other => return Err(AggError::UnsupportedOp(other)),
        }
    }

    let result_raw = match op {
        OP_COUNT => count,
        OP_SUM => sum,
        OP_AVG => {
            if count == 0 {
                0
            } else {
                // ×100 fixed-point average: floor(sum * 100 / count). u128 avoids the *100 overflow;
                // only flag overflow if the final value can't fit in u64.
                let avg = (sum as u128 * 100) / count as u128;
                if avg > u64::MAX as u128 {
                    overflow = true;
                }
                avg as u64
            }
        }
        OP_WEIGHTED_SUM => wsum,
        OP_MIN => minv,
        OP_MAX => maxv,
        other => return Err(AggError::UnsupportedOp(other)),
    };

    let k_met = count >= k;
    // When k-anonymity suppresses the result, suppress the overflow flag too: otherwise a hidden
    // matching subset (<k rows) that overflowed would still signal overflow=true, leaking its
    // existence through a channel suppression was meant to close.
    let (result, overflow) = if k_met { (result_raw, overflow) } else { (0, false) };
    Ok(AggResult {
        count,
        result,
        k_met,
        overflow,
    })
}

/// Read column `idx` from a row, erroring if the row is too narrow.
fn field(row: &[u64], idx: usize) -> Result<u64, AggError> {
    row.get(idx).copied().ok_or(AggError::FieldOutOfRange(idx))
}

#[cfg(test)]
mod tests {
    use super::*;

    // rows: [id, age, balance]; ages 25,40,33,19,51
    fn rows() -> Vec<Vec<u64>> {
        vec![
            vec![1, 25, 100],
            vec![2, 40, 50],
            vec![3, 33, 250],
            vec![4, 19, 999],
            vec![5, 51, 10],
        ]
    }

    // filter: field[1] (age) > 30
    fn age_gt_30() -> (Vec<u8>, Vec<u64>) {
        let mut bc = Vec::new();
        bc.push(0x01); // PUSH_FIELD
        bc.extend_from_slice(&1u16.to_be_bytes());
        bc.push(0x02); // PUSH_CONST
        bc.extend_from_slice(&0u16.to_be_bytes());
        bc.push(0x10); // GT
        (bc, vec![30])
    }

    #[test]
    fn count_with_filter_k_met() {
        let (bc, consts) = age_gt_30();
        let r = run(OP_COUNT, 0, 2, &[], &bc, &consts, &rows()).unwrap();
        assert_eq!(r.count, 3); // ages 40,33,51
        assert_eq!(r.result, 3); // COUNT result == count
        assert!(r.k_met);
        assert!(!r.overflow);
    }

    #[test]
    fn count_k_not_met_zeroes_result() {
        let (bc, consts) = age_gt_30();
        let r = run(OP_COUNT, 0, 4, &[], &bc, &consts, &rows()).unwrap();
        assert_eq!(r.count, 3);
        assert!(!r.k_met); // 3 < 4
        assert_eq!(r.result, 0); // suppressed
    }

    #[test]
    fn count_no_filter_counts_all() {
        let r = run(OP_COUNT, 0, 1, &[], &[], &[], &rows()).unwrap();
        assert_eq!(r.count, 5);
        assert_eq!(r.result, 5);
        assert!(r.k_met);
    }

    // kept rows under age>30: [2,40,50],[3,33,250],[5,51,10] (count 3)
    #[test]
    fn sum_target_balance_field2() {
        let (bc, consts) = age_gt_30();
        let r = run(OP_SUM, 2, 2, &[], &bc, &consts, &rows()).unwrap();
        assert_eq!(r.count, 3);
        assert_eq!(r.result, 310); // 50+250+10
        assert!(r.k_met);
        assert!(!r.overflow);
    }

    #[test]
    fn sum_no_filter_field2() {
        let r = run(OP_SUM, 2, 1, &[], &[], &[], &rows()).unwrap();
        assert_eq!(r.result, 1409); // 100+50+250+999+10
    }

    #[test]
    fn avg_fixed_point_x100_field2() {
        let (bc, consts) = age_gt_30();
        let r = run(OP_AVG, 2, 2, &[], &bc, &consts, &rows()).unwrap();
        // floor(310 * 100 / 3) = floor(10333.33) = 10333
        assert_eq!(r.result, 10333);
        assert!(!r.overflow);
    }

    #[test]
    fn avg_k_not_met_zeroes_result() {
        let (bc, consts) = age_gt_30();
        let r = run(OP_AVG, 2, 4, &[], &bc, &consts, &rows()).unwrap();
        assert!(!r.k_met);
        assert_eq!(r.result, 0);
    }

    #[test]
    fn min_target_balance_field2() {
        let (bc, consts) = age_gt_30();
        let r = run(OP_MIN, 2, 2, &[], &bc, &consts, &rows()).unwrap();
        assert_eq!(r.result, 10); // min(50,250,10)
    }

    #[test]
    fn max_target_balance_field2() {
        let (bc, consts) = age_gt_30();
        let r = run(OP_MAX, 2, 2, &[], &bc, &consts, &rows()).unwrap();
        assert_eq!(r.result, 250); // max(50,250,10)
    }

    #[test]
    fn min_no_filter_field1_age() {
        let r = run(OP_MIN, 1, 1, &[], &[], &[], &rows()).unwrap();
        assert_eq!(r.result, 19); // youngest
    }

    #[test]
    fn weighted_sum_weights_1_2_3() {
        let (bc, consts) = age_gt_30();
        // per kept row: row[0]*1 + row[1]*2 + row[2]*3
        // [2,40,50]=232  [3,33,250]=819  [5,51,10]=137  → 1188
        let r = run(OP_WEIGHTED_SUM, 0, 2, &[1u16, 2, 3], &bc, &consts, &rows()).unwrap();
        assert_eq!(r.result, 1188);
        assert!(!r.overflow);
    }

    #[test]
    fn sum_overflow_flagged() {
        // two rows, target field 0: u64::MAX + 5 wraps → overflow flagged
        let big = vec![vec![u64::MAX], vec![5u64]];
        let r = run(OP_SUM, 0, 1, &[], &[], &[], &big).unwrap();
        assert_eq!(r.count, 2);
        assert!(r.overflow);
        assert_eq!(r.result, 4); // MAX.wrapping_add(5)
    }

    #[test]
    fn overflow_suppressed_when_k_not_met() {
        // matching subset overflows u64 but count < k → result AND overflow are both suppressed,
        // so a k-suppressed aggregate can't leak that a small overflowing subset exists.
        let big = vec![vec![u64::MAX], vec![5u64]];
        let r = run(OP_SUM, 0, 3, &[], &[], &[], &big).unwrap(); // k=3 > count 2
        assert_eq!(r.count, 2);
        assert!(!r.k_met);
        assert_eq!(r.result, 0);
        assert!(!r.overflow, "overflow must be cleared under k-anon suppression");
    }

    #[test]
    fn weighted_sum_mul_overflow_flagged() {
        // field 0 = u64::MAX, weight 2 → mul overflow
        let big = vec![vec![u64::MAX]];
        let r = run(OP_WEIGHTED_SUM, 0, 1, &[2u16], &[], &[], &big).unwrap();
        assert!(r.overflow);
    }

    #[test]
    fn field_out_of_range_errors() {
        // target field 9 doesn't exist (rows have 3 cols)
        let err = run(OP_SUM, 9, 1, &[], &[], &[], &rows()).unwrap_err();
        assert_eq!(err, AggError::FieldOutOfRange(9));
    }
}

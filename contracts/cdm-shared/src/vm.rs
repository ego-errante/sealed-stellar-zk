//! Stack-based filter VM, ported from mini-cdm's Solidity `_evalFilter`.
//! Plaintext evaluation over a row (the FHE version compared ciphertexts; here it's real bools).
//! Bytecode field/const indices are big-endian u16 (matches filterDsl.ts output).
//! Empty bytecode = accept all. Max stack depth 8.

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FilterError {
    Truncated,
    InvalidOpcode(u8),
    InvalidFieldIndex(u16),
    InvalidConstIndex(u16),
    StackOverflow,
    StackUnderflow,
    InvalidFinalState,
}

const MAX_DEPTH: usize = 8;

// opcodes
const PUSH_FIELD: u8 = 0x01;
const PUSH_CONST: u8 = 0x02;
const GT: u8 = 0x10;
const GE: u8 = 0x11;
const LT: u8 = 0x12;
const LE: u8 = 0x13;
const EQ: u8 = 0x14;
const NE: u8 = 0x15;
const AND: u8 = 0x20;
const OR: u8 = 0x21;
const NOT: u8 = 0x22;

/// Evaluate `bytecode` against `row`, reading constants from `consts`. Empty bytecode => true.
pub fn eval_filter(bytecode: &[u8], consts: &[u64], row: &[u64]) -> Result<bool, FilterError> {
    if bytecode.is_empty() {
        return Ok(true);
    }
    let mut vstack: Vec<u64> = Vec::new();
    let mut cstack: Vec<u64> = Vec::new();
    let mut bstack: Vec<bool> = Vec::new();

    let mut i = 0usize;
    while i < bytecode.len() {
        let op = bytecode[i];
        i += 1;
        match op {
            PUSH_FIELD => {
                if i + 2 > bytecode.len() {
                    return Err(FilterError::Truncated);
                }
                let idx = u16::from_be_bytes([bytecode[i], bytecode[i + 1]]);
                i += 2;
                let f = *row.get(idx as usize).ok_or(FilterError::InvalidFieldIndex(idx))?;
                if vstack.len() >= MAX_DEPTH {
                    return Err(FilterError::StackOverflow);
                }
                vstack.push(f);
            }
            PUSH_CONST => {
                if i + 2 > bytecode.len() {
                    return Err(FilterError::Truncated);
                }
                let idx = u16::from_be_bytes([bytecode[i], bytecode[i + 1]]);
                i += 2;
                let c = *consts.get(idx as usize).ok_or(FilterError::InvalidConstIndex(idx))?;
                if cstack.len() >= MAX_DEPTH {
                    return Err(FilterError::StackOverflow);
                }
                cstack.push(c);
            }
            GT | GE | LT | LE | EQ | NE => {
                let v = vstack.pop().ok_or(FilterError::StackUnderflow)?;
                let c = cstack.pop().ok_or(FilterError::StackUnderflow)?;
                let r = match op {
                    GT => v > c,
                    GE => v >= c,
                    LT => v < c,
                    LE => v <= c,
                    EQ => v == c,
                    _ => v != c, // NE
                };
                if bstack.len() >= MAX_DEPTH {
                    return Err(FilterError::StackOverflow);
                }
                bstack.push(r);
            }
            AND | OR => {
                let b = bstack.pop().ok_or(FilterError::StackUnderflow)?;
                let a = bstack.pop().ok_or(FilterError::StackUnderflow)?;
                bstack.push(if op == AND { a && b } else { a || b });
            }
            NOT => {
                let a = bstack.pop().ok_or(FilterError::StackUnderflow)?;
                bstack.push(!a);
            }
            other => return Err(FilterError::InvalidOpcode(other)),
        }
    }

    if bstack.len() != 1 || !vstack.is_empty() || !cstack.is_empty() {
        return Err(FilterError::InvalidFinalState);
    }
    Ok(bstack[0])
}

#[cfg(test)]
mod tests {
    use super::*;

    // helpers to build bytecode
    fn push_field(b: &mut Vec<u8>, idx: u16) {
        b.push(PUSH_FIELD);
        b.extend_from_slice(&idx.to_be_bytes());
    }
    fn push_const(b: &mut Vec<u8>, idx: u16) {
        b.push(PUSH_CONST);
        b.extend_from_slice(&idx.to_be_bytes());
    }

    #[test]
    fn empty_filter_accepts_all() {
        assert_eq!(eval_filter(&[], &[], &[1, 2, 3]), Ok(true));
    }

    #[test]
    fn single_gt_true_and_false() {
        // field[0] > 30
        let mut bc = Vec::new();
        push_field(&mut bc, 0);
        push_const(&mut bc, 0);
        bc.push(GT);
        assert_eq!(eval_filter(&bc, &[30], &[40]), Ok(true));
        assert_eq!(eval_filter(&bc, &[30], &[20]), Ok(false));
        assert_eq!(eval_filter(&bc, &[30], &[30]), Ok(false)); // strict
    }

    #[test]
    fn all_comparators() {
        let cases: &[(u8, u64, u64, bool)] = &[
            (GE, 30, 30, true),
            (LT, 30, 20, true),
            (LE, 30, 30, true),
            (EQ, 42, 42, true),
            (NE, 42, 7, true),
            (NE, 42, 42, false),
        ];
        for (op, c, field, want) in cases {
            let mut bc = Vec::new();
            push_field(&mut bc, 0);
            push_const(&mut bc, 0);
            bc.push(*op);
            assert_eq!(eval_filter(&bc, &[*c], &[*field]), Ok(*want), "op {op:#x}");
        }
    }

    #[test]
    fn and_or_not() {
        // (field0 > 18) AND (field1 < 100)
        let mut and_bc = Vec::new();
        push_field(&mut and_bc, 0);
        push_const(&mut and_bc, 0);
        and_bc.push(GT);
        push_field(&mut and_bc, 1);
        push_const(&mut and_bc, 1);
        and_bc.push(LT);
        and_bc.push(AND);
        assert_eq!(eval_filter(&and_bc, &[18, 100], &[40, 50]), Ok(true));
        assert_eq!(eval_filter(&and_bc, &[18, 100], &[40, 150]), Ok(false));

        // (field0 == 1) OR (field0 == 2)
        let mut or_bc = Vec::new();
        push_field(&mut or_bc, 0);
        push_const(&mut or_bc, 0);
        or_bc.push(EQ);
        push_field(&mut or_bc, 0);
        push_const(&mut or_bc, 1);
        or_bc.push(EQ);
        or_bc.push(OR);
        assert_eq!(eval_filter(&or_bc, &[1, 2], &[2]), Ok(true));
        assert_eq!(eval_filter(&or_bc, &[1, 2], &[3]), Ok(false));

        // NOT (field0 == 0)
        let mut not_bc = Vec::new();
        push_field(&mut not_bc, 0);
        push_const(&mut not_bc, 0);
        not_bc.push(EQ);
        not_bc.push(NOT);
        assert_eq!(eval_filter(&not_bc, &[0], &[5]), Ok(true));
        assert_eq!(eval_filter(&not_bc, &[0], &[0]), Ok(false));
    }

    #[test]
    fn errors_on_malformed() {
        // truncated PUSH_FIELD (missing index byte)
        assert_eq!(eval_filter(&[PUSH_FIELD, 0x00], &[], &[1]), Err(FilterError::Truncated));
        // comparator with empty stacks -> underflow
        assert_eq!(eval_filter(&[GT], &[], &[1]), Err(FilterError::StackUnderflow));
        // out-of-range field index
        let mut bc = Vec::new();
        push_field(&mut bc, 5);
        push_const(&mut bc, 0);
        bc.push(GT);
        assert_eq!(eval_filter(&bc, &[1], &[1, 2, 3]), Err(FilterError::InvalidFieldIndex(5)));
        // leftover values -> invalid final state (two comparisons, no AND)
        let mut bc2 = Vec::new();
        push_field(&mut bc2, 0);
        push_const(&mut bc2, 0);
        bc2.push(GT);
        push_field(&mut bc2, 0);
        push_const(&mut bc2, 0);
        bc2.push(GT);
        assert_eq!(eval_filter(&bc2, &[1], &[2]), Err(FilterError::InvalidFinalState));
    }
}

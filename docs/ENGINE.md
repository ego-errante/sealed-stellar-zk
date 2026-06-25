# The computation engine

> What actually runs inside the proof — the query language, the filter VM, the aggregates, and the
> commitments that bind them. This is the technically interesting core of Sealed: not "a ZK proof
> exists," but **a small verifiable query engine** whose every step is re-executed inside the RISC Zero
> zkVM and bound on-chain by Soroban.

The same engine lives in three places and is held byte-identical by a cross-implementation test vector:

| Where | Language | Role |
|-------|----------|------|
| `contracts/cdm-shared` | Rust (`no_std`) | the reference engine — Merkle, filter VM, aggregates, `query_hash`, journal |
| `cdm-guest/methods/guest` | Rust → RISC Zero zkVM | runs the engine **in-circuit**; commits the journal |
| `frontend/packages/shared` | TypeScript | compiles filters to the same bytecode and **decodes** them back to text |

The guest is deliberately thin: it is `commit_slice(encode_journal(compute_journal(input)?))`. All the
logic is in `cdm-shared`, so the proven computation and the contract's checks read from the same source.

---

## 1. The query model

A query is four things:

```
op            one of WEIGHTED_SUM | SUM | AVG | COUNT | MIN | MAX
target_field  which column the aggregate reads (ignored by COUNT / WEIGHTED_SUM)
filter        a boolean predicate over a row, compiled to stack bytecode (optional)
k             k-anonymity floor — suppress the answer if fewer than k rows match
```

Columns are referenced by **index**; the dataset's on-chain schema (`column_names`) maps an index to a
human label, so the UI renders a query as `COUNT(*) WHERE age > 30` rather than `… field 1 …`. The
names are committed metadata — see [§7](#7-what-is-proven-vs-asserted).

### Worked example

A 5-row dataset, columns `[id, age, balance]`:

```
id  age  balance
 1   25      100
 2   40       50
 3   33      250
 4   19      999
 5   51       10
```

With the filter **`age > 30`** (keeps rows 2, 3, 5 — ages 40, 33, 51), every op:

| Query | Result | Why |
|-------|-------:|-----|
| `COUNT(*) WHERE age > 30` | `3` | three rows match |
| `SUM(balance) WHERE age > 30` | `310` | 50 + 250 + 10 |
| `AVG(balance) WHERE age > 30` | `10333` | `floor(310·100 / 3)` → **103.33** (×100 fixed-point) |
| `MIN(balance) WHERE age > 30` | `10` | min(50, 250, 10) |
| `MAX(balance) WHERE age > 30` | `250` | max(50, 250, 10) |
| `WEIGHTED_SUM[1,2,3] WHERE age > 30` | `1188` | Σ rows Σᵢ rowᵢ·wᵢ = 232 + 819 + 137 |

The Merkle root is taken over **all** rows (not just matches), so it commits the whole dataset
regardless of the filter: `bad285cb8effd6c429a1ae614c80fe5bc017d974b257df1728320cf5dbf2873c`.

---

## 2. The filter VM

The filter is a **stack (postfix) program**. Empty bytecode = "accept every row." Otherwise the VM
walks the bytes, pushing operands and applying operators, and the row passes iff the program reduces to
a single `true`.

### Opcodes

| Byte | Op | Effect |
|-----:|----|--------|
| `0x01` | `PUSH_FIELD idx` | push `row[idx]` (idx = **big-endian u16**) |
| `0x02` | `PUSH_CONST idx` | push `consts[idx]` (idx = big-endian u16) |
| `0x10`–`0x15` | `GT GE LT LE EQ NE` | pop field & const, push the boolean compare |
| `0x20` `0x21` | `AND` `OR` | pop two booleans, push the combination |
| `0x22` | `NOT` | pop one boolean, push its negation |

The reference VM (`cdm-shared::vm`) keeps three typed stacks (values, constants, booleans), caps depth
at **8**, and rejects malformed programs explicitly: truncated operands, out-of-range field/const
indices, stack under/overflow, and a final state that isn't exactly one boolean (`InvalidFinalState`).
In-circuit, every one of those checks is part of the proof — a filter that doesn't cleanly reduce can't
produce a valid journal.

### Example

`age > 30` compiles to seven bytes + one constant:

```
01 00 01   PUSH_FIELD 1      (age)
02 00 00   PUSH_CONST 0
10         GT                 → age > consts[0]
consts = [30]
```

Constants ride **alongside** the bytecode (by index), never inside it. This is what lets the bytecode
be public and reusable while the comparison values stay in a separate `consts` array — and it's why the
`query_hash` ([§6](#6-binding-the-query-query_hash)) commits the bytecode and the consts together.

### Decoding (legibility)

`frontend/packages/shared/filterDecode.ts` is the **exact inverse** of the compiler: it walks the same
bytecode, resolves const indices against the request's `consts`, and rebuilds the predicate tree —
`(age > 30) AND (balance ≥ 1000)`. Because it is byte-driven (not a parallel re-implementation), what
the UI shows the owner and buyer is provably the predicate the proof evaluated. Round-trip tests assert
`compile → decode` is identity, and consts are carried as decimal strings so a `u64` above 2⁵³ renders
exactly.

---

## 3. Aggregation

For each row that passes the filter, the engine accumulates per op. `count` is always tracked (it
drives k-anonymity); the `result` depends on the op:

| Op | Code | `result` |
|----|-----:|----------|
| `WEIGHTED_SUM` | 0 | Σ kept-rows Σᵢ `row[i] · weights[i]` |
| `SUM` | 1 | Σ kept-rows `row[target]` |
| `AVG` | 2 | `floor(sum · 100 / count)` — ×100 fixed-point (so `103.33` is carried as `10333`) |
| `COUNT` | 3 | `count` |
| `MIN` | 4 | min `row[target]` over kept rows |
| `MAX` | 5 | max `row[target]` over kept rows |

`AVG` uses a `u128` intermediate so the `·100` can't overflow before the divide. A `target_field` or
weight index outside the row width is a hard error (`FieldOutOfRange`), not a silent zero.

### Overflow

Aggregates use **wrapping** `u64` arithmetic with a **sticky `overflow` flag** (mirroring the FHE
original's overflow tracking). The wrapped value is still returned, but `overflow = true` marks it as
not meaningful — the UI renders "Overflow," never a misleading number.

---

## 4. k-anonymity, in the proof

`k_met = count >= k`. When fewer than `k` rows match, the result is **suppressed inside the circuit** —
`result` is zeroed before it ever reaches the journal. The buyer can't de-anonymize the dataset by
narrowing a filter down to a single person: the proof itself refuses to reveal an aggregate over too
few rows.

One subtlety worth calling out, because it's the kind of thing that leaks in naïve implementations:
when k-anonymity suppresses the result, the **overflow flag is cleared too**. Otherwise a hidden
sub-`k` subset that happened to overflow would still signal `overflow = true`, leaking the existence of
that subset through exactly the channel suppression was meant to close. (`agg.rs`,
`overflow_suppressed_when_k_not_met`.)

---

## 5. The Merkle commitment

The dataset is committed as a binary sha256 Merkle tree:

- **leaf** = `sha256( concat of each column as little-endian u64 )`
- **internal** = `sha256(left ‖ right)`, an odd node duplicated; an empty dataset hashes to zero.

The guest re-derives this root from the rows it's given and puts it in the journal, so a proof is bound
to rows that hash to the **dataset's committed root** — no substituting or cherry-picking rows. sha256
(not Poseidon) keeps the scheme simple and fully in-circuit; Poseidon is named future work and would
cut proving cycles substantially.

---

## 6. Binding the query (`query_hash`)

A valid proof over the *wrong query* would be worthless, so the query is committed too. `query_hash =
sha256(canonical_query_bytes)`, with a fixed, length-prefixed encoding (lengths and scalars
little-endian; the embedded filter bytecode keeps its big-endian operands):

```
op            u8
target_field  u16 LE
k             u64 LE
len(bytecode) u16 LE   ‖ bytecode
len(consts)   u16 LE   ‖ consts   (u64 LE each)
len(weights)  u16 LE   ‖ weights  (u16 LE each)
```

So `COUNT(age > 30), k = 2` has the preimage:

```
03                       op = COUNT
00 00                    target_field = 0
02 00 00 00 00 00 00 00  k = 2
07 00                    bytecode length = 7
01 00 01 02 00 00 10     PUSH_FIELD 1, PUSH_CONST 0, GT
01 00                    1 constant
1e 00 00 00 00 00 00 00  consts[0] = 30
00 00                    0 weights
```

The guest commits this hash in the journal; `JobManager.fulfill` **recomputes it** from the request's
on-chain `(op, target, filter, consts, weights, k)` and rejects any proof whose journal doesn't match.
An owner can't answer an easier question than the one that was asked.

---

## 7. The journal — and what it binds

The guest's only public output is a fixed-layout **103-byte journal**:

```
root[32] │ query_hash[32] │ op[1] │ num_columns[4 LE] │ k[8 LE] │
count[8 LE] │ result[8 LE] │ k_met[1] │ overflow[1] │ request_id[8 LE]
```

It carries **no rows** — only the root, the query identity, the scalar result, and the flags.
`JobManager.fulfill` first verifies the Groth16 proof against `sha256(journal)` and the trusted guest
`image_id`, then binds the journal to on-chain facts: `root == dataset.merkle_root`, `num_columns`,
`op == request.op`, `k == dataset.k`, the recomputed `query_hash`, and `request_id == request_id` (so a
valid proof can't be **replayed** to fulfill a different, otherwise-identical request). Only then is the
result stored. See the [README](../README.md#what-the-proof-attests--and-how-its-bound) for the on-chain side.

---

## 8. What is proven vs. asserted

The engine proves the **computation**: the aggregate is the honest result of the agreed query over rows
hashing to the committed root, with k-anonymity enforced — none of it forgeable. What it does **not**
yet prove is that a column's *label* is truthful. `column_names` is committed on-chain at registration
(immutable thereafter, identical for every buyer, and what the UI renders), which is a real improvement
over an off-chain data dictionary — but the names are owner-asserted metadata, not folded into
`query_hash` or the Merkle root. A dishonest owner could still label index 1 "age" when it isn't.
Closing that gap (hashing the schema into the commitment the proof already covers) is named future work
in the [trust model](../README.md#trust-model--privacy-read-this).

---

## Cross-implementation consistency

The TypeScript compiler (`filterDsl.ts`), the TypeScript decoder (`filterDecode.ts`), and the Rust
engine (`cdm-shared`) must agree to the byte. They're held together by:

- a **frozen Merkle vector** and **canonical-query-bytes vectors** in `cdm-shared` tests,
- a **cross-impl `query_hash` test vector** shared between the Rust contract and the TS frontend,
- **round-trip** tests: `compileFilterDSL → decodeFilter` is identity, and `FilterBuilder bytecode ↔
  on-chain params ↔ prover params` is byte-stable.

Run them with `cargo test` (54 engine/contract tests) and `npm test` in `frontend/` (TS glue + decoder
+ query-parser tests).

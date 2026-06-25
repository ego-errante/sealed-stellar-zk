# Testnet Deployment

Network: **Stellar Testnet** (Protocol 27, BN254 host functions live). Deployed 2026-06-22.

**Current deployment = post-code-review** (the full-op guest + the security/hardening fixes, including
the request_id-bound 103-byte journal). The JobManager binds an immutable `image_id`, so any change to
the guest ELF (`cdm-shared`'s journal/agg) needs a fresh JobManager — redeploy with `scripts/redeploy.sh`.
The Nethermind verifier stack is unchanged and reused across redeploys. See the addresses below; earlier
(superseded) deployments are listed for provenance.

## Identities (testnet, funded via friendbot)
| Role | Address |
|------|---------|
| deployer (post-review redeploy) | `GBYZXUSGZF7NTDORNSZDHH7TPZV2MVWUWHHIGTQY7RG2AY3WVEQ5NOGX` |
| deployer (original) | `GDNPBI646QXUCQ7XXZDX3SSXC6EHCBBZT5LE6BFZYBLDGGGKQFUQZXDY` |
| owner    | `GA5K6SBXYHPFANBX4OI37AOH7NDQHBPSQUZKY5HOH5BHMJMZGIXADHGV` |
| buyer    | `GBKWGY3J6YER3J4VQ34LSXNEPR5T5KFA2YUVBR4ZFZTYOSA4S5EJGRID` |

## Verifier stack (Nethermind risc0 verifier, via scripts/manage.sh)
| Contract | Address |
|----------|---------|
| TimelockController | `CAE57GGWYYE3B7M4NES2C275ZRCKWR5WM5N3D375T34RZIKNLJAKKJUR` |
| VerifierRouter     | `CBRBVQP2GOW6FONS4S4Q6BEC53BAJJGWOJRXC4KNDCFJ6WG673MQX633` |
| Groth16Verifier    | `CALVN6PA6YIGSIKI6T7ZZAP2IW7UF3N4MLNVMOU2DWQ7HUYFXLMBDIX4` |
| EmergencyStop      | `CAKU267ACKQ3GWML32HLPPNM4UHMIIWNDVPA4KCXJYQBEMXUBLIVWATV` |

- Selector: `73c457ba` (routable). Verifier params VERSION 3.0.0. Timelock min-delay 0.

## Our contracts

The current pair is **schema-enabled** — the `Dataset` carries `column_names` (Phase-1 addition). The
guest, journal, `query_hash`, and `image_id` are unchanged, so the pre-baked demo proof fulfills. The
**frontend bindings point at this pair** (`CB7F7A23…`/`CDB2W5HP…`). It was deployed fresh for the demo
recording (2026-06-25) and **holds the demo's live run**: dataset 1 + request 1 fulfilled, `get_result(1)
= (3, true, false)`. (The prior schema pair `CASQR7…`/`CDIWSDJ…` was retired when a demo take submitted
request 1 with `target_field=1` instead of `0` — for COUNT the target is ignored in the result but is part
of `query_hash`, so that request could never match the pre-baked proof; redeployed pristine to reset ids.)

Prior pairs were post-review (full-op, request_id-bound guest, image_id `6290a9cb…`); the pre-schema
ones were deployed from identical pre-schema wasm. `CBWI…`/`CBBS…` was the last **pre-schema** pristine
pair (2026-06-24). Each prior pristine pair was retired once its request id 1 was consumed by a
real-Freighter dry run: `CCUE…`/`CDFH…` (dry-run #4); `CC3J…`/`CDVD…` (dry-run #3 — request 1 was
submitted with the wrong filter const `[0]` instead of `[30]`, so its `query_hash` could never match
the pre-baked proof); `CBP33…`/`CDN2…` (dry-run #2); `CC5X…`/`CCYH…` (dry-run #1, `get_result(1) = [3,
true, false]`, 2026-06-23). The **verified pair** is the one the original CLI end-to-end on-chain check
ran against.

| Contract | Address |
|----------|---------|
| **DatasetRegistry (schema — frontend/demo, CURRENT)** | **`CB7F7A23JYWZVBE5WJZTJDYSKK2IHUJJF2GSY575HMSVN2NVL5OQPTAA`** |
| **JobManager (schema — frontend/demo, CURRENT)** | **`CDB2W5HPALCKHG63G75KMAZQYEL45JZJZT5LFQPD4BNCULKAIYCMAXIW`** |
| DatasetRegistry (schema pristine, superseded) | `CASQR7SRKXWAHFWR27UEJLUE6FZEIVLM67IFABK6V7FIXC6WBEAZKH7C` |
| JobManager (schema — superseded, request 1 wrong target_field) | `CDIWSDJACIMAQYF6SLPEEAMSHE3TQKXEDAI2K7TSAV4WYQOLF52MFADH` |
| DatasetRegistry (pre-schema pristine, superseded) | `CBWIVBE7OCEJ7DNTLPP7FWBUN2PQXABZHBTSHIXNU6Z7Y6EV4AXBLEIG` |
| JobManager (pre-schema pristine, superseded) | `CBBSS7HEHQQ3ERKV6W63MWBGHC4BBBDYQQMWARO2AFBOG3M6XMJQWQR5` |
| DatasetRegistry (dry-run #4, superseded) | `CCUEK5OHQYWHV4BCVAGJRSC7IO3QK7OYR7PXFQZUQU2Q56EZOXPPUA34` |
| JobManager (dry-run #4 — request 1 consumed) | `CDFHLZETEDYXKY3K6RK4C24EOZH6GDNLFZ4MVI4CRPNINCA7JDXNYGPL` |
| DatasetRegistry (dry-run #3, superseded) | `CC3J5NH5RSE7JMAABKFCUZDPZ6K2MDWINON3HOA3AYICP2VAAUFXKDX6` |
| JobManager (dry-run #3 — request 1 wrong-const) | `CDVD4MZOWARAXEO7JJPW7KN64TFY3PCFG43OC3JIAPQJOYCVO55CVXRY` |
| DatasetRegistry (dry-run #2, superseded) | `CBP33TITYLCTTDAMYQMU4MYFMWMLH2YQ67LBBZJMXVD4YZ4TQQB2WH6K` |
| JobManager (dry-run #2 — request 1 consumed) | `CDN2ZJ56ULNITYQJMTRGYL2XVX4MHXZNRRXE73ZSQCF2FL4K3ZNJA2DR` |
| DatasetRegistry (dry-run #1, superseded) | `CC5XUULE2ZW3KURTIGEFOAVWY2UKQ4QJNW7L4WEQVSEMOIOEQ2GZEGWG` |
| JobManager (dry-run #1 — request 1 consumed) | `CCYH2WH7ZN4YXQ2WW455OSEVDZHRLJT2RWP5BCCWLWQ2NXOFQDAMW4XE` |
| DatasetRegistry (verified instance) | `CD5QW2UNV6LUB6U4WEWX5ZZ5KHWE3X5XWZM3PZNTHG7WC5WWUATTOBF5` |
| JobManager (verified instance) | `CD5FEIP2FG43VQKJ7E7ODOGYJ3ZAT5CDN6ZKQCOQRVJCQQBIRWJ4NU4I` |
| DatasetRegistry (pre-review, superseded) | `CBJ4XTOHF2GRCPLYV57HO2E3N6HTGRNNMVZCTTYJ4G6H5SGVRVO6LYS4` |
| JobManager (pre-review, superseded — old image_id) | `CAAJSFAR3FSHXVR3JQRWOMCDADRAHL3Y4H45KSEK76WM6FBBGY4CYHAU` |

**Verified on-chain (instance `CD5FEIP2…`):** register → submit → accept → `fulfill` (real Groth16
proof) → `get_result` = `(3, true, false)`. Replay rejection confirmed: an identical request (id 2)
could not be fulfilled with request 1's proof — `verify` succeeds, then `fulfill` traps on the
request_id binding.

- JobManager constructor: `(registry, router=VerifierRouter, image_id)`. Redeploy with `scripts/redeploy.sh`.
- **Guest IMAGE_ID (post-review, 103-byte journal w/ request_id):** `6290a9cb12b55075f93834a58eccfa100b7839157f37df8b3f4eae78060108c3`
- Superseded image_ids: full-op 95-byte journal `e46e5b3c7043b189beea1751708f51db192258d9957954a18f04a0f8c2763f5f`;
  Slice-0 COUNT `f696612489b98d8ac346b52a7f9af64f2701ba81b152d2eb382c813a8a82094a`
- **TS bindings:** `frontend/packages/{dataset-registry,job-manager}/src/index.ts`
  (`stellar contract bindings typescript --network testnet --contract-id <id> --output-dir … --overwrite`).

### Proving-time measurements (Groth16, container `stellar-zk-full`, finalized guest)
| Rows | Wall time | Result |
|------|-----------|--------|
| 5    | ~4m34s (274s) | COUNT=3 |
| 100  | ~16m32s (992s) | COUNT=75 |

Fits **~237s fixed + ~7.5s/row** — proving cost is driven by zkVM cycles (merkle hashing + per-row
filter/agg), NOT a fixed snark wrap. Extrapolated 500 rows ≈ **~66 min**.
**Demo implication:** prove LIVE only on small datasets (~5–20 rows, ≈4–6 min); **pre-bake** proofs
for any larger dataset shown. README/demo dataset should stay small for the live "Generate proof" path.

### D6 re-verification on the FINAL deployment (dataset 2)
- COUNT (op3, age>30) → `get_result` **`[3, true, false]`** ✅
- SUM (op1, balance where age>30) → `get_result` **`[310, true, false]`** ✅ (50+250+10)
- Both real Groth16 proofs from the finalized guest, verified on-chain via the router.

## E2E proven on testnet (tracer GREEN)
1. `register_dataset(owner, root=bad285cb…873c, num_columns=3, row_count=5, k=2, cooldown=0)` → dataset 1
2. `submit_request(buyer, 1, {op:3 COUNT, target_field:0, filter:01000102000010 [field1>const0], consts:[30], weights:[]})` → request 1
3. `accept_request(owner, 1)`
4. `fulfill(owner, 1, seal, journal)` — real Groth16 proof verified on-chain via the router
5. `get_result(1)` → **`[3, true, false]`** (count=3, k_met=true, overflow=false) ✅

### Security rejection proven on-chain
- `fulfill` with a journal byte flipped → router→groth16-verifier **traps** (`Error(Contract,#0)`);
  tx fails at simulation, request stays `Accepted`. Tamper cannot be completed.

## Build gotchas (container `stellar-zk-full`)
- Prepend cargo to PATH: `export PATH=/usr/local/cargo/bin:$PATH` (login shell only has risc0 bin).
- `unset CARGO_TARGET_DIR` before `manage.sh`/`stellar contract build` so wasm lands in `target/`
  (the scripts hard-code `target/wasm32v1-none/release`, but the image sets `CARGO_TARGET_DIR=/build-target`).
- Add wasm targets to the **stable** toolchain too: `rustup target add wasm32v1-none wasm32-unknown-unknown --toolchain stable`
  (the verifier's `rust-toolchain.toml` pins `channel=stable`).
- Workspace `profile.release` must use `lto = false`: full LTO + a cross-contract path dep throws
  "failed to load bitcode" under wasm32v1-none.
- JobManager must reach DatasetRegistry via a **client-only** `#[contractclient]` interface
  (`src/registry.rs`), NOT a dependency on the contract crate — linking the contract crate leaks its
  `#[no_mangle]` exports and drops JobManager's own `__constructor`. dataset-registry stays a dev-dep.

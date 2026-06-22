# Testnet Deployment (D3 tracer)

Network: **Stellar Testnet** (Protocol 27, BN254 host functions live).
Deployed 2026-06-22. This is the **Slice-0 tracer** deployment (COUNT-only guest). The JobManager
binds an immutable `image_id`, so it will be **redeployed after the guest is finalized in D4/D6**
(adding SUM/AVG/… to `cdm-shared::agg` changes the guest ELF → new image_id). DatasetRegistry +
the verifier stack are stable and can be reused.

## Identities (testnet, funded via friendbot)
| Role | Address |
|------|---------|
| deployer | `GDNPBI646QXUCQ7XXZDX3SSXC6EHCBBZT5LE6BFZYBLDGGGKQFUQZXDY` |
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
| Contract | Address |
|----------|---------|
| DatasetRegistry | `CBJ4XTOHF2GRCPLYV57HO2E3N6HTGRNNMVZCTTYJ4G6H5SGVRVO6LYS4` |
| **JobManager (FINAL, full-op guest)** | **`CAAJSFAR3FSHXVR3JQRWOMCDADRAHL3Y4H45KSEK76WM6FBBGY4CYHAU`** |
| JobManager (D3 tracer, superseded — old image_id) | `CBLRE67DLXDI4C2MF2Y3IWAB664CBYGYJRFNXYRKYJLXJKSYWAWE7JKV` |

- JobManager constructor: `(registry, router=VerifierRouter, image_id)`.
- **Guest IMAGE_ID (FINAL, full op set):** `e46e5b3c7043b189beea1751708f51db192258d9957954a18f04a0f8c2763f5f`
- Superseded Slice-0 COUNT image_id: `f696612489b98d8ac346b52a7f9af64f2701ba81b152d2eb382c813a8a82094a`
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

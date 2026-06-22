# Day-1 De-Risk Notes

Date: 2026-06-21 · Goal: prove the ZK core works before committing to the full build.
All toolchains run in Docker (`docker/Dockerfile`) — host stays clean (per global CLAUDE.md).

## Environment

- Host: x86_64, 4 cores. Has git, rustup/cargo 1.96, node 24, npm, docker 29.6. **Good for Groth16 (needs x86_64).**
- Missing on host (now containerized): Stellar CLI, RISC Zero (`rzup`/`cargo-risczero`/`r0vm`).
- Docker image `stellar-zk-dev`: `base` = Rust+wasm+Stellar CLI; `full` = + RISC Zero toolchain.

## Verifier repo: NethermindEth/stellar-risc0-verifier

Multi-contract Soroban workspace (`soroban-sdk 25.1.0`, edition 2024, stable Rust):
- `groth16-verifier` — verifies RISC Zero Groth16 (BN254) proofs. Core of what we need.
- `risc0-router` — routes `verify()` by 4-byte selector prefix in the seal.
- `emergency-stop`, `timelock`, `interface`, `mock-verifier` — governance/plumbing.
- Integrate from our contract via `risc0-interface` crate → `RiscZeroVerifierRouterClient::verify(seal, image_id, journal_digest)`.

### ⭐ Key win: ships a real test vector
`contracts/groth16-verifier/src/test.rs` has `TEST_SEAL` (260 bytes), `TEST_IMAGE_ID` (32),
`TEST_JOURNAL` (4 bytes) and `test_verify_proof()` that calls `client.verify(...)` and asserts success.
→ **Milestone 1 (verifier works on current Stellar) provable by `cargo test` alone** — no network,
no proof generation, no docker-in-docker.

### ⚠️ Critical version pin: RISC Zero **3.0.0**
`contracts/groth16-verifier/parameters.json` → `"version": "3.0.0"`, with `control_root` +
`bn254_control_id`. Our guest proofs MUST be generated with **RISC Zero 3.0.x** to verify against this
verifier (host crates `risc0-zkvm` / `risc0-ethereum-contracts` `^3.0`). If `rzup` installs a newer
major, either pin to 3.0.x OR regen `parameters.json` for the new version and rebuild the verifier
(the verifier supports param/selector upgrades — see docs/upgrading-groth16-verifier.md).

### Verify interface (what our app contract calls)
- `image_id` (32B): guest program ID.
- `journal_digest` (32B): `sha256(journal_bytes)`.
- `seal` (bytes): from `encode_seal(&receipt)` (risc0-ethereum-contracts); carries the routing selector prefix.

### Proof-generation flow (from docs/verifying-risc0-proofs.md)
- `cargo risczero new <proj> --guest-name <guest>`
- host deps: `risc0-zkvm ^3.0`, `risc0-ethereum-contracts ^3.0`, `sha2`, `hex`
- prove with `ProverOpts::groth16()`; `encode_seal(&receipt)`; `image_id = methods::<GUEST>_ID`; `journal_digest = sha256(receipt.journal)`
- `rzup install risc0-groth16` needed for native groth16 (avoids docker-in-docker).

## De-risk milestones

1. [x] **Verifier builds + verifies on Stellar** ✅ (2026-06-21) — `cargo test -p groth16-verifier` in `base`
       image: 4/4 passed incl. `test_verify_proof` (verifies the bundled REAL RISC Zero Groth16 proof under
       soroban-sdk 25.1.0). Budget: Bn254Pairing ~17.5M CPU, Bn254G1Mul ~5.7M, G2-subgroup-check ~11.7M —
       dominant on-chain costs, feasible. On-chain side de-risked.
       Also: `stellar contract build` produced deployable wasm for all 5 contracts (groth16_verifier 16K,
       risc0_router 19K, emergency_stop 20K, timelock 37K, mock_verifier 11K). Deploy path confirmed.
       GOTCHA: verifier's rust-toolchain.toml pins `channel="stable"` (a separate toolchain from the image
       default 1.96.0) — wasm targets (wasm32-unknown-unknown + wasm32v1-none) must be added to BOTH.
2. [x] **Guest prototype** ✅ (2026-06-21) — `derisk/cdm-guest`: guest computes Merkle root (sha256) + COUNT
       (`row[col] > threshold`) + k-anonymity over a 5-row dataset; commits {root, col, threshold, k, count,
       k_met}. Real Groth16 proof generated (seal 260 bytes), `receipt.verify()` OK, journal decoded
       correctly (count=3, k_met=true). proof.txt = seal/image_id/journal_digest.
3. [x] **Version match + E2E through the Stellar verifier** ✅ (2026-06-21) — added `test_verify_cdm_query_proof`
       to the verifier; it loads our proof.txt and calls the real `RiscZeroGroth16Verifier.verify()` → PASSES.
       Our seal selector `73c457ba` == verifier TEST_SEAL's first 4 bytes; build.rs confirms VERSION 3.0.0.
       So RISC Zero 3.0.5 toolchain ↔ verifier 3.0.0 params are compatible end-to-end.

## ⚠️ Groth16 proving needs Docker (important for the real build)
The SDK's in-process prover does stark→snark via `docker run risczero/risc0-groth16-prover:v2025-04-03.1`
(see risc0-groth16-3.0.4/src/prove/docker.rs). `rzup install risc0-groth16` + `RISC0_PROVER=ipc` did NOT
avoid it in this version. Solution used (docker-out-of-docker from our dev container):
  - mount host docker socket + docker CLI into the container
  - bind a host dir at an IDENTICAL path in container & host, set `RISC0_WORK_DIR` to it (so the groth16
    container the host daemon spawns can read seal.r0/input.json) → here `/home/dev/r0work`
  - pre-pull `risczero/risc0-groth16-prover:v2025-04-03.1` on the host
Alternative for CI/prod: prove on an x86_64 box with Docker directly, or via Bonsai.

## ✅ DE-RISK VERDICT: GREEN
The full loop works on current Stellar: guest (Rust) → real Groth16 proof (RISC Zero 3.0.5) → verified by
the Soroban Groth16 verifier. On-chain verification is feasible (BN254 budget ~17.5M pairing). The
architecture (commit dataset → prove confidential aggregate → verify on Stellar) is validated. Safe to build.

## Decisions / simplifications for MVP

- On-chain side is **reusable as-is** (fork the verifier or call its router). We don't write a Groth16
  verifier — we call theirs. Our contract = dataset registry + result store + a `verify()` call into the router.
- Avoid docker-in-docker: use native `risc0-groth16` prover; validate guest via `receipt.verify()`; deploy
  to **testnet** rather than `stellar container start local` (which needs Docker) for E2E.
- Merkle hash: prototype with sha256 (RISC Zero-accelerated). Switch to Poseidon later to use Stellar's
  native cheap Poseidon host function on-chain if we ever verify inclusion on-chain (we don't need to —
  inclusion is proven inside the zkVM; on-chain only checks the SNARK).

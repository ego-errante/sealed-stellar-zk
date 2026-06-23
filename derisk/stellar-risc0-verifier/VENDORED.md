# Vendored dependency — not our code

This directory is the **Nethermind RISC Zero verifier for Stellar**, vendored into this repo so the
`contracts/` workspace is self-contained and buildable (`contracts/job-manager` path-depends on its
`contracts/interface` and `contracts/groth16-verifier` crates).

- **Upstream:** https://github.com/NethermindEth/stellar-risc0-verifier
- **Vendored at commit:** `e8ff6ea202db195352c0141ecc533ff649393fe4` (origin/main)
- **License:** Apache-2.0 (see `LICENSE` in this directory) — redistributed under its terms.
- **Local changes:** `deployment.toml` reflects our testnet deployment config. (A de-risk-phase smoke
  test that had been added to `contracts/groth16-verifier/src/test.rs` was reverted, so that file now
  matches upstream.) Build artifacts (`target/`) and the upstream `.git` history are intentionally not included.

All credit for this verifier stack belongs to Nethermind. Our project verifies proofs *against* it; we
did not author it.

# Stellar Hacks: Real-World ZK — Requirements & Project Spec

Source: https://dorahacks.io/hackathon/stellar-hacks-zk (Details / Resources / Ideas tabs)
Captured: 2026-06-21

---

## 1. Hackathon at a glance

- **Host:** Stellar Development Foundation, on DoraHacks.
- **Theme:** Build *anything* using zero-knowledge that runs on Stellar. Single open innovation track.
- **Prize pool:** $10,000 in XLM
  - 1st: $5,000 · 2nd: $2,000 · 3rd: $1,250 · 4th: $1,000 · 5th: $750
- **Timeline:** Submissions open June 15, 2026 → **Deadline June 29, 2026, 12:00 PM PST**. Virtual.
- **Registered hackers:** ~328 (as of capture).

## 2. Hard submission requirements (all three mandatory)

1. **Open-source repo** — public GitHub/GitLab/Bitbucket with full source + a clear `README.md`.
   Honesty encouraged: if something is unfinished or uses mock data, say so.
2. **Demo video** — 2–3 min walkthrough showing the project working and explaining what ZK does in it.
   Need not be technical/produced; you don't need to be on camera.
3. **ZK + Stellar, load-bearing** — must use zero-knowledge cryptography in a *meaningful* way and must
   *touch Stellar* (e.g. verify proofs in a Soroban contract, or integrate Stellar testnet/mainnet).
   **The ZK must power a real part of how the project works — not appear only on a slide.**

No mandatory framework, no required boilerplate contract, no fixed track.

## 3. Judging signal (from the brief)

- "Mild projects win hackathons all the time when they're sharp and well-executed."
- Real-world money use cases (stablecoins, cross-border payments, RWAs, identity/compliance) are
  *especially welcome* — Stellar's strength is real-world money movement.
- The bar that kills most entries: **is the ZK genuinely essential?** Make it the centerpiece.

## 4. The three proven ZK paths on Stellar

ZK proofs are generated **off-chain** with a higher-level system, then a **verifier contract on Stellar
(Soroban)** checks them. Protocol 25 ("X-Ray") + 26 ("Yardstick") added BN254 + Poseidon/Poseidon2 host
functions (plus BLS12-381 earlier), making on-chain SNARK verification cheap.

| Path | Language | Proof system | Notes |
|------|----------|--------------|-------|
| **RISC Zero** | Rust (zkVM) | Groth16 | Write a provable program in ordinary Rust; prove its execution. **Our pick.** |
| **Noir** | Rust-like DSL | UltraHonk | Easiest circuits to write; proofs bigger/costlier (P26 helped). |
| **Circom** | low-level DSL | Groth16 | Cheapest to verify, hardest to write. Used by the Privacy Pools PoC. |

## 5. Key reference repos / resources

- **RISC Zero verifier (Soroban):** https://github.com/NethermindEth/stellar-risc0-verifier  ← our on-chain base
  - Companion: https://stellar.org/blog/developers/risc-zero-verifier
- RISC Zero E2E tutorial: https://jamesbachini.com/stellar-risc-zero-games/
- RISC Zero docs: https://dev.risczero.com/
- UltraHonk / Noir verifiers: https://github.com/yugocabrio/rs-soroban-ultrahonk · https://github.com/indextree/ultrahonk_soroban_contract
- Privacy Pools PoC (Circom + Groth16 + ASP): https://github.com/NethermindEth/stellar-private-payments
- ZK Proofs on Stellar (docs): https://developers.stellar.org/docs/build/apps/zk
- Privacy on Stellar (docs): https://developers.stellar.org/docs/build/apps/privacy
- Stellar AI skills: https://skills.stellar.org/ (zk-proofs skill: https://skills.stellar.org/skills/zk-proofs/SKILL.md)
- Soroban SDK BN254 / Poseidon migration docs:
  https://docs.rs/soroban-sdk/latest/soroban_sdk/_migrating/v25_bn254/index.html ·
  https://docs.rs/soroban-sdk/latest/soroban_sdk/_migrating/v25_poseidon/index.html
- Stellar CLI: https://developers.stellar.org/docs/tools/cli · Lab (faucet/testnet): https://developers.stellar.org/docs/tools/lab

## 6. Support channels

- Stellar Dev Discord #zk-chat: https://discord.gg/stellardev
- Stellar Hacks Telegram: https://t.me/+e898qibDUVExODkx
- (Beware DM scams — team never DMs first asking for keys/seed/payment.)

---

## 7. Our project: Private Data Marketplace on Stellar (ZK)

**Pitch:** Verifiable confidential analytics. A data owner commits a dataset (Poseidon Merkle root on
Stellar). A buyer requests an aggregate query (e.g. COUNT/SUM with a filter). The owner computes the
result **off-chain** and submits a **RISC Zero ZK proof** that:
  1. the rows used are genuinely in the committed Merkle root (Merkle inclusion in-circuit),
  2. the filter was applied correctly,
  3. the aggregate was computed correctly over matching rows,
  4. **k-anonymity holds** (≥ k rows matched; otherwise the result is suppressed).
A **Soroban contract verifies the proof** and records the attested result. The buyer gets a trustworthy
number; the raw rows never leave the owner.

**Origin:** Repurposes the *product design + frontend + filter DSL + Merkle tooling* from the author's
`mini-cdm` project (a Confidential Data Marketplace built on Zama FHEVM/EVM). The crypto engine swaps
**FHE → ZK (RISC Zero)** and the chain swaps **EVM/Solidity → Soroban/Rust**. The Solidity contracts and
FHE layer are NOT ported; the product concept, UX, and DSL/Merkle libraries are reused.

**Why ZK is load-bearing:** the proof *is* the trust — without it the buyer has no reason to believe the
owner's number. Bonus story: ZK does the whole dataset off-chain in one proof, eliminating FHEVM's
~500k-gas-per-row on-chain cost.

### MVP scope (8-day cut — discipline = win)

- Dataset commit: Poseidon Merkle root stored in a Soroban contract.
- ONE or two ops: **COUNT** first, then **SUM**, over a single filter predicate.
- **k-anonymity** enforced inside the circuit (suppress result if matches < k).
- RISC Zero guest computes result + proof; Soroban verifies the Groth16 receipt.
- Wire to the reused Next.js UI + filter DSL.
- OUT of MVP: escrow/payments, cooldowns, stall protection, MIN/MAX/AVG/WEIGHTED_SUM, multi-op.

### Day-1 de-risking goals (this session)

1. **Verifier builds on Stellar** — clone Nethermind RISC0 verifier, build the Soroban contract, run its
   test / sample-proof verification on (local or) testnet.
2. **RISC Zero guest prototype** — tiny guest doing Merkle-inclusion + COUNT over a handful of rows; prove
   it and confirm the receipt verifies. Validates the core before committing to the full build.
3. Note any version pins / toolchain constraints (RISC Zero is version-sensitive).

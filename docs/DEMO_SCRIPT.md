# Demo video shot-list (target 2:30, hard cap 3:00)

A scene-by-scene script for the hackathon demo video. Two mandatory beats from the brief: **show it
working** and **explain what the ZK does**. Both are covered below. You don't need to be on camera; a
screen recording + voiceover is fine.

## Before you record (one-time setup)

1. **Remove the dev signer seam so real Freighter is used:**
   ```bash
   rm frontend/packages/site/.env.local      # or rename to .env.local.bak
   ```
   (Otherwise the app signs with a local key and Freighter never pops — the demo must show the real wallet.)
2. **Two browser profiles, each with Freighter on testnet:** one "Owner", one "Buyer". Fund both at the
   [Stellar Lab friendbot](https://developers.stellar.org/docs/tools/lab).
3. **Start the app:** `cd frontend && npm run dev` → http://localhost:3000.
4. **Have ready:** `demo/ds4_age_balance.csv` (6 rows) and the pre-baked `demo/ds4_count_age_gt30_proof.json`
   (`seal` + `journal`) for instant fulfill — see the proving-time note at the bottom.
5. Optional: have a terminal visible with `cargo test` already green, and the testnet contract addresses
   from the README on a slide for the closing.

---

## Scene 1 — The problem (0:00–0:20)

**Show:** the "Sealed" masthead — *"A dataset's rows stay ████████. Only the proven aggregate is revealed."*

**Say:**
> "Someone holds a private dataset — say, customer records. A buyer wants one statistic from it: how
> many customers are over 30? Today they either hand over all the data and lose their privacy, or they
> just quote a number the buyer has no reason to believe. Sealed is the third option."

## Scene 2 — The thesis (0:20–0:40)

**Show:** scroll the masthead copy; point at the two live counters (datasets sealed / queries proven).

**Say:**
> "The owner answers with a zero-knowledge proof. A Soroban contract on Stellar verifies it and records
> the result. The buyer trusts the math, not the owner — and the raw rows never leave the owner's
> machine."

## Scene 3 — Owner commits a dataset (0:40–1:05)

**Show (Owner profile):** click *Register dataset* → upload `demo/ds4_age_balance.csv` → set `k = 2` →
register. **Freighter pops** → sign. The new dataset card appears.

**Say:**
> "The owner registers a dataset. Only its sha256 Merkle root goes on-chain — a commitment. The rows
> themselves stay local. This 6-row set is tiny so we can prove it live."

## Scene 4 — Buyer asks a question (1:05–1:25)

**Show (Buyer profile):** open the dataset drawer → *Submit request* → op `COUNT`, build filter
`Field[1] > 30` → submit. **Freighter pops** → sign. Request shows **Pending**.

**Say:**
> "A buyer asks for an aggregate over a filter — COUNT where age is over 30 — and submits it on-chain."

## Scene 5 — Owner proves & fulfills (1:25–2:00)

**Show (Owner profile):** Accept the request. Then in the Fulfill panel either
- **(live)** click *Prove locally* — show the spinner / ETA, **or**
- **(instant)** paste the `seal` + `journal` from `demo/ds4_count_age_gt30_proof.json`.

Then *Fulfill* → **Freighter pops** → sign → request flips to **Completed** and the result **unseals to 3**.

**Say:**
> "The owner proves the answer with RISC Zero — entirely on their own machine — and submits the proof.
> The contract verifies the Groth16 receipt *and* checks the proof is bound to this exact dataset, this
> exact query, and the one guest program it trusts. It verifies… and the answer unseals: three."

## Scene 6 — Why the ZK matters (2:00–2:25)

**Show:** the README's "What the proof attests" list, or the journal layout diagram. Optionally show a
terminal: a tampered-journal `fulfill` **trapping** on-chain (`Error(Contract,#0)`), or just describe it.

**Say:**
> "This is what makes it real. The proof guarantees the count was computed over rows that hash to the
> committed root — no cherry-picking — using the agreed filter, with k-anonymity enforced so small
> result sets are suppressed. Flip a single byte of the result and the on-chain verifier rejects it.
> The proof *is* the trust."

## Scene 7 — Honest close (2:25–2:40)

**Show:** the testnet addresses slide + the repo.

**Say:**
> "Everything you saw is live on Stellar testnet with real Groth16 proofs. One honest note: the prover
> runs on the owner's own machine — it's in their trust boundary by design. A trustless third-party
> prover via WASM or a TEE is the natural next step. Thanks for watching."

---

## Notes & contingencies

- **Proving takes minutes** (~237s + ~7.5s/row → ~4–5 min for the 6-row demo). For a tight video, either
  (a) **time-lapse / cut** the proving wait, or (b) use the **pre-baked proof** in `demo/` via the paste
  path — it's the *same* proof, already verified on-chain, so the result is identical. Mention out loud
  that proving ran locally either way.
- The pre-baked proof's bound Merkle root matches `demo/ds4_age_balance.csv` exactly (verified), so it
  fulfills cleanly against a dataset registered from that CSV. If you register a *fresh* dataset on
  camera, its root will match too (same CSV) — the same proof still fulfills.
- Keep each Freighter signature in-frame briefly; the wallet popups are good evidence it's really
  on-chain.
- If a request id collides with an earlier demo run, just register a fresh dataset and submit a new
  request — ids increment.

# Sealed — a Private Data Marketplace on Stellar (ZK)

> **Prove answers. Reveal nothing.**
> A data owner commits a dataset on Stellar. A buyer asks for an aggregate — `COUNT`, `SUM`, `AVG`,
> `MIN`, `MAX`, `WEIGHTED_SUM` — over a filter. The owner answers with a **RISC Zero zero-knowledge
> proof**; a **Soroban contract verifies it** and binds the attested result on-chain. The buyer gets a
> trustworthy number. **The raw rows never leave the owner's machine.**

Built for **[Stellar Hacks: Real-World ZK](https://dorahacks.io/hackathon/stellar-hacks-zk)** (Stellar
Development Foundation). Live on **Stellar testnet** (Protocol 27, BN254 host functions).

- 🎥 **Demo video:** _<add link>_
- 🌐 **Network:** Stellar Testnet · 📜 **Contracts:** [see addresses](#live-on-testnet)
- 🔐 **ZK stack:** RISC Zero zkVM 3.0.5 → Groth16 → [Nethermind Soroban verifier](https://github.com/NethermindEth/stellar-risc0-verifier)

---

## The problem

Someone holds a valuable private dataset — patient records, payroll, transaction history, a credit
book. A buyer wants an aggregate statistic from it: *"how many of your customers are over 30?"*,
*"what's the total balance of accounts flagged risky?"*. Two bad options today:

1. **The owner hands over the data** → privacy gone, and irreversibly so.
2. **The owner just tells the buyer a number** → the buyer has no reason to believe it.

Sealed is the third option: the owner computes the answer locally and proves — in zero knowledge —
that the number is the *honest* result of the *agreed query* over the *exact committed dataset*. The
buyer verifies the proof on Stellar and trusts the math, not the owner.

## Why the ZK is load-bearing

The proof **is** the trust. Remove it and the product collapses into "take the owner's word for it."
The owner could otherwise cherry-pick rows, apply a different filter, fabricate the total, or quietly
swap in a friendlier dataset. The Groth16 proof, verified by the Soroban contract, makes every one of
those cheats impossible:

- the aggregate was computed over rows that hash to the **dataset's committed Merkle root** (no
  substituting or cherry-picking rows),
- the **agreed filter and operation** were applied (no swapping the query),
- **k-anonymity holds** — if fewer than `k` rows matched, the result is suppressed (no de-anonymizing
  the underlying rows by querying down to one),
- and all of this is **bound to one specific guest program** (`image_id`), so the owner can't prove a
  different computation.

None of that lives "on a slide" — it is the contract's `fulfill` path, and tampering with the journal
makes the on-chain verifier **trap**. ([proven on testnet](#live-on-testnet).)

---

## How it works

```
  DATA OWNER (private)                         STELLAR TESTNET                        BUYER
  ───────────────────                          ───────────────                       ─────
                                          ┌────────────────────────┐
  rows.csv ──register──► merkle_root ────►│ DatasetRegistry        │
  (stays local)         (sha256 tree)     │  • merkle_root  • k     │
                                          │  • num_columns • cols   │
                                          └────────────────────────┘
                                                                          ┌──── submit_request(op, filter)
                                          ┌────────────────────────┐ ◄────┘  "COUNT where age > 30"
                                          │ JobManager             │
  accept_request ──────────────────────► │  Pending → Accepted     │
                                          └────────────────────────┘
  ┌─────────────────────────────────┐
  │ RISC Zero guest (in zkVM)        │     proof = (seal, journal)
  │  • recompute Merkle root         │     journal = 95 bytes:
  │  • run filter VM over each row   │       root│query_hash│op│cols│k│
  │  • aggregate matching rows       │       count│result│k_met│overflow
  │  • enforce k-anonymity           │
  │  • commit 95-byte journal        │── fulfill(seal, journal) ──┐
  └─────────────────────────────────┘                            ▼
        ▲                                 ┌────────────────────────────────────┐
        │ Groth16 (STARK→SNARK wrap,      │ JobManager.fulfill:                │
        │ x86 Docker)                     │  1. router.verify(seal, image_id,  │
                                          │     sha256(journal))  ◄── Groth16  │
                                          │     ┌─────────────────────────┐    │
                                          │     │ VerifierRouter →        │    │
                                          │     │ Groth16Verifier (BN254) │    │
                                          │     └─────────────────────────┘    │
                                          │  2. bind journal ⇔ dataset/query:  │
                                          │     root, num_columns, op, k,      │
                                          │     query_hash all must match      │
                                          │  3. store result ⇒ Completed       │
                                          └────────────────────────────────────┘
                                                       │
                                          get_result(request_id) ──────────────► (result, k_met, overflow)
```

The lifecycle, end to end:

| Step | Actor | Action | On-chain |
|------|-------|--------|----------|
| 1 | Owner | Compute the dataset's sha256 Merkle root locally, register schema + `k` + cooldown | `register_dataset` → dataset id |
| 2 | Buyer | Pick an op + target column, build a filter, submit | `submit_request` → request id |
| 3 | Owner | Accept (or reject) the request | `accept_request` |
| 4 | Owner | Prove the answer with RISC Zero, submit the receipt | `fulfill(seal, journal)` — **verifies + binds** |
| 5 | Buyer | Read the attested result | `get_result` → `(result, k_met, overflow)` |

### What the proof attests — and how it's bound

The guest runs entirely inside the RISC Zero zkVM. It re-derives the Merkle root from the rows it was
given, evaluates the filter bytecode per row, aggregates the matching rows, applies k-anonymity, and
commits a **fixed-layout 103-byte journal**:

```
root[32] │ query_hash[32] │ op[1] │ num_columns[4 LE] │ k[8 LE] │ count[8 LE] │ result[8 LE] │ k_met[1] │ overflow[1] │ request_id[8 LE]
```

`JobManager.fulfill` does two things the verifier alone can't:

1. **Verify** — `router.verify(seal, image_id, sha256(journal))` runs the Groth16 check on Stellar
   (Nethermind's verifier, BN254 host functions). An invalid proof, or a proof from a *different*
   guest, traps here.
2. **Bind** — even a valid proof is rejected unless its journal matches the *on-chain* facts:
   `journal.root == dataset.merkle_root`, `num_columns`, `op == request.op`, `k == dataset.k`, a
   **recomputed `query_hash`** over the request's exact `(op, target, filter, consts, weights, k)`,
   and `journal.request_id == request_id`. This stops an owner from proving an honest computation
   over the *wrong* dataset or a *different* query — and, via the request_id binding, stops a valid
   proof from being **replayed** to fulfill a different (otherwise identical) request.

The journal carries **no rows** — only the root, the query identity, and the scalar result. The buyer
never sees data, only a number the chain has certified.

---

## Trust model & privacy (read this)

**Be honest about what is and isn't trustless** — the hackathon brief asks for it, and the distinction
matters.

- **The buyer / the chain are fully protected.** They never see raw rows, and they cannot be lied to:
  the proof + binding guarantee the result is the honest aggregate of the committed dataset under the
  agreed query. This part is trustless.
- **The prover sits inside the owner's trust boundary — by design.** The owner owns the rows; ZK
  exists so a *verifiable aggregate* reaches the buyer **without the rows**. So the prover runs
  **owner-local**:
  - **CLI path (lead with this — maximally private):** the owner runs the prover on their own machine
    (`host prove`). The CSV **never enters the browser**; they paste only the resulting `seal` +
    `journal` into the UI to fulfill.
  - **Live path (localhost convenience):** the in-app "Prove locally" button calls the owner's **own**
    `localhost:8787` prover. Data stays on the owner's box; it never crosses the network.

  The buyer's profile has no prover and never touches data.
- **We explicitly do _not_ claim a trustless third-party prover.** A malicious *host* running the
  prover would see the rows. That's out of scope for this MVP and we don't pretend otherwise.

### Named future work (not built here)

- **In-browser / WASM proving** — would let the owner prove without any local service. Blocked today:
  the Groth16 `stark2snark` wrap needs the x86 Docker prover; it isn't WASM-portable yet.
- **TEE-hosted prover (SGX/SEV)** — would let an *untrusted* host prove without seeing rows, closing
  the one remaining trust gap and enabling a true third-party proving service.
- **Poseidon Merkle commitments** — we use sha256 (simple, in-circuit, proven). Poseidon would cut
  zkVM cycles and proving time substantially.

---

## Live on testnet

Network: **Stellar Testnet**, Protocol 27. Deployed 2026-06-22 (the front end + the pre-baked demo
proof point at this pristine pair — request ids start at 1, so the proof in `demo/` fulfills request 1).

| Contract | Address |
|----------|---------|
| **DatasetRegistry** | `CC5XUULE2ZW3KURTIGEFOAVWY2UKQ4QJNW7L4WEQVSEMOIOEQ2GZEGWG` |
| **JobManager** | `CCYH2WH7ZN4YXQ2WW455OSEVDZHRLJT2RWP5BCCWLWQ2NXOFQDAMW4XE` |
| VerifierRouter (Nethermind) | `CBRBVQP2GOW6FONS4S4Q6BEC53BAJJGWOJRXC4KNDCFJ6WG673MQX633` |
| Groth16Verifier (Nethermind) | `CALVN6PA6YIGSIKI6T7ZZAP2IW7UF3N4MLNVMOU2DWQ7HUYFXLMBDIX4` |

- **Guest `image_id`** (the one program the JobManager trusts):
  `6290a9cb12b55075f93834a58eccfa100b7839157f37df8b3f4eae78060108c3`
- **Proven end-to-end on-chain** on an identical instance (`JobManager
  CD5FEIP2FG43VQKJ7E7ODOGYJ3ZAT5CDN6ZKQCOQRVJCQQBIRWJ4NU4I`, deployed from the same wasm + image_id):
  register → submit → accept → `fulfill` with the real Groth16 proof → **`get_result` = `(3, true, false)`**
  ([fulfill tx](https://stellar.expert/explorer/testnet/tx/b8dc567e93e7e912e35fd6007b787b1c5c8827beff0ae76db61654cfdc2e7b32)).
- **Replay rejection proven on-chain:** an *identical* second request (id 2) cannot be fulfilled with
  request 1's valid proof — the router's `verify` returns success, then `fulfill` **traps** on the
  `request_id` binding (`UnreachableCodeReached`). A proof is bound to exactly one request.
- **Tamper rejection:** flipping a single journal byte makes `sha256(journal)` differ, so the Groth16
  verifier **traps**; `fulfill` fails at simulation and the request stays `Accepted`.

---

## Repository layout

```
stellar-zk-cdm/
├─ contracts/                 Soroban contracts (Rust, no_std) — cargo workspace
│  ├─ cdm-shared/             merkle · filter VM · aggregates · 95-byte journal · query_hash (41 tests)
│  ├─ dataset-registry/       register_dataset / get_dataset
│  └─ job-manager/            submit / accept / reject / fulfill (verify + bind) / get_result
├─ cdm-guest/                 RISC Zero zkVM program + prover CLI
│  ├─ methods/guest/          the guest (thin wrapper over cdm-shared::compute_journal)
│  ├─ proverlib/              CSV parsing + ProveParams → QueryInput
│  └─ host/                   `host register` / `host prove` CLI
├─ prover-service/            tiny dep-free Node bridge: POST /register, POST /prove → docker exec the CLI
├─ frontend/                  Next.js 15 app ("Sealed") + TS contract bindings (npm workspaces)
│  └─ packages/{shared,dataset-registry,job-manager,site}
├─ demo/                      demo CSV + a pre-baked fallback proof (COUNT age>30 = 3)
└─ docs/                      HACKATHON_SPEC · TESTNET_DEPLOYMENT · DERISK_NOTES
```

## Running it yourself

> The ZK toolchain (RISC Zero + the x86 Docker `stark2snark` prover) is heavy and version-sensitive, so
> proving runs **inside a Docker container**. The frontend and contracts read from the already-deployed
> testnet contracts above, so you can drive the whole UI without rebuilding anything.

**Frontend (against live testnet):**

```bash
cd frontend
npm install
npm run build:packages      # build the shared lib + the two contract bindings (tsc → dist)
npm run dev                  # http://localhost:3000
```

You'll need the **Freighter** wallet extension with a testnet account (fund it at the
[Stellar Lab](https://developers.stellar.org/docs/tools/lab) friendbot). Connect as the **owner** to
register/fulfill, or as a **buyer** to submit requests.

**Prover service (owner-local, for the "Prove locally" path):**

```bash
node prover-service/server.mjs   # listens on :8787, shells into the RISC Zero container
```

Proving cost is **~237s fixed + ~7.5s/row** (zkVM cycles for Merkle hashing + per-row filter/agg
dominate). **Prove live only on small datasets (~5–20 rows ≈ 4–6 min); pre-bake larger proofs.** The
`demo/` folder ships a 6-row CSV and its matching proof so you can fulfill instantly.

**Contracts / guest (rebuild + redeploy):** see [`docs/TESTNET_DEPLOYMENT.md`](docs/TESTNET_DEPLOYMENT.md)
for the container build steps, gotchas, and the deploy/bindings commands.

## Tests

- **Contracts + shared + guest logic:** `cargo test` — **41 tests** (cdm-shared 28, dataset-registry 5,
  job-manager 8), including the real-Groth16 happy path through the actual verifier contract and 6
  negative security tests (tampered journal, wrong owner, root/op/k/query_hash mismatch).
- **Frontend glue:** `npm test` in `frontend` — vitest on `lib/convert.ts` (filter-DSL bytecode ↔
  on-chain params ↔ prover params round-trip).

---

## Honest status

Per the brief's "say what's unfinished" — here's the straight version:

- ✅ **Real, end-to-end, on live testnet:** dataset commit, request lifecycle, real RISC Zero Groth16
  proofs, on-chain verification + binding, k-anonymity, the full op set (COUNT/SUM/AVG/MIN/MAX/
  WEIGHTED_SUM), and the web UI driving all of it. Tamper is rejected on-chain.
- ⚠️ **Owner-local prover, not a trustless third party** — see [Trust model](#trust-model--privacy-read-this).
  WASM/TEE proving is named future work, not built.
- ⚠️ **No payments/escrow** — the marketplace settles a *verified result*, not money. Escrow against a
  fulfilled proof is a natural next step, deliberately out of the 8-day MVP.
- ⚠️ **sha256 Merkle, not Poseidon** — simpler and fully proven; Poseidon would be cheaper to prove.
- ⚠️ **Small-dataset live proving** — proving time grows ~linearly with rows; large datasets need
  pre-baked proofs (the UI supports pasting them).

## Tech & acknowledgements

- **[RISC Zero](https://dev.risczero.com/) zkVM 3.0.5** — Rust zkVM, STARK→Groth16.
- **[Nethermind Stellar RISC Zero verifier](https://github.com/NethermindEth/stellar-risc0-verifier)**
  — the on-chain Groth16 verifier + router stack we verify against. Thank you.
- **Stellar / Soroban** — Protocol 27 BN254 host functions make on-chain SNARK verification cheap.
- **Origin:** the product design, filter DSL, and Merkle/UX tooling are repurposed from the author's
  `mini-cdm` (a Confidential Data Marketplace originally built on Zama FHEVM/EVM). The crypto engine was
  swapped **FHE → ZK (RISC Zero)** and the chain **EVM → Soroban**; the Solidity/FHE layers are not
  ported.

## License

MIT.

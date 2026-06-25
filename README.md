# Sealed — a Private Data Marketplace on Stellar (ZK)

> **Prove answers. Reveal nothing.**
> A data owner commits a dataset on Stellar. A buyer asks for an aggregate — `COUNT`, `SUM`, `AVG`,
> `MIN`, `MAX`, `WEIGHTED_SUM` — over a filter. The owner answers with a **RISC Zero zero-knowledge
> proof**; a **Soroban contract verifies it** and binds the attested result on-chain. The buyer gets a
> trustworthy number. **The raw rows never leave the owner's machine.**

Built for **[Stellar Hacks: Real-World ZK](https://dorahacks.io/hackathon/stellar-hacks-zk)** (Stellar
Development Foundation). Live on **Stellar testnet** (Protocol 27, BN254 host functions).

To our knowledge, Sealed is the **first verifiable private-analytics marketplace on Stellar** — and the
**first to enforce k-anonymity inside a Soroban-verified proof**. The mechanism is domain-general:
anyone holding a sensitive dataset — payroll, clinical records, transaction history, ad-conversion, ESG
— can sell *verifiable aggregate answers* without ever revealing a row.

- 🎥 **Demo video:** https://youtu.be/6RzvZbpHq2k
- 🌐 **Network:** Stellar Testnet · 📜 **Contracts:** [see addresses](#live-on-testnet)
- 🔐 **ZK stack:** RISC Zero zkVM 3.0.5 → Groth16 → [Nethermind Soroban verifier](https://github.com/NethermindEth/stellar-risc0-verifier)
- ⚙️ **How the engine works:** [`docs/ENGINE.md`](docs/ENGINE.md) — the filter VM, aggregates, k-anonymity, and the commitments that bind them
- 🧑‍💻 **Built solo** in 8 days for this hackathon.

> **For judges (5 minutes):** watch the [~2-min demo](https://youtu.be/6RzvZbpHq2k); see a real proof
> verified **and** bound on-chain in the [`fulfill` tx](#live-on-testnet) — and a tampered/replayed proof
> rejected; then drive the live UI yourself against testnet ([run it](#running-it-yourself), no rebuild
> needed, connect Freighter). The [`demo/`](demo/) folder ships a CSV + a pre-baked proof so you can
> fulfill instantly. For the *why it's interesting*, skim [`docs/ENGINE.md`](docs/ENGINE.md).

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
  │  • recompute Merkle root         │     journal = 103 bytes:
  │  • run filter VM over each row   │       root│query_hash│op│cols│k│count│
  │  • aggregate matching rows       │       result│k_met│overflow│request_id
  │  • enforce k-anonymity           │
  │  • commit 103-byte journal       │── fulfill(seal, journal) ──┐
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

## The computation engine

The interesting part of Sealed isn't "a proof exists" — it's the **small verifiable query engine** that
runs inside it. A query is an aggregate `op`, a `target` column, an optional **filter** compiled to
stack bytecode, and a k-anonymity floor. The guest re-executes all of it in-circuit; the same engine
lives in the Soroban contract, the zkVM guest, and the TypeScript frontend, held byte-identical by a
cross-implementation test vector. Full walkthrough: **[`docs/ENGINE.md`](docs/ENGINE.md)**.

Over a 5-row dataset `[id, age, balance]`, the range it proves — with the filter `age > 30`:

| Query (as the UI shows it) | Proven result |
|----------------------------|--------------:|
| `COUNT(*) WHERE age > 30` | `3` |
| `SUM(balance) WHERE age > 30` | `310` |
| `AVG(balance) WHERE age > 30` | `103.33` *(carried as `10333`, ×100 fixed-point)* |
| `MIN(balance) WHERE age > 30` | `10` |
| `MAX(balance) WHERE age > 30` | `250` |
| `WEIGHTED_SUM[1,2,3] WHERE age > 30` | `1188` |
| `COUNT(*) WHERE (age > 30) AND (balance ≤ 5000)` | *(nested filters: `AND`/`OR`/`NOT`)* |

The **filter** is a postfix bytecode VM (`PUSH_FIELD` / `PUSH_CONST` / comparators / `AND`·`OR`·`NOT`,
max depth 8). It's compiled from the UI builder — or from a **pasted JSON query** that references
columns by name and expresses nesting the inline builder can't — and **decoded back to text** by the
exact inverse of the compiler, so the line shown to the owner before they prove (`COUNT(*) WHERE age >
30`) is provably the predicate the proof evaluated. **k-anonymity is enforced in the circuit:** if fewer
than `k` rows match, the result is zeroed before it reaches the journal (and the overflow flag is
cleared too, so a suppressed sub-`k` subset can't leak through that channel).

---

## Trust model & privacy (read this)

**Be honest about what is and isn't trustless** — the hackathon brief asks for it, and the distinction
matters.

- **The buyer / the chain are fully protected.** They never see raw rows, and they cannot be lied to:
  the proof + binding guarantee the result is the honest aggregate of the committed dataset under the
  agreed query. This part is trustless.
- **Column _labels_ are committed on-chain, but not yet _proven_.** The dataset's column names are
  stored **on-chain** in the `Dataset` (set once at registration, immutable thereafter, identical for
  every buyer), and the UI renders queries with them — `COUNT(*) WHERE age > 30`, not `field 1`. That's
  a real improvement over an off-chain data dictionary. But the proof still binds columns by **index**:
  the names aren't folded into `query_hash` or the Merkle root, so they remain owner-asserted metadata.
  The proof guarantees *"this COUNT used column index 1 over rows hashing to the committed root with the
  agreed filter"* — **not** that index 1 is truthfully "age." A dishonest owner could mislabel a column
  and still produce a valid proof. Folding the schema into the commitment is named in future work.
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
- **Schema commitment** — column names are now committed on-chain in the `Dataset` (done); the remaining
  step is to fold them into `query_hash` / the Merkle root, so a label like "age = index 1" is bound by
  the same commitment the proof already covers. Closes the labeling gap noted in the trust model.

---

## Live on testnet

Network: **Stellar Testnet**, Protocol 27. The addresses below are the current **schema-enabled pair** —
what the frontend bindings (the source of truth) point at. It holds the demo's live run: **dataset 1**
(committed Merkle root + on-chain column labels) and **request 1**, fulfilled by a real Groth16 proof
(`get_result(1) = (3, true, false)`).

| Contract | Address (→ stellar.expert) |
|----------|----------------------------|
| **DatasetRegistry** | [`CB7F7A23JYWZVBE5WJZTJDYSKK2IHUJJF2GSY575HMSVN2NVL5OQPTAA`](https://stellar.expert/explorer/testnet/contract/CB7F7A23JYWZVBE5WJZTJDYSKK2IHUJJF2GSY575HMSVN2NVL5OQPTAA) |
| **JobManager** | [`CDB2W5HPALCKHG63G75KMAZQYEL45JZJZT5LFQPD4BNCULKAIYCMAXIW`](https://stellar.expert/explorer/testnet/contract/CDB2W5HPALCKHG63G75KMAZQYEL45JZJZT5LFQPD4BNCULKAIYCMAXIW) |
| VerifierRouter (Nethermind) | [`CBRBVQP2GOW6FONS4S4Q6BEC53BAJJGWOJRXC4KNDCFJ6WG673MQX633`](https://stellar.expert/explorer/testnet/contract/CBRBVQP2GOW6FONS4S4Q6BEC53BAJJGWOJRXC4KNDCFJ6WG673MQX633) |
| Groth16Verifier (Nethermind) | [`CALVN6PA6YIGSIKI6T7ZZAP2IW7UF3N4MLNVMOU2DWQ7HUYFXLMBDIX4`](https://stellar.expert/explorer/testnet/contract/CALVN6PA6YIGSIKI6T7ZZAP2IW7UF3N4MLNVMOU2DWQ7HUYFXLMBDIX4) |

- **Guest `image_id`** (the one program the JobManager trusts):
  `6290a9cb12b55075f93834a58eccfa100b7839157f37df8b3f4eae78060108c3`
- **Proven end-to-end on-chain** on the current `JobManager` (above): register → submit → accept →
  `fulfill` with the real Groth16 proof → **`get_result(1) = (3, true, false)`**. This is the exact flow
  in the [demo video](https://youtu.be/6RzvZbpHq2k), live on the schema-enabled pair — anyone can re-read
  it by calling `get_result(1)` on the JobManager.
- **Replay rejection proven on-chain:** an *identical* second request (id 2) cannot be fulfilled with
  request 1's valid proof — the router's `verify` returns success, then `fulfill` **traps** on the
  `request_id` binding (`UnreachableCodeReached`). A proof is bound to exactly one request.
- **Tamper rejection:** flipping a single journal byte makes `sha256(journal)` differ, so the Groth16
  verifier **traps**; `fulfill` fails at simulation and the request stays `Accepted`.

---

## Repository layout

```
sealed-stellar-zk/
├─ contracts/                 Soroban contracts (Rust, no_std) — cargo workspace
│  ├─ cdm-shared/             merkle · filter VM · aggregates · 103-byte journal · query_hash (29 tests)
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

- **Contracts + shared + guest logic:** `cargo test` — **54 tests** (cdm-shared 29, dataset-registry 7,
  job-manager 18), including the real-Groth16 happy path through the actual verifier contract and the
  negative security tests (tampered journal, wrong owner, root/op/k/query_hash mismatch, replay,
  schema-length mismatch).
- **Frontend glue:** `npm test` in `frontend` — **43 vitest tests**: filter-DSL bytecode ↔ on-chain
  params ↔ prover params round-trip, the bytecode→text decoder (`compile → decode` is identity),
  CSV-header schema parsing, and the JSON query parser.

---

## Honest status

Per the brief's "say what's unfinished" — here's the straight version:

- ✅ **Real, end-to-end, on live testnet:** dataset commit, request lifecycle, real RISC Zero Groth16
  proofs, on-chain verification + binding, k-anonymity, the full op set (COUNT/SUM/AVG/MIN/MAX/
  WEIGHTED_SUM), and the web UI driving all of it. Tamper is rejected on-chain.
- ⚠️ **Owner-local prover, not a trustless third party** — see [Trust model](#trust-model--privacy-read-this).
  WASM/TEE proving is named future work, not built.
- ⚠️ **Column labels are committed, not proven** — names are stored on-chain and the UI queries by name,
  but the proof binds columns by *index*; it attests the computation, not that a label is truthful.
  Folding the schema into the commitment is named future work (see [Trust model](#trust-model--privacy-read-this)).
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

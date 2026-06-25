# Hosting the demo (Vercel)

The web UI is a fully **static** Next.js app — it reads Stellar testnet directly from the
browser (Soroban RPC) and never needs a server of its own. That makes it trivial to host:
a visitor can connect Freighter, browse the sealed datasets, read every query in plain
English, compose and submit a buyer request, and inspect proofs already verified on-chain.

**What the hosted demo deliberately does _not_ do:** run the prover. The prover
(`prover-service`, default `http://localhost:8787`) sits inside the **owner's trust
boundary** by design — the raw CSV never leaves the owner's machine. So the two
prover-backed actions, **registering a dataset** (computes the Merkle root) and **live
"prove locally"**, are gated on the hosted build: they explain themselves and link to the
repo instead of failing on a localhost fetch. The **paste / CLI proof path** on fulfill
still works — paste a `seal` + `journal` produced by the local prover and it verifies
on-chain.

This split is set by one build flag.

## The hosted flag

```
NEXT_PUBLIC_HOSTED=1
```

- **Set it on Vercel** (Project → Settings → Environment Variables) so the deployed build
  is the read/browse/paste demo.
- **Leave it unset locally** (`npm run dev` / `npm run build`) so your own machine keeps the
  full register + live-prove flow against `localhost:8787`.

`lib/env.ts` reads it; `HostedBanner` (masthead strip) and `HostedNote` (inline, on the
register + prove-locally controls) render only when it is `1`.

## Deploy

The app is an npm-workspaces monorepo under `frontend/` (the Next app is
`packages/site`, with `shared` / `dataset-registry` / `job-manager` built to `dist/`
first). Point Vercel at `frontend/` and the included `frontend/vercel.json` does the rest.

### Via the dashboard (recommended)

1. Import the GitHub repo into Vercel.
2. **Root Directory → `frontend`** (this is the one setting that matters — it tells Vercel
   the workspace root, not the repo root).
3. Add env var **`NEXT_PUBLIC_HOSTED` = `1`**.
4. Deploy. `frontend/vercel.json` pins the framework (`nextjs`), install (`npm install`,
   which links the workspaces), build (`npm run build` → builds the three packages, then
   `next build`), and output (`packages/site/.next`).

### Via the CLI

```bash
npm i -g vercel
cd frontend
vercel link            # set Root Directory to "." (you're already in frontend)
vercel env add NEXT_PUBLIC_HOSTED   # value: 1
vercel --prod
```

## Verify a hosted build locally

```bash
cd frontend
NEXT_PUBLIC_HOSTED=1 npm run build && npm -w packages/site run start
```

You should see the "Live demo · Stellar testnet" banner, a disabled "Compute Merkle root"
with the local-prover note in Register, and the prove-locally note (paste path still live)
in the owner's Fulfill panel. Unset the flag and both prover paths return.

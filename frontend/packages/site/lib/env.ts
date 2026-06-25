/**
 * Build-time flags.
 *
 * `NEXT_PUBLIC_HOSTED=1` marks the public demo deploy (Vercel), where the
 * owner-local prover (localhost:8787) isn't reachable. The prover sits inside the
 * owner's trust boundary by design — so on the hosted demo, the two prover-backed
 * actions (register's Merkle-root compute, live "prove locally") explain themselves
 * and point at the repo, instead of throwing a confusing localhost fetch error.
 *
 * Everything else still works on the hosted demo: reads from testnet, the legible
 * query decoder, buyer submit, and the paste/CLI proof path on fulfill.
 */
export const IS_HOSTED = process.env.NEXT_PUBLIC_HOSTED === "1";

/** Public repository — linked from the hosted demo for the "run it locally" path. */
export const REPO_URL = "https://github.com/ego-errante/sealed-stellar-zk";

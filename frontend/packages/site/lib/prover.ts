// Client for the owner-local prover-service. The owner runs this on their own machine;
// the CSV posted here stays within the owner's trust boundary (localhost). Proving is slow
// (~237s + ~7.5s/row), so /prove holds the connection for minutes.

import { PROVER_URL } from "@/config/network";
import type { ProveParams } from "@/lib/convert";

export interface RegisterResult {
  merkle_root: string; // hex
  num_columns: number;
  row_count: number;
}

export interface ProveResult {
  seal: string; // hex
  image_id: string; // hex
  journal: string; // hex
}

async function post<T>(path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${PROVER_URL}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error(
      `Cannot reach the prover at ${PROVER_URL}. Start it on your machine (the owner-local prover-service).`
    );
  }
  if (!res.ok) throw new Error((await res.text()) || `prover ${res.status}`);
  return res.json() as Promise<T>;
}

/** Compute the Merkle root + shape from a CSV (owner-local). */
export function proverRegister(csv: string): Promise<RegisterResult> {
  return post<RegisterResult>("/register", { csv });
}

/** Generate a Groth16 proof for a query over a CSV (owner-local; minutes). */
export function proverProve(
  csv: string,
  params: ProveParams
): Promise<ProveResult> {
  return post<ProveResult>("/prove", { csv, params });
}

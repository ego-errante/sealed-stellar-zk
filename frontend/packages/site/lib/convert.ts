import { Buffer } from "buffer";
import type { QueryParams } from "job-manager";

/** Params the owner-local prover-service `/prove` expects (mirrors proverlib::ProveParams). */
export interface ProveParams {
  op: number;
  target_field: number;
  k: number;
  filter_bytecode: string; // hex, no 0x; "" = no filter
  /** u64 constants as exact decimal strings — a JSON number would round values above 2^53. */
  consts: string[];
  weights: number[];
  /** The request this proof is for; echoed into the journal and bound on-chain by fulfill. */
  request_id: number;
}

export interface QueryFormInput {
  op: number;
  targetField: number;
  /** FilterBuilder output, or null for "no filter". */
  filter: { bytecode: string; consts: number[] } | null;
  weights: number[];
}

/** FilterBuilder `{bytecode, consts}` + op/target/weights → contract `QueryParams`. */
export function toQueryParams(input: QueryFormInput): QueryParams {
  const hex = (input.filter?.bytecode ?? "").replace(/^0x/, "");
  return {
    op: input.op,
    target_field: input.targetField,
    filter_bytecode: Buffer.from(hex, "hex"),
    consts: (input.filter?.consts ?? []).map((c) => BigInt(c)),
    weights: input.weights,
  };
}

/** On-chain `Request.params` + `dataset.k` + the request id → prover `ProveParams`. */
export function toProveParams(
  params: QueryParams,
  datasetK: bigint,
  requestId: bigint
): ProveParams {
  return {
    op: params.op,
    target_field: params.target_field,
    k: Number(datasetK),
    filter_bytecode: Buffer.from(params.filter_bytecode).toString("hex"),
    // Stringify rather than Number(): on-chain consts are u64 (bigint) and values above 2^53
    // would otherwise be silently rounded, making the prover evaluate a different predicate.
    consts: params.consts.map((c) => c.toString()),
    weights: params.weights,
    // Request ids are sequential and small; Number is exact here and binds the proof to this request.
    request_id: Number(requestId),
  };
}

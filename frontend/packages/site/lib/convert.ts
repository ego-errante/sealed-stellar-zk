import { Buffer } from "buffer";
import type { QueryParams } from "job-manager";

/** Params the owner-local prover-service `/prove` expects (mirrors proverlib::ProveParams). */
export interface ProveParams {
  op: number;
  target_field: number;
  k: number;
  filter_bytecode: string; // hex, no 0x; "" = no filter
  consts: number[];
  weights: number[];
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

/** On-chain `Request.params` + `dataset.k` → prover `ProveParams` (the owner reconstructs prove input). */
export function toProveParams(params: QueryParams, datasetK: bigint): ProveParams {
  return {
    op: params.op,
    target_field: params.target_field,
    k: Number(datasetK),
    filter_bytecode: Buffer.from(params.filter_bytecode).toString("hex"),
    consts: params.consts.map((c) => Number(c)),
    weights: params.weights,
  };
}

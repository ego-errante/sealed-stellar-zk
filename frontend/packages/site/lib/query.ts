import { describeQuery } from "@cdm/shared";
import type { RequestView } from "@/lib/requests";

/**
 * One-line, schema-aware text for an on-chain request — e.g. `COUNT(*) WHERE age > 30`.
 * Pass the dataset's column names; falls back to `field N` for any unnamed/absent column
 * (so it still reads sensibly when the dataset isn't in the caller's list).
 */
export function describeRequest(
  request: RequestView,
  columnNames: readonly string[],
): string {
  return describeQuery(
    {
      op: request.params.op,
      targetField: request.params.target_field,
      filterBytecode: request.params.filter_bytecode,
      consts: request.params.consts,
      weights: request.params.weights,
    },
    columnNames,
  );
}

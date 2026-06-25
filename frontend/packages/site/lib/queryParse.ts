import {
  compileFilterDSL,
  OpNames,
  type ComparisonOp,
  type FilterDSL,
} from "@cdm/shared";
import type { QueryFormInput } from "@/lib/convert";

/**
 * Parse an uploaded/pasted JSON query into the same shape the submit form produces.
 *
 * Columns are referenced by name (resolved against the dataset schema), so a buyer can
 * write `{ "gt": ["age", 30] }` instead of field indices — and express nesting / mixed
 * AND-OR that the inline two-condition builder can't. Throws with a human message on any
 * unknown column, op, or malformed node so the UI can surface it.
 *
 * Grammar:
 *   query  := { op, target?, filter?, weights? }
 *   op     := "COUNT" | "SUM" | ... (case-insensitive) | 0..5
 *   target := column name | index   (ignored by COUNT / WEIGHTED_SUM)
 *   filter := cmp | { and:[filter,…] } | { or:[filter,…] } | { not: filter }
 *   cmp    := { gt|ge|lt|le|eq|ne: [column, value] }
 */
export function parseQueryJson(raw: string, columnNames: readonly string[]): QueryFormInput {
  let doc: unknown;
  try {
    doc = JSON.parse(raw);
  } catch {
    throw new Error("Not valid JSON.");
  }
  if (typeof doc !== "object" || doc === null) {
    throw new Error("Query must be a JSON object.");
  }
  const obj = doc as Record<string, unknown>;

  const op = resolveOp(obj.op);
  const targetField = obj.target == null ? 0 : resolveColumn(obj.target, columnNames);
  const weights = Array.isArray(obj.weights) ? obj.weights.map((w) => Number(w)) : [];
  const filter =
    obj.filter == null ? null : compileFilterDSL(nodeToDsl(obj.filter, columnNames));

  return { op, targetField, filter, weights };
}

function resolveOp(op: unknown): number {
  if (typeof op === "number" && Number.isInteger(op) && op >= 0 && op < OpNames.length) {
    return op;
  }
  if (typeof op === "string") {
    const idx = OpNames.indexOf(op.trim().toUpperCase() as (typeof OpNames)[number]);
    if (idx >= 0) return idx;
  }
  throw new Error(`Unknown op "${String(op)}". Expected one of: ${OpNames.join(", ")}.`);
}

/** column name (case-insensitive), a bare index, or "field N" → column index */
function resolveColumn(ref: unknown, columnNames: readonly string[]): number {
  if (typeof ref === "number" && Number.isInteger(ref) && ref >= 0) return ref;
  if (typeof ref === "string") {
    const t = ref.trim();
    const byName = columnNames.findIndex((n) => n.trim().toLowerCase() === t.toLowerCase());
    if (byName >= 0) return byName;
    const m = /^(?:field\s+)?(\d+)$/i.exec(t);
    if (m) return Number(m[1]);
    throw new Error(`Unknown column "${ref}". Known columns: ${columnNames.join(", ")}.`);
  }
  throw new Error(`Invalid column reference: ${JSON.stringify(ref)}.`);
}

const COMPARATORS: Record<string, ComparisonOp> = {
  gt: "GT",
  ge: "GE",
  lt: "LT",
  le: "LE",
  eq: "EQ",
  ne: "NE",
};

function nodeToDsl(node: unknown, columnNames: readonly string[]): FilterDSL {
  if (typeof node !== "object" || node === null) {
    throw new Error(`Invalid filter node: ${JSON.stringify(node)}.`);
  }
  const obj = node as Record<string, unknown>;

  for (const [key, opName] of Object.entries(COMPARATORS)) {
    if (key in obj) {
      const operand = obj[key];
      if (!Array.isArray(operand) || operand.length !== 2) {
        throw new Error(`"${key}" expects [column, value], got ${JSON.stringify(operand)}.`);
      }
      const field = resolveColumn(operand[0], columnNames);
      const value = Number(operand[1]);
      if (!Number.isFinite(value)) throw new Error(`"${key}" value must be a number.`);
      return [opName, field, value];
    }
  }

  if ("and" in obj || "or" in obj) {
    const isAnd = "and" in obj;
    const list = obj[isAnd ? "and" : "or"];
    if (!Array.isArray(list) || list.length === 0) {
      throw new Error(`"${isAnd ? "and" : "or"}" expects a non-empty array of conditions.`);
    }
    const dsls = list.map((n) => nodeToDsl(n, columnNames));
    return dsls.reduce((acc, d) => [isAnd ? "AND" : "OR", acc, d]);
  }

  if ("not" in obj) {
    return ["NOT", nodeToDsl(obj.not, columnNames)];
  }

  throw new Error(
    `Unrecognized filter node ${JSON.stringify(node)}. Use gt/ge/lt/le/eq/ne, and, or, not.`,
  );
}

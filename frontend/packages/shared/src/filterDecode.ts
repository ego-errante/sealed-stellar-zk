// Inverse of filterDsl.ts — turn on-chain filter bytecode + consts back into a
// human-readable predicate. The Filter VM bytecode is a postfix (stack) program;
// decoding walks it with an operand stack, exactly mirroring how the guest executes it.
//
// This module is display-only: it never touches the compiler, so the bytecode the
// guest hashes stays bit-identical. Const values are carried as decimal strings so a
// u64 above 2^53 renders exactly (a JS number would silently round it).

import { opcodes } from "./filterDsl.js";
import { OpNames } from "./constants.js";

export type ComparisonOp = "GT" | "GE" | "LT" | "LE" | "EQ" | "NE";

export type DecodedFilter =
  | { kind: "cmp"; op: ComparisonOp; field: number; value: string }
  | { kind: "and"; left: DecodedFilter; right: DecodedFilter }
  | { kind: "or"; left: DecodedFilter; right: DecodedFilter }
  | { kind: "not"; expr: DecodedFilter };

const COMPARATORS: Record<number, ComparisonOp> = {
  [opcodes.GT]: "GT",
  [opcodes.GE]: "GE",
  [opcodes.LT]: "LT",
  [opcodes.LE]: "LE",
  [opcodes.EQ]: "EQ",
  [opcodes.NE]: "NE",
};

const SYMBOLS: Record<ComparisonOp, string> = {
  GT: ">",
  GE: "≥",
  LT: "<",
  LE: "≤",
  EQ: "=",
  NE: "≠",
};

/** Accept the hex string the builder emits, the Buffer the contract returns, or a raw byte list. */
function toBytes(bytecode: string | Uint8Array | number[]): Uint8Array {
  if (typeof bytecode === "string") {
    const hex = bytecode.replace(/^0x/, "");
    if (hex.length % 2 !== 0) throw new Error("filter bytecode hex has an odd length");
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return out;
  }
  return bytecode instanceof Uint8Array ? bytecode : Uint8Array.from(bytecode);
}

type Operand =
  | { t: "field"; index: number }
  | { t: "const"; value: string }
  | { t: "node"; node: DecodedFilter };

/**
 * Decode filter bytecode + its const table into a {@link DecodedFilter} tree.
 * @param bytecode hex string (with/without 0x), Buffer/Uint8Array, or byte list
 * @param consts the request's const table; resolved by index, stringified u64-exact
 */
export function decodeFilter(
  bytecode: string | Uint8Array | number[],
  consts: ReadonlyArray<number | bigint | string>,
): DecodedFilter {
  const bytes = toBytes(bytecode);
  const stack: Operand[] = [];
  let i = 0;

  const u16 = () => {
    if (i + 1 >= bytes.length) throw new Error("filter bytecode truncated mid-operand");
    const v = (bytes[i] << 8) | bytes[i + 1];
    i += 2;
    return v;
  };

  while (i < bytes.length) {
    const op = bytes[i++];
    if (op === opcodes.PUSH_FIELD) {
      stack.push({ t: "field", index: u16() });
    } else if (op === opcodes.PUSH_CONST) {
      const idx = u16();
      if (idx >= consts.length) throw new Error(`filter references const ${idx} but only ${consts.length} provided`);
      stack.push({ t: "const", value: String(consts[idx]) });
    } else if (op in COMPARATORS) {
      const right = stack.pop();
      const left = stack.pop();
      if (left?.t !== "field" || right?.t !== "const") {
        throw new Error("comparator expects PUSH_FIELD then PUSH_CONST");
      }
      stack.push({ t: "node", node: { kind: "cmp", op: COMPARATORS[op], field: left.index, value: right.value } });
    } else if (op === opcodes.AND || op === opcodes.OR) {
      const right = stack.pop();
      const left = stack.pop();
      if (left?.t !== "node" || right?.t !== "node") throw new Error("AND/OR expects two sub-expressions");
      stack.push({ t: "node", node: { kind: op === opcodes.AND ? "and" : "or", left: left.node, right: right.node } });
    } else if (op === opcodes.NOT) {
      const expr = stack.pop();
      if (expr?.t !== "node") throw new Error("NOT expects a sub-expression");
      stack.push({ t: "node", node: { kind: "not", expr: expr.node } });
    } else {
      throw new Error(`unknown filter opcode 0x${op.toString(16).padStart(2, "0")}`);
    }
  }

  if (stack.length !== 1 || stack[0].t !== "node") throw new Error("filter bytecode did not reduce to one expression");
  return stack[0].node;
}

/** Column name for an index, falling back to `field N` when the schema doesn't name it. */
export function fieldLabel(index: number, columnNames: readonly string[]): string {
  return columnNames[index]?.trim() || `field ${index}`;
}

/** Render a decoded tree as text, e.g. `(age > 30) AND (NOT (balance ≥ 1000))`. */
export function describeFilter(node: DecodedFilter, columnNames: readonly string[]): string {
  switch (node.kind) {
    case "cmp":
      return `${fieldLabel(node.field, columnNames)} ${SYMBOLS[node.op]} ${node.value}`;
    case "not":
      return `NOT (${describeFilter(node.expr, columnNames)})`;
    case "and":
    case "or":
      return `(${describeFilter(node.left, columnNames)}) ${node.kind.toUpperCase()} (${describeFilter(node.right, columnNames)})`;
  }
}

export interface QueryShape {
  op: number;
  targetField: number;
  filterBytecode: string | Uint8Array | number[];
  consts: ReadonlyArray<number | bigint | string>;
  weights?: ReadonlyArray<number>;
}

/** The one-line, schema-aware description of a request shown to owner and buyer. */
export function describeQuery(q: QueryShape, columnNames: readonly string[]): string {
  const COUNT = 3;
  const WEIGHTED_SUM = 0;
  const name = OpNames[q.op] ?? `OP${q.op}`;

  let agg: string;
  if (q.op === COUNT) {
    agg = "COUNT(*)";
  } else if (q.op === WEIGHTED_SUM) {
    agg = `WEIGHTED_SUM(${(q.weights ?? []).join(", ")})`;
  } else {
    agg = `${name}(${fieldLabel(q.targetField, columnNames)})`;
  }

  const bytes = toBytes(q.filterBytecode);
  if (bytes.length === 0) return agg;
  return `${agg} WHERE ${describeFilter(decodeFilter(bytes, q.consts), columnNames)}`;
}

import { describe, expect, it } from "vitest";
import {
  and,
  buildBytecode,
  compileFilterDSL,
  decodeFilter,
  describeFilter,
  describeQuery,
  eq,
  ge,
  gt,
  lt,
  not,
  or,
  type DecodedFilter,
} from "@cdm/shared";

const NAMES = ["user_id", "age", "balance"];

describe("decodeFilter (inverse of compileFilterDSL — round-trips bytecode+consts back to a tree)", () => {
  it("round-trips a single comparison", () => {
    const { bytecode, consts } = compileFilterDSL(gt(1, 30));
    expect(decodeFilter(bytecode, consts)).toEqual({
      kind: "cmp",
      op: "GT",
      field: 1,
      value: "30",
    } satisfies DecodedFilter);
  });

  it("round-trips an AND of two comparisons (const indices resolved by position)", () => {
    const { bytecode, consts } = compileFilterDSL(and(gt(1, 30), ge(2, 1000)));
    expect(decodeFilter(bytecode, consts)).toEqual({
      kind: "and",
      left: { kind: "cmp", op: "GT", field: 1, value: "30" },
      right: { kind: "cmp", op: "GE", field: 2, value: "1000" },
    } satisfies DecodedFilter);
  });

  it("round-trips OR, NOT, and a nested mix", () => {
    const dsl = or(not(eq(0, 5)), and(lt(1, 18), gt(2, 0)));
    const { bytecode, consts } = compileFilterDSL(dsl);
    expect(decodeFilter(bytecode, consts)).toEqual({
      kind: "or",
      left: { kind: "not", expr: { kind: "cmp", op: "EQ", field: 0, value: "5" } },
      right: {
        kind: "and",
        left: { kind: "cmp", op: "LT", field: 1, value: "18" },
        right: { kind: "cmp", op: "GT", field: 2, value: "0" },
      },
    } satisfies DecodedFilter);
  });

  it("accepts a Uint8Array bytecode with bigint consts and stays u64-exact (no float rounding)", () => {
    // The on-chain shape: filter_bytecode is a byte array, consts are u64 bigints.
    const hex = buildBytecode([["PUSH_FIELD", 2], ["PUSH_CONST", 0], ["GT"]]);
    const bytes = Uint8Array.from(
      hex
        .replace(/^0x/, "")
        .match(/.{2}/g)!
        .map((h) => parseInt(h, 16)),
    );
    const huge = 18446744073709551615n; // 2^64 - 1, far beyond 2^53
    expect(decodeFilter(bytes, [huge])).toEqual({
      kind: "cmp",
      op: "GT",
      field: 2,
      value: "18446744073709551615",
    } satisfies DecodedFilter);
  });
});

describe("describeFilter (tree → human text using the dataset schema)", () => {
  it("renders comparisons by column name with math symbols", () => {
    const node = decodeFilter(...Object.values(compileFilterDSL(gt(1, 30))) as [string, number[]]);
    expect(describeFilter(node, NAMES)).toBe("age > 30");
  });

  it("parenthesizes AND/OR and prefixes NOT", () => {
    const node = decodeFilter(
      ...(Object.values(compileFilterDSL(and(gt(1, 30), not(ge(2, 1000))))) as [
        string,
        number[],
      ]),
    );
    expect(describeFilter(node, NAMES)).toBe("(age > 30) AND (NOT (balance ≥ 1000))");
  });

  it("falls back to `field N` when a column is unnamed", () => {
    const node = decodeFilter(...(Object.values(compileFilterDSL(lt(2, 5))) as [string, number[]]));
    expect(describeFilter(node, ["id"])).toBe("field 2 < 5");
  });
});

describe("describeQuery (full aggregate + WHERE, the line shown to owner & buyer)", () => {
  it("COUNT renders as COUNT(*) and appends the filter", () => {
    const { bytecode, consts } = compileFilterDSL(gt(1, 30));
    expect(
      describeQuery({ op: 3, targetField: 0, filterBytecode: bytecode, consts }, NAMES),
    ).toBe("COUNT(*) WHERE age > 30");
  });

  it("SUM/AVG/MIN/MAX name the target column", () => {
    expect(
      describeQuery({ op: 1, targetField: 2, filterBytecode: "", consts: [] }, NAMES),
    ).toBe("SUM(balance)");
    expect(
      describeQuery({ op: 2, targetField: 1, filterBytecode: "0x", consts: [] }, NAMES),
    ).toBe("AVG(age)");
  });

  it("WEIGHTED_SUM lists the per-column weights", () => {
    expect(
      describeQuery(
        { op: 0, targetField: 0, filterBytecode: "", consts: [], weights: [1, 2, 3] },
        NAMES,
      ),
    ).toBe("WEIGHTED_SUM(1, 2, 3)");
  });

  it("omits WHERE when there is no filter", () => {
    expect(
      describeQuery({ op: 4, targetField: 1, filterBytecode: new Uint8Array(), consts: [] }, NAMES),
    ).toBe("MIN(age)");
  });
});

import { describe, expect, it } from "vitest";
import {
  and,
  compileFilterDSL,
  ge,
  gt,
  lt,
  ne,
  not,
  or,
} from "@cdm/shared";
import { parseQueryJson } from "@/lib/queryParse";

const NAMES = ["user_id", "age", "balance"];

describe("parseQueryJson (uploaded JSON → form input; columns referenced by name)", () => {
  it("resolves op + target by name and compiles a single comparison", () => {
    const q = parseQueryJson(
      JSON.stringify({ op: "SUM", target: "balance", filter: { gt: ["age", 30] } }),
      NAMES,
    );
    expect(q.op).toBe(1); // SUM
    expect(q.targetField).toBe(2); // balance
    expect(q.weights).toEqual([]);
    expect(q.filter).toEqual(compileFilterDSL(gt(1, 30)));
  });

  it("folds an n-ary AND of three conditions (left-assoc, matching the DSL)", () => {
    const q = parseQueryJson(
      JSON.stringify({
        op: "COUNT",
        filter: { and: [{ gt: ["age", 18] }, { lt: ["age", 65] }, { ge: ["balance", 1000] }] },
      }),
      NAMES,
    );
    expect(q.filter).toEqual(
      compileFilterDSL(and(and(gt(1, 18), lt(1, 65)), ge(2, 1000))),
    );
  });

  it("handles OR + NOT nesting the inline builder can't express", () => {
    const q = parseQueryJson(
      JSON.stringify({
        op: "COUNT",
        filter: { or: [{ not: { eq: ["user_id", 0] } }, { ne: ["balance", 0] }] },
      }),
      NAMES,
    );
    expect(q.filter).toEqual(
      compileFilterDSL(or(not(["EQ", 0, 0]), ne(2, 0))),
    );
  });

  it("defaults COUNT target to 0 and yields a null filter when absent", () => {
    const q = parseQueryJson(JSON.stringify({ op: "COUNT" }), NAMES);
    expect(q.op).toBe(3);
    expect(q.targetField).toBe(0);
    expect(q.filter).toBeNull();
  });

  it("parses WEIGHTED_SUM weights", () => {
    const q = parseQueryJson(
      JSON.stringify({ op: "WEIGHTED_SUM", weights: [1, 2, 3] }),
      NAMES,
    );
    expect(q.op).toBe(0);
    expect(q.weights).toEqual([1, 2, 3]);
  });

  it("accepts a numeric field index and a bare op code", () => {
    const q = parseQueryJson(JSON.stringify({ op: 4, target: 1 }), NAMES);
    expect(q.op).toBe(4); // MIN
    expect(q.targetField).toBe(1);
  });

  it("throws a helpful error for an unknown column", () => {
    expect(() =>
      parseQueryJson(JSON.stringify({ op: "COUNT", filter: { gt: ["height", 5] } }), NAMES),
    ).toThrow(/height/);
  });

  it("throws for an unknown op", () => {
    expect(() => parseQueryJson(JSON.stringify({ op: "MEDIAN" }), NAMES)).toThrow(/MEDIAN/);
  });

  it("throws for malformed JSON", () => {
    expect(() => parseQueryJson("{ not json", NAMES)).toThrow();
  });

  it("throws for an unrecognized filter node", () => {
    expect(() =>
      parseQueryJson(JSON.stringify({ op: "COUNT", filter: { between: ["age", 1, 9] } }), NAMES),
    ).toThrow();
  });
});

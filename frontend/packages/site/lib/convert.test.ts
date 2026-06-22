import { describe, expect, it } from "vitest";
import { Buffer } from "buffer";
import { compileFilterDSL } from "@cdm/shared";
import type { QueryParams } from "job-manager";
import { toProveParams, toQueryParams } from "@/lib/convert";

describe("toQueryParams (FilterBuilder output → contract QueryParams)", () => {
  it("decodes a 0x-prefixed bytecode hex to a Buffer and consts to bigint[]", () => {
    const p = toQueryParams({
      op: 3,
      targetField: 0,
      filter: { bytecode: "0x01000102000010", consts: [30] },
      weights: [],
    });
    expect(p.op).toBe(3);
    expect(p.target_field).toBe(0);
    expect(Buffer.from(p.filter_bytecode).toString("hex")).toBe("01000102000010");
    expect(p.consts).toEqual([30n]);
    expect(p.weights).toEqual([]);
  });

  it("treats a null filter as no filter (empty bytecode + consts)", () => {
    const p = toQueryParams({ op: 1, targetField: 2, filter: null, weights: [] });
    expect(p.filter_bytecode.length).toBe(0);
    expect(p.consts).toEqual([]);
  });

  it("passes weights through for WEIGHTED_SUM", () => {
    const p = toQueryParams({
      op: 0,
      targetField: 0,
      filter: null,
      weights: [1, 2, 3],
    });
    expect(p.weights).toEqual([1, 2, 3]);
  });
});

describe("toProveParams (on-chain Request.params + dataset.k → prover ProveParams)", () => {
  it("encodes filter_bytecode Buffer to hex (no 0x) and consts/k to numbers", () => {
    const qp: QueryParams = {
      op: 3,
      target_field: 0,
      filter_bytecode: Buffer.from("01000102000010", "hex"),
      consts: [30n],
      weights: [],
    };
    const pp = toProveParams(qp, 2n);
    expect(pp).toEqual({
      op: 3,
      target_field: 0,
      k: 2,
      filter_bytecode: "01000102000010",
      consts: [30],
      weights: [],
    });
  });

  it("emits an empty string for an empty filter", () => {
    const qp: QueryParams = {
      op: 1,
      target_field: 2,
      filter_bytecode: Buffer.alloc(0),
      consts: [],
      weights: [],
    };
    expect(toProveParams(qp, 5n).filter_bytecode).toBe("");
  });
});

describe("round-trip: compileFilterDSL → toQueryParams → toProveParams is byte-stable", () => {
  it("reproduces the guest's expected opcode bytes for field[1] > 30", () => {
    // PUSH_FIELD 0x01 | field 0x0001 | PUSH_CONST 0x02 | const 0x0000 | GT 0x10
    const compiled = compileFilterDSL(["GT", 1, 30]);
    const qp = toQueryParams({ op: 3, targetField: 0, filter: compiled, weights: [] });
    const pp = toProveParams(qp, 2n);
    expect(pp.filter_bytecode).toBe("01000102000010");
    expect(pp.consts).toEqual([30]);
    expect(pp.k).toBe(2);
  });
});

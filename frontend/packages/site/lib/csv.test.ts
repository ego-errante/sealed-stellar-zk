import { describe, expect, it } from "vitest";
import { countDataRows, parseCsvWithSchema } from "@/lib/csv";

describe("countDataRows (mirror proverlib::parse_csv — non-blank lines only)", () => {
  it("counts each non-blank line", () => {
    expect(countDataRows("1,2,3\n4,5,6")).toBe(2);
  });

  it("skips blank and whitespace-only interior/trailing lines like the prover does", () => {
    expect(countDataRows("\n 1,2 \n\n3,4\n")).toBe(2);
  });

  it("returns 0 for empty or whitespace-only input", () => {
    expect(countDataRows("")).toBe(0);
    expect(countDataRows("  \n  \n")).toBe(0);
  });
});

describe("parseCsvWithSchema (header detection + strip; the data hashed must exclude the header)", () => {
  it("detects a non-numeric first row as a header and strips it from the data", () => {
    const r = parseCsvWithSchema("user_id,age,balance\n10,22,500\n11,45,1200");
    expect(r.hadHeader).toBe(true);
    expect(r.names).toEqual(["user_id", "age", "balance"]);
    expect(r.dataCsv).toBe("10,22,500\n11,45,1200");
    expect(r.numColumns).toBe(3);
  });

  it("treats an all-integer first row as data (no header) and yields empty names to fill in", () => {
    const r = parseCsvWithSchema("10,22,500\n11,45,1200");
    expect(r.hadHeader).toBe(false);
    expect(r.dataCsv).toBe("10,22,500\n11,45,1200");
    expect(r.names).toEqual(["", "", ""]);
    expect(r.numColumns).toBe(3);
  });

  it("ignores blank lines and trims header fields", () => {
    const r = parseCsvWithSchema("\n a , b \n1,2\n\n3,4\n");
    expect(r.hadHeader).toBe(true);
    expect(r.names).toEqual(["a", "b"]);
    expect(r.dataCsv).toBe("1,2\n3,4");
    expect(r.numColumns).toBe(2);
  });

  it("returns empty for blank input", () => {
    const r = parseCsvWithSchema("   \n  ");
    expect(r).toEqual({ dataCsv: "", names: [], numColumns: 0, hadHeader: false });
  });
});

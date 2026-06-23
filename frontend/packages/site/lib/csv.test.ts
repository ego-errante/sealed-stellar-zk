import { describe, expect, it } from "vitest";
import { countDataRows } from "@/lib/csv";

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

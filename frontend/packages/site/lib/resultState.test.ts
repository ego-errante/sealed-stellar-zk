import { describe, expect, it } from "vitest";
import { resultDisplayState } from "@/lib/resultState";

describe("resultDisplayState (k-anon suppression outranks overflow)", () => {
  it("shows the value when k is met and there is no overflow", () => {
    expect(resultDisplayState(true, false)).toBe("value");
  });

  it("shows overflow when k is met but the aggregate overflowed", () => {
    expect(resultDisplayState(true, true)).toBe("overflow");
  });

  it("suppresses when k is not met (no overflow)", () => {
    expect(resultDisplayState(false, false)).toBe("suppressed");
  });

  it("suppresses when k is not met EVEN IF overflow is set — suppression wins, no leak", () => {
    // The whole point: a suppressed-but-overflowing aggregate must render as suppressed, not
    // 'Overflow', so the UI doesn't reveal that a small (<k) matching subset overflowed.
    expect(resultDisplayState(false, true)).toBe("suppressed");
  });
});

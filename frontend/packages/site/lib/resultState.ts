export type ResultState = "suppressed" | "overflow" | "value";

/**
 * Display precedence for a completed result. k-anonymity suppression OUTRANKS overflow: a result
 * withheld for too-few matching rows must never surface as "Overflow", which would leak that a
 * small (<k) matching subset existed and overflowed. Check `!kMet` first.
 */
export function resultDisplayState(kMet: boolean, overflow: boolean): ResultState {
  if (!kMet) return "suppressed";
  if (overflow) return "overflow";
  return "value";
}

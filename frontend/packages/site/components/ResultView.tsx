"use client";

import { OpCodes } from "@cdm/shared";

/** Renders a completed request's result: the unsealed value, k-anon suppression, or overflow. */
export function ResultView({
  result,
  kMet,
  overflow,
  op,
}: {
  result: bigint;
  kMet: boolean;
  overflow: boolean;
  op: number;
}) {
  if (overflow) {
    return (
      <span className="font-mono text-sm font-semibold text-alert">
        Overflow
      </span>
    );
  }
  if (!kMet) {
    return (
      <span
        className="inline-flex items-center gap-2 rounded-sm bg-seal px-2 py-1 font-mono text-xs text-muted-foreground"
        title="Fewer than k matching rows — result withheld"
      >
        <span className="redaction h-3 w-10" />
        Suppressed · k-anon
      </span>
    );
  }
  // AVG (op 2) is reported as a ×100 fixed-point integer by the guest.
  const display =
    op === OpCodes.AVG
      ? (Number(result) / 100).toFixed(2)
      : result.toString();
  return (
    <span className="animate-unseal font-mono text-lg font-semibold text-verify">
      {display}
    </span>
  );
}

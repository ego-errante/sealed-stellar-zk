"use client";

import { useDatasetCount } from "@/hooks/useDatasetRegistry";
import { useRequests } from "@/hooks/useJobManager";

/** Live counters for the thesis masthead: datasets sealed · queries proven. */
export function MastheadStats() {
  const count = useDatasetCount();
  const requests = useRequests();
  const proven = (requests.data ?? []).filter(
    (r) => r.status === "Completed"
  ).length;

  return (
    <div className="mt-8 flex gap-8 font-mono text-sm">
      <Stat value={count.data} label="datasets sealed" />
      <Stat value={requests.data ? proven : undefined} label="queries proven" />
    </div>
  );
}

function Stat({ value, label }: { value: number | undefined; label: string }) {
  return (
    <div>
      <div className="text-2xl font-semibold text-proof">
        {value ?? "—"}
      </div>
      <div className="text-xs uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
    </div>
  );
}

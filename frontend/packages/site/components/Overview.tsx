"use client";

import { useState } from "react";
import { Database, Layers } from "lucide-react";
import { useDatasets, type DatasetView } from "@/hooks/useDatasetRegistry";
import { useRequests } from "@/hooks/useJobManager";
import { useWallet } from "@/hooks/useWallet";
import { DatasetDrawer } from "@/components/DatasetDrawer";
import { RegisterDatasetModal } from "@/components/RegisterDatasetModal";
import { truncate } from "@/lib/utils";

export function Overview() {
  const { count, datasets } = useDatasets();
  const { address } = useWallet();
  const requests = useRequests();
  const [selected, setSelected] = useState<DatasetView | null>(null);
  const [open, setOpen] = useState(false);

  function openDrawer(d: DatasetView) {
    setSelected(d);
    setOpen(true);
  }

  const reqCountFor = (id: bigint) =>
    (requests.data ?? []).filter((r) => r.datasetId === id).length;

  return (
    <section className="mx-auto max-w-6xl px-6 pb-24">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-baseline gap-3">
          <h2 className="text-xl font-semibold">Datasets</h2>
          <span className="font-mono text-sm text-muted-foreground">
            {count.isLoading
              ? "loading…"
              : count.isError
                ? "error"
                : `${count.data} sealed`}
          </span>
        </div>
        {address && <RegisterDatasetModal />}
      </div>

      {datasets.isError && (
        <p className="font-mono text-sm text-destructive">
          Failed to read testnet: {String((datasets.error as Error)?.message)}
        </p>
      )}

      {datasets.data && datasets.data.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No datasets yet. Register one to commit a Merkle root on Stellar.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {datasets.data?.map((d) => (
          <DatasetCard
            key={d.id.toString()}
            d={d}
            requestCount={reqCountFor(d.id)}
            onClick={() => openDrawer(d)}
          />
        ))}
      </div>

      <DatasetDrawer
        dataset={selected}
        open={open}
        onOpenChange={setOpen}
        currentAddress={address}
      />
    </section>
  );
}

function DatasetCard({
  d,
  requestCount,
  onClick,
}: {
  d: DatasetView;
  requestCount: number;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="rounded-lg border border-border bg-card p-4 text-left transition-colors hover:border-proof/50"
    >
      <div className="flex items-center justify-between">
        <span className="font-display text-lg font-bold">
          Dataset #{d.id.toString()}
        </span>
        <span className="font-mono text-xs text-muted-foreground">
          owner {truncate(d.owner)}
        </span>
      </div>
      <div className="mt-4 flex gap-4 text-sm text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <Database className="h-3.5 w-3.5" /> {d.rowCount.toString()} rows
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Layers className="h-3.5 w-3.5" /> {d.numColumns} cols
        </span>
        <span className="font-mono text-xs">k={d.k.toString()}</span>
      </div>
      <div className="mt-3 flex items-center justify-between">
        <span className="truncate font-mono text-[11px] text-muted-foreground/70">
          root {d.merkleRoot.slice(0, 16)}…
        </span>
        {requestCount > 0 && (
          <span className="font-mono text-[11px] text-proof">
            {requestCount} req
          </span>
        )}
      </div>
    </button>
  );
}

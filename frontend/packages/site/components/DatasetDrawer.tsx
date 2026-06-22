"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { RequestRow } from "@/components/RequestRow";
import { SubmitRequestForm } from "@/components/SubmitRequestForm";
import type { DatasetView } from "@/hooks/useDatasetRegistry";
import { useRequests } from "@/hooks/useJobManager";
import { truncate } from "@/lib/utils";

export function DatasetDrawer({
  dataset,
  open,
  onOpenChange,
  currentAddress,
}: {
  dataset: DatasetView | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  currentAddress: string | null;
}) {
  const requests = useRequests();
  const [showForm, setShowForm] = useState(false);

  const rows = (requests.data ?? []).filter(
    (r) => dataset && r.datasetId === dataset.id
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        {dataset && (
          <>
            <SheetHeader>
              <SheetTitle className="font-display text-2xl">
                Dataset #{dataset.id.toString()}
              </SheetTitle>
              <SheetDescription className="font-mono text-xs">
                owner {truncate(dataset.owner, 6, 6)}
              </SheetDescription>
            </SheetHeader>

            <div className="mt-2 grid grid-cols-2 gap-2 px-4 font-mono text-xs text-muted-foreground">
              <span>{dataset.rowCount.toString()} rows</span>
              <span>{dataset.numColumns} columns</span>
              <span>k = {dataset.k.toString()}</span>
              <span>cooldown {dataset.cooldownSec}s</span>
              <span className="col-span-2 truncate">root {dataset.merkleRoot}</span>
            </div>

            <div className="mt-6 space-y-3 px-4">
              {currentAddress && (
                <div className="rounded-md border border-border p-3">
                  {showForm ? (
                    <SubmitRequestForm
                      dataset={dataset}
                      onDone={() => setShowForm(false)}
                    />
                  ) : (
                    <Button
                      variant="outline"
                      className="w-full"
                      onClick={() => setShowForm(true)}
                    >
                      <Plus className="mr-2 h-4 w-4" /> New request
                    </Button>
                  )}
                </div>
              )}

              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-muted-foreground">
                  Requests ({rows.length})
                </h3>
                {rows.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    No requests yet for this dataset.
                  </p>
                )}
                {rows.map((r) => (
                  <RequestRow
                    key={r.id.toString()}
                    request={r}
                    dataset={dataset}
                    currentAddress={currentAddress}
                  />
                ))}
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

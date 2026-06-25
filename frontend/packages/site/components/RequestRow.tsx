"use client";

import { useState } from "react";
import { Check, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { OpNames } from "@cdm/shared";
import { Button } from "@/components/ui/button";
import { FulfillPanel } from "@/components/FulfillPanel";
import { ResultView } from "@/components/ResultView";
import type { DatasetView } from "@/hooks/useDatasetRegistry";
import {
  useAcceptRequest,
  useRejectRequest,
  type RequestView,
  type Status,
} from "@/hooks/useJobManager";
import { truncate } from "@/lib/utils";

const STATUS_CLASS: Record<Status, string> = {
  Pending: "bg-muted text-muted-foreground",
  Accepted: "bg-proof/15 text-proof",
  Rejected: "bg-destructive/15 text-destructive",
  Completed: "bg-verify/15 text-verify",
};

export function RequestRow({
  request,
  dataset,
  currentAddress,
}: {
  request: RequestView;
  dataset?: DatasetView;
  currentAddress: string | null;
}) {
  const [showFulfill, setShowFulfill] = useState(false);
  const accept = useAcceptRequest();
  const reject = useRejectRequest();
  const isOwner = !!dataset && dataset.owner === currentAddress;

  async function run(fn: Promise<unknown>, label: string) {
    try {
      await fn;
      toast.success(label);
    } catch (e) {
      toast.error(`${label} failed`, {
        description: e instanceof Error ? e.message : undefined,
      });
    }
  }

  return (
    <div className="rounded-md border border-border bg-card p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <span className="font-mono text-sm">#{request.id.toString()}</span>{" "}
          <span className="font-semibold">{OpNames[request.op]}</span>{" "}
          <span className="font-mono text-xs text-muted-foreground">
            {dataset?.columnNames[request.targetField]?.trim() ||
              `field ${request.targetField}`}{" "}
            · buyer {truncate(request.buyer)}
          </span>
        </div>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLASS[request.status]}`}
        >
          {request.status}
        </span>
      </div>

      <div className="mt-3 flex items-center justify-between gap-2">
        {request.status === "Completed" ? (
          <ResultView
            result={request.result}
            kMet={request.kMet}
            overflow={request.overflow}
            op={request.op}
          />
        ) : (
          <span />
        )}

        {isOwner && request.status === "Pending" && (
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={accept.isPending}
              onClick={() =>
                run(accept.mutateAsync(request.id), `Request #${request.id} accepted`)
              }
            >
              {accept.isPending ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Check className="mr-1 h-3.5 w-3.5" />
              )}
              Accept
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={reject.isPending}
              onClick={() =>
                run(reject.mutateAsync(request.id), `Request #${request.id} rejected`)
              }
            >
              <X className="mr-1 h-3.5 w-3.5" /> Reject
            </Button>
          </div>
        )}

        {isOwner && request.status === "Accepted" && (
          <Button size="sm" onClick={() => setShowFulfill((s) => !s)}>
            {showFulfill ? "Hide" : "Fulfill"}
          </Button>
        )}
      </div>

      {isOwner && request.status === "Accepted" && showFulfill && dataset && (
        <div className="mt-3">
          <FulfillPanel request={request} dataset={dataset} />
        </div>
      )}
    </div>
  );
}

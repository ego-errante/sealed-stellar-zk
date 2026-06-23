"use client";

import { useState } from "react";
import { Loader2, ShieldCheck, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useFulfill, type RequestView } from "@/hooks/useJobManager";
import type { DatasetView } from "@/hooks/useDatasetRegistry";
import { toProveParams } from "@/lib/convert";
import { getCsv, hasCsv, saveCsv } from "@/lib/csvStore";
import { proverProve, proverRegister } from "@/lib/prover";

/**
 * Owner-only. Two owner-local proof paths:
 *  - CLI/manual (lead): paste seal + journal proved on your own machine — data never enters the browser.
 *  - Live local: "Prove locally" runs the owner's localhost prover on the retained CSV — data stays on your box.
 */
export function FulfillPanel({
  request,
  dataset,
}: {
  request: RequestView;
  dataset: DatasetView;
}) {
  const fulfill = useFulfill();
  const [proving, setProving] = useState(false);
  const [seal, setSeal] = useState("");
  const [journal, setJournal] = useState("");
  const [csvPresent, setCsvPresent] = useState(() => hasCsv(dataset.id));

  async function submitProof(s: string, j: string) {
    await fulfill.mutateAsync({ requestId: request.id, seal: s, journal: j });
    toast.success(`Request #${request.id.toString()} fulfilled`, {
      description: "Proof verified on-chain; result bound.",
    });
  }

  async function onManualSubmit() {
    try {
      await submitProof(seal.trim(), journal.trim());
    } catch (e) {
      toast.error("Fulfill failed", {
        description: e instanceof Error ? e.message : undefined,
      });
    }
  }

  async function onReUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const csv = await f.text();
    const reg = await proverRegister(csv).catch(() => null);
    if (!reg || reg.merkle_root !== dataset.merkleRoot) {
      toast.error("This CSV doesn’t match the registered Merkle root");
      return;
    }
    saveCsv(dataset.id, csv);
    setCsvPresent(true);
    toast.success("CSV verified against the on-chain root");
  }

  async function onProveLocally() {
    const csv = getCsv(dataset.id);
    if (!csv) {
      toast.error("No CSV on this device — re-upload it to prove locally");
      return;
    }
    setProving(true);
    try {
      const params = toProveParams(request.params, dataset.k, request.id);
      const { seal: s, journal: j } = await proverProve(csv, params);
      await submitProof(s, j);
    } catch (e) {
      toast.error("Proving / fulfill failed", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setProving(false);
    }
  }

  return (
    <div className="space-y-4 rounded-md border border-border bg-card/50 p-3">
      <p className="text-xs text-muted-foreground">
        Prove on your own machine. The rows never go to the buyer or the chain —
        only the verified aggregate is bound.
      </p>

      {/* CLI / manual path — most private (data never enters the browser) */}
      <div className="space-y-2">
        <Label className="text-xs font-semibold">
          Prove with the CLI — paste the proof
        </Label>
        <Textarea
          placeholder="seal (hex)"
          value={seal}
          onChange={(e) => setSeal(e.target.value)}
          className="h-16 font-mono text-xs"
        />
        <Textarea
          placeholder="journal (hex)"
          value={journal}
          onChange={(e) => setJournal(e.target.value)}
          className="h-16 font-mono text-xs"
        />
        <Button
          size="sm"
          onClick={onManualSubmit}
          disabled={!seal.trim() || !journal.trim() || fulfill.isPending}
        >
          {fulfill.isPending && !proving && (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          )}
          <ShieldCheck className="mr-2 h-4 w-4" /> Submit proof
        </Button>
      </div>

      <div className="flex items-center gap-3 text-[11px] uppercase tracking-wider text-muted-foreground">
        <span className="h-px flex-1 bg-border" /> or <span className="h-px flex-1 bg-border" />
      </div>

      {/* Live local path — convenience (data stays on your machine) */}
      <div className="space-y-2">
        <Label className="text-xs font-semibold">Prove locally</Label>
        {csvPresent ? (
          <p className="font-mono text-xs text-verify">CSV on file ✓</p>
        ) : (
          <div className="space-y-1">
            <p className="font-mono text-xs text-alert">
              CSV not on this device — re-upload to prove (verified vs the root)
            </p>
            <Input type="file" accept=".csv,text/csv" onChange={onReUpload} />
          </div>
        )}
        <Button
          size="sm"
          variant="secondary"
          onClick={onProveLocally}
          disabled={!csvPresent || proving || fulfill.isPending}
        >
          {proving ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Proving locally… (~{Math.round(237 + 7.5 * Number(dataset.rowCount))}s)
            </>
          ) : (
            <>
              <Upload className="mr-2 h-4 w-4" /> Prove locally & fulfill
            </>
          )}
        </Button>
        <p className="text-[11px] text-muted-foreground">
          Data stays on your machine. Live proving suits small datasets (≤20 rows).
        </p>
      </div>
    </div>
  );
}

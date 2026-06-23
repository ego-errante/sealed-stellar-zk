"use client";

import { useState } from "react";
import { Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRegisterDataset } from "@/hooks/useDatasetRegistry";
import { saveCsv } from "@/lib/csvStore";
import { countDataRows } from "@/lib/csv";
import { proverRegister, type RegisterResult } from "@/lib/prover";

export function RegisterDatasetModal() {
  const [open, setOpen] = useState(false);
  const [csv, setCsv] = useState("");
  const [computing, setComputing] = useState(false);
  const [meta, setMeta] = useState<RegisterResult | null>(null);
  const [k, setK] = useState(2);
  const [cooldown, setCooldown] = useState(0);
  const register = useRegisterDataset();

  // Count non-blank lines (matches proverlib::parse_csv and the on-chain row_count) so the
  // "over 20 rows — pre-bake" live-prove hint can't be thrown off by blank separator lines.
  const rowCount = countDataRows(csv);

  function reset() {
    setCsv("");
    setMeta(null);
    setK(2);
    setCooldown(0);
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setCsv(await f.text());
    setMeta(null);
  }

  async function computeRoot() {
    setComputing(true);
    try {
      setMeta(await proverRegister(csv));
    } catch (err) {
      toast.error("Could not compute Merkle root", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setComputing(false);
    }
  }

  async function onRegister() {
    if (!meta) return;
    try {
      const id = await register.mutateAsync({
        merkleRoot: meta.merkle_root,
        numColumns: meta.num_columns,
        rowCount: meta.row_count,
        k,
        cooldownSec: cooldown,
      });
      saveCsv(id, csv); // retain so the owner can prove later
      toast.success(`Dataset #${id.toString()} sealed`, {
        description: "Merkle root committed on Stellar. CSV kept on this device.",
      });
      reset();
      setOpen(false);
    } catch (err) {
      toast.error("Registration failed", {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Upload className="mr-2 h-4 w-4" /> Register dataset
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Register a dataset</DialogTitle>
          <DialogDescription>
            Your CSV stays on this device. Only the Merkle root is committed on
            Stellar — the rows are never uploaded or revealed.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="csv">Dataset CSV (rows of unsigned integers)</Label>
            <Input id="csv" type="file" accept=".csv,text/csv" onChange={onFile} />
            {rowCount > 0 && (
              <p className="font-mono text-xs text-muted-foreground">
                {rowCount} rows loaded
                {rowCount > 20 && (
                  <span className="text-alert">
                    {" "}· over 20 rows — pre-bake the proof for the demo
                  </span>
                )}
              </p>
            )}
          </div>

          {!meta ? (
            <Button
              variant="secondary"
              onClick={computeRoot}
              disabled={!csv.trim() || computing}
              className="w-full"
            >
              {computing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Compute Merkle root
            </Button>
          ) : (
            <div className="rounded-md border border-border bg-card p-3 font-mono text-xs">
              <div className="break-all text-muted-foreground">
                root <span className="text-foreground">{meta.merkle_root}</span>
              </div>
              <div className="mt-1 text-muted-foreground">
                {meta.row_count} rows · {meta.num_columns} columns
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="k">k-anonymity</Label>
              <Input
                id="k"
                type="number"
                min={0}
                value={k}
                onChange={(e) => setK(Number(e.target.value))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cd">Cooldown (sec)</Label>
              <Input
                id="cd"
                type="number"
                min={0}
                value={cooldown}
                onChange={(e) => setCooldown(Number(e.target.value))}
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            onClick={onRegister}
            disabled={!meta || register.isPending}
          >
            {register.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Register on Stellar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

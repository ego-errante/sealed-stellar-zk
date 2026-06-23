"use client";

import { useState } from "react";
import { Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { OpNames, type CompiledFilter } from "@cdm/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FilterBuilder } from "@/components/FilterBuilder";
import type { DatasetView } from "@/hooks/useDatasetRegistry";
import { useSubmitRequest } from "@/hooks/useJobManager";
import { toQueryParams } from "@/lib/convert";

const WEIGHTED_SUM = 0;

export function SubmitRequestForm({
  dataset,
  onDone,
}: {
  dataset: DatasetView;
  onDone?: () => void;
}) {
  const [op, setOp] = useState(3); // COUNT
  const [targetField, setTargetField] = useState(0);
  const [filter, setFilter] = useState<CompiledFilter | null>(null);
  const [weightsText, setWeightsText] = useState("");
  const submit = useSubmitRequest();

  async function onSubmit() {
    const weights =
      op === WEIGHTED_SUM
        ? weightsText
            .split(",")
            .map((w) => Number(w.trim()))
            .filter((n) => !Number.isNaN(n))
        : [];
    try {
      const params = toQueryParams({ op, targetField, filter, weights });
      const id = await submit.mutateAsync({ datasetId: dataset.id, params });
      toast.success(`Request #${id.toString()} submitted`);
      onDone?.();
    } catch (e) {
      toast.error("Submit failed", {
        description: e instanceof Error ? e.message : undefined,
      });
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Aggregate</Label>
          <Select value={String(op)} onValueChange={(v) => setOp(Number(v))}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {OpNames.map((name, code) => (
                <SelectItem key={code} value={String(code)}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Target column</Label>
          <Select
            value={String(targetField)}
            onValueChange={(v) => setTargetField(Number(v))}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Array.from({ length: dataset.numColumns }, (_, i) => (
                <SelectItem key={i} value={String(i)}>
                  Field {i}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <FilterBuilder numColumns={dataset.numColumns} onFilterChange={setFilter} />

      {op === WEIGHTED_SUM && (
        <div className="space-y-1.5">
          <Label className="text-xs">Weights (comma-separated, one per column)</Label>
          <Input
            value={weightsText}
            onChange={(e) => setWeightsText(e.target.value)}
            placeholder="1, 2, 3"
            className="font-mono"
          />
        </div>
      )}

      <Button onClick={onSubmit} disabled={submit.isPending} className="w-full">
        {submit.isPending ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <Send className="mr-2 h-4 w-4" />
        )}
        Submit request
      </Button>
    </div>
  );
}

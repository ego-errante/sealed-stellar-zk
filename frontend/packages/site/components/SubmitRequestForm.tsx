"use client";

import { useState } from "react";
import { FileCode, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { OpNames, describeQuery, type CompiledFilter } from "@cdm/shared";
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
import { Textarea } from "@/components/ui/textarea";
import { FilterBuilder } from "@/components/FilterBuilder";
import type { DatasetView } from "@/hooks/useDatasetRegistry";
import { useSubmitRequest } from "@/hooks/useJobManager";
import { toQueryParams } from "@/lib/convert";
import { parseQueryJson } from "@/lib/queryParse";

const WEIGHTED_SUM = 0;

const JSON_EXAMPLE = `{
  "op": "COUNT",
  "filter": {
    "and": [
      { "gt": ["age", 30] },
      { "ge": ["balance", 1000] }
    ]
  }
}`;

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
  const [jsonOpen, setJsonOpen] = useState(false);
  const [jsonText, setJsonText] = useState("");
  const [jsonError, setJsonError] = useState<string | null>(null);
  const submit = useSubmitRequest();

  function loadJson() {
    try {
      const q = parseQueryJson(jsonText, dataset.columnNames);
      setOp(q.op);
      setTargetField(q.targetField);
      setWeightsText(q.weights.join(", "));
      setFilter(q.filter);
      setJsonError(null);
      toast.success("Query loaded — check the preview, then submit");
    } catch (e) {
      setJsonError(e instanceof Error ? e.message : "Could not parse the query");
    }
  }

  function parseWeights() {
    return op === WEIGHTED_SUM
      ? weightsText
          .split(",")
          .map((w) => Number(w.trim()))
          .filter((n) => !Number.isNaN(n))
      : [];
  }

  const preview = describeQuery(
    {
      op,
      targetField,
      filterBytecode: filter?.bytecode ?? "",
      consts: filter?.consts ?? [],
      weights: parseWeights(),
    },
    dataset.columnNames,
  );

  async function onSubmit() {
    const weights = parseWeights();
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
      <div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() => setJsonOpen((o) => !o)}
        >
          <FileCode className="mr-1 h-3.5 w-3.5" />
          {jsonOpen ? "Hide JSON query" : "Paste JSON query"}
        </Button>
        {jsonOpen && (
          <div className="mt-2 space-y-2 rounded-md border border-border p-3">
            <p className="text-[11px] text-muted-foreground">
              Reference columns by name; supports nesting and mixed AND/OR that the builder
              can&rsquo;t. Loading replaces the fields below.
            </p>
            <Textarea
              value={jsonText}
              onChange={(e) => setJsonText(e.target.value)}
              placeholder={JSON_EXAMPLE}
              className="h-40 font-mono text-xs"
            />
            {jsonError && (
              <p className="font-mono text-xs text-destructive">{jsonError}</p>
            )}
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={loadJson}
              disabled={!jsonText.trim()}
            >
              Load query
            </Button>
          </div>
        )}
      </div>

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
                  {dataset.columnNames[i]?.trim() || `Field ${i}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <FilterBuilder columnNames={dataset.columnNames} onFilterChange={setFilter} />

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

      <div className="rounded-md border border-border bg-muted/40 p-2">
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
          Request preview
        </p>
        <p className="mt-0.5 break-words font-mono text-xs text-foreground">
          {preview}
        </p>
      </div>

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

// Owner-side CSV retention. The chain stores only the Merkle root; the raw CSV is the
// owner's private data, needed again at /prove time. We keep it per-dataset in localStorage
// (CSVs are tiny). It never leaves the owner's browser. A re-upload fallback (verified against
// the on-chain root) covers a cleared store / different machine.

const key = (datasetId: bigint | string) => `cdm:csv:${datasetId.toString()}`;
const INDEX_KEY = "cdm:csvIndex";

function readIndex(): string[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(INDEX_KEY) ?? "[]");
  } catch {
    return [];
  }
}

export function saveCsv(datasetId: bigint | string, csv: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(key(datasetId), csv);
  const idx = new Set(readIndex());
  idx.add(datasetId.toString());
  localStorage.setItem(INDEX_KEY, JSON.stringify([...idx]));
}

export function getCsv(datasetId: bigint | string): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(key(datasetId));
}

export function hasCsv(datasetId: bigint | string): boolean {
  return getCsv(datasetId) !== null;
}

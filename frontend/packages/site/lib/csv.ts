/**
 * Count the data rows in a CSV the way `proverlib::parse_csv` does: one row per non-blank line
 * (after trimming). Plain `split("\n").length` over-counts blank/trailing lines and disagrees with
 * the on-chain `row_count`, mis-driving the "over 20 rows — pre-bake" live-prove hint.
 */
export function countDataRows(csv: string): number {
  return csv.split("\n").filter((line) => line.trim() !== "").length;
}

export interface ParsedCsv {
  /** Header-stripped CSV (only integer data rows) — what the prover/guest hash. */
  dataCsv: string;
  /** Column labels: from the header row if present, else one empty string per column to fill in. */
  names: string[];
  /** Columns detected from the first data row. */
  numColumns: number;
  /** Whether a header row was detected and stripped. */
  hadHeader: boolean;
}

/**
 * Split a raw CSV into header-stripped data + column names. A first row is treated as a header iff
 * any of its fields is not a non-negative integer (data rows are unsigned integers). The header is
 * stripped so the Merkle root / guest only ever hash data rows; names ride alongside as the schema.
 * With no header, `names` is one empty string per detected column for the typed fallback.
 */
export function parseCsvWithSchema(raw: string): ParsedCsv {
  const lines = raw.split("\n").filter((l) => l.trim() !== "");
  if (lines.length === 0) {
    return { dataCsv: "", names: [], numColumns: 0, hadHeader: false };
  }
  const firstFields = lines[0].split(",").map((f) => f.trim());
  const isInt = (s: string) => /^\d+$/.test(s);
  const hadHeader = firstFields.some((f) => !isInt(f));
  const dataLines = hadHeader ? lines.slice(1) : lines;
  const numColumns = (dataLines[0]?.split(",").length ?? firstFields.length) || 0;
  const names = hadHeader
    ? firstFields
    : Array.from({ length: numColumns }, () => "");
  return { dataCsv: dataLines.join("\n"), names, numColumns, hadHeader };
}

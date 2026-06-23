/**
 * Count the data rows in a CSV the way `proverlib::parse_csv` does: one row per non-blank line
 * (after trimming). Plain `split("\n").length` over-counts blank/trailing lines and disagrees with
 * the on-chain `row_count`, mis-driving the "over 20 rows — pre-bake" live-prove hint.
 */
export function countDataRows(csv: string): number {
  return csv.split("\n").filter((line) => line.trim() !== "").length;
}

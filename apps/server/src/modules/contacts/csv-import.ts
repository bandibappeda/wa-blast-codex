import { parse } from "csv-parse/sync";

export type CsvRow = Record<string, string>;

export function parseContactCsv(content: string): CsvRow[] {
  const records = parse(content, {
    columns: (headers: string[]) => headers.map(normalizeHeader),
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true,
  }) as CsvRow[];
  return records;
}

export function normalizeHeader(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

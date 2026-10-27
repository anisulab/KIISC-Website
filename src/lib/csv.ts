// CSV building for report exports. No imports, so it can be unit-tested with plain Node.

export type CsvValue = string | number | boolean | null | undefined;

// Spreadsheet apps run cells that start with these as formulas (CSV injection).
const FORMULA_START = /^[=+\-@\t\r]/;

/** One CSV field: quoted, with quotes doubled and formula-like text neutralised. */
export function csvField(value: CsvValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  let text = String(value);
  if (FORMULA_START.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}

/**
 * CSV text with a UTF-8 byte-order mark, so Excel shows Bengali correctly,
 * and CRLF line endings (RFC 4180).
 */
export function toCsv(header: string[], rows: CsvValue[][]): string {
  const lines = [header, ...rows].map((cells) => cells.map(csvField).join(','));
  return '﻿' + lines.join('\r\n') + '\r\n';
}

/** Safe file name: letters, digits, dashes; e.g. "students-2026-10-26.csv". */
export function csvFileName(base: string, date: string) {
  const slug = base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'report';
  return `${slug}-${date}.csv`;
}

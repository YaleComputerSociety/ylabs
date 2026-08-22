import { safeSpreadsheetCell } from './spreadsheetSafety';

export interface CsvColumn<T> {
  header: string;
  value: (row: T) => unknown;
}

const UTF8_BOM = '\uFEFF';
const FIELD_NEEDS_QUOTING = /[",\r\n]/;

const escapeCsvField = (value: unknown): string => {
  const safe = safeSpreadsheetCell(value);
  const needsQuotes = FIELD_NEEDS_QUOTING.test(safe) || safe !== safe.trim();
  return needsQuotes ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export const rowsToCsv = <T>(rows: readonly T[], columns: ReadonlyArray<CsvColumn<T>>): string => {
  const headerLine = columns.map((column) => escapeCsvField(column.header)).join(',');
  const dataLines = rows.map((row) =>
    columns.map((column) => escapeCsvField(column.value(row))).join(','),
  );
  return [headerLine, ...dataLines].join('\r\n');
};

export const downloadCsv = (filename: string, csv: string): void => {
  if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') {
    return;
  }

  const blob = new Blob([`${UTF8_BOM}${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

export const downloadRowsAsCsv = <T>(
  filename: string,
  rows: readonly T[],
  columns: ReadonlyArray<CsvColumn<T>>,
): void => {
  downloadCsv(filename, rowsToCsv(rows, columns));
};

export const csvTimestampSuffix = (now: Date = new Date()): string => {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

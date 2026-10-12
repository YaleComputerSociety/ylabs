import { describe, it, expect } from 'vitest';
import { deflateRawSync } from 'zlib';
import { readFirstSheetRows, readZipEntries, XlsxReadError } from '../utils/xlsxSheetRows';

function zipOf(files: Record<string, string>, compress = true): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const raw = Buffer.from(content, 'utf8');
    const data = compress ? deflateRawSync(raw) : raw;
    const nameBytes = Buffer.from(name, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(compress ? 8 : 0, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(compress ? 8 : 0, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, data);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + data.length;
  }
  const centralDirectory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralDirectory, end]);
}

const SHARED_STRINGS = `<?xml version="1.0"?><sst><si><t>Award Number</t></si><si><t>PI</t></si><si><r><t>Investigator, </t></r><r><t>Synthetic</t></r></si></sst>`;
const SHEET = `<?xml version="1.0"?><worksheet><sheetData>
  <row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row>
  <row r="2"><c r="A2" t="inlineStr"><is><t>DE-SC0000001</t></is></c><c r="B2"><v>450000</v></c><c r="C2" t="s"><v>2</v></c></row>
</sheetData></worksheet>`;

describe('readFirstSheetRows', () => {
  it('reads shared, inline and numeric cells into their columns', () => {
    const workbook = zipOf({
      'xl/sharedStrings.xml': SHARED_STRINGS,
      'xl/worksheets/sheet1.xml': SHEET,
    });
    expect(readFirstSheetRows(workbook)).toEqual([
      ['Award Number', '', 'PI'],
      ['DE-SC0000001', '450000', 'Investigator, Synthetic'],
    ]);
  });

  it('reads stored as well as deflated entries', () => {
    const entries = readZipEntries(zipOf({ 'a.txt': 'stored text' }, false));
    expect(entries.get('a.txt')?.toString('utf8')).toBe('stored text');
  });

  it('refuses a payload that is not a workbook', () => {
    expect(() => readFirstSheetRows(Buffer.from('<html>error page</html>'))).toThrow(XlsxReadError);
    expect(() => readFirstSheetRows(zipOf({ 'xl/workbook.xml': '<workbook/>' }))).toThrow(
      'workbook has no first worksheet',
    );
  });
});

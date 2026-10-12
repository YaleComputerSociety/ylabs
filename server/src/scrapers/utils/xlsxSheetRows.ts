import { inflateRawSync } from 'zlib';
import * as cheerio from 'cheerio';

const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const CENTRAL_DIRECTORY_ENTRY_SIGNATURE = 0x02014b50;
const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const STORED = 0;
const DEFLATED = 8;
const MAX_END_OF_CENTRAL_DIRECTORY_SEARCH = 0xffff + 22;

export class XlsxReadError extends Error {}

function findEndOfCentralDirectory(buffer: Buffer): number {
  const floor = Math.max(0, buffer.length - MAX_END_OF_CENTRAL_DIRECTORY_SEARCH);
  for (let offset = buffer.length - 22; offset >= floor; offset--) {
    if (buffer.readUInt32LE(offset) === END_OF_CENTRAL_DIRECTORY_SIGNATURE) return offset;
  }
  throw new XlsxReadError('not a zip archive: no end-of-central-directory record');
}

export function readZipEntries(buffer: Buffer): Map<string, Buffer> {
  if (buffer.length < 22) throw new XlsxReadError('not a zip archive: too short');
  const end = findEndOfCentralDirectory(buffer);
  const entryCount = buffer.readUInt16LE(end + 10);
  let cursor = buffer.readUInt32LE(end + 16);
  const entries = new Map<string, Buffer>();
  for (let index = 0; index < entryCount; index++) {
    if (buffer.readUInt32LE(cursor) !== CENTRAL_DIRECTORY_ENTRY_SIGNATURE) {
      throw new XlsxReadError('corrupt zip central directory');
    }
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localHeaderOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.toString('utf8', cursor + 46, cursor + 46 + nameLength);
    cursor += 46 + nameLength + extraLength + commentLength;

    if (buffer.readUInt32LE(localHeaderOffset) !== LOCAL_FILE_HEADER_SIGNATURE) {
      throw new XlsxReadError(`corrupt zip local header for ${name}`);
    }
    const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const data = buffer.subarray(dataStart, dataStart + compressedSize);
    if (method === STORED) entries.set(name, Buffer.from(data));
    else if (method === DEFLATED) entries.set(name, inflateRawSync(data));
    else throw new XlsxReadError(`unsupported zip compression method ${method} for ${name}`);
  }
  return entries;
}

function columnIndex(cellReference: string): number {
  const letters = (cellReference.match(/^[A-Z]+/) || [''])[0];
  let index = 0;
  for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64);
  return index - 1;
}

function sharedStringsOf(xml: string | undefined): string[] {
  if (!xml) return [];
  const $ = cheerio.load(xml, { xmlMode: true });
  return $('si')
    .toArray()
    .map((si) =>
      $(si)
        .find('t')
        .toArray()
        .map((t) => $(t).text())
        .join(''),
    );
}

export function readFirstSheetRows(buffer: Buffer): string[][] {
  const entries = readZipEntries(buffer);
  const sheet = entries.get('xl/worksheets/sheet1.xml');
  if (!sheet) throw new XlsxReadError('workbook has no first worksheet');
  const shared = sharedStringsOf(entries.get('xl/sharedStrings.xml')?.toString('utf8'));
  const $ = cheerio.load(sheet.toString('utf8'), { xmlMode: true });
  return $('sheetData > row')
    .toArray()
    .map((row) => {
      const cells: string[] = [];
      $(row)
        .children('c')
        .each((position, cell) => {
          const reference = $(cell).attr('r');
          const index = reference ? columnIndex(reference) : position;
          const type = $(cell).attr('t');
          let value: string;
          if (type === 's') value = shared[Number($(cell).children('v').text())] ?? '';
          else if (type === 'inlineStr') value = $(cell).find('is t').text();
          else value = $(cell).children('v').text();
          while (cells.length < index) cells.push('');
          cells[index] = value;
        });
      return cells;
    });
}

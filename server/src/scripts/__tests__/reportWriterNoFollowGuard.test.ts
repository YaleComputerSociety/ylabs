import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const SERVER_SRC = path.resolve(__dirname, '../..');

const RESOLVES_A_REPORT_PATH = /\bresolveSafeJsonReport(?:Output)?Path\b/;
const RAW_WRITE_NAMES =
  'writeFileSync|writeFile|createWriteStream|appendFileSync|appendFile|openSync|writeSync';
const RAW_FILE_WRITE = new RegExp(`\\b(?:${RAW_WRITE_NAMES})\\s*\\(`);
const RENAMED_RAW_WRITE_IMPORT = new RegExp(`\\b(?:${RAW_WRITE_NAMES})\\s+as\\s+[A-Za-z_$]`);

// The shared writers themselves: two write through an O_NOFOLLOW descriptor, and the resolver's
// writability probe opens with 'wx', which never follows a link.
const SHARED_WRITERS = new Set([
  'scrapers/scraperCliOutput.ts',
  'utils/reportFileWriter.ts',
  'utils/reportOutputPath.ts',
]);

export interface ScannedSource {
  file: string;
  source: string;
}

/**
 * Files that resolve a report path and then write a file with their own call, which follows a
 * link planted between the resolve and the write. They must write through the shared
 * O_NOFOLLOW writers instead (`writeJsonOutputFile`, `writeReportFileSync`) (#6375).
 *
 * The scan is file-level text. It catches a renamed import (`writeFileSync as w`) but not a
 * variable alias (`const w = fs.writeFileSync`),
 * a write through a temp file and a copy or rename, or a resolve in one module with the write
 * in another; those are accepted residuals of #6375. A file that resolves a path only to read
 * it and writes something unrelated is a false positive.
 */
export function rawReportWriters(sources: readonly ScannedSource[]): string[] {
  return sources
    .filter(
      ({ file, source }) =>
        !SHARED_WRITERS.has(file) &&
        RESOLVES_A_REPORT_PATH.test(source) &&
        (RAW_FILE_WRITE.test(source) || RENAMED_RAW_WRITE_IMPORT.test(source)),
    )
    .map(({ file }) => file)
    .sort();
}

function productionSources(): ScannedSource[] {
  const sources: ScannedSource[] = [];
  const walk = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
        walk(full);
      } else if (/\.(ts|mts)$/.test(entry.name) && !/\.test\.ts$/.test(entry.name)) {
        sources.push({
          file: path.relative(SERVER_SRC, full).split(path.sep).join('/'),
          source: fs.readFileSync(full, 'utf8'),
        });
      }
    }
  };
  walk(SERVER_SRC);
  return sources;
}

describe('report writers go through the shared O_NOFOLLOW writer (#6375)', () => {
  it('finds no raw report writer in production code', () => {
    expect(rawReportWriters(productionSources())).toEqual([]);
  });

  it('flags a resolved path written with its own call and passes the shared writers', () => {
    const raw = {
      file: 'scripts/raw.ts',
      source: "const p = resolveSafeJsonReportOutputPath(a);\nfs.writeFileSync(p, '{}');",
    };
    const shared = {
      file: 'scripts/shared.ts',
      source: 'const p = resolveSafeJsonReportOutputPath(a);\nwriteReportFileSync(p, text);',
    };
    const renamed = {
      file: 'scripts/renamed.ts',
      source:
        "import { writeFileSync as save } from 'fs';\nconst p = resolveSafeJsonReportPath(a);\nsave(p, '{}');",
    };
    expect(rawReportWriters([raw, shared, renamed])).toEqual([
      'scripts/raw.ts',
      'scripts/renamed.ts',
    ]);
  });
});

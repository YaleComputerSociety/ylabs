import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import allowlist from './reportWriterNoFollowAllowlist.json';

const SERVER_SRC = path.resolve(__dirname, '../..');

const RESOLVES_A_REPORT_PATH = /\bresolveSafeJsonReport(?:Output)?Path\b/;
const RAW_FILE_WRITE =
  /\b(?:writeFileSync|writeFile|createWriteStream|appendFileSync|appendFile)\s*\(/;

// The shared writers themselves: one writes through an O_NOFOLLOW handle, and the resolver's
// writability probe opens with 'wx', which never follows a link.
const SHARED_WRITERS = new Set(['scrapers/scraperCliOutput.ts', 'utils/reportOutputPath.ts']);

export interface ScannedSource {
  file: string;
  source: string;
}

/**
 * Files that resolve a report path and then write a file with their own call, which follows a
 * link planted between the resolve and the write. They must write through the shared
 * O_NOFOLLOW writers instead (`writeJsonOutputFile`, `writeReportFileSync`) (#6375).
 */
export function rawReportWriters(sources: readonly ScannedSource[]): string[] {
  return sources
    .filter(
      ({ file, source }) =>
        !SHARED_WRITERS.has(file) &&
        RESOLVES_A_REPORT_PATH.test(source) &&
        RAW_FILE_WRITE.test(source),
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
  const offenders = rawReportWriters(productionSources());
  const allowed = new Set<string>(allowlist);

  it('refuses a new raw report writer', () => {
    expect(offenders.filter((file) => !allowed.has(file))).toEqual([]);
  });

  it('drops a migrated file from the allowlist, so the list only shrinks', () => {
    const current = new Set(offenders);
    expect([...allowed].filter((file) => !current.has(file))).toEqual([]);
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
    expect(rawReportWriters([raw, shared])).toEqual(['scripts/raw.ts']);
  });
});

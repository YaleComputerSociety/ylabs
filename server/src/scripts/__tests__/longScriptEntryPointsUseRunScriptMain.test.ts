import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const SERVER_ROOT = path.resolve(__dirname, '../../..');

/**
 * Long-running operator entry points, and why each one must exit through runScriptMain (#5945).
 * A script that finished its work but kept the event loop open had to be stopped by PID, and an
 * operator or cron cannot tell that from a hang without the watchdog's exit code 3.
 */
const LONG_SCRIPT_ENTRY_POINTS: Record<string, string> = {
  scrape:
    'scrape run and scrape materialize drive every lane and the materializer over the whole corpus',
  'observations:rematerialize-user-keys':
    'rematerializes every person key a lane re-keyed, a multi-hour pass over user observations',
  'research-entity:rematerialize':
    'rematerializes research rows in bulk, the longest materializer pass an operator starts by hand',
  'observations:retire-rekeyed-person-keys':
    'projects thousands of person keys through the engine twice each; the run that never exited was this path',
  'observations:retire-orphaned-lane-configs':
    'projects every row an orphaned lane config backs through the engine before retiring evidence',
  'research-entity:coverage-synthesis':
    'synthesizes coverage text across the corpus, row by row, for hours',
  'research-entity:coverage-audit': 'scans every research row to audit coverage',
  'research-entity:projection-drift-census':
    'reprojects stored rows through the engine to census drift against what is stored',
};

const TSX_ENTRY = /^tsx\s+(\S+\.ts)\b/;

const packageScripts = (): Record<string, string> =>
  JSON.parse(fs.readFileSync(path.join(SERVER_ROOT, 'package.json'), 'utf8')).scripts;

const entryPointFile = (command: string | undefined): string | undefined =>
  command?.match(TSX_ENTRY)?.[1];

const exitsThroughRunScriptMain = (source: string): boolean =>
  /\brunScriptMain\(/.test(source) && !/\bmain\(\)\s*\.(?:catch|then|finally)\(/.test(source);

describe('long script entry points exit through runScriptMain (#5945)', () => {
  const scripts = packageScripts();

  it('names only package scripts that run a tsx entry point', () => {
    const unresolved = Object.keys(LONG_SCRIPT_ENTRY_POINTS).filter(
      (name) => !entryPointFile(scripts[name]),
    );
    expect(unresolved).toEqual([]);
  });

  it('gives a reason for every entry point it lists', () => {
    expect(
      Object.entries(LONG_SCRIPT_ENTRY_POINTS).filter(([, reason]) => reason.trim().length === 0),
    ).toEqual([]);
  });

  it('finds runScriptMain in every listed entry point', () => {
    const offenders = Object.keys(LONG_SCRIPT_ENTRY_POINTS).filter((name) => {
      const file = entryPointFile(scripts[name]);
      if (!file) return true;
      return !exitsThroughRunScriptMain(fs.readFileSync(path.join(SERVER_ROOT, file), 'utf8'));
    });
    expect(offenders).toEqual([]);
  });
});

describe('the runScriptMain entry point check', () => {
  it('reads the file out of a tsx package script', () => {
    expect(entryPointFile('tsx src/scripts/example.ts --flag')).toBe('src/scripts/example.ts');
    expect(entryPointFile('node dist/example.js')).toBeUndefined();
  });

  it('accepts an entry point that hands main to runScriptMain', () => {
    expect(exitsThroughRunScriptMain('if (direct) void runScriptMain(main);')).toBe(true);
  });

  it('refuses an entry point that still chains its own exit handling onto main', () => {
    expect(exitsThroughRunScriptMain('main().catch((error) => {\n  process.exit(1);\n});')).toBe(
      false,
    );
    expect(
      exitsThroughRunScriptMain('void runScriptMain(other);\nmain()\n  .finally(close);'),
    ).toBe(false);
  });
});

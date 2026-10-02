import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

const SERVER_SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPTS_DIR = path.join(SERVER_SRC, 'scripts');
const MIN_SCANNED_SOURCE_FILES = 500;

const HARD_CODED_TMP_READ = /readFileSync\(\s*['"`]\/tmp\//;
const SCRATCH_SCRIPT_NAME = /^tmp[A-Z0-9_-]/;

const productionSourceFiles = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules' || entry.name === '__tests__') return [];
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return productionSourceFiles(full);
    return /\.(?:ts|mts|mjs|js)$/.test(entry.name) ? [full] : [];
  });

describe('no committed scratch scripts (#3728)', () => {
  const files = productionSourceFiles(SERVER_SRC);

  it('reads a real population of server sources', () => {
    expect(files.length).toBeGreaterThan(MIN_SCANNED_SOURCE_FILES);
  });

  it('never reads an input from a hard-coded /tmp path, which nothing in the repository writes', () => {
    const offenders = files
      .filter((file) => HARD_CODED_TMP_READ.test(fs.readFileSync(file, 'utf8')))
      .map((file) => path.relative(SERVER_SRC, file));

    expect(offenders).toEqual([]);
  });

  it('keeps no scratch-named one-off in the scripts directory', () => {
    const scratch = fs.readdirSync(SCRIPTS_DIR).filter((name) => SCRATCH_SCRIPT_NAME.test(name));

    expect(scratch).toEqual([]);
  });

  it('would flag the shapes it guards against', () => {
    expect(
      HARD_CODED_TMP_READ.test("JSON.parse(fs.readFileSync('/tmp/cohort-read.json', 'utf8'))"),
    ).toBe(true);
    expect(HARD_CODED_TMP_READ.test('fs.readFileSync(options.input, "utf8")')).toBe(false);
    expect(SCRATCH_SCRIPT_NAME.test('tmpArms.ts')).toBe(true);
    expect(SCRATCH_SCRIPT_NAME.test('tempArtifactRoots.ts')).toBe(false);
  });
});

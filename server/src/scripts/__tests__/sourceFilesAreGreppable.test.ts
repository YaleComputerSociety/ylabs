import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../../../..');
const SOURCE_ROOTS = ['server/src', 'client/src'];
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.md']);

const walk = (dir: string): string[] => {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(fullPath);
    return [fullPath];
  });
};

const sourceFiles = () =>
  SOURCE_ROOTS.flatMap((sourceRoot) => walk(path.join(ROOT, sourceRoot))).filter((file) =>
    SOURCE_EXTENSIONS.has(path.extname(file)),
  );

describe('source files are greppable', () => {
  /**
   * ripgrep reports `binary file matches` and prints NO matching lines for a file
   * containing a raw NUL, so a single stray byte hides an entire file from the
   * search step that `AGENTS.md` makes the first move of every task. `rg -c` still
   * returns a count, which is why this went unnoticed: a count-based check looks
   * healthy while a line-based one silently finds nothing (#2852).
   *
   * A NUL in a runtime *value* is fine. Write it as a `\u0000` escape so the
   * source text stays plain.
   */
  // Reads every source file, which takes over the default 10s timeout on a
  // developer Mac even though CI finishes it in well under a second.
  it('contains no raw NUL byte, which would hide the file from ripgrep', () => {
    const violations: string[] = [];

    for (const file of sourceFiles()) {
      const bytes = fs.readFileSync(file);
      const index = bytes.indexOf(0);
      if (index === -1) continue;
      const line = bytes.subarray(0, index).toString('utf8').split('\n').length;
      violations.push(`${path.relative(ROOT, file)}:${line}`);
    }

    expect(violations).toEqual([]);
  }, 60_000);
});

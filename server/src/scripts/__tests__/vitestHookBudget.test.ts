import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import vitestConfig from '../../../vitest.config';

/**
 * A MongoMemory replica set takes seconds to stop in isolation and far longer under
 * full-suite parallel load, so vitest's 10000 ms default hook budget turned suites red
 * whose every test passed (#2903). The budget is owned by the config rather than repeated
 * on each hook so that a new MongoMemory suite inherits it instead of re-learning this.
 */
const MONGO_MEMORY_TEARDOWN_BUDGET_MS = 60000;

const SERVER_SRC = path.resolve(__dirname, '../..');
const HOOK_OPENER = /^(\s*)(beforeAll|afterAll|beforeEach|afterEach)\(/;

const testFiles = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return testFiles(fullPath);
    return entry.name.endsWith('.test.ts') || entry.name.endsWith('.spec.ts') ? [fullPath] : [];
  });

const hooksCappedBelowBudget = (file: string): string[] => {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const capped: string[] = [];

  lines.forEach((line, index) => {
    const opener = HOOK_OPENER.exec(line);
    if (!opener) return;
    const [, indent, hook] = opener;
    const closer = new RegExp(`^${indent}\\}(?:, (\\d+))?\\);`);

    for (let cursor = index; cursor < lines.length; cursor += 1) {
      const match = closer.exec(lines[cursor]);
      if (!match) continue;
      const budget = match[1] === undefined ? undefined : Number(match[1]);
      if (budget !== undefined && budget < MONGO_MEMORY_TEARDOWN_BUDGET_MS) {
        capped.push(`${path.relative(SERVER_SRC, file)}:${cursor + 1} ${hook} ${budget}`);
      }
      return;
    }
  });

  return capped;
};

describe('server vitest hook budget', () => {
  it('budgets every hook for a MongoMemory teardown under full-suite load', () => {
    expect(vitestConfig.test?.hookTimeout).toBeGreaterThanOrEqual(MONGO_MEMORY_TEARDOWN_BUDGET_MS);
  });

  /**
   * An explicit hook argument overrides the config, so a hook that keeps a smaller one
   * opts its whole suite back into the #2903 failure while the config looks correct.
   * A per-test `it` budget is unaffected and stays free to be smaller.
   */
  it('lets no hook cap itself below the configured budget', () => {
    const capped = testFiles(SERVER_SRC).flatMap(hooksCappedBelowBudget);

    expect(capped).toEqual([]);
  });
});

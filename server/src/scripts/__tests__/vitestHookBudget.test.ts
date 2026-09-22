import fs from 'node:fs';
import path from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import vitestConfig from '../../../vitest.config';

/**
 * A MongoMemory replica set takes seconds to stop in isolation and far longer under
 * full-suite parallel load, so vitest's 10000 ms default hook budget turned suites red
 * whose every test passed (#2903). The budget is owned by the config rather than repeated
 * on each hook so that a new MongoMemory suite inherits it instead of re-learning this.
 */
const MONGO_MEMORY_TEARDOWN_BUDGET_MS = 60000;

const configuredHookTimeoutMs = vitestConfig.test?.hookTimeout;
const scannedBudgetMs = configuredHookTimeoutMs ?? MONGO_MEMORY_TEARDOWN_BUDGET_MS;

const SERVER_SRC = path.resolve(__dirname, '../..');
const HOOK_NAMES = new Set(['beforeAll', 'afterAll', 'beforeEach', 'afterEach']);
const HOOK_CALL_MENTION = /\b(?:beforeAll|afterAll|beforeEach|afterEach)\s*\(/;

const testFiles = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return testFiles(fullPath);
    return entry.name.endsWith('.test.ts') || entry.name.endsWith('.spec.ts') ? [fullPath] : [];
  });

const literalMilliseconds = (node: ts.Expression): number | undefined =>
  ts.isNumericLiteral(node) ? Number(node.text.replace(/_/g, '')) : undefined;

const hooksCappedBelowBudget = (budgetMs: number, label: string, source: string): string[] => {
  const parsed = ts.createSourceFile(label, source, ts.ScriptTarget.Latest);
  const capped: string[] = [];

  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      HOOK_NAMES.has(node.expression.text)
    ) {
      const timeoutArgument = node.arguments[1];
      if (timeoutArgument) {
        const { line } = parsed.getLineAndCharacterOfPosition(timeoutArgument.getStart(parsed));
        const milliseconds = literalMilliseconds(timeoutArgument);
        const reported =
          milliseconds === undefined ? 'a timeout this scan cannot read' : milliseconds;
        if (milliseconds === undefined || milliseconds < budgetMs) {
          capped.push(`${label}:${line + 1} ${node.expression.text} ${reported}`);
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(parsed);
  return capped;
};

describe('server vitest hook budget', () => {
  it('budgets every hook for a MongoMemory teardown under full-suite load', () => {
    expect(configuredHookTimeoutMs).toBeGreaterThanOrEqual(MONGO_MEMORY_TEARDOWN_BUDGET_MS);
  });

  /**
   * An explicit hook argument overrides the config, so a hook that keeps a smaller one
   * opts its whole suite back into the #2903 failure while the config looks correct.
   * A per-test `it` budget is unaffected and stays free to be smaller.
   */
  it('lets no hook cap itself below the configured budget', () => {
    const capped = testFiles(SERVER_SRC)
      .map((file) => ({ file, source: fs.readFileSync(file, 'utf8') }))
      .filter(({ source }) => HOOK_CALL_MENTION.test(source))
      .flatMap(({ file, source }) =>
        hooksCappedBelowBudget(scannedBudgetMs, path.relative(SERVER_SRC, file), source),
      );

    expect(capped).toEqual([]);
  }, 60000);
});

describe('the hook budget scan', () => {
  it('reads a hook budget written with numeric separators and ignores a per-test budget', () => {
    const source = [
      "describe('a suite', () => {",
      '  beforeAll(async () => {',
      '    await start();',
      '  }, 30_000);',
      '',
      "  it('serves', async () => {",
      '    await check();',
      '  }, 5000);',
      '});',
    ].join('\n');

    expect(hooksCappedBelowBudget(60000, 'fixture.test.ts', source)).toEqual([
      'fixture.test.ts:4 beforeAll 30000',
    ]);
  });

  it('reports a hook budget it cannot resolve rather than passing it', () => {
    const source = ['afterAll(async () => {', '  await stop();', '}, TEARDOWN_MS);'].join('\n');

    expect(hooksCappedBelowBudget(60000, 'fixture.test.ts', source)).toEqual([
      'fixture.test.ts:3 afterAll a timeout this scan cannot read',
    ]);
  });

  it('accepts a hook budget at or above the scanned budget', () => {
    const source = ['beforeAll(async () => {', '  await start();', '}, 120_000);'].join('\n');

    expect(hooksCappedBelowBudget(60000, 'fixture.test.ts', source)).toEqual([]);
  });
});

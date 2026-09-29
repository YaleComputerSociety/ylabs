import fs from 'node:fs';
import path from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * `syncEntity` and `syncEntities` report their outcome only through the value they
 * return, and a caller that discards it reports a resync the index never received
 * (#2874, #3726). This scans every non-test server source file by call shape and fails
 * on any call to them, or to `syncResearchEntitiesWithOutcome`, whose value is dropped.
 */
const SERVER_SRC = path.resolve(__dirname, '../..');

const INDEX_SYNC_CALLEES = new Set([
  'syncEntity',
  'syncEntities',
  'syncResearchEntitiesWithOutcome',
]);

/**
 * Each file allowed to discard an index-sync result, the number of such sites, and why
 * the outcome is not worth reporting there. A new discarded site in a listed file changes
 * its count, so it is reviewed here like a new file would be.
 */
const REVIEWED_DISCARDED_INDEX_SYNC_SITES: Record<string, { sites: number; reason: string }> = {};

const sourceFiles = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === '__tests__' || entry.name === 'node_modules'
        ? []
        : sourceFiles(fullPath);
    }
    const isSource = entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts');
    const isTest = /\.(test|spec)\.ts$/.test(entry.name);
    return isSource && !isTest ? [fullPath] : [];
  });

const calleeName = (call: ts.CallExpression): string | undefined => {
  const callee = call.expression;
  if (ts.isIdentifier(callee)) return callee.text;
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
  return undefined;
};

const isValuePassThrough = (node: ts.Node): node is ts.Expression =>
  ts.isAwaitExpression(node) ||
  ts.isParenthesizedExpression(node) ||
  ts.isAsExpression(node) ||
  ts.isNonNullExpression(node) ||
  ts.isSatisfiesExpression(node) ||
  ts.isTypeAssertionExpression(node);

const valueIsDiscarded = (call: ts.CallExpression): boolean => {
  let node: ts.Node = call;
  while (node.parent && isValuePassThrough(node.parent)) node = node.parent;
  const parent = node.parent;
  return !!parent && (ts.isExpressionStatement(parent) || ts.isVoidExpression(parent));
};

export const discardedIndexSyncSites = (label: string, source: string): string[] => {
  const parsed = ts.createSourceFile(label, source, ts.ScriptTarget.Latest, true);
  const discarded: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const name = calleeName(node);
      if (name && INDEX_SYNC_CALLEES.has(name) && valueIsDiscarded(node)) {
        const { line } = parsed.getLineAndCharacterOfPosition(node.getStart(parsed));
        discarded.push(`${label}:${line + 1} ${name}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return discarded;
};

describe('index-sync results are read by every caller (#3726)', () => {
  it('finds a discarded result in each statement shape a caller can write', () => {
    const source = [
      'async function run() {',
      "await syncEntities('researchEntity', docs);",
      "if (docs.length > 0) await syncEntities('researchEntity', docs);",
      "void syncEntity('researchEntity', doc);",
      "await (syncEntities('researchEntity', docs) as Promise<number>);",
      "await meili.syncEntities('researchEntity', docs);",
      'await syncResearchEntitiesWithOutcome(docs);',
      "const submitted = await syncEntities('researchEntity', docs);",
      "if (!(await syncEntity('researchEntity', doc))) failures += 1;",
      'result.sync = await syncResearchEntitiesWithOutcome(docs);',
      "return syncEntities('researchEntity', docs);",
      '}',
    ].join('\n');

    expect(discardedIndexSyncSites('synthetic.ts', source)).toEqual([
      'synthetic.ts:2 syncEntities',
      'synthetic.ts:3 syncEntities',
      'synthetic.ts:4 syncEntity',
      'synthetic.ts:5 syncEntities',
      'synthetic.ts:6 syncEntities',
      'synthetic.ts:7 syncResearchEntitiesWithOutcome',
    ]);
  });

  it('no server source file discards an index-sync result outside the reviewed list', () => {
    const countsByFile = new Map<string, number>();
    const sites: string[] = [];
    for (const file of sourceFiles(SERVER_SRC)) {
      const label = path.relative(SERVER_SRC, file).split(path.sep).join('/');
      const found = discardedIndexSyncSites(label, fs.readFileSync(file, 'utf8'));
      if (found.length === 0) continue;
      countsByFile.set(label, found.length);
      sites.push(...found);
    }

    const unreviewed = sites.filter((site) => {
      const file = site.slice(0, site.indexOf(':'));
      return REVIEWED_DISCARDED_INDEX_SYNC_SITES[file]?.sites !== countsByFile.get(file);
    });
    expect(unreviewed).toEqual([]);

    const staleReviews = Object.entries(REVIEWED_DISCARDED_INDEX_SYNC_SITES)
      .filter(([file, review]) => countsByFile.get(file) !== review.sites)
      .map(([file]) => file);
    expect(staleReviews).toEqual([]);
  });
});

import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const SCRIPTS_DIR = path.resolve(__dirname, '..');
const GUARD_NAME = 'assertScriptApplyAllowed';
const GUARD_MODULE = 'scriptWriteGuards.ts';
const APPLY_FLAG = '--apply';

const DEVELOPMENT_ONLY_DATABASE_CHECK =
  'refuses any target but Development through assertOperatorEnvironmentMatchesDatabase, before connecting and again on the connected database';
const PROMOTION_DATABASE_CHECK =
  'promotion tooling that names its source and target databases and refuses any pair but the one promotion step it performs';
const REFUSES_APPLY = 'a read-only instrument that names --apply only to throw on it';

const APPLY_GUARD_EXEMPTIONS: Record<string, string> = {
  'auditFacultyDepartureLane.ts': REFUSES_APPLY,
  'auditPlansTheProjectionDeclines.ts': REFUSES_APPLY,
  'leadEdgeRetirementReviewQueue.ts': REFUSES_APPLY,
  'backfillNonLabBrowseRankDebias.ts': DEVELOPMENT_ONLY_DATABASE_CHECK,
  'reconcileNotCurrentlyAvailableAccessSignals.ts': DEVELOPMENT_ONLY_DATABASE_CHECK,
  'retireStaleAccessSignalFields.ts': DEVELOPMENT_ONLY_DATABASE_CHECK,
  'retireStaleSavedPlanFields.ts': DEVELOPMENT_ONLY_DATABASE_CHECK,
  'betaSeedEnvironment.ts':
    'assertBetaSeedAllowed refuses unless SCRAPER_ENV=beta and --confirm-beta-seed is passed',
  'canonicalMongoValidators.ts':
    'a schema operation that requires --environment, a matching confirmation flag, and CONFIRM_PROD_MONGO_VALIDATORS=true for Production',
  'promoteAcceptedBetaCopy.ts': PROMOTION_DATABASE_CHECK,
  'syncBetaToDevelopment.ts': PROMOTION_DATABASE_CHECK,
  'syncDevelopmentToBeta.ts': PROMOTION_DATABASE_CHECK,
};

interface ScriptModule {
  namesApplyFlag: boolean;
  callsGuard: boolean;
  imports: string[];
}

function scriptFiles(): string[] {
  return fs
    .readdirSync(SCRIPTS_DIR, { recursive: true, encoding: 'utf8' })
    .map((file) => file.split(path.sep).join('/'))
    .filter(
      (file) =>
        file.endsWith('.ts') &&
        !file.endsWith('.d.ts') &&
        !file.includes('__tests__/') &&
        file !== GUARD_MODULE,
    );
}

function localImport(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null;
  const base = path.posix.join(path.posix.dirname(fromFile), specifier);
  for (const candidate of [`${base}.ts`, `${base}/index.ts`]) {
    if (!candidate.startsWith('..') && fs.existsSync(path.join(SCRIPTS_DIR, candidate))) {
      return candidate;
    }
  }
  return null;
}

function parseScriptModule(file: string): ScriptModule {
  const source = ts.createSourceFile(
    file,
    fs.readFileSync(path.join(SCRIPTS_DIR, file), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const parsed: ScriptModule = { namesApplyFlag: false, callsGuard: false, imports: [] };
  const visit = (node: ts.Node): void => {
    if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      node.text === APPLY_FLAG
    ) {
      parsed.namesApplyFlag = true;
    }
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === GUARD_NAME
    ) {
      parsed.callsGuard = true;
    }
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const imported = localImport(file, node.moduleSpecifier.text);
      if (imported) parsed.imports.push(imported);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return parsed;
}

function applyPathsWithoutTheGuard(): string[] {
  const modules = new Map(scriptFiles().map((file) => [file, parseScriptModule(file)]));
  const reachable = new Map<string, Set<string>>();
  const reachableFrom = (file: string): Set<string> => {
    const cached = reachable.get(file);
    if (cached) return cached;
    const seen = new Set<string>([file]);
    reachable.set(file, seen);
    for (const imported of modules.get(file)?.imports ?? []) {
      for (const reached of reachableFrom(imported)) seen.add(reached);
    }
    return seen;
  };
  const callsGuard = (file: string) => modules.get(file)?.callsGuard === true;

  return [...modules.entries()]
    .filter(([, parsed]) => parsed.namesApplyFlag)
    .map(([file]) => file)
    .filter((file) => {
      const importers = [...modules.keys()].filter((other) => reachableFrom(other).has(file));
      return ![...reachableFrom(file), ...importers].some(callsGuard);
    })
    .sort();
}

describe('every script --apply path reaches the shared apply guard (#4320)', () => {
  const unguarded = applyPathsWithoutTheGuard();
  const exempt = new Set(Object.keys(APPLY_GUARD_EXEMPTIONS));

  it('parses the scripts it is guarding', () => {
    expect(scriptFiles().length).toBeGreaterThan(100);
  });

  it('has no apply path that skips assertScriptApplyAllowed without a recorded reason', () => {
    expect(
      unguarded.filter((file) => !exempt.has(file)),
      `Call ${GUARD_NAME} with mongoUrl: process.env.MONGODBURL on the apply path, or add the script to APPLY_GUARD_EXEMPTIONS with the guard that stands in for it.`,
    ).toEqual([]);
  });

  it('keeps every exemption a script that still has an unguarded apply path', () => {
    expect(
      [...exempt].filter((file) => !unguarded.includes(file)),
      'These now reach the shared guard or no longer name --apply: remove them from APPLY_GUARD_EXEMPTIONS.',
    ).toEqual([]);
  });

  it('records a reason for every exemption', () => {
    expect(
      Object.entries(APPLY_GUARD_EXEMPTIONS)
        .filter(([, reason]) => reason.trim().length === 0)
        .map(([file]) => file),
    ).toEqual([]);
  });
});

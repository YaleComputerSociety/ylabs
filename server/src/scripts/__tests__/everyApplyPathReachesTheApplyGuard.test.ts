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
  'canonicalMongoValidators.ts':
    'a schema operation that requires --environment, a matching confirmation flag, and CONFIRM_PROD_MONGO_VALIDATORS=true for Production',
  'promoteAcceptedBetaCopy.ts': PROMOTION_DATABASE_CHECK,
  'syncBetaToDevelopment.ts': PROMOTION_DATABASE_CHECK,
  'syncDevelopmentToBeta.ts': PROMOTION_DATABASE_CHECK,
  'runScraperSweep.ts':
    'forwards --apply to the stage commands it spawns, each behind its own guard, after validateScraperSweepEnvironment refuses any database but Development',
};

const PACKAGE_JSON = path.resolve(SCRIPTS_DIR, '..', '..', 'package.json');

interface ImportedBinding {
  module: string;
  exportedName: string;
}

interface CodeFacts {
  namesApplyFlag: boolean;
  callsGuard: boolean;
  calledImports: ImportedBinding[];
}

interface ScriptModule extends CodeFacts {
  imports: string[];
  exportedFunctions: Map<string, CodeFacts>;
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

function registeredEntryScripts(): Set<string> {
  const scripts =
    (JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8')) as { scripts?: Record<string, string> })
      .scripts ?? {};
  return new Set(
    Object.values(scripts).flatMap((line) =>
      [...line.matchAll(/src\/scripts\/([\w./-]+\.ts)/g)].map((match) => match[1]),
    ),
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

function importedBindings(file: string, source: ts.SourceFile): Map<string, ImportedBinding> {
  const bindings = new Map<string, ImportedBinding>();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }
    const module = localImport(file, statement.moduleSpecifier.text);
    const clause = statement.importClause;
    if (!module || !clause?.namedBindings) continue;
    if (ts.isNamespaceImport(clause.namedBindings)) {
      bindings.set(clause.namedBindings.name.text, { module, exportedName: '*' });
      continue;
    }
    for (const element of clause.namedBindings.elements) {
      bindings.set(element.name.text, {
        module,
        exportedName: (element.propertyName ?? element.name).text,
      });
    }
  }
  return bindings;
}

function calledBinding(
  call: ts.CallExpression,
  bindings: Map<string, ImportedBinding>,
): ImportedBinding | null {
  const callee = call.expression;
  if (ts.isIdentifier(callee)) return bindings.get(callee.text) ?? null;
  if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)) {
    const namespace = bindings.get(callee.expression.text);
    return namespace?.exportedName === '*'
      ? { module: namespace.module, exportedName: callee.name.text }
      : null;
  }
  return null;
}

function codeFacts(node: ts.Node, bindings: Map<string, ImportedBinding>): CodeFacts {
  const facts: CodeFacts = { namesApplyFlag: false, callsGuard: false, calledImports: [] };
  const visit = (child: ts.Node): void => {
    if (
      (ts.isStringLiteral(child) || ts.isNoSubstitutionTemplateLiteral(child)) &&
      child.text === APPLY_FLAG
    ) {
      facts.namesApplyFlag = true;
    }
    if (ts.isCallExpression(child)) {
      if (ts.isIdentifier(child.expression) && child.expression.text === GUARD_NAME) {
        facts.callsGuard = true;
      }
      const binding = calledBinding(child, bindings);
      if (binding) facts.calledImports.push(binding);
    }
    ts.forEachChild(child, visit);
  };
  visit(node);
  return facts;
}

const isExported = (node: ts.Node): boolean =>
  ts.canHaveModifiers(node) &&
  (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);

function exportedFunctions(
  source: ts.SourceFile,
  bindings: Map<string, ImportedBinding>,
): Map<string, CodeFacts> {
  const functions = new Map<string, CodeFacts>();
  for (const statement of source.statements) {
    if (!isExported(statement)) continue;
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      functions.set(statement.name.text, codeFacts(statement, bindings));
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.initializer) {
          functions.set(declaration.name.text, codeFacts(declaration.initializer, bindings));
        }
      }
    }
  }
  return functions;
}

function parseScriptModule(file: string): ScriptModule {
  const source = ts.createSourceFile(
    file,
    fs.readFileSync(path.join(SCRIPTS_DIR, file), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const bindings = importedBindings(file, source);
  return {
    ...codeFacts(source, bindings),
    imports: [...new Set([...bindings.values()].map((binding) => binding.module))],
    exportedFunctions: exportedFunctions(source, bindings),
  };
}

function reachesThroughCalls(
  modules: Map<string, ScriptModule>,
  holds: (facts: CodeFacts) => boolean,
): (binding: ImportedBinding) => boolean {
  const verdicts = new Map<string, boolean>();
  const reaches = (binding: ImportedBinding): boolean => {
    const key = `${binding.module}#${binding.exportedName}`;
    const known = verdicts.get(key);
    if (known !== undefined) return known;
    verdicts.set(key, false);
    const facts = modules.get(binding.module)?.exportedFunctions.get(binding.exportedName);
    const verdict = Boolean(facts && (holds(facts) || facts.calledImports.some(reaches)));
    verdicts.set(key, verdict);
    return verdict;
  };
  return reaches;
}

function applyPathsWithoutTheGuard(): string[] {
  const modules = new Map(scriptFiles().map((file) => [file, parseScriptModule(file)]));
  const imported = new Set([...modules.values()].flatMap((parsed) => parsed.imports));
  const registered = registeredEntryScripts();
  const parsesApply = reachesThroughCalls(modules, (facts) => facts.namesApplyFlag);
  const wrapsGuard = reachesThroughCalls(modules, (facts) => facts.callsGuard);

  return [...modules.entries()]
    .filter(([file]) => registered.has(file) || !imported.has(file))
    .filter(([, parsed]) => parsed.namesApplyFlag || parsed.calledImports.some(parsesApply))
    .filter(([, parsed]) => !parsed.callsGuard && !parsed.calledImports.some(wrapsGuard))
    .map(([file]) => file)
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

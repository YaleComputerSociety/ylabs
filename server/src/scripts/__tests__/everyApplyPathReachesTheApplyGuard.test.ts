import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const SERVER_SRC = path.resolve(__dirname, '../..');
const SCRIPTS_PREFIX = 'scripts/';
const GUARD_NAME = 'assertScriptApplyAllowed';
const LEASE_TAKING_CALLS = new Set([
  GUARD_NAME,
  'recordDevApplyIntent',
  'holdDevApplyLeaseOnDb',
  'holdDevApplyLeaseForRun',
]);
const CONNECTING_CALLS = new Set([
  'initializeConnections',
  'connectScriptMongo',
  'createScriptMongoConnection',
]);
const GUARD_MODULE = 'scripts/scriptWriteGuards.ts';
const isApplyFlag = (text: string): boolean =>
  /^--(apply|execute|write|mode=apply)$/.test(text) || text.startsWith('--confirm');

type ExemptionCategory =
  'read-only' | 'beta-or-production-only' | 'forwards-to-guarded-children' | 'covered-elsewhere';

interface Exemption {
  category: ExemptionCategory;
  reason: string;
}

const REFUSES_APPLY: Exemption = {
  category: 'read-only',
  reason: 'a read-only instrument that names --apply only to throw on it',
};
const PROMOTION_DATABASE_CHECK: Exemption = {
  category: 'beta-or-production-only',
  reason:
    'promotion tooling that names its source and target databases, refuses any pair but the one promotion step it performs, and never writes Development',
};

/**
 * Every apply entry point that reaches none of LEASE_TAKING_CALLS, with the category that says why
 * it may not need the Development write lease. A new apply entry point fails this suite until it
 * takes the lease or is classified here.
 */
const APPLY_GUARD_EXEMPTIONS: Record<string, Exemption> = {
  'scripts/auditFacultyDepartureLane.ts': REFUSES_APPLY,
  'scripts/measureRetiredResearchEntityRemint.ts': REFUSES_APPLY,
  'scripts/auditPlansTheProjectionDeclines.ts': REFUSES_APPLY,
  'scripts/leadEdgeRetirementReviewQueue.ts': REFUSES_APPLY,
  'scripts/promoteAcceptedBetaCopy.ts': PROMOTION_DATABASE_CHECK,
  'scripts/syncDevelopmentToBeta.ts': PROMOTION_DATABASE_CHECK,
  'scripts/promoteBeta.ts': {
    category: 'forwards-to-guarded-children',
    reason:
      'forwards --apply only to beta:refresh-from-development, which refuses any pair but Development to Beta, after a typed confirmation',
  },
  'scripts/promoteProduction.ts': {
    category: 'forwards-to-guarded-children',
    reason:
      'forwards --apply only to production:promote-beta-copy, which refuses any pair but Beta to Prod, after the operator types the target name',
  },
  'scripts/promoteRemotePhase.ts': {
    category: 'forwards-to-guarded-children',
    reason:
      'runs on the Render operator service only after remotePhaseEnvironmentProblems matches SCRAPER_ENV and the index prefix to the target, then forwards --apply to commands that run their own guard',
  },
  'scripts/opsSweep.ts': {
    category: 'forwards-to-guarded-children',
    reason:
      'passes its confirm flag to a one-off job on the hosted sweep runner, which takes its own lease through holdDevApplyLeaseForRun; this process only reads Development',
  },
};

/**
 * Every apply entry point that connects before it records its apply intent. The connect path then
 * takes no lease, so a model write takes it at the first write instead (#5971), but a raw driver
 * write skips that and would land unleased. Record the intent before connecting, or list the script
 * here with the reason that is safe.
 */
const RECORDS_APPLY_INTENT_AFTER_CONNECTING: Record<string, Exemption> = {};

const PACKAGE_JSON = path.resolve(SERVER_SRC, '..', 'package.json');

interface ImportedBinding {
  module: string;
  exportedName: string;
}

interface CodeFacts {
  namesApplyFlag: boolean;
  callsGuard: boolean;
  callsConnect: boolean;
  calledImports: ImportedBinding[];
  calledLocals: string[];
}

interface FunctionBody {
  name: string;
  calls: ts.CallExpression[];
}

interface ScriptModule extends CodeFacts {
  imports: string[];
  bindings: Map<string, ImportedBinding>;
  exportedFunctions: Map<string, CodeFacts>;
  localFunctions: Map<string, CodeFacts>;
  functionBodies: FunctionBody[];
}

function registeredEntryFiles(): Set<string> {
  const scripts =
    (JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8')) as { scripts?: Record<string, string> })
      .scripts ?? {};
  return new Set(
    Object.values(scripts)
      .flatMap((line) => [...line.matchAll(/src\/([\w./-]+\.ts)/g)].map((match) => match[1]))
      .filter((file) => file !== 'index.ts'),
  );
}

function parsedFiles(): string[] {
  const scripts = fs
    .readdirSync(path.join(SERVER_SRC, SCRIPTS_PREFIX), { recursive: true, encoding: 'utf8' })
    .map((file) => `${SCRIPTS_PREFIX}${file.split(path.sep).join('/')}`)
    .filter(
      (file) =>
        file.endsWith('.ts') &&
        !file.endsWith('.d.ts') &&
        !file.includes('__tests__/') &&
        file !== GUARD_MODULE,
    );
  return [...new Set([...scripts, ...registeredEntryFiles()])].sort();
}

function localImport(
  fromFile: string,
  specifier: string,
  parsed: ReadonlySet<string>,
): string | null {
  if (!specifier.startsWith('.')) return null;
  const base = path.posix.join(path.posix.dirname(fromFile), specifier);
  for (const candidate of [`${base}.ts`, `${base}/index.ts`]) {
    if (parsed.has(candidate)) return candidate;
  }
  return null;
}

function importedBindings(
  file: string,
  source: ts.SourceFile,
  parsed: ReadonlySet<string>,
): Map<string, ImportedBinding> {
  const bindings = new Map<string, ImportedBinding>();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }
    const module = localImport(file, statement.moduleSpecifier.text, parsed);
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

const calledIdentifier = (call: ts.CallExpression): string | null =>
  ts.isIdentifier(call.expression) ? call.expression.text : null;

const readsParsedApplyFlag = (node: ts.Node): boolean =>
  ts.isPropertyAccessExpression(node) &&
  node.name.text === 'apply' &&
  !(ts.isCallExpression(node.parent) && node.parent.expression === node);

function codeFacts(node: ts.Node, bindings: Map<string, ImportedBinding>): CodeFacts {
  const facts: CodeFacts = {
    namesApplyFlag: false,
    callsGuard: false,
    callsConnect: false,
    calledImports: [],
    calledLocals: [],
  };
  const visit = (child: ts.Node): void => {
    if (
      (ts.isStringLiteral(child) || ts.isNoSubstitutionTemplateLiteral(child)) &&
      isApplyFlag(child.text)
    ) {
      facts.namesApplyFlag = true;
    }
    if (readsParsedApplyFlag(child)) facts.namesApplyFlag = true;
    if (ts.isCallExpression(child)) {
      const identifier = calledIdentifier(child);
      if (identifier && LEASE_TAKING_CALLS.has(identifier)) facts.callsGuard = true;
      if (identifier && CONNECTING_CALLS.has(identifier)) facts.callsConnect = true;
      const binding = calledBinding(child, bindings);
      if (binding) facts.calledImports.push(binding);
      else if (identifier) facts.calledLocals.push(identifier);
    }
    ts.forEachChild(child, visit);
  };
  visit(node);
  return facts;
}

const isExported = (node: ts.Node): boolean =>
  ts.canHaveModifiers(node) &&
  (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);

function namedTopLevelFunctions(
  source: ts.SourceFile,
): Array<{ name: string; node: ts.Node; exported: boolean }> {
  const functions: Array<{ name: string; node: ts.Node; exported: boolean }> = [];
  for (const statement of source.statements) {
    const exported = isExported(statement);
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      functions.push({ name: statement.name.text, node: statement, exported });
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.initializer) {
          functions.push({ name: declaration.name.text, node: declaration.initializer, exported });
        }
      }
    }
  }
  return functions;
}

function functionBodies(source: ts.SourceFile): FunctionBody[] {
  const bodies: FunctionBody[] = [];
  const collect = (node: ts.Node): void => {
    if (ts.isFunctionLike(node) && 'body' in node && node.body) {
      const calls: ts.CallExpression[] = [];
      const walk = (child: ts.Node): void => {
        if (ts.isFunctionLike(child)) return;
        if (ts.isCallExpression(child)) calls.push(child);
        ts.forEachChild(child, walk);
      };
      ts.forEachChild(node.body, walk);
      const name =
        node.name && ts.isIdentifier(node.name)
          ? node.name.text
          : `<function at ${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}>`;
      bodies.push({ name, calls: calls.sort((left, right) => left.getStart() - right.getStart()) });
    }
    ts.forEachChild(node, collect);
  };
  collect(source);
  return bodies;
}

function parseScriptModule(file: string, parsed: ReadonlySet<string>): ScriptModule {
  const source = ts.createSourceFile(
    file,
    fs.readFileSync(path.join(SERVER_SRC, file), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const bindings = importedBindings(file, source, parsed);
  const functions = namedTopLevelFunctions(source);
  return {
    ...codeFacts(source, bindings),
    imports: [...new Set([...bindings.values()].map((binding) => binding.module))],
    bindings,
    exportedFunctions: new Map(
      functions
        .filter(({ exported }) => exported)
        .map(({ name, node }) => [name, codeFacts(node, bindings)]),
    ),
    localFunctions: new Map(functions.map(({ name, node }) => [name, codeFacts(node, bindings)])),
    functionBodies: functionBodies(source),
  };
}

type Reaches = ((binding: ImportedBinding) => boolean) & {
  local: (module: string, name: string) => boolean;
};

function reachesThroughCalls(
  modules: Map<string, ScriptModule>,
  holds: (facts: CodeFacts) => boolean,
): Reaches {
  const verdicts = new Map<string, boolean>();
  const reachesFunction = (module: string, name: string, exportedOnly: boolean): boolean => {
    const key = `${module}#${name}`;
    const known = verdicts.get(key);
    if (known !== undefined) return known;
    verdicts.set(key, false);
    const parsed = modules.get(module);
    const facts = exportedOnly
      ? parsed?.exportedFunctions.get(name)
      : parsed?.localFunctions.get(name);
    const verdict = Boolean(
      facts &&
      (holds(facts) ||
        facts.calledImports.some(reaches) ||
        facts.calledLocals.some((local) => reachesFunction(module, local, false))),
    );
    verdicts.set(key, verdict);
    return verdict;
  };
  const reaches = (binding: ImportedBinding): boolean =>
    reachesFunction(binding.module, binding.exportedName, true);
  return Object.assign(reaches, {
    local: (module: string, name: string) => reachesFunction(module, name, false),
  });
}

function callReaches(
  file: string,
  module: ScriptModule,
  call: ts.CallExpression,
  reaches: Reaches,
  named: ReadonlySet<string>,
): boolean {
  const binding = calledBinding(call, module.bindings);
  if (binding) return reaches(binding);
  const identifier = calledIdentifier(call);
  if (!identifier) return false;
  return named.has(identifier) || reaches.local(file, identifier);
}

interface Inventory {
  applyEntryPoints: string[];
  unguarded: string[];
  intentAfterConnecting: string[];
}

function inventory(): Inventory {
  const files = parsedFiles();
  const parsed = new Set(files);
  const modules = new Map(files.map((file) => [file, parseScriptModule(file, parsed)]));
  const imported = new Set([...modules.values()].flatMap((module) => module.imports));
  const registered = registeredEntryFiles();
  const parsesApply = reachesThroughCalls(modules, (facts) => facts.namesApplyFlag);
  const wrapsGuard = reachesThroughCalls(modules, (facts) => facts.callsGuard);
  const wrapsConnect = reachesThroughCalls(modules, (facts) => facts.callsConnect);

  const applyEntryPoints = [...modules.entries()]
    .filter(
      ([file]) => registered.has(file) || (file.startsWith(SCRIPTS_PREFIX) && !imported.has(file)),
    )
    .filter(([, module]) => module.namesApplyFlag || module.calledImports.some(parsesApply))
    .map(([file]) => file)
    .sort();

  const guarded = (module: ScriptModule) =>
    module.callsGuard || module.calledImports.some(wrapsGuard);
  const unguarded = applyEntryPoints.filter((file) => !guarded(modules.get(file)!));

  const intentAfterConnecting = applyEntryPoints.filter((file) => {
    const module = modules.get(file)!;
    if (!guarded(module)) return false;
    return module.functionBodies.some(({ calls }) => {
      const connectsAt = calls.findIndex((call) =>
        callReaches(file, module, call, wrapsConnect, CONNECTING_CALLS),
      );
      if (connectsAt < 0) return false;
      const recordsIntent = (call: ts.CallExpression) =>
        callReaches(file, module, call, wrapsGuard, LEASE_TAKING_CALLS);
      return (
        !calls.slice(0, connectsAt + 1).some(recordsIntent) &&
        calls.slice(connectsAt + 1).some(recordsIntent)
      );
    });
  });

  return { applyEntryPoints, unguarded, intentAfterConnecting };
}

const EXEMPTION_CATEGORIES: ReadonlySet<ExemptionCategory> = new Set([
  'read-only',
  'beta-or-production-only',
  'forwards-to-guarded-children',
  'covered-elsewhere',
]);

const unexplained = (exemptions: Record<string, Exemption>) =>
  Object.entries(exemptions)
    .filter(
      ([, { category, reason }]) =>
        !EXEMPTION_CATEGORIES.has(category) || reason.trim().length === 0,
    )
    .map(([file]) => file);

describe('every script apply path takes the Development write lease (#4320, #5971)', () => {
  const found = inventory();

  it('parses the scripts it is guarding', () => {
    expect(found.applyEntryPoints.length).toBeGreaterThan(100);
  });

  it('enumerates the apply entry points outside src/scripts that package.json registers', () => {
    expect(found.applyEntryPoints).toEqual(
      expect.arrayContaining(['scrapers/cli.ts', 'scrapers/seedSources.ts']),
    );
  });

  it('has no apply path that takes no lease without a classified reason', () => {
    expect(
      found.unguarded.filter((file) => !(file in APPLY_GUARD_EXEMPTIONS)),
      `Call ${GUARD_NAME} with mongoUrl: process.env.MONGODBURL on the apply path, or another of ${[...LEASE_TAKING_CALLS].join(', ')}, or add the script to APPLY_GUARD_EXEMPTIONS with its category and reason.`,
    ).toEqual([]);
  });

  it('keeps every exemption a script that still has an apply path that takes no lease', () => {
    expect(
      Object.keys(APPLY_GUARD_EXEMPTIONS).filter((file) => !found.unguarded.includes(file)),
      'These now take the lease or no longer name an apply flag: remove them from APPLY_GUARD_EXEMPTIONS.',
    ).toEqual([]);
  });

  it('records the intent before connecting, or names why recording it later is safe', () => {
    expect(
      found.intentAfterConnecting.filter(
        (file) => !(file in RECORDS_APPLY_INTENT_AFTER_CONNECTING),
      ),
      'Call the apply guard before initializeConnections or connectScriptMongo, so the connect path takes the lease: a raw driver write after a late intent lands unleased.',
    ).toEqual([]);
  });

  it('keeps every late-intent entry a script that still connects before recording its intent', () => {
    expect(
      Object.keys(RECORDS_APPLY_INTENT_AFTER_CONNECTING).filter(
        (file) => !found.intentAfterConnecting.includes(file),
      ),
      'These now record the intent before connecting: remove them from RECORDS_APPLY_INTENT_AFTER_CONNECTING.',
    ).toEqual([]);
  });

  it('records a category and a reason for every exemption', () => {
    expect([
      ...unexplained(APPLY_GUARD_EXEMPTIONS),
      ...unexplained(RECORDS_APPLY_INTENT_AFTER_CONNECTING),
    ]).toEqual([]);
  });
});

import fs from 'node:fs';
import path from 'node:path';

import ts from 'typescript';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildServerBundle, SERVER_ROOT, type ServerBundle } from '../test/serverBundle';

const SERVER_ENTRY_MODULE = 'src/index.ts';
const ENTRY_PROCESS_SIGNAL = /process\.argv|import\.meta|require\.main|__filename|__dirname/;
const MODULE_LOCATION_CONSUMERS = new Set([
  'isDirectScriptInvocation',
  'resolveServerPackageRoot',
  'createRequire',
]);
const MODULES_THAT_SEARCH_BOTH_LAYOUTS = new Set(['src/scrapers/prompts/index.ts']);

interface EntryPointFinding {
  module: string;
  line: number;
  rule: 'unguarded-direct-run-check' | 'top-level-local-call' | 'module-location-path';
  text: string;
}

const lineOf = (sourceFile: ts.SourceFile, node: ts.Node): number =>
  sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;

const unwrapInvocation = (expression: ts.Expression): ts.Expression => {
  let current = expression;
  for (;;) {
    if (ts.isVoidExpression(current) || ts.isAwaitExpression(current)) {
      current = current.expression;
    } else if (ts.isParenthesizedExpression(current)) {
      current = current.expression;
    } else if (
      ts.isCallExpression(current) &&
      ts.isPropertyAccessExpression(current.expression) &&
      ['catch', 'then', 'finally'].includes(current.expression.name.text)
    ) {
      current = current.expression.expression;
    } else {
      return current;
    }
  }
};

const CLI_BODY_NAME = /^(main|run|cli)$/i;

const isAsync = (node: ts.Node): boolean =>
  ts.canHaveModifiers(node) &&
  (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword);

const topLevelBindings = (sourceFile: ts.SourceFile) => {
  const functions = new Set<string>();
  const initializers = new Map<string, string>();
  const addFunction = (name: string, declaration: ts.Node) => {
    if (isAsync(declaration) || CLI_BODY_NAME.test(name)) functions.add(name);
  };
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      addFunction(statement.name.text, statement);
    }
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
      const initializer = declaration.initializer;
      if (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) {
        addFunction(declaration.name.text, initializer);
      }
      initializers.set(declaration.name.text, initializer.getText(sourceFile));
    }
  }
  return { functions, initializers };
};

const mentionsEntryProcess = (
  condition: ts.Expression,
  initializers: Map<string, string>,
  sourceFile: ts.SourceFile,
): boolean => {
  if (ENTRY_PROCESS_SIGNAL.test(condition.getText(sourceFile))) return true;
  let found = false;
  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node) && ENTRY_PROCESS_SIGNAL.test(initializers.get(node.text) ?? '')) {
      found = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(condition);
  return found;
};

const isOwnDirectScriptInvocation = (
  condition: ts.Expression,
  moduleName: string,
  sourceFile: ts.SourceFile,
): boolean => {
  if (!ts.isCallExpression(condition) || !ts.isIdentifier(condition.expression)) return false;
  if (condition.expression.text !== 'isDirectScriptInvocation') return false;
  const [moduleUrl, scriptName] = condition.arguments;
  return (
    moduleUrl?.getText(sourceFile) === 'import.meta.url' &&
    scriptName !== undefined &&
    ts.isStringLiteral(scriptName) &&
    scriptName.text === moduleName
  );
};

const consumerOf = (node: ts.Node): string | undefined => {
  const call = node.parent;
  if (!call || !ts.isCallExpression(call) || call.arguments[0] !== node) return undefined;
  return ts.isIdentifier(call.expression) ? call.expression.text : undefined;
};

function findEntryPointHazards(module: string, sourceText: string): EntryPointFinding[] {
  const sourceFile = ts.createSourceFile(module, sourceText, ts.ScriptTarget.Latest, true);
  const moduleName = path.basename(module, path.extname(module));
  const { functions, initializers } = topLevelBindings(sourceFile);
  const findings: EntryPointFinding[] = [];
  const record = (rule: EntryPointFinding['rule'], node: ts.Node) =>
    findings.push({
      module,
      line: lineOf(sourceFile, node),
      rule,
      text: node.getText(sourceFile).replace(/\s+/g, ' ').slice(0, 120),
    });

  for (const statement of sourceFile.statements) {
    if (
      ts.isIfStatement(statement) &&
      mentionsEntryProcess(statement.expression, initializers, sourceFile) &&
      !isOwnDirectScriptInvocation(statement.expression, moduleName, sourceFile)
    ) {
      record('unguarded-direct-run-check', statement.expression);
    }
    if (ts.isExpressionStatement(statement) && module !== SERVER_ENTRY_MODULE) {
      const invoked = unwrapInvocation(statement.expression);
      if (
        ts.isCallExpression(invoked) &&
        ts.isIdentifier(invoked.expression) &&
        functions.has(invoked.expression.text)
      ) {
        record('top-level-local-call', statement);
      }
    }
  }

  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node) && (node.text === '__dirname' || node.text === '__filename')) {
      record('module-location-path', node.parent);
    }
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isMetaProperty(node.expression) &&
      node.expression.keywordToken === ts.SyntaxKind.ImportKeyword &&
      !MODULES_THAT_SEARCH_BOTH_LAYOUTS.has(module)
    ) {
      const consumer = node.name.text === 'url' ? consumerOf(node) : undefined;
      if (!consumer || !MODULE_LOCATION_CONSUMERS.has(consumer)) {
        record('module-location-path', node.parent);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return findings;
}

describe('the entry-point hazard detector', () => {
  it('flags a bare argv comparison, the shape that ran a seed at server boot', () => {
    const findings = findEntryPointHazards(
      'src/scrapers/exampleCli.ts',
      [
        'const __filename = fileURLToPath(import.meta.url);',
        'async function main() {}',
        'if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {',
        '  void main();',
        '}',
      ].join('\n'),
    );
    expect(findings.map((finding) => finding.rule)).toContain('unguarded-direct-run-check');
  });

  it('flags a direct-run check hidden behind a named constant', () => {
    const findings = findEntryPointHazards(
      'src/scripts/exampleCli.ts',
      [
        'const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);',
        'if (isDirectRun) {}',
      ].join('\n'),
    );
    expect(findings.map((finding) => finding.rule)).toContain('unguarded-direct-run-check');
  });

  it('flags a guard that names a different script', () => {
    const findings = findEntryPointHazards(
      'src/scripts/exampleCli.ts',
      "if (isDirectScriptInvocation(import.meta.url, 'otherCli')) {}",
    );
    expect(findings.map((finding) => finding.rule)).toEqual(['unguarded-direct-run-check']);
  });

  it('flags a CLI body called at module load', () => {
    const findings = findEntryPointHazards(
      'src/scripts/exampleCli.ts',
      [
        'async function main() {}',
        'const backfill = async () => {};',
        'main().catch(() => {});',
        'void backfill();',
      ].join('\n'),
    );
    expect(findings.map((finding) => finding.rule)).toEqual([
      'top-level-local-call',
      'top-level-local-call',
    ]);
  });

  it('accepts a synchronous contract assertion at module load', () => {
    const findings = findEntryPointHazards(
      'src/scrapers/exampleContracts.ts',
      ['function assertContractsAreDeclarable() {}', 'assertContractsAreDeclarable();'].join('\n'),
    );
    expect(findings).toEqual([]);
  });

  it('flags a path computed from the module location, the shape that misplaced a server root', () => {
    const findings = findEntryPointHazards(
      'src/scripts/exampleScheduler.ts',
      "const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');",
    );
    expect(findings.map((finding) => finding.rule)).toEqual(['module-location-path']);
  });

  it('accepts a guard that names the module itself and a root resolved from the package', () => {
    const findings = findEntryPointHazards(
      'src/scripts/exampleCli.ts',
      [
        'const ROOT = resolveServerPackageRoot(import.meta.url);',
        'async function main() {}',
        "if (isDirectScriptInvocation(import.meta.url, 'exampleCli')) {",
        '  void main();',
        '}',
      ].join('\n'),
    );
    expect(findings).toEqual([]);
  });
});

describe('every module the server bundle contains', () => {
  let bundle: ServerBundle;
  let modules: string[] = [];

  beforeAll(async () => {
    bundle = await buildServerBundle('bundled-module-entry-points');
    modules = bundle.sourceModules();
  });

  afterAll(() => {
    bundle?.remove();
  });

  it('is enumerated from the bundle itself, not from a list', () => {
    expect(modules.length).toBeGreaterThan(200);
    expect(modules).toEqual(
      expect.arrayContaining([
        SERVER_ENTRY_MODULE,
        'src/scrapers/seedSources.ts',
        'src/scripts/sourceHealth.ts',
        'src/scripts/gateRefreshScheduler.ts',
      ]),
    );
  });

  it('runs a CLI body only under its own name and resolves paths in both layouts', () => {
    const findings = modules.flatMap((module) =>
      findEntryPointHazards(module, fs.readFileSync(path.join(SERVER_ROOT, module), 'utf8')),
    );
    expect(findings).toEqual([]);
  });
});

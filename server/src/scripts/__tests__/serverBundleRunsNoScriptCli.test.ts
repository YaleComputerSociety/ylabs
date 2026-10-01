import fs from 'node:fs';
import path from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const SERVER_SRC = path.resolve(__dirname, '../..');
const SERVER_ENTRY = path.join(SERVER_SRC, 'index.ts');

const BUNDLE_AWARE_GUARD = path.join(SERVER_SRC, 'scripts', 'directScriptInvocation.ts');

const resolveRelativeImport = (fromFile: string, specifier: string): string | null => {
  if (!specifier.startsWith('.')) return null;
  const base = path.resolve(path.dirname(fromFile), specifier.replace(/\.js$/, ''));
  const candidates = [`${base}.ts`, path.join(base, 'index.ts')];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
};

const importedFiles = (file: string, source: ts.SourceFile): string[] => {
  const specifiers: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      specifiers.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return specifiers
    .map((specifier) => resolveRelativeImport(file, specifier))
    .filter((resolved): resolved is string => resolved !== null);
};

const entryArgumentReadLines = (source: ts.SourceFile): number[] => {
  const lines: number[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isElementAccessExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'process' &&
      node.expression.name.text === 'argv' &&
      ts.isNumericLiteral(node.argumentExpression) &&
      node.argumentExpression.text === '1'
    ) {
      lines.push(source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return lines;
};

const modulesReachableFromServerEntry = (): string[] => {
  const seen = new Set<string>();
  const queue = [SERVER_ENTRY];
  while (queue.length > 0) {
    const file = queue.shift()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const source = ts.createSourceFile(
      file,
      fs.readFileSync(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    );
    queue.push(...importedFiles(file, source));
  }
  return [...seen];
};

describe('the bundled server entry', () => {
  it('reaches no module that decides on its own whether it is the entry point', () => {
    const offenders = modulesReachableFromServerEntry()
      .filter((file) => file !== BUNDLE_AWARE_GUARD)
      .flatMap((file) => {
        const source = ts.createSourceFile(
          file,
          fs.readFileSync(file, 'utf8'),
          ts.ScriptTarget.Latest,
          true,
        );
        return entryArgumentReadLines(source).map(
          (line) => `${path.relative(SERVER_SRC, file)}:${line}`,
        );
      });

    expect(
      offenders,
      'tsup bundles every reachable module into build/index.js, so a module that compares ' +
        'process.argv[1] itself runs its CLI body in the deployed server (#4186). Decide a direct ' +
        'run through isDirectScriptInvocation, or keep the module out of the server graph.',
    ).toEqual([]);
  });

  it('reaches the source-health module, so the guard above is load-bearing', () => {
    expect(modulesReachableFromServerEntry()).toContain(
      path.join(SERVER_SRC, 'scripts', 'sourceHealth.ts'),
    );
  });
});

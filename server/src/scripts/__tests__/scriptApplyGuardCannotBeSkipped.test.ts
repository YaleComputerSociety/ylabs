import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { assertScriptApplyAllowed } from '../scriptWriteGuards';

const SERVER_SRC = path.resolve(__dirname, '../..');
const GUARD_NAME = 'assertScriptApplyAllowed';
const GUARD_MODULE = path.join(SERVER_SRC, 'scripts', 'scriptWriteGuards.ts');
const PRODUCTION_URL = 'mongodb+srv://user:secret@cluster.example.net/Prod';

interface GuardCall {
  location: string;
  namesTarget: boolean;
  overridesEnvironment: boolean;
}

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === '__tests__' || entry.name === 'node_modules' ? [] : sourceFiles(full);
    }
    if (!entry.name.endsWith('.ts') || entry.name.endsWith('.d.ts')) return [];
    if (entry.name.endsWith('.test.ts') || entry.name.endsWith('.spec.ts')) return [];
    return [full];
  });
}

function propertyNames(argument: ts.Expression | undefined): Set<string> {
  if (!argument || !ts.isObjectLiteralExpression(argument)) return new Set();
  return new Set(
    argument.properties.flatMap((property) =>
      property.name && ts.isIdentifier(property.name) ? [property.name.text] : [],
    ),
  );
}

// Parsed rather than grepped: a call spans several lines and a line window
// cannot tell which argument object a `mongoUrl` on the next line belongs to.
function guardCalls(): GuardCall[] {
  const calls: GuardCall[] = [];
  for (const file of sourceFiles(SERVER_SRC)) {
    if (file === GUARD_MODULE) continue;
    const text = fs.readFileSync(file, 'utf8');
    if (!text.includes(`${GUARD_NAME}(`)) continue;
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === GUARD_NAME
      ) {
        const fields = propertyNames(node.arguments[0]);
        const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
        calls.push({
          location: `${path.relative(SERVER_SRC, file)}:${line + 1}`,
          namesTarget: fields.has('mongoUrl'),
          overridesEnvironment: fields.has('env'),
        });
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return calls;
}

describe('no script apply path can skip the production check', () => {
  const calls = guardCalls();

  it('finds the guard call sites it is guarding', () => {
    expect(calls.length).toBeGreaterThan(100);
  });

  /**
   * #3725: four apply-capable scripts omitted `mongoUrl`, so the guard labelled
   * the target 'missing', no production pattern matched, and the refusal could
   * not fire while the script connected through `MONGODBURL` anyway. The guard
   * now resolves the target itself, so an omission is no longer unsafe, and this
   * keeps every call site saying out loud which database it is about to write.
   */
  it('makes every apply path name the database it would write', () => {
    expect(
      calls.filter((call) => !call.namesTarget).map((call) => call.location),
      'Pass mongoUrl: process.env.MONGODBURL so the target this apply would write is explicit.',
    ).toEqual([]);
  });

  /**
   * The remaining way to reach a production database unchecked: hand the guard a
   * stub `env` holding no `MONGODBURL` while the script connects through the real
   * `process.env`. Supplying both, or neither, leaves the guard able to resolve
   * the same target the connection uses.
   */
  it('never overrides the environment while leaving the target unresolved', () => {
    expect(
      calls
        .filter((call) => call.overridesEnvironment && !call.namesTarget)
        .map((call) => call.location),
      'Pass mongoUrl alongside the env override, or drop the override.',
    ).toEqual([]);
  });

  it('refuses a production target that only the environment names', () => {
    expect(() =>
      assertScriptApplyAllowed({
        apply: true,
        scriptName: 'fixture-script',
        env: { MONGODBURL: PRODUCTION_URL },
      }),
    ).toThrow('target looks like production');
  });
});

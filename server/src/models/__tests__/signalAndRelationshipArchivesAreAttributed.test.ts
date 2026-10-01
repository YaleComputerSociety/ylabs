import fs from 'node:fs';
import path from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const SERVER_SRC = path.resolve(__dirname, '../..');
const UPDATE_METHODS = new Set([
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
  'findByIdAndUpdate',
]);
const ATTRIBUTED_MODEL_RECEIVERS = new Set([
  'Signal',
  'ResearchEntityRelationship',
  'relationshipModel',
]);
const ATTRIBUTED_COLLECTIONS = new Set(['signals', 'research_entity_relationships']);

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

const receiverIsAttributedTarget = (receiver: ts.Expression): boolean => {
  if (ts.isIdentifier(receiver)) return ATTRIBUTED_MODEL_RECEIVERS.has(receiver.text);
  if (
    ts.isCallExpression(receiver) &&
    ts.isPropertyAccessExpression(receiver.expression) &&
    receiver.expression.name.text === 'collection'
  ) {
    const name = receiver.arguments[0];
    return !!name && ts.isStringLiteral(name) && ATTRIBUTED_COLLECTIONS.has(name.text);
  }
  return false;
};

const propertyNamed = (
  literal: ts.ObjectLiteralExpression,
  name: string,
): ts.PropertyAssignment | undefined =>
  literal.properties.find(
    (property): property is ts.PropertyAssignment =>
      ts.isPropertyAssignment(property) &&
      (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) &&
      property.name.text === name,
  );

function unattributedArchiveSites(fileName: string, text: string): string[] {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  const sites: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      UPDATE_METHODS.has(node.expression.name.text) &&
      receiverIsAttributedTarget(node.expression.expression)
    ) {
      const update = node.arguments[1];
      const set =
        update && ts.isObjectLiteralExpression(update) ? propertyNamed(update, '$set') : undefined;
      if (set && ts.isObjectLiteralExpression(set.initializer)) {
        const archived = propertyNamed(set.initializer, 'archived');
        const reason = propertyNamed(set.initializer, 'archivedReason');
        if (archived?.initializer.kind === ts.SyntaxKind.TrueKeyword && !reason) {
          const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
          sites.push(`${fileName}:${line + 1}`);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return sites;
}

describe('every raw or model archive of a signal or a relationship edge names its reason (#3935)', () => {
  it('finds no update that archives a signal or an edge without an archivedReason', () => {
    const sites = sourceFiles(SERVER_SRC).flatMap((file) =>
      unattributedArchiveSites(path.relative(SERVER_SRC, file), fs.readFileSync(file, 'utf8')),
    );
    expect(sites).toEqual([]);
  });

  it('flags a model write and a raw collection write that archive with no reason', () => {
    const flagged = unattributedArchiveSites(
      'probe.ts',
      [
        'await Signal.updateMany({}, { $set: { archived: true } });',
        "await db.collection('research_entity_relationships').updateOne({}, { $set: { archived: true, updatedAt: now } });",
        'await ResearchEntityRelationship.updateMany({}, { $set: attributedArchiveSet(REASON) });',
        "await db.collection('signals').updateMany({}, { $set: { archived: true, archivedReason: REASON } });",
        "await db.collection('role_assignments').updateMany({}, { $set: { archived: true } });",
        'await Signal.updateMany({}, { $set: { archived: false } });',
      ].join('\n'),
    );
    expect(flagged).toEqual(['probe.ts:1', 'probe.ts:2']);
  });
});

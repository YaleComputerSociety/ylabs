import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * The `ResearchEntity` model refuses a `fieldProvenance` entry that names no observation
 * (#3769), and a raw `collection` handle skips every Mongoose hook, so a raw write to
 * `research_entities` is the one path that can still author one (#3788).
 *
 * This finds raw writes by call shape rather than by source text: a write method called on
 * a model's `collection`, on the result of a `collection(name)` call, or on a local, loop,
 * callback, destructured or imported binding to either, plus `$out`/`$merge` pipeline
 * stages. It then resolves which collection the handle names and which keys the written
 * document sets, following local and imported builders. A site that reaches
 * `research_entities`, or whose collection it cannot resolve, must be listed below with the
 * reason it stays raw; no raw site may author a whole provenance entry or its `sourceName`;
 * and a site whose written key it cannot resolve is counted as a reviewed exception. Run
 * against `beta` on 2026-09-27, before the duplicate citation-mirror script was deleted, it
 * found the same 49 raw driver calls a type-aware pass over the whole server program found.
 */
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER_SRC = path.resolve(HERE, '../..');

const RESEARCH_ENTITIES = 'research_entities';
const RESEARCH_ENTITY_MODEL = 'ResearchEntity';
const UNRESOLVED = '<unresolved>';

const WRITTEN_ARGUMENT_BY_METHOD = new Map<string, number | null>([
  ['insertOne', 0],
  ['insertMany', 0],
  ['updateOne', 1],
  ['updateMany', 1],
  ['replaceOne', 1],
  ['bulkWrite', 0],
  ['findOneAndUpdate', 1],
  ['findOneAndReplace', 1],
  ['rename', null],
]);
const NON_AUTHORING_PROPERTIES = new Set(['filter', '$unset', '$pull', '$pullAll']);
const STORED_DOCUMENT_READS = new Set(['find', 'findOne', 'findById', 'aggregate', 'distinct']);
const WRITING_STAGES = new Set(['$out', '$merge']);

/**
 * Each file that may write `research_entities` through a raw handle, the exact number of
 * such sites it holds, and why the write cannot go through the model. A new site in a
 * listed file changes its count, so it is reviewed here like a new file would be.
 * `unresolvedKeySites` counts the sites whose written key comes from a caller, which the
 * reason must vouch never names a provenance entry.
 */
const REVIEWED_RAW_RESEARCH_ENTITY_WRITERS: Record<
  string,
  { sites: number; unresolvedKeySites?: number; reason: string }
> = {
  'scripts/dedupeResearchEntitiesByPi.ts': {
    sites: 6,
    unresolvedKeySites: 2,
    reason:
      'archives duplicates and relinks references across every collection in its reference specs by name, so one writer serves many collections; it relinks ids and archives, and authors no provenance entry',
  },
  'scripts/migrateMongoNaming.ts': {
    sites: 2,
    reason:
      'renames and merges whole collections by name, a schema migration below the model that copies stored documents unchanged',
  },
  'scripts/migrateResearchEntities.ts': {
    sites: 1,
    reason:
      'upserts each legacy document into the canonical collection as normalized, a migration that must write fields the current schema no longer declares',
  },
  'scripts/migrateResearchEntityCollections.ts': {
    sites: 1,
    reason:
      'copies stored documents between collections by name, a migration that preserves each document as stored',
  },
  'scripts/promoteAcceptedBetaCopy.ts': {
    sites: 2,
    reason:
      'copies whole collections from the accepted Beta copy into staging, so every document is one the model already accepted',
  },
  'scripts/repairGluedSentenceBoundaries.ts': {
    sites: 1,
    reason:
      'rewrites text fields across several collections in one bulk pass by name; it sets text values only and authors no provenance entry',
  },
  'scripts/repairInvisibleFormatCharacters.ts': {
    sites: 1,
    reason:
      'rewrites text fields across several collections in one bulk pass by name; it sets text values only and authors no provenance entry',
  },
  'scripts/repairOrphanedObservationReferences.ts': {
    sites: 5,
    unresolvedKeySites: 1,
    reason:
      'relinks a missing observation id to its deterministic replacement in whichever owner collection holds the reference, so it writes an id into an entry and never authors one',
  },
  'scripts/retireBibliographicMirror.ts': {
    sites: 1,
    reason:
      'unsets fields retired from the schema, which strict mode would silently drop from a model update',
  },
  'scripts/retireDocumentedWayInField.ts': {
    sites: 1,
    reason:
      'unsets fields retired from the schema, which strict mode would silently drop from a model update',
  },
  'scripts/retireStaleAccessSignalFields.ts': {
    sites: 1,
    reason:
      'unsets fields retired from the schema, which strict mode would silently drop from a model update',
  },
  'scripts/retireUndergraduateLogisticsFields.ts': {
    sites: 1,
    reason:
      'unsets fields retired from the schema, which strict mode would silently drop from a model update',
  },
  'scripts/stagedCollectionSwap.ts': {
    sites: 5,
    reason:
      'swaps a staged collection into place by rename, so the documents it installs are copies the model already accepted',
  },
  'scripts/syncBetaToDevelopment.ts': {
    sites: 2,
    reason:
      'copies whole collections from Beta into Development, so every document is one the model already accepted',
  },
};

export interface RawWriteSite {
  file: string;
  line: number;
  method: string;
  collections: string[];
  authoredProvenanceKeys: string[];
}

type Binding =
  | { kind: 'value'; initializer: ts.Expression }
  | { kind: 'loop'; iterable: ts.Expression }
  | { kind: 'destructured'; source: ts.Expression; property: string }
  | { kind: 'parameter'; typeText: string; receiver: ts.Expression | null }
  | { kind: 'import'; importedName: string; specifier: string }
  | { kind: 'function'; returns: ts.Expression[] };

type ScopedBinding = Binding & { scope: ts.Node };

interface FieldWrite {
  site: ts.Identifier;
  key?: string | ts.Expression;
  value: ts.Expression;
}

export type ReadModule = (
  fromFile: string,
  specifier: string,
) => { fileName: string; source: string } | null;

interface ModuleAnalysis {
  sites: () => RawWriteSite[];
  handlesOf: (
    name: string,
    site: ts.Node | null,
    depth: number,
    called: boolean,
  ) => Set<string> | null;
  keysOf: (name: string, site: ts.Node | null, seen: Set<unknown>, keys: string[]) => void;
}

const MAX_DEPTH = 8;
const ANY_KEY = '*';

function unwrap(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isAwaitExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function returnedExpressions(body: ts.ConciseBody | undefined): ts.Expression[] {
  if (!body) return [];
  if (!ts.isBlock(body)) return [body];
  const returns: ts.Expression[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionLike(node) && node !== body.parent) return;
    if (ts.isReturnStatement(node) && node.expression) returns.push(node.expression);
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(body, visit);
  return returns;
}

function propertyNameText(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) return name.text;
  return null;
}

function enclosingScope(node: ts.Node): ts.Node {
  let current = node.parent;
  while (
    current &&
    !ts.isSourceFile(current) &&
    !ts.isBlock(current) &&
    !ts.isForStatement(current) &&
    !ts.isForOfStatement(current) &&
    !ts.isForInStatement(current) &&
    !ts.isCaseBlock(current) &&
    !ts.isCatchClause(current) &&
    !ts.isFunctionLike(current)
  ) {
    current = current.parent;
  }
  return current ?? node.getSourceFile();
}

function contains(scope: ts.Node, site: ts.Node): boolean {
  for (let current: ts.Node | undefined = site; current; current = current.parent) {
    if (current === scope) return true;
  }
  return false;
}

function scopeDepth(scope: ts.Node): number {
  let depth = 0;
  for (let current = scope.parent; current; current = current.parent) depth += 1;
  return depth;
}

function isProjectModule(specifier: string): boolean {
  return specifier.startsWith('.');
}

function accessRoot(expression: ts.Expression): ts.Identifier | null {
  let node = unwrap(expression);
  while (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
    node = unwrap(node.expression);
  }
  return ts.isIdentifier(node) ? node : null;
}

function callbackReceiver(fn: ts.Node): ts.Expression | null {
  if (!ts.isArrowFunction(fn) && !ts.isFunctionExpression(fn)) return null;
  const call = fn.parent;
  return ts.isCallExpression(call) &&
    call.arguments.includes(fn) &&
    ts.isPropertyAccessExpression(call.expression)
    ? call.expression.expression
    : null;
}

function mentionsRawHandle(node: ts.Node): boolean {
  if (ts.isPropertyAccessExpression(node) && node.name.text === 'collection') return true;
  return ts.forEachChild(node, mentionsRawHandle) ?? false;
}

function union(sets: (Set<string> | null)[]): Set<string> | null {
  const present = sets.filter((names): names is Set<string> => names !== null);
  return present.length > 0 ? new Set(present.flatMap((names) => [...names])) : null;
}

function mayAuthorProvenanceEntry(pattern: string): boolean {
  const pieces = pattern.split(ANY_KEY);
  const matcher = new RegExp(
    `^${pieces.map((piece) => piece.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`,
  );
  const fields = [
    'field',
    ...pieces.join('').split('.'),
    ...pieces.flatMap((piece) => piece.split('.')),
  ];
  return fields
    .filter(Boolean)
    .some((field) =>
      ['fieldProvenance', `fieldProvenance.${field}`, `fieldProvenance.${field}.sourceName`].some(
        (key) => matcher.test(key),
      ),
    );
}

function analyzeModule(
  fileName: string,
  source: string,
  moduleFrom: (fromFile: string, specifier: string) => ModuleAnalysis | null,
): ModuleAnalysis {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const bindings = new Map<string, ScopedBinding[]>();
  const fieldWrites = new Map<string, FieldWrite[]>();
  const propertyValues = new Map<string, ts.Expression[]>();

  const bind = (name: string, declaration: ts.Node, binding: Binding): void => {
    bindings.set(name, [
      ...(bindings.get(name) ?? []),
      { ...binding, scope: enclosingScope(declaration) },
    ]);
  };
  const recordFieldWrite = (target: ts.Expression, write: Omit<FieldWrite, 'site'>): void => {
    const root = accessRoot(target);
    if (root) {
      fieldWrites.set(root.text, [...(fieldWrites.get(root.text) ?? []), { ...write, site: root }]);
    }
  };

  const collect = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      const loop = node.parent?.parent;
      if (loop && ts.isForOfStatement(loop) && loop.initializer === node.parent) {
        bind(node.name.text, node, { kind: 'loop', iterable: loop.expression });
      } else if (
        node.initializer &&
        (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
      ) {
        bind(node.name.text, node, {
          kind: 'function',
          returns: returnedExpressions(node.initializer.body),
        });
      } else if (node.initializer) {
        bind(node.name.text, node, { kind: 'value', initializer: node.initializer });
      }
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isObjectBindingPattern(node.name) &&
      node.initializer
    ) {
      for (const element of node.name.elements) {
        if (!ts.isIdentifier(element.name)) continue;
        const property = element.propertyName
          ? propertyNameText(element.propertyName)
          : element.name.text;
        if (property) {
          bind(element.name.text, node, {
            kind: 'destructured',
            source: node.initializer,
            property,
          });
        }
      }
    }
    if (ts.isFunctionDeclaration(node) && node.name) {
      bind(node.name.text, node, { kind: 'function', returns: returnedExpressions(node.body) });
    }
    if (ts.isParameter(node) && ts.isIdentifier(node.name)) {
      bind(node.name.text, node, {
        kind: 'parameter',
        typeText: node.type?.getText(sourceFile) ?? '',
        receiver: callbackReceiver(node.parent),
      });
    }
    if (ts.isImportSpecifier(node)) {
      const specifier = node.parent.parent.parent.moduleSpecifier;
      bind(node.name.text, node, {
        kind: 'import',
        importedName: (node.propertyName ?? node.name).text,
        specifier: ts.isStringLiteral(specifier) ? specifier.text : '',
      });
    }
    if (ts.isPropertyAssignment(node)) {
      const name = propertyNameText(node.name);
      if (name) propertyValues.set(name, [...(propertyValues.get(name) ?? []), node.initializer]);
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      if (ts.isElementAccessExpression(node.left)) {
        recordFieldWrite(node.left.expression, {
          key: node.left.argumentExpression,
          value: node.right,
        });
      } else if (ts.isPropertyAccessExpression(node.left)) {
        recordFieldWrite(node.left.expression, { key: node.left.name.text, value: node.right });
      }
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      (node.expression.name.text === 'push' || node.expression.name.text === 'unshift')
    ) {
      for (const argument of node.arguments) {
        recordFieldWrite(node.expression.expression, { value: argument });
      }
    }
    ts.forEachChild(node, collect);
  };
  collect(sourceFile);

  const bindingsAt = (name: string, site: ts.Node | null): ScopedBinding[] => {
    const visible = (bindings.get(name) ?? []).filter((binding) =>
      site ? contains(binding.scope, site) : binding.scope === sourceFile,
    );
    const innermost = Math.max(...visible.map((binding) => scopeDepth(binding.scope)));
    return visible.filter((binding) => scopeDepth(binding.scope) === innermost);
  };

  const isResearchEntityModel = (expression: ts.Expression): boolean => {
    const node = unwrap(expression);
    if (!ts.isIdentifier(node)) return false;
    if (node.text === RESEARCH_ENTITY_MODEL) return true;
    return bindingsAt(node.text, node).some(
      (binding) =>
        (binding.kind === 'import' && binding.importedName === RESEARCH_ENTITY_MODEL) ||
        (binding.kind === 'value' && isResearchEntityModel(binding.initializer)),
    );
  };

  const ownerCollectionNames = (owner: ts.Expression): Set<string> => {
    if (isResearchEntityModel(owner)) return new Set([RESEARCH_ENTITIES]);
    const node = unwrap(owner);
    if (ts.isIdentifier(node) && /^[A-Z]/.test(node.text)) return new Set([`model:${node.text}`]);
    return new Set([UNRESOLVED]);
  };

  const objectLiteralsOf = (
    expression: ts.Expression,
    depth: number,
    asElements = false,
  ): ts.ObjectLiteralExpression[] | null => {
    const node = unwrap(expression);
    if (depth > MAX_DEPTH) return null;
    if (!asElements && ts.isObjectLiteralExpression(node)) return [node];
    if (asElements && ts.isArrayLiteralExpression(node)) {
      const objects = node.elements.map((element) => objectLiteralsOf(element, depth + 1));
      return objects.every(Boolean) ? objects.flatMap((object) => object ?? []) : null;
    }
    if (!ts.isIdentifier(node)) return null;
    const found = bindingsAt(node.text, node);
    const objects = found.map((binding) => {
      if (binding.kind === 'value') {
        return objectLiteralsOf(binding.initializer, depth + 1, asElements);
      }
      if (binding.kind === 'loop' && !asElements) {
        return objectLiteralsOf(binding.iterable, depth + 1, true);
      }
      return null;
    });
    return found.length > 0 && objects.every(Boolean)
      ? objects.flatMap((object) => object ?? [])
      : null;
  };

  const propertyValuesOf = (
    owner: ts.Expression,
    property: string,
    depth: number,
  ): (ts.Expression | null)[] | null =>
    objectLiteralsOf(owner, depth)?.map(
      (object) =>
        object.properties.find(
          (candidate): candidate is ts.PropertyAssignment =>
            ts.isPropertyAssignment(candidate) && propertyNameText(candidate.name) === property,
        )?.initializer ?? null,
    ) ?? null;

  const namesOf = (expression: ts.Expression, depth: number): Set<string> => {
    const node = unwrap(expression);
    if (depth > MAX_DEPTH) return new Set([UNRESOLVED]);
    if (ts.isStringLiteralLike(node)) return new Set([node.text]);
    if (ts.isConditionalExpression(node)) {
      return new Set([...namesOf(node.whenTrue, depth + 1), ...namesOf(node.whenFalse, depth + 1)]);
    }
    if (ts.isArrayLiteralExpression(node)) {
      return new Set(
        node.elements.flatMap((element) => [
          ...namesOf(ts.isSpreadElement(element) ? element.expression : element, depth + 1),
        ]),
      );
    }
    if (ts.isIdentifier(node)) {
      const found = bindingsAt(node.text, node);
      if (found.length === 0) return new Set([UNRESOLVED]);
      return new Set(
        found.flatMap((binding) => {
          if (binding.kind === 'value') return [...namesOf(binding.initializer, depth + 1)];
          if (binding.kind === 'loop') return [...namesOf(binding.iterable, depth + 1)];
          return [UNRESOLVED];
        }),
      );
    }
    if (ts.isPropertyAccessExpression(node)) {
      const property = node.name.text;
      if (property === 'collectionName' || property === 'name') {
        const handle = rawHandleNames(node.expression, depth + 1);
        if (handle) return handle;
      }
      const values = propertyValues.get(property) ?? [];
      if (values.length === 0) return new Set([UNRESOLVED]);
      return new Set(values.flatMap((value) => [...namesOf(value, depth + 1)]));
    }
    return new Set([UNRESOLVED]);
  };

  const elementHandleNames = (expression: ts.Expression, depth: number): Set<string> | null => {
    const node = unwrap(expression);
    if (depth > MAX_DEPTH) return null;
    if (ts.isArrayLiteralExpression(node)) {
      return union(
        node.elements.map((element) =>
          ts.isSpreadElement(element)
            ? elementHandleNames(element.expression, depth + 1)
            : rawHandleNames(element, depth + 1),
        ),
      );
    }
    if (ts.isIdentifier(node)) {
      return union(
        bindingsAt(node.text, node).map((binding) =>
          binding.kind === 'value' ? elementHandleNames(binding.initializer, depth + 1) : null,
        ),
      );
    }
    return mentionsRawHandle(node) ? new Set([UNRESOLVED]) : null;
  };

  const handlesOf = (
    name: string,
    site: ts.Node | null,
    depth: number,
    called: boolean,
  ): Set<string> | null =>
    union(
      bindingsAt(name, site).map((binding) => {
        if (binding.kind === 'function') {
          return called
            ? union(binding.returns.map((returned) => rawHandleNames(returned, depth)))
            : null;
        }
        if (binding.kind === 'import') {
          if (!isProjectModule(binding.specifier)) return null;
          const other = moduleFrom(fileName, binding.specifier);
          return other
            ? other.handlesOf(binding.importedName, null, depth, called)
            : new Set([UNRESOLVED]);
        }
        if (called) return null;
        if (binding.kind === 'value') return rawHandleNames(binding.initializer, depth);
        if (binding.kind === 'loop') return elementHandleNames(binding.iterable, depth);
        if (binding.kind === 'destructured') {
          return binding.property === 'collection' ? ownerCollectionNames(binding.source) : null;
        }
        if (/\bCollection\b/.test(binding.typeText)) return new Set([UNRESOLVED]);
        return binding.typeText === '' && binding.receiver
          ? elementHandleNames(binding.receiver, depth)
          : null;
      }),
    );

  const rawHandleNames = (expression: ts.Expression, depth: number): Set<string> | null => {
    const node = unwrap(expression);
    if (depth > MAX_DEPTH) return null;
    if (ts.isPropertyAccessExpression(node) && node.name.text === 'collection') {
      return ownerCollectionNames(node.expression);
    }
    if (ts.isCallExpression(node)) {
      const callee = unwrap(node.expression);
      const calleeName = ts.isPropertyAccessExpression(callee)
        ? callee.name.text
        : ts.isIdentifier(callee)
          ? callee.text
          : null;
      if (calleeName === 'collection' && node.arguments.length > 0) {
        return namesOf(node.arguments[0], depth + 1);
      }
      return ts.isIdentifier(callee) ? handlesOf(callee.text, callee, depth + 1, true) : null;
    }
    if (ts.isIdentifier(node)) return handlesOf(node.text, node, depth + 1, false);
    return null;
  };

  const keyPatternsOf = (key: string | ts.Expression, depth: number): string[] => {
    if (typeof key === 'string') return [key];
    const node = unwrap(key);
    if (depth > MAX_DEPTH) return [ANY_KEY];
    if (ts.isStringLiteralLike(node)) return [node.text];
    if (ts.isTemplateExpression(node)) {
      return [
        node.head.text +
          node.templateSpans.map((span) => `${ANY_KEY}${span.literal.text}`).join(''),
      ];
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const rights = keyPatternsOf(node.right, depth + 1);
      return keyPatternsOf(node.left, depth + 1).flatMap((left) =>
        rights.map((right) => left + right),
      );
    }
    if (ts.isIdentifier(node)) {
      const found = bindingsAt(node.text, node);
      if (found.length > 0 && found.every((binding) => binding.kind === 'value')) {
        return found.flatMap((binding) =>
          binding.kind === 'value' ? keyPatternsOf(binding.initializer, depth + 1) : [],
        );
      }
    }
    if (ts.isPropertyAccessExpression(node)) {
      const values = propertyValuesOf(node.expression, node.name.text, depth + 1);
      if (values) {
        return values.flatMap((value) => (value ? keyPatternsOf(value, depth + 1) : [ANY_KEY]));
      }
    }
    return [ANY_KEY];
  };

  const readsStoredDocuments = (node: ts.Node): boolean => {
    if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) {
      return false;
    }
    if (!STORED_DOCUMENT_READS.has(node.expression.name.text)) return false;
    const receiver = node.expression.expression;
    return rawHandleNames(receiver, 0) !== null || !ownerCollectionNames(receiver).has(UNRESOLVED);
  };

  const visitKeys = (node: ts.Node, seen: Set<unknown>, keys: string[]): void => {
    if (readsStoredDocuments(node)) return;
    if (ts.isPropertyAssignment(node)) {
      if (ts.isComputedPropertyName(node.name)) {
        keys.push(...keyPatternsOf(node.name.expression, 0));
      } else {
        const name = propertyNameText(node.name);
        if (name) keys.push(name);
      }
      if (!NON_AUTHORING_PROPERTIES.has(propertyNameText(node.name) ?? '')) {
        visitKeys(node.initializer, seen, keys);
      }
      return;
    }
    if (ts.isShorthandPropertyAssignment(node)) {
      keys.push(node.name.text);
      keysOf(node.name.text, node.name, seen, keys);
      return;
    }
    if (ts.isPropertyAccessExpression(node)) {
      visitKeys(node.expression, seen, keys);
      return;
    }
    if (ts.isIdentifier(node)) {
      keysOf(node.text, node, seen, keys);
      return;
    }
    ts.forEachChild(node, (child) => visitKeys(child, seen, keys));
  };

  const keysOf = (name: string, site: ts.Node | null, seen: Set<unknown>, keys: string[]): void => {
    const found = bindingsAt(name, site);
    const identity = found[0] ?? `${fileName}#${name}`;
    if (seen.has(identity)) return;
    seen.add(identity);
    for (const write of fieldWrites.get(name) ?? []) {
      if ((bindingsAt(name, write.site)[0] ?? `${fileName}#${name}`) !== identity) continue;
      if (write.key !== undefined) keys.push(...keyPatternsOf(write.key, 0));
      visitKeys(write.value, seen, keys);
    }
    for (const binding of found) {
      if (binding.kind === 'value') visitKeys(binding.initializer, seen, keys);
      if (binding.kind === 'function') {
        for (const returned of binding.returns) visitKeys(returned, seen, keys);
      }
      if (binding.kind === 'import' && isProjectModule(binding.specifier)) {
        const other = moduleFrom(fileName, binding.specifier);
        if (other) other.keysOf(binding.importedName, null, seen, keys);
        else keys.push(ANY_KEY);
      }
    }
  };

  const provenanceKeysIn = (args: readonly ts.Expression[]): string[] => {
    const keys: string[] = [];
    const seen = new Set<unknown>();
    for (const argument of args) visitKeys(argument, seen, keys);
    return [...new Set(keys)].filter(mayAuthorProvenanceEntry);
  };

  const sites = (): RawWriteSite[] => {
    const found: RawWriteSite[] = [];
    const record = (
      node: ts.Node,
      method: string,
      collections: Set<string>,
      writtenArgument: ts.Expression | undefined,
    ) => {
      const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      found.push({
        file: fileName,
        line: line + 1,
        method,
        collections: [...collections].sort(),
        authoredProvenanceKeys: writtenArgument ? provenanceKeysIn([writtenArgument]) : [],
      });
    };

    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        WRITTEN_ARGUMENT_BY_METHOD.has(node.expression.name.text)
      ) {
        const method = node.expression.name.text;
        const handle = rawHandleNames(node.expression.expression, 0);
        if (handle) {
          const collections =
            method === 'rename' && node.arguments[0]
              ? new Set([...handle, ...namesOf(node.arguments[0], 0)])
              : handle;
          const written = WRITTEN_ARGUMENT_BY_METHOD.get(method);
          record(
            node,
            method,
            collections,
            typeof written === 'number' ? node.arguments[written] : undefined,
          );
        }
      }
      if (ts.isPropertyAssignment(node)) {
        const stage = propertyNameText(node.name);
        if (stage && WRITING_STAGES.has(stage)) {
          const target = unwrap(node.initializer);
          const into = ts.isObjectLiteralExpression(target)
            ? target.properties.find(
                (property): property is ts.PropertyAssignment =>
                  ts.isPropertyAssignment(property) &&
                  (propertyNameText(property.name) === 'into' ||
                    propertyNameText(property.name) === 'coll'),
              )?.initializer
            : target;
          record(node, stage, into ? namesOf(into, 0) : new Set([UNRESOLVED]), undefined);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return found;
  };

  return { sites, handlesOf, keysOf };
}

export function findRawWriteSites(
  fileName: string,
  source: string,
  readModule: ReadModule = () => null,
): RawWriteSite[] {
  const analyses = new Map<string, ModuleAnalysis>();
  const moduleFrom = (fromFile: string, specifier: string): ModuleAnalysis | null => {
    const found = readModule(fromFile, specifier);
    if (!found) return null;
    const cached = analyses.get(found.fileName);
    if (cached) return cached;
    const analysis = analyzeModule(found.fileName, found.source, moduleFrom);
    analyses.set(found.fileName, analysis);
    return analysis;
  };
  return analyzeModule(fileName, source, moduleFrom).sites();
}

function productionSourceFiles(root: string): string[] {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      return entry.name === '__tests__' || entry.name === 'node_modules'
        ? []
        : productionSourceFiles(full);
    }
    return entry.isFile() &&
      full.endsWith('.ts') &&
      !full.endsWith('.test.ts') &&
      !full.endsWith('.d.ts')
      ? [full]
      : [];
  });
}

function reachesResearchEntities(site: RawWriteSite): boolean {
  return site.collections.includes(RESEARCH_ENTITIES) || site.collections.includes(UNRESOLVED);
}

function corpusName(file: string): string {
  return path.relative(SERVER_SRC, file).split(path.sep).join('/');
}

const readCorpusModule: ReadModule = (fromFile, specifier) => {
  const base = path.resolve(SERVER_SRC, path.dirname(fromFile), specifier.replace(/\.js$/, ''));
  const file = [base, `${base}.ts`, path.join(base, 'index.ts')].find(
    (candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile(),
  );
  return file ? { fileName: corpusName(file), source: fs.readFileSync(file, 'utf8') } : null;
};

function corpusRawWriteSites(): RawWriteSite[] {
  return productionSourceFiles(SERVER_SRC).flatMap((file) =>
    findRawWriteSites(corpusName(file), fs.readFileSync(file, 'utf8'), readCorpusModule),
  );
}

describe('the raw-write detector recognises the call shapes that bypass the model', () => {
  const sitesIn = (source: string) =>
    findRawWriteSites('fixture.ts', source).map((site) => ({
      method: site.method,
      collections: site.collections,
      authoredProvenanceKeys: site.authoredProvenanceKeys,
    }));

  it('finds a write on the model collection handle, including through an alias', () => {
    expect(
      sitesIn(`
        import { ResearchEntity as Entities } from '../models/researchEntity';
        await ResearchEntity.collection.updateOne({}, { $set: { name: 'x' } });
        const handle = Entities.collection;
        await handle.bulkWrite([]);
      `),
    ).toEqual([
      { method: 'updateOne', collections: [RESEARCH_ENTITIES], authoredProvenanceKeys: [] },
      { method: 'bulkWrite', collections: [RESEARCH_ENTITIES], authoredProvenanceKeys: [] },
    ]);
  });

  it('resolves a collection named by a literal, a constant, a model name, or a loop', () => {
    const sites = sitesIn(`
      const COLLECTION = 'research_entities';
      const NAME = ResearchEntity.collection.collectionName;
      const REPAIRED = [NAME, 'observations'];
      await mongoose.connection.db!.collection('research_entities').insertMany([]);
      await db.collection(COLLECTION).updateMany({}, { $unset: { retired: '' } });
      for (const name of REPAIRED) await db.collection(name).bulkWrite([]);
      await db.collection('observations').updateOne({}, {});
    `);
    expect(sites.map((site) => site.collections)).toEqual([
      [RESEARCH_ENTITIES],
      [RESEARCH_ENTITIES],
      ['observations', RESEARCH_ENTITIES],
      ['observations'],
    ]);
  });

  it('reports a collection it cannot resolve rather than assuming it is safe', () => {
    expect(
      sitesIn(`
        async function copy(name: string, target: Collection) {
          await db.collection(name).bulkWrite([]);
          await target.insertOne({});
        }
      `).map((site) => site.collections),
    ).toEqual([[UNRESOLVED], [UNRESOLVED]]);
  });

  it('finds a writing aggregation stage and a rename into the collection', () => {
    expect(
      sitesIn(`
        await Observation.aggregate([{ $merge: { into: 'research_entities' } }]);
        await Staging.aggregate([{ $out: 'staging_copy' }]);
        await db.collection('staged').rename('research_entities');
      `).map((site) => [site.method, site.collections]),
    ).toEqual([
      ['$merge', [RESEARCH_ENTITIES]],
      ['$out', ['staging_copy']],
      ['rename', [RESEARCH_ENTITIES, 'staged']],
    ]);
  });

  it('ignores a write that goes through the model and its hooks', () => {
    expect(
      sitesIn(`
        await ResearchEntity.updateOne({}, { $set: { name: 'x' } }, { strict: false });
        await ResearchEntity.bulkWrite([]);
        await ResearchEntity.collection.find({}).toArray();
      `),
    ).toEqual([]);
  });

  it('reads the provenance keys a raw write authors, whether inline or built up', () => {
    const sites = sitesIn(`
      const set: Record<string, unknown> = {};
      set[\`fieldProvenance.\${field}\`] = entry;
      set[\`fieldProvenance.\${field}.sourceUrl\`] = url;
      await ResearchEntity.collection.updateOne({}, { $set: set });
      await ResearchEntity.collection.updateOne({}, { $set: { 'fieldProvenance.school.sourceName': 'lane' } });
      await ResearchEntity.collection.updateOne({}, { $set: { 'fieldProvenance.school.sourceUrl': 'u' } });
    `);
    expect(sites.map((site) => site.authoredProvenanceKeys)).toEqual([
      ['fieldProvenance.*'],
      ['fieldProvenance.school.sourceName'],
      [],
    ]);
  });

  it('follows the written keys through a local builder, a pushed op, and a nested assignment', () => {
    const sites = sitesIn(`
      function archiveUpdate(now: Date) {
        return { $set: { lastMaterializedAt: now, 'fieldProvenance.school.sourceName': 'lane' } };
      }
      const update = archiveUpdate(new Date());
      await ResearchEntity.collection.updateOne({}, update);
      const ops = [];
      ops.push({
        updateOne: {
          filter: { 'fieldProvenance.school': { $exists: true } },
          update: { $set: { fieldProvenance: {} } },
        },
      });
      await ResearchEntity.collection.bulkWrite(ops);
      const patch = { $set: {} };
      patch.$set['fieldProvenance.school'] = entry;
      await ResearchEntity.collection.updateOne({}, patch);
      const repoint = { $set: {} };
      repoint.$set['fieldProvenance.school.sourceUrl'] = url;
      await ResearchEntity.collection.updateOne({ 'fieldProvenance.school.sourceName': 'lane' }, repoint);
    `);
    expect(sites.map((site) => site.authoredProvenanceKeys)).toEqual([
      ['fieldProvenance.school.sourceName'],
      ['fieldProvenance'],
      ['fieldProvenance.school'],
      [],
    ]);
  });

  it('reports a written key it cannot resolve rather than assuming it is safe', () => {
    const sites = sitesIn(`
      import { buildUpdate } from './updates';
      async function relink(field: string, id: unknown) {
        await ResearchEntity.collection.updateOne({}, { $set: { [field]: id } });
        await ResearchEntity.collection.updateOne({}, { $unset: { [field]: '' } });
      }
      await ResearchEntity.collection.updateOne({}, buildUpdate());
      for (const spec of [{ field: 'canonicalGroupId' }]) {
        await ResearchEntity.collection.updateOne({}, { $set: { [spec.field]: id } });
      }
    `);
    expect(sites.map((site) => site.authoredProvenanceKeys)).toEqual([
      [ANY_KEY],
      [],
      [ANY_KEY],
      [],
    ]);
  });

  it('follows an imported builder or handle into the module that defines it', () => {
    const modules: Record<string, string> = {
      'updates.ts': `export const buildUpdate = () => ({ $set: { 'fieldProvenance.school': {} } });`,
      'handles.ts': `export function entities() { return ResearchEntity.collection; }`,
    };
    const readModule: ReadModule = (_fromFile, specifier) => {
      const fileName = `${specifier.replace('./', '')}.ts`;
      return modules[fileName] ? { fileName, source: modules[fileName] } : null;
    };
    const sites = findRawWriteSites(
      'fixture.ts',
      `
        import { buildUpdate } from './updates';
        import { entities } from './handles';
        await entities().updateOne({}, buildUpdate());
      `,
      readModule,
    );
    expect(sites.map((site) => [site.collections, site.authoredProvenanceKeys])).toEqual([
      [[RESEARCH_ENTITIES], ['fieldProvenance.school']],
    ]);
  });

  it('does not read the schema of a model it only queries as keys a write authors', () => {
    const modules: Record<string, string> = {
      'model.ts': `export const ResearchEntity = model('ResearchEntity', { fieldProvenance: {} });`,
    };
    const readModule: ReadModule = (_fromFile, specifier) => {
      const fileName = `${specifier.replace('./', '')}.ts`;
      return modules[fileName] ? { fileName, source: modules[fileName] } : null;
    };
    const sites = findRawWriteSites(
      'fixture.ts',
      `
        import { ResearchEntity } from './model';
        const rows = await ResearchEntity.find({}).lean();
        const stored = await db.collection('research_entities').findOne({});
        await db.collection('signals').updateOne({}, { $set: { key: rows[0].slug, at: stored.at } });
      `,
      readModule,
    );
    expect(sites.map((site) => site.authoredProvenanceKeys)).toEqual([[]]);
  });

  it('finds a write on a handle held in a loop, a callback, a destructured binding, or an import', () => {
    const sites = sitesIn(`
      import { handleFor } from './handles';
      for (const target of [ResearchEntity.collection, Observation.collection]) {
        await target.updateMany({}, {});
      }
      const handles = [ResearchEntity.collection];
      handles.forEach((handle) => handle.bulkWrite([]));
      const { collection } = ResearchEntity;
      await collection.insertOne({});
      await handleFor('x').updateOne({}, {});
      for (const doc of docs) await doc.updateOne({}, {});
    `);
    expect(sites.map((site) => site.collections)).toEqual([
      ['model:Observation', RESEARCH_ENTITIES],
      [RESEARCH_ENTITIES],
      [RESEARCH_ENTITIES],
      [UNRESOLVED],
    ]);
  });
});

describe('a raw write to research_entities is a reviewed exception, never a new default', () => {
  const sites = corpusRawWriteSites();
  const reaching = sites.filter(reachesResearchEntities);

  it('finds the raw writes it is guarding, so it cannot pass over an empty population', () => {
    expect(sites.length).toBeGreaterThan(30);
    expect(reaching.length).toBeGreaterThan(20);
  });

  it('lists every file that writes research_entities through a raw handle, at its exact count', () => {
    const counts = new Map<string, number>();
    for (const site of reaching) counts.set(site.file, (counts.get(site.file) ?? 0) + 1);
    const unreviewed = [...counts]
      .filter(([file, count]) => REVIEWED_RAW_RESEARCH_ENTITY_WRITERS[file]?.sites !== count)
      .map(([file, count]) => ({
        file,
        count,
        lines: reaching.filter((site) => site.file === file).map((site) => site.line),
      }));
    expect(
      unreviewed,
      'Write through the ResearchEntity model so its provenance guard runs. If the write genuinely must stay raw, add the file to REVIEWED_RAW_RESEARCH_ENTITY_WRITERS with its site count and the reason.',
    ).toEqual([]);
  });

  it('keeps the reviewed list exact, so a converted writer leaves it', () => {
    const files = new Set(reaching.map((site) => site.file));
    expect(
      Object.keys(REVIEWED_RAW_RESEARCH_ENTITY_WRITERS).filter((file) => !files.has(file)),
    ).toEqual([]);
  });

  it('gives every reviewed writer a reason', () => {
    expect(
      Object.entries(REVIEWED_RAW_RESEARCH_ENTITY_WRITERS)
        .filter(([, entry]) => entry.reason.trim().length < 40)
        .map(([file]) => file),
    ).toEqual([]);
  });

  it('never authors a whole provenance entry or its source name through a raw handle', () => {
    expect(
      sites
        .filter((site) => site.authoredProvenanceKeys.some((key) => !key.startsWith(ANY_KEY)))
        .map((site) => `${site.file}:${site.line} ${site.authoredProvenanceKeys.join(', ')}`),
      'A provenance entry must pass the model guard, which refuses one that names no observation (#3769).',
    ).toEqual([]);
  });

  it('lists every raw write whose written key it cannot resolve, at its exact count', () => {
    const counts = new Map<string, number>();
    for (const site of reaching.filter((candidate) =>
      candidate.authoredProvenanceKeys.some((key) => key.startsWith(ANY_KEY)),
    )) {
      counts.set(site.file, (counts.get(site.file) ?? 0) + 1);
    }
    const reviewed = Object.entries(REVIEWED_RAW_RESEARCH_ENTITY_WRITERS)
      .filter(([, entry]) => entry.unresolvedKeySites !== undefined)
      .map(([file, entry]) => [file, entry.unresolvedKeySites]);
    expect(
      [...counts].sort(),
      'A key the guard cannot resolve could name a provenance entry. Write through the model, or review the site and record its count as unresolvedKeySites.',
    ).toEqual(reviewed.sort());
  });
});

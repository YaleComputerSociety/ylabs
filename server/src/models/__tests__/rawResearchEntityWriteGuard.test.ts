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
 * a model's `collection`, on the result of a `collection(name)` call, or on a local bound
 * to either, plus `$out`/`$merge` pipeline stages. It then resolves which collection the
 * handle names. A site that reaches `research_entities`, or whose collection it cannot
 * resolve, must be listed below with the reason it stays raw, and no raw site may author a
 * whole provenance entry at all. Run against current `beta` on 2026-09-28 it found the same
 * 49 raw write calls a type-aware pass over the whole server program found.
 */
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER_SRC = path.resolve(HERE, '../..');

const RESEARCH_ENTITIES = 'research_entities';
const RESEARCH_ENTITY_MODEL = 'ResearchEntity';
const UNRESOLVED = '<unresolved>';

const WRITE_METHODS = new Set([
  'insertOne',
  'insertMany',
  'updateOne',
  'updateMany',
  'replaceOne',
  'bulkWrite',
  'findOneAndUpdate',
  'findOneAndReplace',
  'rename',
]);
const WRITING_STAGES = new Set(['$out', '$merge']);

/**
 * Each file that may write `research_entities` through a raw handle, the exact number of
 * such sites it holds, and why the write cannot go through the model. A new site in a
 * listed file changes its count, so it is reviewed here like a new file would be.
 */
const REVIEWED_RAW_RESEARCH_ENTITY_WRITERS: Record<string, { sites: number; reason: string }> = {
  'scripts/dedupeResearchEntitiesByPi.ts': {
    sites: 6,
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
  | { kind: 'parameter'; typeText: string }
  | { kind: 'import'; importedName: string }
  | { kind: 'function'; returns: ts.Expression[] };

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

function keyPattern(expression: ts.Expression): string | null {
  const node = unwrap(expression);
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isTemplateExpression(node)) {
    return node.head.text + node.templateSpans.map((span) => `*${span.literal.text}`).join('');
  }
  return null;
}

function authorsProvenanceEntry(key: string): boolean {
  return (
    key === 'fieldProvenance' ||
    /^fieldProvenance\.[^.]+$/.test(key) ||
    /^fieldProvenance\.[^.]+\.sourceName$/.test(key)
  );
}

export function findRawWriteSites(fileName: string, source: string): RawWriteSite[] {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const bindings = new Map<string, Binding[]>();
  const propertyValues = new Map<string, ts.Expression[]>();
  const elementAssignmentKeys = new Map<string, ts.Expression[]>();

  const bind = (name: string, binding: Binding): void => {
    bindings.set(name, [...(bindings.get(name) ?? []), binding]);
  };

  const collect = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      const loop = node.parent?.parent;
      if (loop && ts.isForOfStatement(loop) && loop.initializer === node.parent) {
        bind(node.name.text, { kind: 'loop', iterable: loop.expression });
      } else if (
        node.initializer &&
        (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
      ) {
        bind(node.name.text, {
          kind: 'function',
          returns: returnedExpressions(node.initializer.body),
        });
      } else if (node.initializer) {
        bind(node.name.text, { kind: 'value', initializer: node.initializer });
      }
    }
    if (ts.isFunctionDeclaration(node) && node.name) {
      bind(node.name.text, { kind: 'function', returns: returnedExpressions(node.body) });
    }
    if (ts.isParameter(node) && ts.isIdentifier(node.name)) {
      bind(node.name.text, { kind: 'parameter', typeText: node.type?.getText(sourceFile) ?? '' });
    }
    if (ts.isImportSpecifier(node)) {
      bind(node.name.text, {
        kind: 'import',
        importedName: (node.propertyName ?? node.name).text,
      });
    }
    if (ts.isPropertyAssignment(node)) {
      const name = propertyNameText(node.name);
      if (name) propertyValues.set(name, [...(propertyValues.get(name) ?? []), node.initializer]);
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isElementAccessExpression(node.left) &&
      ts.isIdentifier(node.left.expression)
    ) {
      const target = node.left.expression.text;
      elementAssignmentKeys.set(target, [
        ...(elementAssignmentKeys.get(target) ?? []),
        node.left.argumentExpression,
      ]);
    }
    ts.forEachChild(node, collect);
  };
  collect(sourceFile);

  const isResearchEntityModel = (expression: ts.Expression): boolean => {
    const node = unwrap(expression);
    if (!ts.isIdentifier(node)) return false;
    if (node.text === RESEARCH_ENTITY_MODEL) return true;
    return (bindings.get(node.text) ?? []).some(
      (binding) =>
        (binding.kind === 'import' && binding.importedName === RESEARCH_ENTITY_MODEL) ||
        (binding.kind === 'value' && isResearchEntityModel(binding.initializer)),
    );
  };

  const namesOf = (expression: ts.Expression, depth: number): Set<string> => {
    const node = unwrap(expression);
    if (depth > 8) return new Set([UNRESOLVED]);
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
      const found = bindings.get(node.text) ?? [];
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

  const rawHandleNames = (expression: ts.Expression, depth: number): Set<string> | null => {
    const node = unwrap(expression);
    if (depth > 8) return null;
    if (ts.isPropertyAccessExpression(node) && node.name.text === 'collection') {
      if (isResearchEntityModel(node.expression)) return new Set([RESEARCH_ENTITIES]);
      const owner = unwrap(node.expression);
      if (ts.isIdentifier(owner) && /^[A-Z]/.test(owner.text)) {
        return new Set([`model:${owner.text}`]);
      }
      return new Set([UNRESOLVED]);
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
      if (ts.isIdentifier(callee)) {
        const handles = (bindings.get(callee.text) ?? [])
          .filter((binding) => binding.kind === 'function')
          .flatMap((binding) => binding.returns)
          .map((returned) => rawHandleNames(returned, depth + 1))
          .filter((names): names is Set<string> => names !== null);
        if (handles.length > 0) return new Set(handles.flatMap((names) => [...names]));
      }
      return null;
    }
    if (ts.isIdentifier(node)) {
      const handles: Set<string>[] = [];
      for (const binding of bindings.get(node.text) ?? []) {
        if (binding.kind === 'value') {
          const names = rawHandleNames(binding.initializer, depth + 1);
          if (names) handles.push(names);
        }
        if (binding.kind === 'parameter' && /\bCollection\b/.test(binding.typeText)) {
          handles.push(new Set([UNRESOLVED]));
        }
      }
      return handles.length > 0 ? new Set(handles.flatMap((names) => [...names])) : null;
    }
    return null;
  };

  const provenanceKeysIn = (argument: ts.Expression): string[] => {
    const keys: string[] = [];
    const seen = new Set<string>();
    const visit = (node: ts.Node): void => {
      if (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) {
        const name =
          ts.isPropertyAssignment(node) && ts.isComputedPropertyName(node.name)
            ? keyPattern(node.name.expression)
            : propertyNameText(node.name);
        if (name) keys.push(name);
      }
      if (ts.isIdentifier(node) && !seen.has(node.text)) {
        seen.add(node.text);
        for (const key of elementAssignmentKeys.get(node.text) ?? []) {
          const pattern = keyPattern(key);
          if (pattern) keys.push(pattern);
        }
        for (const binding of bindings.get(node.text) ?? []) {
          if (binding.kind === 'value' && ts.isObjectLiteralExpression(unwrap(binding.initializer)))
            visit(binding.initializer);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(argument);
    return keys.filter(authorsProvenanceEntry);
  };

  const sites: RawWriteSite[] = [];
  const record = (
    node: ts.Node,
    method: string,
    collections: Set<string>,
    args: readonly ts.Expression[],
  ) => {
    const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    sites.push({
      file: fileName,
      line: line + 1,
      method,
      collections: [...collections].sort(),
      authoredProvenanceKeys: args.flatMap(provenanceKeysIn),
    });
  };

  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      WRITE_METHODS.has(node.expression.name.text)
    ) {
      const method = node.expression.name.text;
      const handle = rawHandleNames(node.expression.expression, 0);
      if (handle) {
        const collections =
          method === 'rename' && node.arguments[0]
            ? new Set([...handle, ...namesOf(node.arguments[0], 0)])
            : handle;
        record(node, method, collections, node.arguments);
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
        record(node, stage, into ? namesOf(into, 0) : new Set([UNRESOLVED]), []);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return sites;
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

function corpusRawWriteSites(): RawWriteSite[] {
  return productionSourceFiles(SERVER_SRC).flatMap((file) =>
    findRawWriteSites(
      path.relative(SERVER_SRC, file).split(path.sep).join('/'),
      fs.readFileSync(file, 'utf8'),
    ),
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
      reaching
        .filter((site) => site.authoredProvenanceKeys.length > 0)
        .map((site) => `${site.file}:${site.line} ${site.authoredProvenanceKeys.join(', ')}`),
      'A provenance entry must pass the model guard, which refuses one that names no observation (#3769).',
    ).toEqual([]);
  });
});

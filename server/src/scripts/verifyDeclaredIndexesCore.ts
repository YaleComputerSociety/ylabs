import type mongoose from 'mongoose';
import { declaredIndexName } from '../db/connections';

export interface IndexSpec {
  name: string;
  key: Record<string, unknown>;
  weights?: Record<string, unknown>;
}

export interface CollectionIndexSpecs {
  collection: string;
  models: string[];
  indexes: IndexSpec[];
}

export interface IndexConflict {
  collection: string;
  declared: string;
  live: string;
  reason: 'same name, different keys' | 'same keys, different name';
}

export interface DeclaredIndexVerification {
  checkedCollections: number;
  absentCollections: string[];
  missing: Array<{ collection: string; indexNames: string[] }>;
  conflicts: IndexConflict[];
  extra: Array<{ collection: string; indexNames: string[] }>;
}

const DEFAULT_ID_INDEX_NAME = '_id_';

const LIVE_TEXT_KEY = '_fts';
const LIVE_TEXT_TERM_KEY = '_ftsx';

/** MongoDB stores a declared text index as `_fts`/`_ftsx` plus weights, so both forms reduce to one. */
const keyText = (spec: IndexSpec): string => {
  const entries = Object.entries(spec.key);
  const textFields = entries.some(([path]) => path === LIVE_TEXT_KEY)
    ? Object.keys(spec.weights ?? {})
    : entries.filter(([, direction]) => direction === 'text').map(([path]) => path);
  const canonical: string[][] = [];
  let textPlaced = false;
  for (const [path, direction] of entries) {
    if (path === LIVE_TEXT_TERM_KEY) continue;
    if (path === LIVE_TEXT_KEY || direction === 'text') {
      if (!textPlaced) canonical.push(['text', [...textFields].sort().join(',')]);
      textPlaced = true;
      continue;
    }
    canonical.push([path, String(direction)]);
  }
  return JSON.stringify(canonical);
};

export function declaredIndexSpecsByCollection(
  connection: mongoose.Connection,
): CollectionIndexSpecs[] {
  const byCollection = new Map<string, CollectionIndexSpecs>();
  for (const modelName of connection.modelNames()) {
    const model = connection.model(modelName);
    const entry = byCollection.get(model.collection.name) ?? {
      collection: model.collection.name,
      models: [],
      indexes: [],
    };
    entry.models.push(modelName);
    for (const [key, options] of model.schema.indexes()) {
      const name = declaredIndexName(
        key as Record<string, unknown>,
        options as Record<string, unknown>,
      );
      if (name && !entry.indexes.some((spec) => spec.name === name)) {
        entry.indexes.push({ name, key: key as Record<string, unknown> });
      }
    }
    byCollection.set(model.collection.name, entry);
  }
  return [...byCollection.values()]
    .filter((entry) => entry.indexes.length > 0)
    .sort((left, right) => left.collection.localeCompare(right.collection));
}

export function compareCollectionIndexes(
  declared: readonly IndexSpec[],
  live: readonly IndexSpec[],
): {
  missing: string[];
  conflicts: Array<Omit<IndexConflict, 'collection'>>;
  extra: string[];
} {
  const missing: string[] = [];
  const conflicts: Array<Omit<IndexConflict, 'collection'>> = [];
  const matchedLive = new Set<string>();
  for (const spec of declared) {
    const sameName = live.find((index) => index.name === spec.name);
    if (sameName) {
      matchedLive.add(sameName.name);
      if (keyText(sameName) !== keyText(spec)) {
        conflicts.push({
          declared: spec.name,
          live: sameName.name,
          reason: 'same name, different keys',
        });
      }
      continue;
    }
    const sameKeys = live.find((index) => keyText(index) === keyText(spec));
    if (sameKeys) {
      matchedLive.add(sameKeys.name);
      conflicts.push({
        declared: spec.name,
        live: sameKeys.name,
        reason: 'same keys, different name',
      });
      continue;
    }
    missing.push(spec.name);
  }
  const extra = live
    .map((index) => index.name)
    .filter((name) => name !== DEFAULT_ID_INDEX_NAME && !matchedLive.has(name))
    .sort();
  return { missing, conflicts, extra };
}

export async function verifyDeclaredIndexes(
  connection: mongoose.Connection,
): Promise<DeclaredIndexVerification> {
  const db = connection.db;
  if (!db) throw new Error('the target connection has no database');
  const live = new Set(
    (await db.listCollections({}, { nameOnly: true }).toArray()).map((entry) => entry.name),
  );
  const result: DeclaredIndexVerification = {
    checkedCollections: 0,
    absentCollections: [],
    missing: [],
    conflicts: [],
    extra: [],
  };
  for (const declared of declaredIndexSpecsByCollection(connection)) {
    if (!live.has(declared.collection)) {
      result.absentCollections.push(declared.collection);
      continue;
    }
    result.checkedCollections += 1;
    const liveIndexes = (await db.collection(declared.collection).indexes()).map((index) => ({
      name: index.name ?? '',
      key: index.key as Record<string, unknown>,
      weights: index.weights as Record<string, unknown> | undefined,
    }));
    const comparison = compareCollectionIndexes(declared.indexes, liveIndexes);
    if (comparison.missing.length > 0) {
      result.missing.push({ collection: declared.collection, indexNames: comparison.missing });
    }
    for (const conflict of comparison.conflicts) {
      result.conflicts.push({ collection: declared.collection, ...conflict });
    }
    if (comparison.extra.length > 0) {
      result.extra.push({ collection: declared.collection, indexNames: comparison.extra });
    }
  }
  return result;
}

export type IndexCheckTarget = 'production' | 'beta';

export const TARGET_URL_ENV: Record<IndexCheckTarget, string> = {
  production: 'PRODUCTION_MONGODBURL',
  beta: 'BETA_MONGODBURL',
};

/** Names the URL by its variable, never its value, so the printed command carries no credential. */
export function buildIndexesCommand(target: IndexCheckTarget): string {
  const urlVariable = TARGET_URL_ENV[target];
  const guard = target === 'production' ? 'SCRAPER_ENV=production CONFIRM_PROD_SCRAPE=true ' : '';
  return `${guard}MONGODBURL="$${urlVariable}" yarn --cwd server db:build-indexes --apply`;
}

export function formatDeclaredIndexVerification(
  target: IndexCheckTarget,
  databaseName: string,
  result: DeclaredIndexVerification,
): { lines: string[]; failed: boolean } {
  const lines = [
    `Declared-index check on ${target} (${databaseName}): ${result.checkedCollections} collection(s) checked, ${result.absentCollections.length} absent and skipped.`,
  ];
  for (const entry of result.missing) {
    lines.push(`MISSING ${entry.collection}: ${entry.indexNames.join(', ')}`);
  }
  for (const conflict of result.conflicts) {
    lines.push(
      `CONFLICT ${conflict.collection}: declared ${conflict.declared} vs live ${conflict.live} (${conflict.reason})`,
    );
  }
  for (const entry of result.extra) {
    lines.push(
      `warning: ${entry.collection} carries undeclared index(es): ${entry.indexNames.join(', ')}`,
    );
  }
  const failed = result.missing.length > 0 || result.conflicts.length > 0;
  if (result.missing.length > 0) {
    lines.push(`Build the missing indexes with: ${buildIndexesCommand(target)}`);
  }
  if (result.conflicts.length > 0) {
    lines.push(
      'A conflicting index needs a reviewed migration: db:build-indexes would fail on it and never drops an index.',
    );
  }
  if (!failed) lines.push('Every declared index is present.');
  return { lines, failed };
}

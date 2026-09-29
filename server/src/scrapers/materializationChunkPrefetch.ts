import mongoose from 'mongoose';
import { Observation } from '../models/observation';
import { ResearchEntity } from '../models/researchEntity';
import { loadResearchEntityLeadPersonIds } from '../utils/researchHomeNameIdentityRoster';

export interface MaterializationChunkRow {
  entityType: string;
  entityId?: string;
  entityKey?: string;
}

export interface MaterializationChunkPrefetchInput {
  entityType: string;
  rows: readonly MaterializationChunkRow[];
  readScopeFilter: Record<string, unknown>;
  entityDocs?: {
    model: mongoose.Model<any>;
    keyField: string;
  };
}

export type PrefetchLookup<T> = { hit: true; value: T } | { hit: false };

const MISS = { hit: false } as const;
const hit = <T>(value: T): PrefetchLookup<T> => ({ hit: true, value });

const OBJECT_ID_RE = /^[a-f\d]{24}$/i;

/** `archived` is the corpus's own tombstone marker, and only `true` counts as archived. */
const archivedDocument = (document: unknown): boolean =>
  Boolean(document && (document as { archived?: unknown }).archived === true);

export function prefetchObjectIdString(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return OBJECT_ID_RE.test(trimmed) ? trimmed : undefined;
  }
  if (value instanceof mongoose.Types.ObjectId) return value.toHexString();
  return undefined;
}

const nonEmptyKey = (value: unknown): string | undefined =>
  typeof value === 'string' && value ? value : undefined;

const ENTITY_KEY_INDEX = { entityType: 1, entityKey: 1, field: 1, observedAt: -1 } as const;
const ENTITY_ID_INDEX = { entityType: 1, entityId: 1, field: 1, observedAt: -1 } as const;

const { BSON } = mongoose.mongo;

function cloneDocument<T>(document: T): T {
  if (document === null || document === undefined) return document;
  return BSON.deserialize(BSON.serialize(document as Record<string, unknown>)) as T;
}

function groupBy<T>(items: readonly T[], keyOf: (item: T) => string | undefined): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    if (!key) continue;
    const bucket = grouped.get(key);
    if (bucket) bucket.push(item);
    else grouped.set(key, [item]);
  }
  return grouped;
}

/**
 * The reads `materializeEntity` will accept from somewhere other than the live
 * collections. Named as an interface rather than left as the prefetch class's shape
 * because a second implementation answers from a frozen benchmark instead of from a
 * chunk of the corpus (#3589), and the two differ on what a miss means: a chunk miss
 * falls through to a live read on purpose, while a benchmark miss is an input the
 * capture failed to freeze and has to be counted.
 */
export interface MaterializationReadSource {
  readonly entityType: string;
  markTouched(...identifiers: unknown[]): void;
  markCreated(): void;
  observationsForKey(entityType: string, entityKey: string): PrefetchLookup<unknown[]>;
  observationsForId(entityType: string, entityId: unknown): PrefetchLookup<unknown[]>;
  entityDocForId(entityType: string, entityId: unknown): PrefetchLookup<unknown | null>;
  entityDocForKey(entityType: string, keyValue: string): PrefetchLookup<unknown | null>;
  /**
   * The LIVE row with this key, or `null` when none is live.
   *
   * Distinct from `entityDocForKey`, which answers "the row with this key, archived or not",
   * because both questions have real callers and they are not interchangeable: six reads in the
   * materializer ask for `archived: { $ne: true }`, and answering them with a tombstone would
   * make the dedupe candidate lookup adopt an archived shell (#3863). A hit carrying `null` means
   * "no live row", which is an answer; a miss means the source cannot say.
   */
  liveEntityDocForKey(entityType: string, keyValue: string): PrefetchLookup<unknown | null>;
  /** The live row with this id, on the same terms as `liveEntityDocForKey`. */
  liveEntityDocForId(entityType: string, entityId: unknown): PrefetchLookup<unknown | null>;
  hasNoMergedInRows(survivorId: unknown): boolean;
  soleLeadPersonId(entityId: unknown): PrefetchLookup<string>;
}

/**
 * One chunk's worth of the reads `materializeEntity` would otherwise make row by row.
 *
 * Every answer is the same query the row makes, run once for the chunk, and each
 * observation read carries the index hint of the per-row query's plan so a row's
 * observations arrive in the same order: the resolver breaks an exact weight tie by
 * array order. Documents are cloned on the way out because two rows can share an
 * observation and the per-row path never hands the same object to two rows.
 *
 * A write run changes what later rows would read, so a row reports what it is about
 * to write through `markTouched`/`markCreated` and every answer about a touched row,
 * or an absence after any create, becomes a miss and the row reads live (#3568).
 */
export class MaterializationChunkPrefetch implements MaterializationReadSource {
  private readonly observationsByKey = new Map<string, unknown[]>();
  private readonly observationsById = new Map<string, unknown[]>();
  private readonly entityDocsById = new Map<string, unknown | null>();
  private readonly entityDocsByKey = new Map<string, unknown | null>();
  private readonly entityIdsWithoutMergedInRows = new Set<string>();
  private readonly soleLeadPersonIdByEntityId = new Map<string, string>();
  private readonly touchedIds = new Set<string>();
  private readonly touchedKeys = new Set<string>();
  private createdInChunk = false;

  constructor(readonly entityType: string) {}

  markTouched(...identifiers: unknown[]): void {
    for (const identifier of identifiers) {
      const id = prefetchObjectIdString(identifier);
      if (id) this.touchedIds.add(id);
      const key = nonEmptyKey(identifier);
      if (key) this.touchedKeys.add(key);
    }
  }

  markCreated(): void {
    this.createdInChunk = true;
  }

  private isTouched(id: string | undefined, key?: string): boolean {
    return Boolean((id && this.touchedIds.has(id)) || (key && this.touchedKeys.has(key)));
  }

  observationsForKey(entityType: string, entityKey: string): PrefetchLookup<unknown[]> {
    if (entityType !== this.entityType || this.isTouched(undefined, entityKey)) return MISS;
    const found = this.observationsByKey.get(entityKey);
    return found ? hit(found.map(cloneDocument)) : MISS;
  }

  observationsForId(entityType: string, entityId: unknown): PrefetchLookup<unknown[]> {
    const id = prefetchObjectIdString(entityId);
    if (!id || entityType !== this.entityType || this.isTouched(id)) return MISS;
    const found = this.observationsById.get(id);
    return found ? hit(found.map(cloneDocument)) : MISS;
  }

  entityDocForId(entityType: string, entityId: unknown): PrefetchLookup<unknown | null> {
    const id = prefetchObjectIdString(entityId);
    if (!id || entityType !== this.entityType || this.isTouched(id)) return MISS;
    if (!this.entityDocsById.has(id)) return MISS;
    const doc = this.entityDocsById.get(id) ?? null;
    if (!doc && this.createdInChunk) return MISS;
    return hit(cloneDocument(doc));
  }

  /**
   * Answered from the same loaded document as `entityDocForKey`, filtered here rather than in the
   * query, because one load has to serve both questions: a caller that wants the tombstone and a
   * caller that wants only a live row.
   */
  liveEntityDocForKey(entityType: string, keyValue: string): PrefetchLookup<unknown | null> {
    const found = this.entityDocForKey(entityType, keyValue);
    if (!found.hit) return MISS;
    return hit(archivedDocument(found.value) ? null : found.value);
  }

  liveEntityDocForId(entityType: string, entityId: unknown): PrefetchLookup<unknown | null> {
    const found = this.entityDocForId(entityType, entityId);
    if (!found.hit) return MISS;
    return hit(archivedDocument(found.value) ? null : found.value);
  }

  entityDocForKey(entityType: string, keyValue: string): PrefetchLookup<unknown | null> {
    if (entityType !== this.entityType || this.isTouched(undefined, keyValue)) return MISS;
    if (!this.entityDocsByKey.has(keyValue)) return MISS;
    const doc = this.entityDocsByKey.get(keyValue) ?? null;
    if (!doc && this.createdInChunk) return MISS;
    if (doc && this.isTouched(prefetchObjectIdString((doc as { _id?: unknown })._id))) return MISS;
    return hit(cloneDocument(doc));
  }

  hasNoMergedInRows(survivorId: unknown): boolean {
    const id = prefetchObjectIdString(survivorId);
    return Boolean(id && !this.isTouched(id) && this.entityIdsWithoutMergedInRows.has(id));
  }

  soleLeadPersonId(entityId: unknown): PrefetchLookup<string> {
    const id = prefetchObjectIdString(entityId);
    if (!id || this.isTouched(id) || !this.soleLeadPersonIdByEntityId.has(id)) return MISS;
    return hit(this.soleLeadPersonIdByEntityId.get(id) as string);
  }

  private async loadObservations(
    readScopeFilter: Record<string, unknown>,
    keys: Iterable<string>,
    ids: Iterable<string>,
  ): Promise<void> {
    const wantedKeys = [...new Set(keys)].filter((key) => !this.observationsByKey.has(key));
    const wantedIds = [...new Set(ids)].filter((id) => !this.observationsById.has(id));
    const [byKey, byId] = await Promise.all([
      wantedKeys.length > 0
        ? Observation.find({
            entityType: this.entityType,
            ...readScopeFilter,
            entityKey: { $in: wantedKeys },
          })
            .hint(ENTITY_KEY_INDEX)
            .lean()
        : Promise.resolve([]),
      wantedIds.length > 0
        ? Observation.find({
            entityType: this.entityType,
            ...readScopeFilter,
            entityId: { $in: wantedIds.map((id) => new mongoose.Types.ObjectId(id)) },
          })
            .hint(ENTITY_ID_INDEX)
            .lean()
        : Promise.resolve([]),
    ]);
    const groupedByKey = groupBy(byKey as Array<{ entityKey?: unknown }>, (o) =>
      nonEmptyKey(o.entityKey),
    );
    for (const key of wantedKeys) this.observationsByKey.set(key, groupedByKey.get(key) ?? []);
    const groupedById = groupBy(byId as Array<{ entityId?: unknown }>, (o) =>
      prefetchObjectIdString(o.entityId),
    );
    for (const id of wantedIds) this.observationsById.set(id, groupedById.get(id) ?? []);
  }

  static async load(
    input: MaterializationChunkPrefetchInput,
  ): Promise<MaterializationChunkPrefetch> {
    const prefetch = new MaterializationChunkPrefetch(input.entityType);
    const rowIds: string[] = [];
    const rowKeys: string[] = [];
    const keyScopeKeys: string[] = [];
    for (const row of input.rows) {
      const id = row.entityId ? prefetchObjectIdString(row.entityId) : undefined;
      if (row.entityId) {
        if (id) rowIds.push(id);
        if (row.entityKey) keyScopeKeys.push(row.entityKey);
      } else if (row.entityKey) {
        rowKeys.push(row.entityKey);
      }
    }
    await prefetch.loadObservations(input.readScopeFilter, [...rowKeys, ...keyScopeKeys], rowIds);
    if (!input.entityDocs) return prefetch;

    const { model, keyField } = input.entityDocs;
    const [docsById, docsByKey] = await Promise.all([
      rowIds.length > 0
        ? model.find({ _id: { $in: rowIds.map((id) => new mongoose.Types.ObjectId(id)) } }).lean()
        : Promise.resolve([]),
      rowKeys.length > 0
        ? model.find({ [keyField]: { $in: rowKeys } }).lean()
        : Promise.resolve([]),
    ]);
    const idIndex = new Map(
      (docsById as Array<{ _id?: unknown }>).map((doc) => [prefetchObjectIdString(doc._id), doc]),
    );
    for (const id of rowIds) prefetch.entityDocsById.set(id, idIndex.get(id) ?? null);
    const keyIndex = new Map(
      (docsByKey as Array<Record<string, unknown>>).map((doc) => [nonEmptyKey(doc[keyField]), doc]),
    );
    for (const key of rowKeys) prefetch.entityDocsByKey.set(key, keyIndex.get(key) ?? null);

    const resolvedDocs = [...idIndex.values(), ...keyIndex.values()] as Array<
      Record<string, unknown>
    >;
    const resolvedIds = [
      ...new Set(
        resolvedDocs
          .map((doc) => prefetchObjectIdString(doc._id))
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const resolvedSlugs = resolvedDocs
      .map((doc) => nonEmptyKey(doc.slug))
      .filter((slug): slug is string => Boolean(slug));
    if (resolvedIds.length === 0) return prefetch;

    const [, mergedInRows, leadPersonIds] = await Promise.all([
      prefetch.loadObservations(input.readScopeFilter, resolvedSlugs, resolvedIds),
      ResearchEntity.find({
        canonicalGroupId: { $in: resolvedIds.map((id) => new mongoose.Types.ObjectId(id)) },
        archived: true,
      })
        .select('canonicalGroupId')
        .lean(),
      loadResearchEntityLeadPersonIds(resolvedIds),
    ]);
    const survivorsWithMergedInRows = new Set(
      (mergedInRows as Array<{ canonicalGroupId?: unknown }>).map((row) =>
        prefetchObjectIdString(row.canonicalGroupId),
      ),
    );
    for (const id of resolvedIds) {
      if (!survivorsWithMergedInRows.has(id)) prefetch.entityIdsWithoutMergedInRows.add(id);
    }
    for (const [id, personIds] of leadPersonIds) {
      if (new Set(personIds).size <= 1) {
        prefetch.soleLeadPersonIdByEntityId.set(id, personIds[0] ?? '');
      }
    }
    return prefetch;
  }
}

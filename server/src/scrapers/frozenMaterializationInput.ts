import mongoose from 'mongoose';
import {
  prefetchObjectIdString,
  type MaterializationReadSource,
  type PrefetchLookup,
} from './materializationChunkPrefetch';

export interface FrozenEntityInput {
  entityKey?: string;
  entityId?: string;
  entityDoc: Record<string, unknown> | null;
  observations: unknown[];
  hasMergedInRows: boolean;
  soleLeadPersonId?: string;
}

export interface FrozenInputMiss {
  read: string;
  identifier: string;
}

const MISS = { hit: false } as const;
const hit = <T>(value: T): PrefetchLookup<T> => ({ hit: true, value });

const { BSON } = mongoose.mongo;

const cloneDocument = <T>(document: T): T =>
  document === null || document === undefined
    ? document
    : (BSON.deserialize(BSON.serialize(document as Record<string, unknown>)) as T);

const isArchivedDocument = (document: unknown): boolean =>
  Boolean(document && (document as { archived?: unknown }).archived === true);

const identifierText = (value: unknown): string => (value == null ? '' : String(value));

/**
 * A benchmark's frozen answers to every read `materializeEntity` will take from
 * somewhere other than the live collections (#3589).
 *
 * The difference from `MaterializationChunkPrefetch` is what a miss means. A chunk
 * miss is a cache miss and falling through to a live read is correct there. A
 * benchmark miss means the engine is about to read a value the capture did not
 * freeze, so the replay is no longer a measurement of code alone: the answer could
 * move because the corpus moved. Every miss is recorded here and surfaces as
 * `rowsWithIncompleteInput`, because a replay that silently read live data would
 * report a fingerprint change as a code regression.
 *
 * `markTouched` and `markCreated` are accepted and ignored: a replay writes nothing,
 * so no later row's frozen input can have been invalidated by an earlier one.
 */
export class FrozenMaterializationInput implements MaterializationReadSource {
  private readonly byKey = new Map<string, FrozenEntityInput>();
  private readonly byId = new Map<string, FrozenEntityInput>();
  private readonly misses: FrozenInputMiss[] = [];

  constructor(
    readonly entityType: string,
    rows: readonly FrozenEntityInput[],
  ) {
    for (const row of rows) {
      if (row.entityKey) this.byKey.set(row.entityKey, row);
      const id = row.entityId ? prefetchObjectIdString(row.entityId) : undefined;
      if (id) this.byId.set(id, row);
      const docId = prefetchObjectIdString((row.entityDoc as { _id?: unknown } | null)?._id);
      if (docId) this.byId.set(docId, row);
    }
  }

  recordedMisses(): FrozenInputMiss[] {
    return [...this.misses];
  }

  private miss<T>(read: string, identifier: unknown): PrefetchLookup<T> {
    this.misses.push({ read, identifier: identifierText(identifier) });
    return MISS;
  }

  markTouched(): void {}

  markCreated(): void {}

  observationsForKey(entityType: string, entityKey: string): PrefetchLookup<unknown[]> {
    if (entityType !== this.entityType) return this.miss('observationsForKey', entityKey);
    const row = this.byKey.get(entityKey);
    if (!row) return this.miss('observationsForKey', entityKey);
    return hit(row.observations.map(cloneDocument));
  }

  observationsForId(entityType: string, entityId: unknown): PrefetchLookup<unknown[]> {
    const id = prefetchObjectIdString(entityId);
    if (entityType !== this.entityType || !id) return this.miss('observationsForId', entityId);
    const row = this.byId.get(id);
    if (!row) return this.miss('observationsForId', entityId);
    return hit(row.observations.map(cloneDocument));
  }

  entityDocForId(entityType: string, entityId: unknown): PrefetchLookup<unknown | null> {
    const id = prefetchObjectIdString(entityId);
    if (entityType !== this.entityType || !id) return this.miss('entityDocForId', entityId);
    const row = this.byId.get(id);
    if (!row) return this.miss('entityDocForId', entityId);
    return hit(cloneDocument(row.entityDoc));
  }

  /** The live row, so a caller asking for one is never handed a tombstone (#3863). */
  liveEntityDocForKey(entityType: string, keyValue: string): PrefetchLookup<unknown | null> {
    const found = this.entityDocForKey(entityType, keyValue);
    if (!found.hit) return MISS;
    return hit(isArchivedDocument(found.value) ? null : found.value);
  }

  liveEntityDocForId(entityType: string, entityId: unknown): PrefetchLookup<unknown | null> {
    const found = this.entityDocForId(entityType, entityId);
    if (!found.hit) return MISS;
    return hit(isArchivedDocument(found.value) ? null : found.value);
  }

  entityDocForKey(entityType: string, keyValue: string): PrefetchLookup<unknown | null> {
    if (entityType !== this.entityType) return this.miss('entityDocForKey', keyValue);
    const row = this.byKey.get(keyValue);
    if (!row) return this.miss('entityDocForKey', keyValue);
    return hit(cloneDocument(row.entityDoc));
  }

  /**
   * Answered from the frozen flag, and a survivor the capture never saw is reported as
   * having merged-in rows: that is the answer that makes the engine read them, so an
   * unfrozen survivor becomes a recorded miss on the observation read rather than a
   * silent "nothing was merged into this row".
   */
  hasNoMergedInRows(survivorId: unknown): boolean {
    const id = prefetchObjectIdString(survivorId);
    const row = id ? this.byId.get(id) : undefined;
    if (!row) {
      this.misses.push({ read: 'hasNoMergedInRows', identifier: identifierText(survivorId) });
      return false;
    }
    return !row.hasMergedInRows;
  }

  soleLeadPersonId(entityId: unknown): PrefetchLookup<string> {
    const id = prefetchObjectIdString(entityId);
    const row = id ? this.byId.get(id) : undefined;
    if (!row || row.soleLeadPersonId === undefined) return this.miss('soleLeadPersonId', entityId);
    return hit(row.soleLeadPersonId);
  }
}

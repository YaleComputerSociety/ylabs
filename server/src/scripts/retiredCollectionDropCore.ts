export const RETIRED_POPULATED_COLLECTIONS = [
  'users',
  'entry_pathways',
  'access_signals',
  'research_entity_members',
  'contact_routes',
  'observation_reference_repair_audits',
] as const;

export type RetiredPopulatedCollection = (typeof RETIRED_POPULATED_COLLECTIONS)[number];

const BSON_MIN_DOCUMENT_BYTES = 5;

export function countBsonDocuments(buffer: Buffer): number {
  let offset = 0;
  let documents = 0;

  while (offset < buffer.length) {
    if (offset + 4 > buffer.length) {
      throw new Error(`BSON stream ends inside a length prefix at byte ${offset}`);
    }
    const declaredBytes = buffer.readInt32LE(offset);
    if (declaredBytes < BSON_MIN_DOCUMENT_BYTES || offset + declaredBytes > buffer.length) {
      throw new Error(
        `BSON document at byte ${offset} declares an impossible length of ${declaredBytes} bytes`,
      );
    }
    if (buffer[offset + declaredBytes - 1] !== 0) {
      throw new Error(`BSON document at byte ${offset} is not null-terminated`);
    }
    offset += declaredBytes;
    documents += 1;
  }

  return documents;
}

export interface RetiredCollectionBackupCheck {
  collection: string;
  liveCount: number;
  backupCount?: number;
  ok: boolean;
  reason?: string;
}

export interface RetiredCollectionBackupEvaluation {
  ok: boolean;
  checks: RetiredCollectionBackupCheck[];
}

export function evaluateRetiredCollectionBackup(input: {
  liveCounts: Record<string, number>;
  backupCounts: Record<string, number | undefined>;
  collections?: readonly string[];
}): RetiredCollectionBackupEvaluation {
  const collections = input.collections || RETIRED_POPULATED_COLLECTIONS;

  const checks = collections.map((collection): RetiredCollectionBackupCheck => {
    const liveCount = input.liveCounts[collection] ?? 0;
    const backupCount = input.backupCounts[collection];

    if (liveCount === 0) {
      return { collection, liveCount, backupCount, ok: true, reason: 'no rows to preserve' };
    }
    if (backupCount === undefined) {
      return {
        collection,
        liveCount,
        ok: false,
        reason: `holds ${liveCount} rows and the backup has no dump for it`,
      };
    }
    if (backupCount !== liveCount) {
      return {
        collection,
        liveCount,
        backupCount,
        ok: false,
        reason: `backup holds ${backupCount} rows against ${liveCount} live`,
      };
    }
    return { collection, liveCount, backupCount, ok: true };
  });

  return { ok: checks.every((check) => check.ok), checks };
}

export function assertRetiredCollectionsAreUnmodelled(input: {
  collections: readonly string[];
  modelledCollections: readonly string[];
}): void {
  const modelled = new Set(input.modelledCollections);
  const declared = input.collections.filter((collection) => modelled.has(collection));
  if (declared.length > 0) {
    throw new Error(
      `Refusing to drop a collection a Mongoose model still declares: ${declared.join(', ')}`,
    );
  }
}

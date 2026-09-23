export const RETIRED_POPULATED_COLLECTIONS = [
  'users',
  'entry_pathways',
  'access_signals',
  'research_entity_members',
  'contact_routes',
  'observation_reference_repair_audits',
  // Retired in #3027. Both re-stored a mapping that now lives on the row itself: a
  // merged shell is kept as an archived `research_entities` row whose slug occupies
  // the unique index and whose `canonicalGroupId` routes re-scraped evidence to the
  // survivor. No code reads either collection on `beta`.
  //
  // Production deploys from `main`, which still carries
  // `researchEntityMergeRedirectService`, so dropping `research_entity_redirects`
  // there before the promotion lands would break merged-slug resolution for
  // students. Drop per environment only once that environment's deployed code no
  // longer reads it.
  'research_entity_redirects',
  'canonical_aliases',
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

// A model file the barrel does not re-export never registers, so a registry
// read through `import '../models'` can be silently partial and report a live
// collection as unmodelled. These are collections whose absence proves the
// registry did not load, rather than proving they have no model.
export const REGISTRY_WITNESS_COLLECTIONS = [
  'research_entities',
  'researchers',
  'role_assignments',
  'observations',
] as const;

export function assertRetiredCollectionsAreUnmodelled(input: {
  collections: readonly string[];
  modelledCollections: readonly string[];
}): void {
  const modelled = new Set(input.modelledCollections);

  const missingWitnesses = REGISTRY_WITNESS_COLLECTIONS.filter((witness) => !modelled.has(witness));
  if (missingWitnesses.length > 0) {
    throw new Error(
      `Refusing to drop anything: the model registry looks partial, so "unmodelled" cannot be trusted. Missing ${missingWitnesses.join(', ')}.`,
    );
  }

  const declared = input.collections.filter((collection) => modelled.has(collection));
  if (declared.length > 0) {
    throw new Error(
      `Refusing to drop a collection a Mongoose model still declares: ${declared.join(', ')}`,
    );
  }
}

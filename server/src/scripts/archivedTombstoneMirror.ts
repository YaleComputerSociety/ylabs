import { ObjectId, type AnyBulkWriteOperation, type Db, type Document } from 'mongodb';
import { planMergedFromDerivation } from '../services/researchEntityMergedFrom';

/**
 * Beta and Production serve pages; they never mint, resolve evidence, or re-scrape, so
 * they hold live research entities only. What a merge leaves a student, an old slug that
 * redirects and a saved plan that follows its lab, is answered by the survivor's
 * `mergedFrom`. Development keeps the full archived rows, because its engine routes
 * re-scraped evidence and refuses re-mints through them (#5148, superseding the slim
 * tombstones of #5208).
 */
export const LIVE_RESEARCH_ENTITY_FILTER: Document = { archived: { $ne: true } };

export interface MergedFromEntryDocument {
  slug: string;
  entityId: ObjectId;
  mergedAt?: Date;
  archivedReason?: string;
}

/**
 * Sets each copied survivor's `mergedFrom` from the tombstones as they stand at copy time,
 * so Beta never receives a list older than the merges it no longer carries the rows for.
 */
export function withMergedFromAtCopyTime(
  mergedFromBySurvivor: ReadonlyMap<string, readonly MergedFromEntryDocument[]>,
): (document: Document) => Document {
  return (document) => {
    const entries = mergedFromBySurvivor.get(String(document._id));
    const copied: Document = { ...document };
    delete copied.mergedFrom;
    return entries && entries.length > 0 ? { ...copied, mergedFrom: [...entries] } : copied;
  };
}

// Derived with no stored lists as input, so every survivor with a live chain is returned
// in full rather than only the ones whose stored list drifted.
export async function mergedFromBySurvivorAtCopyTime(
  db: Db,
): Promise<Map<string, MergedFromEntryDocument[]>> {
  const rows = await db
    .collection('research_entities')
    .find(
      {},
      {
        projection: {
          _id: 1,
          slug: 1,
          archived: 1,
          canonicalGroupId: 1,
          archivedAt: 1,
          archivedReason: 1,
        },
      },
    )
    .toArray();
  const plan = planMergedFromDerivation(
    rows.map((row) => ({
      id: String(row._id),
      slug: typeof row.slug === 'string' ? row.slug : '',
      archived: row.archived === true,
      ...(row.canonicalGroupId ? { canonicalGroupId: String(row.canonicalGroupId) } : {}),
      ...(row.archivedAt instanceof Date ? { archivedAt: row.archivedAt } : {}),
      ...(typeof row.archivedReason === 'string' && row.archivedReason.trim()
        ? { archivedReason: row.archivedReason.trim() }
        : {}),
    })),
  );
  return new Map(
    plan.writes.map((write) => [
      write.survivorId,
      write.mergedFrom.map((entry) => ({
        slug: entry.slug,
        entityId: new ObjectId(entry.entityId),
        ...(entry.mergedAt ? { mergedAt: entry.mergedAt } : {}),
        ...(entry.archivedReason ? { archivedReason: entry.archivedReason } : {}),
      })),
    ]),
  );
}

export async function archivedResearchEntityIds(db: Db): Promise<ObjectId[]> {
  const rows = await db
    .collection('research_entities')
    .find({ archived: true }, { projection: { _id: 1 } })
    .toArray();
  return rows.map((row) => row._id as ObjectId);
}

/**
 * The rows that hang off an archived entity, by collection: the serving environments drop
 * them with the full row, and the Beta-to-Development refresh restores them from
 * Development's own backup.
 */
export function rowsOnArchivedEntitiesFilter(
  collectionName: string,
  archivedIds: readonly ObjectId[],
): Document | null {
  const ids = [...archivedIds];
  if (collectionName === 'signals') return { researchEntityId: { $in: ids } };
  if (collectionName === 'role_assignments') {
    return { 'target.kind': 'RESEARCH_ENTITY', 'target.id': { $in: ids } };
  }
  if (collectionName === 'research_entity_relationships') {
    return {
      $or: [{ sourceResearchEntityId: { $in: ids } }, { targetResearchEntityId: { $in: ids } }],
    };
  }
  return null;
}

export interface MirroredCollection {
  name: string;
  filter?: Document;
  transform?: (document: Document) => Document;
}

const withFilter = (collection: MirroredCollection, filter: Document): Document =>
  collection.filter ? { $and: [collection.filter, filter] } : filter;

/**
 * The Development-to-Beta copy list: archived entities and the rows that hang off them
 * stay in Development, and each survivor carries its `mergedFrom`.
 */
export function withLiveResearchRowsOnly<T extends MirroredCollection>(
  collections: readonly T[],
  archivedIds: readonly ObjectId[],
  mergedFromBySurvivor: ReadonlyMap<string, readonly MergedFromEntryDocument[]>,
): T[] {
  return collections.map((collection) => {
    if (collection.name === 'research_entities') {
      return {
        ...collection,
        filter: withFilter(collection, LIVE_RESEARCH_ENTITY_FILTER),
        transform: withMergedFromAtCopyTime(mergedFromBySurvivor),
      };
    }
    const onArchived = rowsOnArchivedEntitiesFilter(collection.name, archivedIds);
    if (!onArchived) return collection;
    return { ...collection, filter: withFilter(collection, { $nor: [onArchived] }) };
  });
}

export interface DevelopmentArchiveCarryReport {
  archivedRowsRestored: number;
  archivedRowsInserted: number;
  archivedRowsLiveInSource: number;
  dependentRowsInserted: Record<string, number>;
}

const DEPENDENT_COLLECTIONS = ['signals', 'role_assignments', 'research_entity_relationships'];
const BATCH_SIZE = 1000;

async function flush(db: Db, collectionName: string, ops: AnyBulkWriteOperation<Document>[]) {
  if (ops.length === 0) return;
  await db.collection(collectionName).bulkWrite(ops.splice(0, ops.length), { ordered: false });
}

/**
 * Beta holds no archived entities and none of the rows on them, so a Beta-to-
 * Development refresh that simply replaced the collections would erase Development's
 * archive and let every merged duplicate be minted again (#3029). This carries
 * Development's own archived rows back in full from the swap backup, and the rows that
 * hang off them. A row Beta now holds live is Beta's accepted state and is left alone.
 */
export async function carryDevelopmentArchive(
  targetDb: Db,
  backups: ReadonlyMap<string, string>,
): Promise<DevelopmentArchiveCarryReport> {
  const report: DevelopmentArchiveCarryReport = {
    archivedRowsRestored: 0,
    archivedRowsInserted: 0,
    archivedRowsLiveInSource: 0,
    dependentRowsInserted: {},
  };
  const entityBackup = backups.get('research_entities');
  if (!entityBackup) return report;

  const live = targetDb.collection('research_entities');
  const carriedIds: ObjectId[] = [];
  const ops: AnyBulkWriteOperation<Document>[] = [];
  for await (const archived of targetDb.collection(entityBackup).find({ archived: true })) {
    const current = await live.findOne({ _id: archived._id }, { projection: { archived: 1 } });
    if (current && current.archived !== true) {
      report.archivedRowsLiveInSource += 1;
      continue;
    }
    if (current) {
      ops.push({ replaceOne: { filter: { _id: archived._id }, replacement: archived } });
      report.archivedRowsRestored += 1;
    } else {
      ops.push({ insertOne: { document: archived } });
      report.archivedRowsInserted += 1;
    }
    carriedIds.push(archived._id as ObjectId);
    if (ops.length >= BATCH_SIZE) await flush(targetDb, 'research_entities', ops);
  }
  await flush(targetDb, 'research_entities', ops);

  for (const collectionName of DEPENDENT_COLLECTIONS) {
    const backup = backups.get(collectionName);
    const onArchived = rowsOnArchivedEntitiesFilter(collectionName, carriedIds);
    if (!backup || !onArchived || carriedIds.length === 0) continue;
    const target = targetDb.collection(collectionName);
    let inserted = 0;
    const dependentOps: AnyBulkWriteOperation<Document>[] = [];
    for await (const row of targetDb.collection(backup).find(onArchived)) {
      if (await target.findOne({ _id: row._id }, { projection: { _id: 1 } })) continue;
      dependentOps.push({ insertOne: { document: row } });
      inserted += 1;
      if (dependentOps.length >= BATCH_SIZE) await flush(targetDb, collectionName, dependentOps);
    }
    await flush(targetDb, collectionName, dependentOps);
    report.dependentRowsInserted[collectionName] = inserted;
  }
  return report;
}

export function carriedRowCount(
  report: DevelopmentArchiveCarryReport | undefined,
  collectionName: string,
): number {
  if (!report) return 0;
  if (collectionName === 'research_entities') return report.archivedRowsInserted;
  return report.dependentRowsInserted[collectionName] ?? 0;
}

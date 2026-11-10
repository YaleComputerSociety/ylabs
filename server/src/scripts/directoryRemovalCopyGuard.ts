import type { Db } from 'mongodb';
import { DIRECTORY_REMOVAL_COLLECTION } from '../models/directoryRemoval';

async function digestsIn(db: Db, filter: Record<string, unknown>): Promise<Set<string>> {
  const rows = await db
    .collection<{ digest: string }>(DIRECTORY_REMOVAL_COLLECTION)
    .find(filter, { projection: { _id: 0, digest: 1 } })
    .toArray();
  return new Set(rows.map((row) => row.digest));
}

export async function countTargetDirectoryRemovalsMissingFromSource(
  sourceDb: Db,
  targetDb: Db,
): Promise<number> {
  const targetActive = await digestsIn(targetDb, { withdrawnAt: { $exists: false } });
  if (targetActive.size === 0) return 0;
  const sourceAll = await digestsIn(sourceDb, {});
  return [...targetActive].filter((digest) => !sourceAll.has(digest)).length;
}

export async function directoryRemovalCopyBlockers(
  sourceDb: Db,
  targetDb: Db,
  label: string,
): Promise<string[]> {
  const missing = await countTargetDirectoryRemovalsMissingFromSource(sourceDb, targetDb);
  if (missing === 0) return [];
  return [
    `${label} blocked: the target holds ${missing} active directory removal ${
      missing === 1 ? 'entry' : 'entries'
    } that the source does not, and the copy would restore those people. Record the removal on the source first (docs/release-process.md).`,
  ];
}

export async function assertCopyCarriesEveryDirectoryRemoval(
  sourceDb: Db,
  targetDb: Db,
  label: string,
): Promise<void> {
  const [blocker] = await directoryRemovalCopyBlockers(sourceDb, targetDb, label);
  if (blocker) throw new Error(blocker);
}

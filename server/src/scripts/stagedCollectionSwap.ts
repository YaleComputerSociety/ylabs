import type { Db } from 'mongodb';

/**
 * Staged swap with rollback, shared by every whole-collection replacement.
 *
 * The sequence exists because deleting in place cannot be rolled back. On
 * 2026-09-01 the Beta-to-Production promotion ran `deleteMany` and then failed
 * opening its copy cursor, leaving Production's `research_entities` at 0 rows -
 * a live outage recoverable only because Beta still held the corpus (#2347).
 *
 * So nothing destructive happens until every collection has been staged and
 * swapped and the caller's `verify` has passed:
 *
 * 1. stage every collection under a temporary name in the TARGET database
 * 2. rename each live collection to a backup, then rename staging into place
 * 3. run `verify`
 * 4. only then drop the backups
 *
 * A failure at any point before `verify` passes rolls every collection back to
 * its pre-run state. A failure after it passes is rethrown untouched, because
 * the new data is already the verified truth and reverting would discard it.
 *
 * `syncBetaToDevelopment` and `promoteAcceptedBetaCopy` both use this rather
 * than keeping a copy each: the invariants here (non-loss, cross-collection
 * atomicity, verified cutover) are exactly the kind that drift when they live in
 * two places, which `docs/decisions.md` 2026-08-26 makes the repository's
 * standing objection to per-lane rollback code.
 */
export interface StagedSwapCollection {
  name: string;
}

export interface StagedCollectionSwapArgs<T extends StagedSwapCollection> {
  targetDb: Db;
  collections: readonly T[];
  backupPrefix: string;
  stage: (collection: T, operationId: string) => Promise<string>;
  verify: () => Promise<void>;
  /** Collections to retire during the same cutover, with no replacement staged. */
  clearedCollectionNames?: readonly string[];
  /** Used only in the AggregateError raised when rollback itself fails. */
  label?: string;
}

export function stagedSwapCollectionExists(db: Db, collectionName: string): Promise<boolean> {
  return db.listCollections({ name: collectionName }, { nameOnly: true }).hasNext();
}

export function stagedSwapOperationId(): string {
  return `${process.pid}_${Date.now()}`;
}

export async function applyStagedCollectionSwap<T extends StagedSwapCollection>(
  args: StagedCollectionSwapArgs<T>,
): Promise<void> {
  const { targetDb, collections, backupPrefix, stage, verify } = args;
  const clearedCollectionNames = args.clearedCollectionNames ?? [];
  const label = args.label ?? 'staged collection swap';

  const operationId = stagedSwapOperationId();
  const staged = new Map<string, string>();
  const backups = new Map<string, string>();
  const replaced: string[] = [];
  let cutoverVerified = false;

  try {
    for (const collection of collections) {
      staged.set(collection.name, await stage(collection, operationId));
    }

    for (const collection of collections) {
      const targetName = collection.name;
      const backupName = `${backupPrefix}${operationId}_${targetName}`;
      if (await stagedSwapCollectionExists(targetDb, targetName)) {
        await targetDb.collection(targetName).rename(backupName);
        backups.set(targetName, backupName);
      }
      await targetDb.collection(staged.get(targetName)!).rename(targetName);
      replaced.push(targetName);
    }

    for (const targetName of clearedCollectionNames) {
      if (!(await stagedSwapCollectionExists(targetDb, targetName))) continue;
      const backupName = `${backupPrefix}${operationId}_${targetName}`;
      await targetDb.collection(targetName).rename(backupName);
      backups.set(targetName, backupName);
    }

    await verify();
    cutoverVerified = true;

    for (const backupName of backups.values()) {
      if (await stagedSwapCollectionExists(targetDb, backupName)) {
        await targetDb.collection(backupName).drop();
      }
    }
  } catch (error) {
    if (cutoverVerified) {
      throw error;
    }
    let rollbackError: unknown;
    try {
      for (const targetName of [...replaced].reverse()) {
        if (await stagedSwapCollectionExists(targetDb, targetName)) {
          await targetDb.collection(targetName).drop();
        }
        const backupName = backups.get(targetName);
        if (backupName && (await stagedSwapCollectionExists(targetDb, backupName))) {
          await targetDb.collection(backupName).rename(targetName);
          backups.delete(targetName);
        }
      }
      for (const [targetName, backupName] of backups) {
        if (await stagedSwapCollectionExists(targetDb, backupName)) {
          await targetDb.collection(backupName).rename(targetName);
        }
      }
    } catch (caughtRollbackError) {
      rollbackError = caughtRollbackError;
    }
    if (rollbackError) {
      throw new AggregateError([error, rollbackError], `${label} and rollback failed`);
    }
    throw error;
  } finally {
    for (const stagingName of staged.values()) {
      if (await stagedSwapCollectionExists(targetDb, stagingName)) {
        await targetDb.collection(stagingName).drop();
      }
    }
  }
}

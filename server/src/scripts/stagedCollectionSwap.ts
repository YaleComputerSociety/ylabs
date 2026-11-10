import type { CreateCollectionOptions, Db, Document } from 'mongodb';
import { assertNoPreservedCollectionsCleared } from './mirrorCollectionPolicy';

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
 * 3. run `afterCutover`, which may read the backups, then `verify`
 * 4. only then drop the backups, or, with `retainedPrefix`, keep them as the one
 *    previous generation and drop any older one (#4149)
 *
 * A failure at any point before `verify` passes rolls every collection back to
 * its pre-run state. A failure after it passes is rethrown untouched, because
 * the new data is already the verified truth and reverting would discard it.
 * Verify proves the swap is complete, not that it is correct, which is why the
 * promotion retains the generation it replaced instead of dropping it.
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
  /**
   * Runs after every rename and before `verify`, with each replaced collection's
   * backup name, so rows the target owns can be carried from the backup into the
   * swapped collection. A throw here rolls the whole swap back like a `verify` failure.
   */
  afterCutover?: (backups: ReadonlyMap<string, string>) => Promise<void>;
  /** Collections to retire during the same cutover, with no replacement staged. */
  clearedCollectionNames?: readonly string[];
  /** Used only in the AggregateError raised when rollback itself fails. */
  label?: string;
  /** Runs before anything is staged; a throw leaves the target untouched. */
  preflight: () => Promise<void>;
  retainedPrefix?: string;
}

export interface RetainedCollection {
  collection: string;
  retainedName: string;
  count: number;
}

export interface RetainedGeneration {
  operationId: string;
  collections: RetainedCollection[];
}

export interface StagedCollectionSwapResult {
  operationId: string;
  retained?: RetainedGeneration;
  droppedGenerations: string[];
}

const OPERATION_ID_PATTERN = /^\d+_\d+$/;

export function isStagedSwapOperationId(value: string): boolean {
  return OPERATION_ID_PATTERN.test(value);
}

export function retainedCollectionName(
  retainedPrefix: string,
  operationId: string,
  collectionName: string,
): string {
  return `${retainedPrefix}${operationId}_${collectionName}`;
}

export async function listRetainedGenerations(
  db: Db,
  retainedPrefix: string,
): Promise<RetainedGeneration[]> {
  const generations = new Map<string, RetainedCollection[]>();
  const listed = await db.listCollections({}, { nameOnly: true }).toArray();
  for (const { name } of listed) {
    if (!name.startsWith(retainedPrefix)) continue;
    const match = /^(\d+_\d+)_(.+)$/.exec(name.slice(retainedPrefix.length));
    if (!match) continue;
    const [, operationId, collection] = match;
    const count = await db.collection(name).countDocuments({});
    const entries = generations.get(operationId) ?? [];
    entries.push({ collection, retainedName: name, count });
    generations.set(operationId, entries);
  }
  return [...generations.entries()]
    .map(([operationId, collections]) => ({
      operationId,
      collections: collections.sort((a, b) => a.collection.localeCompare(b.collection)),
    }))
    .sort((a, b) => a.operationId.localeCompare(b.operationId));
}

export function stagedSwapCollectionExists(db: Db, collectionName: string): Promise<boolean> {
  return db.listCollections({ name: collectionName }, { nameOnly: true }).hasNext();
}

/**
 * The validation options a staging collection must be created with so the swap
 * does not silently strip its target's validator.
 *
 * A validator is collection metadata and `rename` carries no collection options,
 * so staging that is created implicitly by its first write lands as an
 * unvalidated collection and the cutover replaces a validated collection with
 * it. Source options win because a whole-collection copy makes the target match
 * the source; the target's own options are the fallback so a copy never
 * downgrades a validated collection to unvalidated when the source declares
 * none.
 */
export async function mirroredValidationOptions(
  sourceDb: Db,
  targetDb: Db,
  collectionName: string,
): Promise<CreateCollectionOptions> {
  const sourceOptions = await collectionValidationOptions(sourceDb, collectionName);
  if (Object.keys(sourceOptions).length > 0) return sourceOptions;
  return collectionValidationOptions(targetDb, collectionName);
}

async function collectionValidationOptions(
  db: Db,
  collectionName: string,
): Promise<CreateCollectionOptions> {
  const [info] = await db.listCollections({ name: collectionName }).toArray();
  const options = ((info as { options?: Document } | undefined)?.options ?? {}) as Document;
  const validation: CreateCollectionOptions = {};
  if (options.validator) validation.validator = options.validator;
  if (options.validationLevel) validation.validationLevel = options.validationLevel;
  if (options.validationAction) validation.validationAction = options.validationAction;
  return validation;
}

export function stagedSwapOperationId(): string {
  return `${process.pid}_${Date.now()}`;
}

export async function applyStagedCollectionSwap<T extends StagedSwapCollection>(
  args: StagedCollectionSwapArgs<T>,
): Promise<StagedCollectionSwapResult> {
  const { targetDb, collections, backupPrefix, stage, verify } = args;
  const clearedCollectionNames = args.clearedCollectionNames ?? [];
  assertNoPreservedCollectionsCleared(clearedCollectionNames);
  const label = args.label ?? 'staged collection swap';

  const operationId = stagedSwapOperationId();
  const staged = new Map<string, string>();
  const backups = new Map<string, string>();
  const replaced: string[] = [];
  const absentBefore: string[] = [];
  let cutoverVerified = false;

  await args.preflight();

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
      } else {
        absentBefore.push(targetName);
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

    await args.afterCutover?.(backups);
    await verify();
    cutoverVerified = true;

    if (args.retainedPrefix) {
      return {
        operationId,
        ...(await retainGeneration(
          targetDb,
          args.retainedPrefix,
          operationId,
          backups,
          absentBefore,
        )),
      };
    }
    for (const backupName of backups.values()) {
      if (await stagedSwapCollectionExists(targetDb, backupName)) {
        await targetDb.collection(backupName).drop();
      }
    }
    return { operationId, droppedGenerations: [] };
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
      throw new AggregateError([error, rollbackError], `${label} and rollback failed`, {
        cause: error,
      });
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

/**
 * A collection the swap created rather than replaced is retained as an empty
 * collection, so a rollback restores "no rows" without needing a manifest.
 * Older generations are dropped only once this one is complete, so exactly one
 * previous generation exists at rest and a failure here never loses the last.
 */
async function retainGeneration(
  targetDb: Db,
  retainedPrefix: string,
  operationId: string,
  backups: ReadonlyMap<string, string>,
  absentBefore: readonly string[],
): Promise<{ retained: RetainedGeneration; droppedGenerations: string[] }> {
  const collections: RetainedCollection[] = [];
  for (const [collection, backupName] of backups) {
    const retainedName = retainedCollectionName(retainedPrefix, operationId, collection);
    await targetDb.collection(backupName).rename(retainedName);
    collections.push({
      collection,
      retainedName,
      count: await targetDb.collection(retainedName).countDocuments({}),
    });
  }
  for (const collection of absentBefore) {
    const retainedName = retainedCollectionName(retainedPrefix, operationId, collection);
    await targetDb.createCollection(retainedName);
    collections.push({ collection, retainedName, count: 0 });
  }

  const droppedGenerations: string[] = [];
  for (const generation of await listRetainedGenerations(targetDb, retainedPrefix)) {
    if (generation.operationId === operationId) continue;
    for (const { retainedName } of generation.collections) {
      await targetDb.collection(retainedName).drop();
    }
    droppedGenerations.push(generation.operationId);
  }

  return {
    retained: {
      operationId,
      collections: collections.sort((a, b) => a.collection.localeCompare(b.collection)),
    },
    droppedGenerations,
  };
}

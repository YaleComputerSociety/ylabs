import {
  retryTransientDatabaseWrite,
  type DatabaseWriteRetryOptions,
} from './utils/databaseWriteRetry';
import { isDuplicateIdWriteError } from './utils/transientMongoError';

export interface IdempotentInsertDeps<TDoc, TInserted extends { _id: unknown }> {
  insertMany: (docs: TDoc[]) => Promise<ReadonlyArray<TInserted>>;
  findLandedIds: (ids: unknown[]) => Promise<ReadonlyArray<unknown>>;
}

export type IdempotentInsertRetryOptions = Omit<DatabaseWriteRetryOptions, 'ignoreWriteError'>;

export interface LandedDocument<TDoc, TInserted> {
  input: TDoc;
  inserted: TInserted | TDoc;
}

/**
 * Inserts documents that already carry their `_id`, retrying a transient failure without
 * inserting any document twice. A failed unordered insert can land any subset of its batch,
 * and the error does not reliably say which (a network error reports nothing per document),
 * so before each retry the store is asked which ids landed, and only the rest is re-sent.
 * Returns what landed in input order; a document the model refuses on validation is dropped
 * exactly as a single unordered `insertMany` drops it.
 */
export async function insertDocumentsIdempotently<
  TDoc extends { _id: unknown },
  TInserted extends { _id: unknown },
>(
  docs: TDoc[],
  deps: IdempotentInsertDeps<TDoc, TInserted>,
  retry: IdempotentInsertRetryOptions,
): Promise<Array<LandedDocument<TDoc, TInserted>>> {
  const indexById = new Map(docs.map((doc, index) => [String(doc._id), index]));
  const landed = new Map<number, LandedDocument<TDoc, TInserted>>();
  const notLanded = () => docs.filter((_, index) => !landed.has(index));
  await retryTransientDatabaseWrite(
    async ({ attempt }) => {
      if (attempt > 1) {
        const unconfirmed = notLanded();
        if (unconfirmed.length === 0) return;
        for (const id of await deps.findLandedIds(unconfirmed.map((doc) => doc._id))) {
          const index = indexById.get(String(id));
          if (index !== undefined) landed.set(index, { input: docs[index], inserted: docs[index] });
        }
      }
      const pending = notLanded();
      if (pending.length === 0) return;
      const inserted = await deps.insertMany(pending);
      for (const [position, doc] of inserted.entries()) {
        const index =
          indexById.get(String(doc._id)) ?? indexById.get(String(pending[position]?._id));
        if (index !== undefined) landed.set(index, { input: docs[index], inserted: doc });
      }
    },
    { ...retry, ignoreWriteError: isDuplicateIdWriteError },
  );
  return [...landed.entries()].sort(([a], [b]) => a - b).map(([, value]) => value);
}

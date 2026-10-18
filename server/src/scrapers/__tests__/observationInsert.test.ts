import { describe, expect, it, vi } from 'vitest';
import { MongoNetworkError } from 'mongodb';
import { insertDocumentsIdempotently } from '../observationInsert';
import { withDatabaseWriteRetryScope } from '../utils/databaseWriteRetry';

const ATLAS_QUOTA_CHECK_MESSAGE =
  'Error determining if update will go over space quota: Error computing current atlas size: internal atlas error';

interface Doc {
  _id: string;
  field: string;
}

const docs = (count: number): Doc[] =>
  Array.from({ length: count }, (_, index) => ({ _id: `id-${index}`, field: `field-${index}` }));

function fakeStore() {
  const stored = new Map<string, Doc>();
  const insertCalls: string[][] = [];
  const findLandedIds = vi.fn(async (ids: unknown[]) => ids.filter((id) => stored.has(String(id))));
  return { stored, insertCalls, findLandedIds };
}

const noSleep = { sleep: async () => undefined, label: 'test insert' };

function partialBulkFailure(failedIndexes: number[]) {
  return Object.assign(new Error(ATLAS_QUOTA_CHECK_MESSAGE), {
    name: 'MongoBulkWriteError',
    writeErrors: failedIndexes.map((index) => ({
      err: { index, code: 8000, errmsg: ATLAS_QUOTA_CHECK_MESSAGE },
      index,
    })),
  });
}

describe('insertDocumentsIdempotently', () => {
  it('re-sends only the documents a partial unordered insert did not land', async () => {
    const store = fakeStore();
    let call = 0;
    const insertMany = vi.fn(async (pending: Doc[]) => {
      store.insertCalls.push(pending.map((doc) => doc._id));
      call += 1;
      if (call === 1) {
        for (const doc of pending.slice(0, 2)) store.stored.set(doc._id, doc);
        throw partialBulkFailure([2, 3]);
      }
      for (const doc of pending) store.stored.set(doc._id, doc);
      return pending;
    });

    const { value: landed, stats } = await withDatabaseWriteRetryScope(() =>
      insertDocumentsIdempotently(
        docs(4),
        { insertMany, findLandedIds: store.findLandedIds },
        noSleep,
      ),
    );

    expect(store.insertCalls).toEqual([
      ['id-0', 'id-1', 'id-2', 'id-3'],
      ['id-2', 'id-3'],
    ]);
    expect(landed.map(({ input }) => input._id)).toEqual(['id-0', 'id-1', 'id-2', 'id-3']);
    expect(store.stored.size).toBe(4);
    expect(stats).toEqual({ refused: 1, recovered: 1, exhausted: 0, retries: 1 });
  });

  it('inserts nothing twice when a network error hides that the whole batch landed', async () => {
    const store = fakeStore();
    const insertMany = vi.fn(async (pending: Doc[]) => {
      for (const doc of pending) store.stored.set(doc._id, doc);
      throw new MongoNetworkError('connection closed before the reply');
    });

    const landed = await insertDocumentsIdempotently(
      docs(3),
      { insertMany, findLandedIds: store.findLandedIds },
      noSleep,
    );

    expect(insertMany).toHaveBeenCalledTimes(1);
    expect(store.findLandedIds).toHaveBeenCalledTimes(1);
    expect(landed.map(({ input }) => input._id)).toEqual(['id-0', 'id-1', 'id-2']);
  });

  it('keeps the documents the model returned so callers read the stored shape', async () => {
    const store = fakeStore();
    const insertMany = vi.fn(async (pending: Doc[]) =>
      pending.map((doc) => ({ ...doc, hydrated: true })),
    );

    const landed = await insertDocumentsIdempotently(
      docs(2),
      { insertMany, findLandedIds: store.findLandedIds },
      noSleep,
    );

    expect(landed.map(({ inserted }) => (inserted as { hydrated?: boolean }).hydrated)).toEqual([
      true,
      true,
    ]);
    expect(store.findLandedIds).not.toHaveBeenCalled();
  });

  it('does not retry a deterministic failure', async () => {
    const store = fakeStore();
    const duplicate = Object.assign(new Error('E11000 duplicate key error index: value_1'), {
      code: 11000,
    });
    const insertMany = vi.fn(async () => {
      throw duplicate;
    });

    await expect(
      insertDocumentsIdempotently(
        docs(2),
        { insertMany, findLandedIds: store.findLandedIds },
        noSleep,
      ),
    ).rejects.toBe(duplicate);
    expect(insertMany).toHaveBeenCalledTimes(1);
  });

  it('gives up after the backoff budget and counts the write as exhausted', async () => {
    const store = fakeStore();
    const insertMany = vi.fn(async () => {
      throw new MongoNetworkError('still down');
    });

    const { value: caught, stats } = await withDatabaseWriteRetryScope(() =>
      insertDocumentsIdempotently(
        docs(1),
        { insertMany, findLandedIds: store.findLandedIds },
        { ...noSleep, backoffMs: [1, 1] },
      ).catch((error: unknown) => error),
    );

    expect(String(caught)).toContain('still down');
    expect(stats).toEqual({ refused: 1, recovered: 0, exhausted: 1, retries: 2 });
    expect(insertMany).toHaveBeenCalledTimes(3);
  });
});

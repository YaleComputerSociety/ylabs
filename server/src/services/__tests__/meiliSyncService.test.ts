import { describe, it, expect, vi, beforeEach } from 'vitest';

const addDocumentsMock = vi.fn();
const deleteDocumentMock = vi.fn();
const getMeiliIndexMock = vi.fn(async (_name: string) => ({
  addDocuments: addDocumentsMock,
  deleteDocument: deleteDocumentMock,
}));

vi.mock('../../utils/meiliClient', () => ({
  getMeiliIndex: (name: string) => getMeiliIndexMock(name),
}));

import {
  syncEntity,
  syncEntities,
  deleteFromIndex,
  isSyncableEntityType,
} from '../meiliSyncService';

beforeEach(() => {
  addDocumentsMock.mockReset();
  deleteDocumentMock.mockReset();
  getMeiliIndexMock.mockClear();
});

describe('isSyncableEntityType', () => {
  it('accepts the registered entity types', () => {
    expect(isSyncableEntityType('researchEntity')).toBe(true);
  });

  it('rejects unknown entity types', () => {
    expect(isSyncableEntityType('paper')).toBe(false);
    expect(isSyncableEntityType('user')).toBe(false);
    expect(isSyncableEntityType('observation')).toBe(false);
    expect(isSyncableEntityType('')).toBe(false);
  });
});

describe('syncEntity transform', () => {
  it('strips _id, __v, embedding and sets stringified id for researchEntities', async () => {
    const doc = {
      _id: { toString: () => 'rg-id-42' },
      __v: 0,
      embedding: [0.5],
      slug: 'indexed-fixture-home',
      name: 'Indexed Fixture Home',
      kind: 'lab',
      departments: ['Fixture Department'],
      researchAreas: ['Fixture Method'],
    };

    await syncEntity('researchEntity', doc);

    expect(getMeiliIndexMock).toHaveBeenCalledWith('researchentities');
    const [docs, opts] = addDocumentsMock.mock.calls[0];
    expect(opts).toEqual({ primaryKey: 'id' });
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({
      id: 'rg-id-42',
      slug: 'indexed-fixture-home',
      name: 'Indexed Fixture Home',
      kind: 'lab',
    });
    expect(docs[0]).not.toHaveProperty('_id');
    expect(docs[0]).not.toHaveProperty('__v');
    expect(docs[0]).not.toHaveProperty('embedding');
  });

  it('uses an existing string id when _id is absent', async () => {
    const doc = { id: 'pre-set-id', title: 'No _id' };
    await syncEntity('researchEntity', doc);
    const [docs] = addDocumentsMock.mock.calls[0];
    expect(docs[0].id).toBe('pre-set-id');
  });

  it('no-ops on unknown entity type', async () => {
    await syncEntity('user', { _id: 'x' });
    expect(getMeiliIndexMock).not.toHaveBeenCalled();
    expect(addDocumentsMock).not.toHaveBeenCalled();
  });

  it('no-ops on null doc', async () => {
    await syncEntity('researchEntity', null);
    expect(addDocumentsMock).not.toHaveBeenCalled();
  });

  it('swallows Meilisearch errors so callers do not break', async () => {
    addDocumentsMock.mockRejectedValueOnce(new Error('meili down'));
    await expect(
      syncEntity('researchEntity', { _id: { toString: () => 'a' }, title: 't' }),
    ).resolves.toBeUndefined();
  });
});

describe('syncEntities', () => {
  it('transforms a batch and dispatches once', async () => {
    const docs = [
      { _id: { toString: () => 'a' }, __v: 1, embedding: [1], name: 'A' },
      { _id: { toString: () => 'b' }, __v: 2, embedding: [2], name: 'B' },
    ];

    await syncEntities('researchEntity', docs);

    expect(getMeiliIndexMock).toHaveBeenCalledWith('researchentities');
    expect(addDocumentsMock).toHaveBeenCalledTimes(1);
    const [meiliDocs, opts] = addDocumentsMock.mock.calls[0];
    expect(opts).toEqual({ primaryKey: 'id' });
    expect(meiliDocs).toEqual([
      expect.objectContaining({ id: 'a', name: 'A' }),
      expect.objectContaining({ id: 'b', name: 'B' }),
    ]);
    expect(meiliDocs[0]).not.toHaveProperty('__v');
    expect(meiliDocs[0]).not.toHaveProperty('embedding');
    expect(meiliDocs[1]).not.toHaveProperty('__v');
    expect(meiliDocs[1]).not.toHaveProperty('embedding');
  });

  it('no-ops on empty array', async () => {
    await syncEntities('researchEntity', []);
    expect(getMeiliIndexMock).not.toHaveBeenCalled();
  });

  it('no-ops on unknown entity type', async () => {
    await syncEntities('user', [{ _id: 'x' }]);
    expect(getMeiliIndexMock).not.toHaveBeenCalled();
  });
});

describe('deleteFromIndex', () => {
  it('routes to the correct index and deletes by id', async () => {
    await deleteFromIndex('researchEntity', 'entity-id-1');
    expect(getMeiliIndexMock).toHaveBeenCalledWith('researchentities');
    expect(deleteDocumentMock).toHaveBeenCalledWith('entity-id-1');
  });

  it('no-ops on unknown entity type', async () => {
    await deleteFromIndex('user', 'x');
    expect(deleteDocumentMock).not.toHaveBeenCalled();
  });

  it('no-ops on missing id', async () => {
    await deleteFromIndex('researchEntity', '');
    expect(deleteDocumentMock).not.toHaveBeenCalled();
  });

  it('swallows Meilisearch errors', async () => {
    deleteDocumentMock.mockRejectedValueOnce(new Error('boom'));
    await expect(deleteFromIndex('researchEntity', 'id-1')).resolves.toBeUndefined();
  });
});

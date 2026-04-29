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
    expect(isSyncableEntityType('listing')).toBe(true);
    expect(isSyncableEntityType('researchGroup')).toBe(true);
    expect(isSyncableEntityType('paper')).toBe(true);
  });

  it('rejects unknown entity types', () => {
    expect(isSyncableEntityType('user')).toBe(false);
    expect(isSyncableEntityType('observation')).toBe(false);
    expect(isSyncableEntityType('')).toBe(false);
  });
});

describe('syncEntity transform', () => {
  it('strips _id, __v, embedding and sets stringified id for listings', async () => {
    const doc = {
      _id: { toString: () => 'listing-id-1' },
      __v: 7,
      embedding: [0.1, 0.2, 0.3],
      title: 'Quantum Photonics Listing',
      departments: ['Physics'],
    };

    await syncEntity('listing', doc);

    expect(getMeiliIndexMock).toHaveBeenCalledWith('listings');
    expect(addDocumentsMock).toHaveBeenCalledTimes(1);
    const [docs, opts] = addDocumentsMock.mock.calls[0];
    expect(opts).toEqual({ primaryKey: 'id' });
    expect(docs).toHaveLength(1);
    expect(docs[0]).toEqual({
      id: 'listing-id-1',
      title: 'Quantum Photonics Listing',
      departments: ['Physics'],
    });
    expect(docs[0]).not.toHaveProperty('_id');
    expect(docs[0]).not.toHaveProperty('__v');
    expect(docs[0]).not.toHaveProperty('embedding');
  });

  it('strips _id, __v, embedding and sets stringified id for researchGroups', async () => {
    const doc = {
      _id: { toString: () => 'rg-id-42' },
      __v: 0,
      embedding: [0.5],
      slug: 'smith-lab',
      name: 'Smith Lab',
      kind: 'lab',
      departments: ['Bio'],
      researchAreas: ['Genetics'],
    };

    await syncEntity('researchGroup', doc);

    expect(getMeiliIndexMock).toHaveBeenCalledWith('researchgroups');
    const [docs, opts] = addDocumentsMock.mock.calls[0];
    expect(opts).toEqual({ primaryKey: 'id' });
    expect(docs[0]).toEqual({
      id: 'rg-id-42',
      slug: 'smith-lab',
      name: 'Smith Lab',
      kind: 'lab',
      departments: ['Bio'],
      researchAreas: ['Genetics'],
    });
    expect(docs[0]).not.toHaveProperty('_id');
    expect(docs[0]).not.toHaveProperty('__v');
    expect(docs[0]).not.toHaveProperty('embedding');
  });

  it('strips _id, __v, embedding and sets stringified id for papers', async () => {
    const doc = {
      _id: { toString: () => 'paper-id-99' },
      __v: 3,
      embedding: [0.9, 0.1],
      title: 'On Folding',
      abstract: 'an abstract',
      yaleAuthorNetIds: ['abc123'],
    };

    await syncEntity('paper', doc);

    expect(getMeiliIndexMock).toHaveBeenCalledWith('papers');
    const [docs] = addDocumentsMock.mock.calls[0];
    expect(docs[0]).toEqual({
      id: 'paper-id-99',
      title: 'On Folding',
      abstract: 'an abstract',
      yaleAuthorNetIds: ['abc123'],
    });
  });

  it('uses an existing string id when _id is absent', async () => {
    const doc = { id: 'pre-set-id', title: 'No _id' };
    await syncEntity('listing', doc);
    const [docs] = addDocumentsMock.mock.calls[0];
    expect(docs[0].id).toBe('pre-set-id');
  });

  it('no-ops on unknown entity type', async () => {
    await syncEntity('user', { _id: 'x' });
    expect(getMeiliIndexMock).not.toHaveBeenCalled();
    expect(addDocumentsMock).not.toHaveBeenCalled();
  });

  it('no-ops on null doc', async () => {
    await syncEntity('listing', null);
    expect(addDocumentsMock).not.toHaveBeenCalled();
  });

  it('swallows Meilisearch errors so callers do not break', async () => {
    addDocumentsMock.mockRejectedValueOnce(new Error('meili down'));
    await expect(
      syncEntity('listing', { _id: { toString: () => 'a' }, title: 't' }),
    ).resolves.toBeUndefined();
  });
});

describe('syncEntities', () => {
  it('transforms a batch and dispatches once', async () => {
    const docs = [
      { _id: { toString: () => 'a' }, __v: 1, embedding: [1], name: 'A' },
      { _id: { toString: () => 'b' }, __v: 2, embedding: [2], name: 'B' },
    ];

    await syncEntities('researchGroup', docs);

    expect(getMeiliIndexMock).toHaveBeenCalledWith('researchgroups');
    expect(addDocumentsMock).toHaveBeenCalledTimes(1);
    const [meiliDocs, opts] = addDocumentsMock.mock.calls[0];
    expect(opts).toEqual({ primaryKey: 'id' });
    expect(meiliDocs).toEqual([
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' },
    ]);
  });

  it('no-ops on empty array', async () => {
    await syncEntities('listing', []);
    expect(getMeiliIndexMock).not.toHaveBeenCalled();
  });

  it('no-ops on unknown entity type', async () => {
    await syncEntities('user', [{ _id: 'x' }]);
    expect(getMeiliIndexMock).not.toHaveBeenCalled();
  });
});

describe('deleteFromIndex', () => {
  it('routes to the correct index and deletes by id', async () => {
    await deleteFromIndex('paper', 'paper-id-1');
    expect(getMeiliIndexMock).toHaveBeenCalledWith('papers');
    expect(deleteDocumentMock).toHaveBeenCalledWith('paper-id-1');
  });

  it('no-ops on unknown entity type', async () => {
    await deleteFromIndex('user', 'x');
    expect(deleteDocumentMock).not.toHaveBeenCalled();
  });

  it('no-ops on missing id', async () => {
    await deleteFromIndex('listing', '');
    expect(deleteDocumentMock).not.toHaveBeenCalled();
  });

  it('swallows Meilisearch errors', async () => {
    deleteDocumentMock.mockRejectedValueOnce(new Error('boom'));
    await expect(deleteFromIndex('listing', 'id-1')).resolves.toBeUndefined();
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => {
  const addDocuments = vi.fn();
  const deleteDocument = vi.fn();
  return {
    addDocuments,
    deleteDocument,
    researchGroupMemberFind: vi.fn(),
    userFind: vi.fn(),
    facultyMemberFind: vi.fn(),
    getMeiliIndex: vi.fn(async (_name: string) => ({
      addDocuments,
      deleteDocument,
    })),
  };
});

vi.mock('../../utils/meiliClient', () => ({
  getMeiliIndex: (name: string) => mocks.getMeiliIndex(name),
}));

vi.mock('../../models/researchGroupMember', () => ({
  ResearchGroupMember: {
    find: mocks.researchGroupMemberFind,
  },
}));

vi.mock('../../models/user', () => ({
  User: {
    find: mocks.userFind,
  },
}));

vi.mock('../../models/facultyMember', () => ({
  FacultyMember: {
    find: mocks.facultyMemberFind,
  },
}));

import {
  syncEntity,
  syncEntities,
  deleteFromIndex,
  isSyncableEntityType,
} from '../meiliSyncService';

beforeEach(() => {
  mocks.addDocuments.mockReset();
  mocks.deleteDocument.mockReset();
  mocks.researchGroupMemberFind.mockReset();
  mocks.userFind.mockReset();
  mocks.facultyMemberFind.mockReset();
  mocks.getMeiliIndex.mockClear();
  mocks.researchGroupMemberFind.mockReturnValue({ lean: async () => [] });
  mocks.userFind.mockReturnValue({ select: () => ({ lean: async () => [] }) });
  mocks.facultyMemberFind.mockReturnValue({ select: () => ({ lean: async () => [] }) });
});

describe('isSyncableEntityType', () => {
  it('accepts the registered entity types', () => {
    expect(isSyncableEntityType('listing')).toBe(true);
    expect(isSyncableEntityType('researchEntity')).toBe(true);
    expect(isSyncableEntityType('paper')).toBe(true);
  });

  it('rejects unknown entity types', () => {
    expect(isSyncableEntityType('user')).toBe(false);
    expect(isSyncableEntityType('observation')).toBe(false);
    expect(isSyncableEntityType('')).toBe(false);
  });
});

describe('syncEntity transform', () => {
  it('strips _id, __v, embedding and sets serialized id for listings', async () => {
    const doc = {
      _id: 'listing-id-1',
      __v: 7,
      embedding: [0.1, 0.2, 0.3],
      title: 'Quantum Photonics Listing',
      departments: ['Physics'],
    };

    await syncEntity('listing', doc);

    expect(mocks.getMeiliIndex).toHaveBeenCalledWith('listings');
    expect(mocks.addDocuments).toHaveBeenCalledTimes(1);
    const [docs, opts] = mocks.addDocuments.mock.calls[0];
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

  it('strips _id, __v, embedding and sets serialized id for researchEntities', async () => {
    const doc = {
      _id: 'rg-id-42',
      __v: 0,
      embedding: [0.5],
      slug: 'smith-lab',
      name: 'Smith Lab',
      kind: 'lab',
      departments: ['Bio'],
      researchAreas: ['Genetics'],
    };

    await syncEntity('researchEntity', doc);

    expect(mocks.getMeiliIndex).toHaveBeenCalledWith('researchentities');
    const [docs, opts] = mocks.addDocuments.mock.calls[0];
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

  it('enriches researchEntity sync documents with searchable professor names', async () => {
    const entityId = '507f1f77bcf86cd799439011';
    const userId = '507f1f77bcf86cd799439012';
    mocks.researchGroupMemberFind.mockReturnValueOnce({
      lean: async () => [
        {
          researchEntityId: entityId,
          userId,
          role: 'pi',
          isCurrentMember: true,
        },
      ],
    });
    mocks.userFind.mockReturnValueOnce({
      select: () => ({
        lean: async () => [
          {
            _id: userId,
            fname: 'Dennis',
            lname: 'Spencer',
          },
        ],
      }),
    });

    await syncEntity('researchEntity', {
      _id: entityId,
      slug: 'ysm-ynn',
      name: 'Yale Clinical Neuroscience Neuroanalytics',
    });

    const [docs] = mocks.addDocuments.mock.calls[0];
    expect(docs[0]).toMatchObject({
      id: entityId,
      slug: 'ysm-ynn',
      name: 'Yale Clinical Neuroscience Neuroanalytics',
      leadProfessorNames: ['Dennis Spencer'],
      professorNames: ['Dennis Spencer'],
    });
  });

  it('strips _id, __v, embedding and sets serialized id for papers', async () => {
    const doc = {
      _id: 'paper-id-99',
      __v: 3,
      embedding: [0.9, 0.1],
      title: 'On Folding',
      abstract: 'an abstract',
      yaleAuthorNetIds: ['abc123'],
    };

    await syncEntity('paper', doc);

    expect(mocks.getMeiliIndex).toHaveBeenCalledWith('papers');
    const [docs] = mocks.addDocuments.mock.calls[0];
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
    const [docs] = mocks.addDocuments.mock.calls[0];
    expect(docs[0].id).toBe('pre-set-id');
  });

  it('skips index documents with object-shaped ids without coercion', async () => {
    const unsafeId = {
      toString: () => {
        throw new Error('stringified arbitrary Meili document id');
      },
      toHexString: () => {
        throw new Error('called arbitrary Meili document id toHexString');
      },
    };

    await syncEntity('listing', { _id: unsafeId, title: 'Unsafe Listing' });

    expect(mocks.getMeiliIndex).not.toHaveBeenCalled();
    expect(mocks.addDocuments).not.toHaveBeenCalled();
  });

  it('no-ops on unknown entity type', async () => {
    await syncEntity('user', { _id: 'x' });
    expect(mocks.getMeiliIndex).not.toHaveBeenCalled();
    expect(mocks.addDocuments).not.toHaveBeenCalled();
  });

  it('no-ops on null doc', async () => {
    await syncEntity('listing', null);
    expect(mocks.addDocuments).not.toHaveBeenCalled();
  });

  it('swallows Meilisearch errors so callers do not break', async () => {
    mocks.addDocuments.mockRejectedValueOnce(new Error('meili down'));
    await expect(
      syncEntity('listing', { _id: 'a', title: 't' }),
    ).resolves.toBeUndefined();
  });
});

describe('syncEntities', () => {
  it('transforms a batch and dispatches once', async () => {
    const docs = [
      { _id: 'a', __v: 1, embedding: [1], name: 'A' },
      { _id: 'b', __v: 2, embedding: [2], name: 'B' },
    ];

    await syncEntities('researchEntity', docs);

    expect(mocks.getMeiliIndex).toHaveBeenCalledWith('researchentities');
    expect(mocks.addDocuments).toHaveBeenCalledTimes(1);
    const [meiliDocs, opts] = mocks.addDocuments.mock.calls[0];
    expect(opts).toEqual({ primaryKey: 'id' });
    expect(meiliDocs).toEqual([
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' },
    ]);
  });

  it('no-ops on empty array', async () => {
    await syncEntities('listing', []);
    expect(mocks.getMeiliIndex).not.toHaveBeenCalled();
  });

  it('no-ops on unknown entity type', async () => {
    await syncEntities('user', [{ _id: 'x' }]);
    expect(mocks.getMeiliIndex).not.toHaveBeenCalled();
  });
});

describe('deleteFromIndex', () => {
  it('routes to the correct index and deletes by id', async () => {
    await deleteFromIndex('paper', 'paper-id-1');
    expect(mocks.getMeiliIndex).toHaveBeenCalledWith('papers');
    expect(mocks.deleteDocument).toHaveBeenCalledWith('paper-id-1');
  });

  it('no-ops on unknown entity type', async () => {
    await deleteFromIndex('user', 'x');
    expect(mocks.deleteDocument).not.toHaveBeenCalled();
  });

  it('no-ops on missing id', async () => {
    await deleteFromIndex('listing', '');
    expect(mocks.deleteDocument).not.toHaveBeenCalled();
  });

  it('swallows Meilisearch errors', async () => {
    mocks.deleteDocument.mockRejectedValueOnce(new Error('boom'));
    await expect(deleteFromIndex('listing', 'id-1')).resolves.toBeUndefined();
  });
});

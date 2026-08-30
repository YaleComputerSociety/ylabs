import { describe, it, expect, vi, beforeEach } from 'vitest';
import mongoose from 'mongoose';

const mocks = vi.hoisted(() => {
  const addDocuments = vi.fn();
  const deleteDocument = vi.fn();
  return {
    addDocuments,
    deleteDocument,
    roleAssignmentFind: vi.fn(),
    personFind: vi.fn(),
    accountFind: vi.fn(),
    userFind: vi.fn(),
    getMeiliIndex: vi.fn(async (_name: string) => ({
      addDocuments,
      deleteDocument,
    })),
  };
});

vi.mock('../../utils/meiliClient', () => ({
  getMeiliIndex: (name: string) => mocks.getMeiliIndex(name),
}));

vi.mock('../../models/roleAssignment', () => ({
  RoleAssignment: {
    find: mocks.roleAssignmentFind,
  },
}));

vi.mock('../../models/researcher', () => ({
  Researcher: {
    find: mocks.personFind,
  },
}));

vi.mock('../../models/account', () => ({
  Account: {
    find: mocks.accountFind,
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
  mocks.roleAssignmentFind.mockReset();
  mocks.personFind.mockReset();
  mocks.accountFind.mockReset();
  mocks.userFind.mockReset();
  mocks.getMeiliIndex.mockClear();
  mocks.roleAssignmentFind.mockReturnValue({ lean: async () => [] });
  mocks.personFind.mockReturnValue({ select: () => ({ lean: async () => [] }) });
  mocks.accountFind.mockReturnValue({ select: () => ({ lean: async () => [] }) });
  mocks.userFind.mockReturnValue({ select: () => ({ lean: async () => [] }) });
});

describe('isSyncableEntityType', () => {
  it('accepts the only registered entity type', () => {
    expect(isSyncableEntityType('researchEntity')).toBe(true);
  });

  it('rejects retired and unknown entity types', () => {
    expect(isSyncableEntityType('listing')).toBe(false);
    expect(isSyncableEntityType('paper')).toBe(false);
    expect(isSyncableEntityType('user')).toBe(false);
    expect(isSyncableEntityType('observation')).toBe(false);
    expect(isSyncableEntityType('')).toBe(false);
  });
});

describe('syncEntity transform', () => {
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
    const personId = new mongoose.Types.ObjectId();
    mocks.roleAssignmentFind.mockReturnValueOnce({
      lean: async () => [
        {
          _id: new mongoose.Types.ObjectId(),
          personId,
          target: { kind: 'RESEARCH_ENTITY', id: entityId },
          role: 'PI',
          state: 'CURRENT',
          confidence: 0.9,
          reviewStatus: 'APPROVED',
        },
      ],
    });
    mocks.personFind.mockReturnValueOnce({
      select: () => ({
        lean: async () => [{ _id: personId, displayName: 'Dennis Spencer' }],
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

  it('no-ops on retired entity types', async () => {
    await syncEntity('listing', { _id: 'listing-id-1', title: 'Retired Listing' });
    await syncEntity('paper', { _id: 'paper-id-99', title: 'Retired Paper' });
    expect(mocks.getMeiliIndex).not.toHaveBeenCalled();
    expect(mocks.addDocuments).not.toHaveBeenCalled();
  });

  it('no-ops on unknown entity type', async () => {
    await syncEntity('user', { _id: 'x' });
    expect(mocks.getMeiliIndex).not.toHaveBeenCalled();
    expect(mocks.addDocuments).not.toHaveBeenCalled();
  });

  it('no-ops on null doc', async () => {
    await syncEntity('researchEntity', null);
    expect(mocks.addDocuments).not.toHaveBeenCalled();
  });

  it('swallows Meilisearch errors so callers do not break', async () => {
    mocks.addDocuments.mockRejectedValueOnce(new Error('meili down'));
    await expect(syncEntity('researchEntity', { _id: 'a', name: 't' })).resolves.toBeUndefined();
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
    await syncEntities('researchEntity', []);
    expect(mocks.getMeiliIndex).not.toHaveBeenCalled();
  });

  it('no-ops on retired and unknown entity types', async () => {
    await syncEntities('listing', [{ _id: 'x' }]);
    await syncEntities('user', [{ _id: 'y' }]);
    expect(mocks.getMeiliIndex).not.toHaveBeenCalled();
  });
});

describe('deleteFromIndex', () => {
  it('routes to the correct index and deletes by id', async () => {
    await deleteFromIndex('researchEntity', 'rg-id-1');
    expect(mocks.getMeiliIndex).toHaveBeenCalledWith('researchentities');
    expect(mocks.deleteDocument).toHaveBeenCalledWith('rg-id-1');
  });

  it('no-ops on retired and unknown entity types', async () => {
    await deleteFromIndex('paper', 'paper-id-1');
    await deleteFromIndex('user', 'x');
    expect(mocks.deleteDocument).not.toHaveBeenCalled();
  });

  it('no-ops on missing id', async () => {
    await deleteFromIndex('researchEntity', '');
    expect(mocks.deleteDocument).not.toHaveBeenCalled();
  });

  it('swallows Meilisearch errors', async () => {
    mocks.deleteDocument.mockRejectedValueOnce(new Error('boom'));
    await expect(deleteFromIndex('researchEntity', 'id-1')).resolves.toBeUndefined();
  });
});

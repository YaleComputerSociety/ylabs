import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';

const HEADING = 'Lymphoma, T-Cell, Cutaneous';

const mocks = vi.hoisted(() => {
  const addDocuments = vi.fn();
  const waitForTask = vi.fn();
  return {
    addDocuments,
    waitForTask,
    warmEnabled: { value: true },
    vocabularyReads: { count: 0 },
    getMeiliIndex: vi.fn(async () => ({
      addDocuments,
      deleteDocument: vi.fn(),
      deleteDocuments: vi.fn(),
      tasks: { waitForTask },
    })),
    emptyFind: () => ({ lean: async () => [], select: () => ({ lean: async () => [] }) }),
  };
});

vi.mock('../../utils/meiliClient', () => ({ getMeiliIndex: () => mocks.getMeiliIndex() }));
vi.mock('../../models/roleAssignment', () => ({ RoleAssignment: { find: mocks.emptyFind } }));
vi.mock('../../models/researcher', () => ({ Researcher: { find: mocks.emptyFind } }));
vi.mock('../../models/account', () => ({ Account: { find: mocks.emptyFind } }));
vi.mock('../../utils/controlledVocabularyHeadings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/controlledVocabularyHeadings')>();
  return {
    ...actual,
    warmServedResearchAreaVocabulary: async () => {
      if (mocks.warmEnabled.value) await actual.warmControlledVocabularyHeadings();
    },
  };
});

import { Observation } from '../../models/observation';
import { resetControlledVocabularyHeadingsCache } from '../../utils/controlledVocabularyHeadings';
import { syncEntities, syncEntity } from '../meiliSyncService';

const row = () => ({
  _id: new mongoose.Types.ObjectId(),
  slug: 'synthetic-lymphoma-lab',
  name: 'Synthetic Lymphoma Lab',
  kind: 'lab',
  entityType: 'LAB',
  departments: ['Dermatology'],
  researchAreas: [HEADING],
});

const indexedResearchAreas = (call = 0): string[] =>
  mocks.addDocuments.mock.calls[call][0][0].researchAreas ?? [];

beforeEach(() => {
  resetControlledVocabularyHeadingsCache();
  mocks.warmEnabled.value = true;
  mocks.vocabularyReads.count = 0;
  mocks.addDocuments.mockReset().mockResolvedValue({ taskUid: 1 });
  mocks.waitForTask.mockReset().mockResolvedValue({ status: 'succeeded' });
  vi.spyOn(Observation, 'find').mockImplementation((() => {
    mocks.vocabularyReads.count += 1;
    return { select: () => ({ lean: async () => [{ value: [HEADING] }] }) };
  }) as never);
});

afterEach(() => {
  vi.restoreAllMocks();
  resetControlledVocabularyHeadingsCache();
});

describe('a per-row search sync indexes the topics the reconcile indexes (#6542)', () => {
  it('keeps a multi-part controlled-vocabulary heading whole in a cold process', async () => {
    await syncEntity('researchEntity', row());

    expect(indexedResearchAreas()).toContain(HEADING);
  });

  it('splits the same heading when the sync path does not warm, so the case above is real', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    mocks.warmEnabled.value = false;

    await syncEntity('researchEntity', row());

    expect(indexedResearchAreas()).not.toContain(HEADING);
  });

  it('reads the vocabulary once for a batch, not once per row', async () => {
    await syncEntities('researchEntity', [row(), row(), row()]);

    expect(mocks.vocabularyReads.count).toBe(1);
    expect(mocks.addDocuments.mock.calls[0][0].map((doc: any) => doc.researchAreas)).toEqual([
      [HEADING],
      [HEADING],
      [HEADING],
    ]);
  });
});

import mongoose from 'mongoose';
import { describe, expect, it, vi } from 'vitest';
import {
  buildResearcherSearchIndexDocument,
  buildResearcherSearchIndexDocumentsForPage,
  rebuildResearcherSearchIndex,
  searchResearchersViaMeili,
  type ResearcherHomeStats,
} from '../researcherSearchIndexService';

const primaryLink = {
  kind: 'YALE_OFFICIAL' as const,
  purpose: 'PRIMARY_IDENTITY' as const,
  url: 'https://medicine.yale.edu/profile/ada',
  verifiedAt: new Date('2025-01-01T00:00:00Z'),
  healthStatus: 'HEALTHY' as const,
};

const makeDoc = (overrides: Record<string, unknown> = {}) => ({
  _id: new mongoose.Types.ObjectId(),
  displayName: 'Dr Ada Researcher',
  status: 'ACTIVE',
  archived: false,
  profile: { title: 'Professor of Cell Biology', primaryDepartment: 'Cell Biology' },
  profileLinks: [primaryLink],
  ...overrides,
});

describe('buildResearcherSearchIndexDocument', () => {
  it('indexes a findable researcher with home count and school', () => {
    const doc = makeDoc();
    const built = buildResearcherSearchIndexDocument(doc, {
      servableHomeCount: 2,
      school: 'School of Medicine',
    });
    expect(built).not.toBeNull();
    expect(built).toMatchObject({
      id: doc._id.toHexString(),
      publicKey: doc._id.toHexString(),
      displayName: 'Dr Ada Researcher',
      title: 'Professor of Cell Biology',
      primaryDepartment: 'Cell Biology',
      school: 'School of Medicine',
      homeCount: 2,
      archived: false,
    });
  });

  it('indexes a home-less researcher that has a primary identity link', () => {
    const built = buildResearcherSearchIndexDocument(makeDoc(), { servableHomeCount: 0 });
    expect(built?.homeCount).toBe(0);
  });

  it('drops a home-less researcher with no primary identity link', () => {
    const doc = makeDoc({ profileLinks: [] });
    expect(buildResearcherSearchIndexDocument(doc, { servableHomeCount: 0 })).toBeNull();
  });

  it('drops DEPARTED and archived researchers', () => {
    expect(
      buildResearcherSearchIndexDocument(makeDoc({ status: 'DEPARTED' }), { servableHomeCount: 3 }),
    ).toBeNull();
    expect(
      buildResearcherSearchIndexDocument(makeDoc({ archived: true }), { servableHomeCount: 3 }),
    ).toBeNull();
  });

  it('drops a lifespan-carrying display name', () => {
    const doc = makeDoc({ displayName: 'Jane Doe (1901-1980)' });
    expect(buildResearcherSearchIndexDocument(doc, { servableHomeCount: 3 })).toBeNull();
  });
});

describe('buildResearcherSearchIndexDocumentsForPage', () => {
  it('joins per-person home stats and filters out unfindable docs', async () => {
    const findable = makeDoc();
    const unfindable = makeDoc({ profileLinks: [] });
    const fetchHomeStats = vi.fn(async () => {
      const map = new Map<string, ResearcherHomeStats>();
      map.set(findable._id.toHexString(), { servableHomeCount: 1, school: 'Engineering' });
      map.set(unfindable._id.toHexString(), { servableHomeCount: 0 });
      return map;
    });

    const docs = await buildResearcherSearchIndexDocumentsForPage(
      [findable, unfindable],
      fetchHomeStats,
    );
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({ id: findable._id.toHexString(), homeCount: 1 });
    expect(fetchHomeStats).toHaveBeenCalledTimes(1);
  });
});

describe('rebuildResearcherSearchIndex', () => {
  it('pages through researchers and adds only findable index documents', async () => {
    const addDocuments = vi.fn(async (_docs: Record<string, any>[]) => undefined);
    const updateSettings = vi.fn(async () => undefined);
    const deleteAllDocuments = vi.fn(async () => undefined);
    const getIndex = vi.fn(async () => ({ addDocuments, updateSettings, deleteAllDocuments })) as any;

    const page1 = [makeDoc(), makeDoc({ profileLinks: [] })];
    const fetchPage = vi.fn(async (page: number) => (page === 1 ? page1 : []));
    const fetchHomeStats = vi.fn(async (ids: mongoose.Types.ObjectId[]) => {
      const map = new Map<string, ResearcherHomeStats>();
      for (const id of ids) map.set(id.toHexString(), { servableHomeCount: 1 });
      return map;
    });

    const result = await rebuildResearcherSearchIndex({
      clearExisting: true,
      getIndex,
      fetchPage,
      fetchHomeStats,
    });

    expect(updateSettings).toHaveBeenCalledTimes(1);
    expect(deleteAllDocuments).toHaveBeenCalledTimes(1);
    expect(result.fetchedDocumentCount).toBe(2);
    expect(result.indexedDocumentCount).toBe(2);
    expect(addDocuments).toHaveBeenCalledTimes(1);
    const added = addDocuments.mock.calls[0][0] as Record<string, any>[];
    expect(added).toHaveLength(2);
  });
});

describe('searchResearchersViaMeili', () => {
  it('returns empty for a blank query without hitting Meili', async () => {
    const getIndex = vi.fn();
    const result = await searchResearchersViaMeili('   ', { getIndex: getIndex as any });
    expect(result.hits).toEqual([]);
    expect(getIndex).not.toHaveBeenCalled();
  });

  it('maps Meili hits into researcher search hits', async () => {
    const id = new mongoose.Types.ObjectId().toHexString();
    const search = vi.fn(async () => ({
      hits: [
        {
          id,
          publicKey: id,
          displayName: 'Dr Ada Researcher',
          title: 'Professor',
          homeCount: 3,
        },
      ],
      estimatedTotalHits: 1,
    }));
    const getIndex = vi.fn(async () => ({ search })) as any;

    const result = await searchResearchersViaMeili('ada', { getIndex });
    expect(result.estimatedTotalHits).toBe(1);
    expect(result.hits[0]).toMatchObject({ id, displayName: 'Dr Ada Researcher', homeCount: 3 });
    expect(search).toHaveBeenCalledWith(
      'ada',
      expect.objectContaining({ filter: ['archived = false'] }),
    );
  });

  it('degrades to an empty result when Meili throws', async () => {
    const getIndex = vi.fn(async () => ({
      search: vi.fn(async () => {
        throw new Error('meili down');
      }),
    })) as any;
    const result = await searchResearchersViaMeili('ada', { getIndex });
    expect(result.hits).toEqual([]);
    expect(result.estimatedTotalHits).toBe(0);
  });
});

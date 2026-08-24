import { beforeEach, describe, expect, it, vi } from 'vitest';

const { search, getMeiliIndex, find, fetchResearcherPublicHomeAggregates } = vi.hoisted(() => {
  const searchFn = vi.fn();
  return {
    search: searchFn,
    getMeiliIndex: vi.fn(async () => ({ search: searchFn })),
    find: vi.fn(),
    fetchResearcherPublicHomeAggregates: vi.fn(),
  };
});

vi.mock('../../utils/meiliClient', () => ({ getMeiliIndex }));
vi.mock('../../models/researcher', () => ({ Researcher: { find } }));
vi.mock('../researcherSearchIndexService', () => ({
  RESEARCHER_SEARCH_INDEX_NAME: 'researchers',
  fetchResearcherPublicHomeAggregates,
}));

import { searchResearchersViaMeili } from '../researcherSearchService';

const ID_A = 'a'.repeat(24);
const ID_B = 'b'.repeat(24);

const leanFind = (docs: any[]) => ({ select: () => ({ lean: async () => docs }) });

describe('searchResearchersViaMeili', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns [] for a blank query without querying Meili', async () => {
    expect(await searchResearchersViaMeili('   ')).toEqual([]);
    expect(getMeiliIndex).not.toHaveBeenCalled();
  });

  it('preserves Meili order and enriches with live data', async () => {
    search.mockResolvedValue({ hits: [{ id: ID_B }, { id: ID_A }] });
    find.mockReturnValue(
      leanFind([
        { _id: ID_A, displayName: 'Dr Ada', profile: { title: 'Professor' }, profileLinks: [] },
        { _id: ID_B, displayName: 'Dr Ben', profile: {}, profileLinks: [] },
      ]),
    );
    fetchResearcherPublicHomeAggregates.mockResolvedValue(
      new Map([
        [ID_A, { homeNames: [], researchAreas: [], school: 'SEAS', homeCount: 2 }],
        [ID_B, { homeNames: [], researchAreas: [], homeCount: 1 }],
      ]),
    );

    const results = await searchResearchersViaMeili('smith');
    expect(results.map((r) => r.id)).toEqual([ID_B, ID_A]);
    expect(results[1]).toMatchObject({ displayName: 'Dr Ada', title: 'Professor', school: 'SEAS', homeCount: 2 });
  });

  it('drops a hit whose researcher is no longer live', async () => {
    search.mockResolvedValue({ hits: [{ id: ID_A }, { id: ID_B }] });
    find.mockReturnValue(
      leanFind([{ _id: ID_A, displayName: 'Dr Ada', profile: {}, profileLinks: [] }]),
    );
    fetchResearcherPublicHomeAggregates.mockResolvedValue(
      new Map([[ID_A, { homeNames: [], researchAreas: [], homeCount: 1 }]]),
    );

    const results = await searchResearchersViaMeili('smith');
    expect(results.map((r) => r.id)).toEqual([ID_A]);
  });

  it('drops a live researcher with no homes and no identity link', async () => {
    search.mockResolvedValue({ hits: [{ id: ID_A }] });
    find.mockReturnValue(
      leanFind([{ _id: ID_A, displayName: 'Dr Ghost', profile: {}, profileLinks: [] }]),
    );
    fetchResearcherPublicHomeAggregates.mockResolvedValue(new Map());

    expect(await searchResearchersViaMeili('smith')).toEqual([]);
  });

  it('fails open when the Meili index query throws', async () => {
    search.mockRejectedValue(new Error('index_not_found'));
    expect(await searchResearchersViaMeili('smith')).toEqual([]);
    expect(find).not.toHaveBeenCalled();
  });
});

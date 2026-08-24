import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  searchResearchGroupsViaMeili: vi.fn(),
}));

vi.mock('../researchGroupService', () => ({
  searchResearchGroupsViaMeili: mocks.searchResearchGroupsViaMeili,
}));

import {
  getDepartmentResearchPage,
  slugifyDepartmentName,
} from '../researchDepartmentPageService';

describe('slugifyDepartmentName', () => {
  it('lowercases, strips accents, and dashes non-alphanumeric runs', () => {
    expect(slugifyDepartmentName('Ecology & Evolutionary Biology')).toBe(
      'ecology-evolutionary-biology',
    );
    expect(slugifyDepartmentName('Molecular Biophysics & Biochemistry')).toBe(
      'molecular-biophysics-biochemistry',
    );
  });

  it('returns an empty string for blank input', () => {
    expect(slugifyDepartmentName('')).toBe('');
    expect(slugifyDepartmentName(undefined)).toBe('');
  });
});

describe('getDepartmentResearchPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves the slug against the live department facet and returns its entities', async () => {
    mocks.searchResearchGroupsViaMeili
      .mockResolvedValueOnce({
        researchEntities: [],
        estimatedTotalHits: 0,
        page: 1,
        pageSize: 1,
        facetDistribution: {
          departments: { Chemistry: 12, 'Ecology & Evolutionary Biology': 4 },
        },
      })
      .mockResolvedValueOnce({
        researchEntities: [{ slug: 'some-lab', name: 'Some Lab', entityType: 'LAB' }],
        estimatedTotalHits: 1,
        page: 1,
        pageSize: 100,
      });

    const page = await getDepartmentResearchPage('ecology-evolutionary-biology');

    expect(page).toEqual({
      department: 'Ecology & Evolutionary Biology',
      slug: 'ecology-evolutionary-biology',
      entities: [{ slug: 'some-lab', name: 'Some Lab', entityType: 'LAB' }],
      estimatedTotalHits: 1,
    });
    expect(mocks.searchResearchGroupsViaMeili).toHaveBeenLastCalledWith(
      '',
      { departments: ['Ecology & Evolutionary Biology'] },
      1,
      100,
      {},
      { includeNonPublic: false },
    );
  });

  it('returns null when no live department matches the slug', async () => {
    mocks.searchResearchGroupsViaMeili.mockResolvedValueOnce({
      researchEntities: [],
      estimatedTotalHits: 0,
      page: 1,
      pageSize: 1,
      facetDistribution: { departments: { Chemistry: 12 } },
    });

    const page = await getDepartmentResearchPage('not-a-real-department');

    expect(page).toBeNull();
    expect(mocks.searchResearchGroupsViaMeili).toHaveBeenCalledTimes(1);
  });

  it('returns null for a blank slug without querying Meilisearch', async () => {
    const page = await getDepartmentResearchPage('   ');

    expect(page).toBeNull();
    expect(mocks.searchResearchGroupsViaMeili).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';

const savedSearchModelMock = vi.hoisted(() => ({
  find: vi.fn(),
  create: vi.fn(),
  countDocuments: vi.fn(),
  updateOne: vi.fn(),
  findOne: vi.fn(),
  deleteOne: vi.fn(),
}));

const searchMock = vi.hoisted(() => ({ searchResearchGroupsViaMeili: vi.fn() }));
const accountMock = vi.hoisted(() => ({ resolveAccountIdByNetid: vi.fn() }));

vi.mock('../../models/savedSearch', async (importActual) => {
  const actual = await importActual<typeof import('../../models/savedSearch')>();
  return { ...actual, SavedSearch: savedSearchModelMock };
});

vi.mock('../researchGroupService', () => searchMock);
vi.mock('../accountService', () => accountMock);

import {
  createSavedSearch,
  deleteSavedSearch,
  listSavedSearches,
  markSavedSearchViewed,
  normalizeSavedSearchFilters,
  normalizeSavedSearchInput,
  renameSavedSearch,
  savedSearchFiltersAreEmpty,
} from '../savedSearchService';
import { MAX_SAVED_SEARCHES_PER_ACCOUNT } from '../../models/savedSearch';

const ACCOUNT_ID = new mongoose.Types.ObjectId();
const SEARCH_ID = new mongoose.Types.ObjectId().toHexString();

const findReturns = (docs: unknown[]) => {
  savedSearchModelMock.find.mockReturnValue({
    sort: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(docs) }),
  });
};

const findOneReturns = (doc: unknown) => {
  savedSearchModelMock.findOne.mockReturnValue({ lean: vi.fn().mockResolvedValue(doc) });
};

const meiliReturnsIds = (ids: string[]) => {
  searchMock.searchResearchGroupsViaMeili.mockResolvedValue({
    researchEntities: ids.map((id) => ({ _id: id })),
    estimatedTotalHits: ids.length,
    page: 1,
    pageSize: 200,
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  accountMock.resolveAccountIdByNetid.mockResolvedValue(ACCOUNT_ID);
  savedSearchModelMock.countDocuments.mockResolvedValue(0);
  savedSearchModelMock.create.mockResolvedValue({});
  savedSearchModelMock.updateOne.mockResolvedValue({ matchedCount: 1 });
  savedSearchModelMock.deleteOne.mockResolvedValue({ deletedCount: 1 });
  findReturns([]);
  meiliReturnsIds([]);
});

describe('normalizeSavedSearchFilters', () => {
  it('keeps only known keys, dedupes, and drops unknown enum values', () => {
    const filters = normalizeSavedSearchFilters({
      school: ['Yale College', 'Yale College'],
      departments: ['CS', ''],
      researchAreas: ['Machine Learning'],
      entityType: ['lab'],
      currentAvailability: ['OPEN', 'NONSENSE'],
      compensation: ['COURSE_CREDIT'],
      hostsUndergrads: true,
      hasDocumentedWayIn: 'yes',
      injected: ['ignored'],
    });

    expect(filters).toEqual({
      school: ['Yale College'],
      departments: ['CS'],
      researchAreas: ['Machine Learning'],
      entityType: ['lab'],
      currentAvailability: ['OPEN'],
      compensation: ['COURSE_CREDIT'],
      hostsUndergrads: true,
      hasDocumentedWayIn: false,
    });
    expect(filters).not.toHaveProperty('injected');
  });

  it('reports an empty filter set', () => {
    expect(savedSearchFiltersAreEmpty(normalizeSavedSearchFilters({}))).toBe(true);
    expect(
      savedSearchFiltersAreEmpty(normalizeSavedSearchFilters({ departments: ['CS'] })),
    ).toBe(false);
  });
});

describe('normalizeSavedSearchInput', () => {
  it('trims label, query, and leading question marks on url params', () => {
    const input = normalizeSavedSearchInput({
      label: '  My search  ',
      queryText: '  machine learning  ',
      urlParams: '??q=machine+learning&undergrad=1',
      filters: { departments: ['CS'] },
    });
    expect(input.label).toBe('My search');
    expect(input.queryText).toBe('machine learning');
    expect(input.urlParams).toBe('q=machine+learning&undergrad=1');
    expect(input.filters.departments).toEqual(['CS']);
  });
});

describe('createSavedSearch', () => {
  it('seeds last-seen ids with the current matches so a new search shows zero new', async () => {
    meiliReturnsIds(['A', 'B']);
    findReturns([
      {
        _id: SEARCH_ID,
        queryText: 'machine learning',
        filters: {},
        urlParams: 'q=machine+learning',
        lastSeenEntityIds: ['a', 'b'],
      },
    ]);

    const result = await createSavedSearch('abc123', {
      queryText: 'machine learning',
      filters: { departments: ['CS'] },
      urlParams: 'q=machine+learning',
    });

    const createArg = savedSearchModelMock.create.mock.calls[0][0];
    expect(createArg.accountId).toBe(ACCOUNT_ID);
    expect(createArg.lastSeenEntityIds).toEqual(['a', 'b']);
    expect(createArg.filters.departments).toEqual(['CS']);
    expect(result[0].newMatchCount).toBe(0);
  });

  it('rejects a search with neither query nor filters', async () => {
    await expect(
      createSavedSearch('abc123', { queryText: '', filters: {}, urlParams: '' }),
    ).rejects.toMatchObject({ status: 400 });
    expect(savedSearchModelMock.create).not.toHaveBeenCalled();
  });

  it('rejects once the per-account limit is reached', async () => {
    savedSearchModelMock.countDocuments.mockResolvedValue(MAX_SAVED_SEARCHES_PER_ACCOUNT);
    await expect(
      createSavedSearch('abc123', { queryText: 'x', filters: {}, urlParams: '' }),
    ).rejects.toMatchObject({ status: 409 });
    expect(savedSearchModelMock.create).not.toHaveBeenCalled();
  });

  it('still saves when the seed match computation fails', async () => {
    searchMock.searchResearchGroupsViaMeili.mockRejectedValue(new Error('meili down'));
    await createSavedSearch('abc123', {
      queryText: 'x',
      filters: {},
      urlParams: '',
    });
    const createArg = savedSearchModelMock.create.mock.calls[0][0];
    expect(createArg.lastSeenEntityIds).toEqual([]);
  });
});

describe('listSavedSearches', () => {
  it('counts matches that are new since the search was last viewed', async () => {
    findReturns([
      {
        _id: SEARCH_ID,
        queryText: 'ml',
        filters: {},
        urlParams: '',
        lastSeenEntityIds: ['a'],
      },
    ]);
    meiliReturnsIds(['A', 'B', 'C']);

    const [view] = await listSavedSearches('abc123');
    expect(view.newMatchCount).toBe(2);
    expect(savedSearchModelMock.find).toHaveBeenCalledWith({ accountId: ACCOUNT_ID });
  });

  it('hides the indicator when the count cannot be computed', async () => {
    findReturns([
      { _id: SEARCH_ID, queryText: 'ml', filters: {}, urlParams: '', lastSeenEntityIds: [] },
    ]);
    searchMock.searchResearchGroupsViaMeili.mockRejectedValue(new Error('meili down'));

    const [view] = await listSavedSearches('abc123');
    expect(view.newMatchCount).toBeNull();
  });
});

describe('markSavedSearchViewed', () => {
  it('refreshes the last-seen id set and stamps lastViewedAt', async () => {
    findOneReturns({ _id: SEARCH_ID, queryText: 'ml', filters: {}, lastSeenEntityIds: ['a'] });
    meiliReturnsIds(['A', 'B']);

    await markSavedSearchViewed('abc123', SEARCH_ID);

    const [filter, update] = savedSearchModelMock.updateOne.mock.calls[0];
    expect(filter).toMatchObject({ accountId: ACCOUNT_ID });
    expect(update.$set.lastSeenEntityIds).toEqual(['a', 'b']);
    expect(update.$set.lastViewedAt).toBeInstanceOf(Date);
  });

  it('does not clobber last-seen ids when the refresh computation fails', async () => {
    findOneReturns({ _id: SEARCH_ID, queryText: 'ml', filters: {}, lastSeenEntityIds: ['a'] });
    searchMock.searchResearchGroupsViaMeili.mockRejectedValue(new Error('meili down'));

    await markSavedSearchViewed('abc123', SEARCH_ID);

    const [, update] = savedSearchModelMock.updateOne.mock.calls[0];
    expect(update.$set).not.toHaveProperty('lastSeenEntityIds');
    expect(update.$set.lastViewedAt).toBeInstanceOf(Date);
  });

  it('throws NotFound when the search is not owned by the account', async () => {
    findOneReturns(null);
    await expect(markSavedSearchViewed('abc123', SEARCH_ID)).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe('renameSavedSearch', () => {
  it('scopes the update to the account and trims the label', async () => {
    await renameSavedSearch('abc123', SEARCH_ID, '  New name  ');
    const [filter, update] = savedSearchModelMock.updateOne.mock.calls[0];
    expect(filter).toMatchObject({ accountId: ACCOUNT_ID });
    expect(update.$set.label).toBe('New name');
  });

  it('throws NotFound when nothing matched', async () => {
    savedSearchModelMock.updateOne.mockResolvedValue({ matchedCount: 0 });
    await expect(renameSavedSearch('abc123', SEARCH_ID, 'x')).rejects.toMatchObject({
      status: 404,
    });
  });

  it('rejects a malformed id before touching the database', async () => {
    await expect(renameSavedSearch('abc123', 'not-an-id', 'x')).rejects.toMatchObject({
      status: 400,
    });
    expect(savedSearchModelMock.updateOne).not.toHaveBeenCalled();
  });
});

describe('deleteSavedSearch', () => {
  it('hard-deletes only the account-owned row', async () => {
    await deleteSavedSearch('abc123', SEARCH_ID);
    const [filter] = savedSearchModelMock.deleteOne.mock.calls[0];
    expect(filter).toMatchObject({ accountId: ACCOUNT_ID });
    expect(String(filter._id)).toBe(SEARCH_ID);
  });
});

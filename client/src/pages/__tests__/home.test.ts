import { describe, expect, it } from 'vitest';

import { getListingEmptyMessage, hasListingSearchCriteria } from '../../utils/listingEmptyState';

const baseParams = {
  queryString: '',
  selectedDepartments: [],
  selectedResearchAreas: [],
  selectedListingResearchAreas: [],
  quickFilter: null,
};

describe('getListingEmptyMessage', () => {
  it('explains that no labs are available when no search criteria are active', () => {
    expect(getListingEmptyMessage(baseParams)).toBe('No research labs are available right now');
  });

  it('mentions search or filters when a text query is active', () => {
    expect(getListingEmptyMessage({ ...baseParams, queryString: 'neuroscience' })).toBe(
      'No labs match your current search or filters',
    );
  });

  it('mentions search or filters when any filter is active', () => {
    expect(
      getListingEmptyMessage({
        ...baseParams,
        selectedDepartments: ['Computer Science'],
      }),
    ).toBe('No labs match your current search or filters');

    expect(getListingEmptyMessage({ ...baseParams, quickFilter: 'open' })).toBe(
      'No labs match your current search or filters',
    );
  });
});

describe('hasListingSearchCriteria', () => {
  it('returns false when the user has not searched or filtered', () => {
    expect(hasListingSearchCriteria(baseParams)).toBe(false);
  });

  it('returns true when the user has searched or filtered', () => {
    expect(hasListingSearchCriteria({ ...baseParams, queryString: 'biology' })).toBe(true);
    expect(
      hasListingSearchCriteria({
        ...baseParams,
        selectedListingResearchAreas: ['Genomics'],
      }),
    ).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';

import { getListingEmptyMessage } from '../home';

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

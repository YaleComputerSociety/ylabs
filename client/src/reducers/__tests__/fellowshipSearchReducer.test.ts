import { describe, expect, it } from 'vitest';

import { Fellowship } from '../../types/types';
import {
  FellowshipSearchState,
  createInitialFellowshipSearchState,
  fellowshipSearchReducer,
} from '../fellowshipSearchReducer';

const makeFellowship = (overrides: Partial<Fellowship> = {}): Fellowship => ({
  id: 'f-1',
  title: 'Fellowship',
  competitionType: '',
  summary: '',
  description: '',
  applicationInformation: '',
  eligibility: '',
  restrictionsToUseOfAward: '',
  additionalInformation: '',
  links: [],
  applicationLink: '',
  awardAmount: '',
  isAcceptingApplications: true,
  applicationOpenDate: null,
  deadline: null,
  contactName: '',
  contactEmail: '',
  contactPhone: '',
  contactOffice: '',
  yearOfStudy: [],
  termOfAward: [],
  purpose: [],
  globalRegions: [],
  citizenshipStatus: [],
  archived: false,
  audited: false,
  views: 0,
  favorites: 0,
  updatedAt: '',
  createdAt: '',
  ...overrides,
});

describe('fellowshipSearchReducer', () => {
  it('initial state has the expected defaults', () => {
    const state = createInitialFellowshipSearchState();
    expect(state.sortDirection).toBe('desc');
    expect(state.sortOrder).toBe(-1);
    expect(state.filterOptionsLoaded).toBe(false);
    expect(state.filterOptions.yearOfStudy).toEqual([]);
  });

  it('SET_QUERY_STRING updates the query', () => {
    const state = createInitialFellowshipSearchState();
    const next = fellowshipSearchReducer(state, {
      type: 'SET_QUERY_STRING',
      payload: 'research',
    });
    expect(next.queryString).toBe('research');
  });

  it('updater form works for SET_SELECTED_YEAR_OF_STUDY', () => {
    const state = createInitialFellowshipSearchState({
      selectedYearOfStudy: ['Senior'],
    });
    const next = fellowshipSearchReducer(state, {
      type: 'SET_SELECTED_YEAR_OF_STUDY',
      payload: (prev) => [...prev, 'Junior'],
    });
    expect(next.selectedYearOfStudy).toEqual(['Senior', 'Junior']);
  });

  it('TOGGLE_SORT_DIRECTION flips direction and order', () => {
    const state = createInitialFellowshipSearchState();
    const once = fellowshipSearchReducer(state, { type: 'TOGGLE_SORT_DIRECTION' });
    expect(once.sortDirection).toBe('asc');
    expect(once.sortOrder).toBe(1);
    const twice = fellowshipSearchReducer(once, { type: 'TOGGLE_SORT_DIRECTION' });
    expect(twice.sortDirection).toBe('desc');
    expect(twice.sortOrder).toBe(-1);
  });

  it('SET_FILTER_OPTIONS replaces options in full', () => {
    const state = createInitialFellowshipSearchState();
    const next = fellowshipSearchReducer(state, {
      type: 'SET_FILTER_OPTIONS',
      payload: {
        yearOfStudy: ['Senior'],
        termOfAward: ['Summer'],
        purpose: ['Research'],
        globalRegions: ['Europe'],
        citizenshipStatus: ['US Citizen'],
      },
    });
    expect(next.filterOptions.yearOfStudy).toEqual(['Senior']);
    expect(next.filterOptions.globalRegions).toEqual(['Europe']);
  });

  it('SEARCH_SUCCESS with append=false replaces and total falls back to length when payload omits total', () => {
    const state = createInitialFellowshipSearchState({
      fellowships: [makeFellowship({ id: 'old' })],
    });
    const next = fellowshipSearchReducer(state, {
      type: 'SEARCH_SUCCESS',
      payload: {
        fellowships: [makeFellowship({ id: 'a' }), makeFellowship({ id: 'b' })],
        pageSize: 500,
        append: false,
      },
    });
    expect(next.fellowships.map((f) => f.id)).toEqual(['a', 'b']);
    expect(next.total).toBe(2);
    expect(next.isLoading).toBe(false);
  });

  it('SEARCH_SUCCESS with append=true concatenates', () => {
    const state = createInitialFellowshipSearchState({
      fellowships: [makeFellowship({ id: 'a' })],
    });
    const next = fellowshipSearchReducer(state, {
      type: 'SEARCH_SUCCESS',
      payload: {
        fellowships: [makeFellowship({ id: 'b' })],
        total: 99,
        pageSize: 500,
        append: true,
      },
    });
    expect(next.fellowships.map((f) => f.id)).toEqual(['a', 'b']);
    expect(next.total).toBe(99);
  });

  it('RESET_LIFECYCLE_FLAGS resets all loaded flags', () => {
    const state: FellowshipSearchState = createInitialFellowshipSearchState({
      queryStringLoaded: true,
      filtersLoaded: true,
      initialSearchDone: true,
      filterOptionsLoaded: true,
    });
    const next = fellowshipSearchReducer(state, { type: 'RESET_LIFECYCLE_FLAGS' });
    expect(next.queryStringLoaded).toBe(false);
    expect(next.filtersLoaded).toBe(false);
    expect(next.initialSearchDone).toBe(false);
    expect(next.filterOptionsLoaded).toBe(false);
  });

  it('RESET_LIFECYCLE_FLAGS preserves current selections and results', () => {
    const fellowships = [makeFellowship({ id: 'keep' })];
    const state = createInitialFellowshipSearchState({
      fellowships,
      selectedPurpose: ['Research'],
      queryString: 'keep me',
      filtersLoaded: true,
    });
    const next = fellowshipSearchReducer(state, { type: 'RESET_LIFECYCLE_FLAGS' });
    expect(next.fellowships).toBe(fellowships);
    expect(next.selectedPurpose).toEqual(['Research']);
    expect(next.queryString).toBe('keep me');
  });

  it('does not mutate previous state', () => {
    const state = createInitialFellowshipSearchState({
      selectedRegions: ['Asia'],
    });
    const snapshot = JSON.stringify(state);
    fellowshipSearchReducer(state, { type: 'SET_SELECTED_REGIONS', payload: ['Europe'] });
    fellowshipSearchReducer(state, { type: 'TOGGLE_SORT_DIRECTION' });
    expect(JSON.stringify(state)).toBe(snapshot);
  });
});

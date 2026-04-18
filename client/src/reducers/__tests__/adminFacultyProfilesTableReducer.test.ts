import { describe, expect, it } from 'vitest';

import {
  adminFacultyProfilesTableReducer,
  createInitialAdminFacultyProfilesTableState,
} from '../adminFacultyProfilesTableReducer';

interface TestProfile {
  _id: string;
  netid: string;
}
const make = (id: string): TestProfile => ({ _id: id, netid: id });

describe('adminFacultyProfilesTableReducer (specialization of generic admin table)', () => {
  it('default sort is lname ascending; filters start empty', () => {
    const state = createInitialAdminFacultyProfilesTableState<TestProfile>();
    expect(state.sortBy).toBe('lname');
    expect(state.sortOrder).toBe('asc');
    expect(state.filters).toEqual({ profileVerified: '', hasListings: '' });
    expect(state.isLoading).toBe(true);
  });

  it('SET_FILTER on profileVerified updates only that key', () => {
    const state = createInitialAdminFacultyProfilesTableState<TestProfile>();
    const next = adminFacultyProfilesTableReducer<TestProfile>(state, {
      type: 'SET_FILTER',
      filter: 'profileVerified',
      value: 'true',
    });
    expect(next.filters.profileVerified).toBe('true');
    expect(next.filters.hasListings).toBe('');
  });

  it('FETCH_SUCCESS populates items/total/totalPages', () => {
    const state = createInitialAdminFacultyProfilesTableState<TestProfile>();
    const next = adminFacultyProfilesTableReducer<TestProfile>(state, {
      type: 'FETCH_SUCCESS',
      items: [make('a'), make('b'), make('c')],
      total: 100,
      totalPages: 4,
    });
    expect(next.items).toHaveLength(3);
    expect(next.total).toBe(100);
    expect(next.totalPages).toBe(4);
    expect(next.isLoading).toBe(false);
  });

  it('OPEN_EDIT stores row on `editing`', () => {
    const row = make('x');
    const state = createInitialAdminFacultyProfilesTableState<TestProfile>();
    const next = adminFacultyProfilesTableReducer<TestProfile>(state, {
      type: 'OPEN_EDIT',
      item: row,
    });
    expect(next.editing).toBe(row);
  });
});

import { describe, expect, it } from 'vitest';

import {
  adminFellowshipsTableReducer,
  createInitialAdminFellowshipsTableState,
} from '../adminFellowshipsTableReducer';

// Minimal fellowship-shaped row for assertions; the reducer is generic.
interface TestFellowship {
  _id: string;
  title: string;
}
const make = (id: string): TestFellowship => ({ _id: id, title: `Fellowship ${id}` });

describe('adminFellowshipsTableReducer (specialization of generic admin table)', () => {
  it('default sort column is createdAt with archived + audited filters', () => {
    const state = createInitialAdminFellowshipsTableState<TestFellowship>();
    expect(state.sortBy).toBe('createdAt');
    expect(state.sortOrder).toBe('desc');
    expect(state.filters).toEqual({ archived: '', audited: '' });
  });

  it('delegates FETCH_SUCCESS to the generic reducer', () => {
    const state = createInitialAdminFellowshipsTableState<TestFellowship>();
    const next = adminFellowshipsTableReducer<TestFellowship>(state, {
      type: 'FETCH_SUCCESS',
      items: [make('a'), make('b')],
      total: 2,
      totalPages: 1,
    });
    expect(next.items).toHaveLength(2);
    expect(next.total).toBe(2);
  });

  it('SET_FILTER on audited updates just that filter', () => {
    const state = createInitialAdminFellowshipsTableState<TestFellowship>();
    const next = adminFellowshipsTableReducer<TestFellowship>(state, {
      type: 'SET_FILTER',
      filter: 'audited',
      value: 'true',
    });
    expect(next.filters.audited).toBe('true');
    expect(next.filters.archived).toBe('');
    expect(next.page).toBe(1);
  });

  it('OPEN_EDIT stores the row on `editing`', () => {
    const row = make('x');
    const state = createInitialAdminFellowshipsTableState<TestFellowship>();
    const next = adminFellowshipsTableReducer<TestFellowship>(state, {
      type: 'OPEN_EDIT',
      item: row,
    });
    expect(next.editing).toBe(row);
  });
});

import { describe, expect, it } from 'vitest';

import {
  publicationsTableReducer,
  createInitialPublicationsTableState,
} from '../publicationsTableReducer';

// Minimal publication-shaped row for assertions; the reducer is generic.
interface TestPublication {
  title: string;
  year: number;
}
const make = (title: string, year: number): TestPublication => ({ title, year });

describe('publicationsTableReducer (specialization of generic admin table)', () => {
  it('default sort column is year desc with empty filters', () => {
    const state = createInitialPublicationsTableState<TestPublication>();
    expect(state.sortBy).toBe('year');
    expect(state.sortOrder).toBe('desc');
    expect(state.filters).toEqual({});
    expect(state.page).toBe(1);
    expect(state.pageSize).toBe(20);
  });

  it('FETCH_SUCCESS populates items/total/totalPages and clears loading', () => {
    const state = createInitialPublicationsTableState<TestPublication>();
    const next = publicationsTableReducer<TestPublication>(state, {
      type: 'FETCH_SUCCESS',
      items: [make('A', 2024), make('B', 2023)],
      total: 2,
      totalPages: 1,
    });
    expect(next.items).toHaveLength(2);
    expect(next.total).toBe(2);
    expect(next.totalPages).toBe(1);
    expect(next.isLoading).toBe(false);
  });

  it('TOGGLE_SORT flips direction on the same column', () => {
    const state = createInitialPublicationsTableState<TestPublication>();
    const flipped = publicationsTableReducer<TestPublication>(state, {
      type: 'TOGGLE_SORT',
      field: 'year',
    });
    expect(flipped.sortBy).toBe('year');
    expect(flipped.sortOrder).toBe('asc');
  });

  it('TOGGLE_SORT on a new column resets direction to desc', () => {
    const state = createInitialPublicationsTableState<TestPublication>();
    const next = publicationsTableReducer<TestPublication>(state, {
      type: 'TOGGLE_SORT',
      field: 'title',
    });
    expect(next.sortBy).toBe('title');
    expect(next.sortOrder).toBe('desc');
    expect(next.page).toBe(1);
  });

  it('SET_PAGE updates page without resetting other state', () => {
    const state = createInitialPublicationsTableState<TestPublication>();
    const seeded = publicationsTableReducer<TestPublication>(state, {
      type: 'FETCH_SUCCESS',
      items: [make('A', 2024)],
      total: 50,
      totalPages: 3,
    });
    const paged = publicationsTableReducer<TestPublication>(seeded, {
      type: 'SET_PAGE',
      payload: 2,
    });
    expect(paged.page).toBe(2);
    expect(paged.total).toBe(50);
    expect(paged.totalPages).toBe(3);
    expect(paged.sortBy).toBe('year');
  });
});

import { describe, expect, it } from 'vitest';

import {
  browsePageReducer,
  createInitialBrowsePageState,
} from '../browsePageReducer';

interface SampleItem {
  id: string;
  title: string;
}

const itemA: SampleItem = { id: 'a', title: 'Alpha' };
const itemB: SampleItem = { id: 'b', title: 'Beta' };

describe('browsePageReducer', () => {
  it('initial state has empty favorites, no selection, modals closed', () => {
    const state = createInitialBrowsePageState<SampleItem>();
    expect(state.favIds).toEqual([]);
    expect(state.selectedItem).toBeNull();
    expect(state.isDetailModalOpen).toBe(false);
    expect(state.adminEditItem).toBeNull();
  });

  it('OPEN_DETAIL_MODAL atomically sets selectedItem and opens the modal', () => {
    const state = createInitialBrowsePageState<SampleItem>();
    const next = browsePageReducer(state, { type: 'OPEN_DETAIL_MODAL', item: itemA });
    expect(next.selectedItem).toBe(itemA);
    expect(next.isDetailModalOpen).toBe(true);
  });

  it('CLOSE_DETAIL_MODAL atomically clears selectedItem and closes the modal', () => {
    const opened = browsePageReducer(createInitialBrowsePageState<SampleItem>(), {
      type: 'OPEN_DETAIL_MODAL',
      item: itemA,
    });
    const closed = browsePageReducer(opened, { type: 'CLOSE_DETAIL_MODAL' });
    expect(closed.selectedItem).toBeNull();
    expect(closed.isDetailModalOpen).toBe(false);
  });

  it('OPEN_ADMIN_EDIT sets adminEditItem without affecting detail modal state', () => {
    const withDetail = browsePageReducer(createInitialBrowsePageState<SampleItem>(), {
      type: 'OPEN_DETAIL_MODAL',
      item: itemA,
    });
    const next = browsePageReducer(withDetail, { type: 'OPEN_ADMIN_EDIT', item: itemB });
    expect(next.adminEditItem).toBe(itemB);
    expect(next.selectedItem).toBe(itemA);
    expect(next.isDetailModalOpen).toBe(true);
  });

  it('CLOSE_ADMIN_EDIT clears adminEditItem only', () => {
    const opened = browsePageReducer(createInitialBrowsePageState<SampleItem>(), {
      type: 'OPEN_ADMIN_EDIT',
      item: itemA,
    });
    const closed = browsePageReducer(opened, { type: 'CLOSE_ADMIN_EDIT' });
    expect(closed.adminEditItem).toBeNull();
  });

  it('SET_FAVORITES replaces favIds without touching modal state', () => {
    const withModal = browsePageReducer(createInitialBrowsePageState<SampleItem>(), {
      type: 'OPEN_DETAIL_MODAL',
      item: itemA,
    });
    const next = browsePageReducer(withModal, {
      type: 'SET_FAVORITES',
      ids: ['x', 'y'],
    });
    expect(next.favIds).toEqual(['x', 'y']);
    expect(next.selectedItem).toBe(itemA);
    expect(next.isDetailModalOpen).toBe(true);
  });

  it('SET_FAVORITES supports optimistic add and rollback patterns', () => {
    const initial = createInitialBrowsePageState<SampleItem>({ favIds: ['a'] });
    const optimistic = browsePageReducer(initial, {
      type: 'SET_FAVORITES',
      ids: ['b', 'a'],
    });
    expect(optimistic.favIds).toEqual(['b', 'a']);
    const rolledBack = browsePageReducer(optimistic, {
      type: 'SET_FAVORITES',
      ids: ['a'],
    });
    expect(rolledBack.favIds).toEqual(['a']);
  });

  it('reducer does not mutate prior state', () => {
    const state = createInitialBrowsePageState<SampleItem>({ favIds: ['a'] });
    const snapshot = JSON.stringify(state);
    browsePageReducer(state, { type: 'OPEN_DETAIL_MODAL', item: itemA });
    browsePageReducer(state, { type: 'OPEN_ADMIN_EDIT', item: itemB });
    browsePageReducer(state, { type: 'SET_FAVORITES', ids: ['x'] });
    expect(JSON.stringify(state)).toBe(snapshot);
  });

  it('returns same reference for unknown action', () => {
    const state = createInitialBrowsePageState<SampleItem>();
    // @ts-expect-error intentionally invalid
    expect(browsePageReducer(state, { type: 'NOPE' })).toBe(state);
  });
});

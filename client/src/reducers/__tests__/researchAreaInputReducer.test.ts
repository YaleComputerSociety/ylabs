import { describe, expect, it } from 'vitest';

import {
  createInitialResearchAreaInputState,
  researchAreaInputReducer,
  ResearchAreaInputAction,
} from '../researchAreaInputReducer';

describe('researchAreaInputReducer', () => {
  it('initial state is fully closed with empty search and no focus', () => {
    const state = createInitialResearchAreaInputState();
    expect(state.isDropdownOpen).toBe(false);
    expect(state.searchTerm).toBe('');
    expect(state.focusedIndex).toBe(-1);
    expect(state.isModalOpen).toBe(false);
    expect(state.pendingNewArea).toBe('');
    expect(state.isLoading).toBe(false);
  });

  describe('dropdown state', () => {
    it('OPEN_DROPDOWN opens, clears stale search, and resets focus', () => {
      const state = createInitialResearchAreaInputState({
        isDropdownOpen: false,
        searchTerm: 'stale',
        focusedIndex: 3,
      });
      const next = researchAreaInputReducer(state, { type: 'OPEN_DROPDOWN' });
      expect(next.isDropdownOpen).toBe(true);
      expect(next.searchTerm).toBe('');
      expect(next.focusedIndex).toBe(-1);
    });

    it('CLOSE_DROPDOWN closes, clears search, and resets focus atomically', () => {
      const state = createInitialResearchAreaInputState({
        isDropdownOpen: true,
        searchTerm: 'bio',
        focusedIndex: 2,
      });
      const next = researchAreaInputReducer(state, { type: 'CLOSE_DROPDOWN' });
      expect(next.isDropdownOpen).toBe(false);
      expect(next.searchTerm).toBe('');
      expect(next.focusedIndex).toBe(-1);
    });

    it('SET_SEARCH_TERM updates the search and resets focus index', () => {
      const state = createInitialResearchAreaInputState({ focusedIndex: 5 });
      const next = researchAreaInputReducer(state, {
        type: 'SET_SEARCH_TERM',
        payload: 'neuro',
      });
      expect(next.searchTerm).toBe('neuro');
      expect(next.focusedIndex).toBe(-1);
    });

    it('SET_FOCUSED_INDEX supports a functional updater for ArrowDown', () => {
      const state = createInitialResearchAreaInputState({ focusedIndex: 2 });
      const next = researchAreaInputReducer(state, {
        type: 'SET_FOCUSED_INDEX',
        payload: (prev) => prev + 1,
      });
      expect(next.focusedIndex).toBe(3);
    });

    it('SET_FOCUSED_INDEX accepts a plain number', () => {
      const state = createInitialResearchAreaInputState({ focusedIndex: 2 });
      const next = researchAreaInputReducer(state, {
        type: 'SET_FOCUSED_INDEX',
        payload: 0,
      });
      expect(next.focusedIndex).toBe(0);
    });

    it('SELECT_AREA closes dropdown, clears search, and resets focus atomically', () => {
      const state = createInitialResearchAreaInputState({
        isDropdownOpen: true,
        searchTerm: 'gen',
        focusedIndex: 1,
      });
      const next = researchAreaInputReducer(state, { type: 'SELECT_AREA' });
      expect(next.isDropdownOpen).toBe(false);
      expect(next.searchTerm).toBe('');
      expect(next.focusedIndex).toBe(-1);
    });
  });

  describe('add-new modal', () => {
    it('OPEN_ADD_MODAL with payload seeds pendingNewArea and closes the dropdown', () => {
      const state = createInitialResearchAreaInputState({
        isDropdownOpen: true,
        searchTerm: 'something',
      });
      const next = researchAreaInputReducer(state, {
        type: 'OPEN_ADD_MODAL',
        payload: 'Explicit Area',
      });
      expect(next.isModalOpen).toBe(true);
      expect(next.isDropdownOpen).toBe(false);
      expect(next.pendingNewArea).toBe('Explicit Area');
    });

    it('OPEN_ADD_MODAL without payload uses the current (trimmed) searchTerm', () => {
      const state = createInitialResearchAreaInputState({
        isDropdownOpen: true,
        searchTerm: '  Quantum Biology  ',
      });
      const next = researchAreaInputReducer(state, { type: 'OPEN_ADD_MODAL' });
      expect(next.isModalOpen).toBe(true);
      expect(next.isDropdownOpen).toBe(false);
      expect(next.pendingNewArea).toBe('Quantum Biology');
    });

    it('CLOSE_ADD_MODAL closes modal and resets pendingNewArea', () => {
      const state = createInitialResearchAreaInputState({
        isModalOpen: true,
        pendingNewArea: 'Draft',
      });
      const next = researchAreaInputReducer(state, { type: 'CLOSE_ADD_MODAL' });
      expect(next.isModalOpen).toBe(false);
      expect(next.pendingNewArea).toBe('');
    });

    it('SET_PENDING_AREA updates the pending text', () => {
      const state = createInitialResearchAreaInputState({ pendingNewArea: 'old' });
      const next = researchAreaInputReducer(state, {
        type: 'SET_PENDING_AREA',
        payload: 'new',
      });
      expect(next.pendingNewArea).toBe('new');
    });
  });

  describe('submit lifecycle', () => {
    it('SUBMIT_START sets isLoading true', () => {
      const state = createInitialResearchAreaInputState();
      const next = researchAreaInputReducer(state, { type: 'SUBMIT_START' });
      expect(next.isLoading).toBe(true);
    });

    it('SUBMIT_END sets isLoading false', () => {
      const state = createInitialResearchAreaInputState({ isLoading: true });
      const next = researchAreaInputReducer(state, { type: 'SUBMIT_END' });
      expect(next.isLoading).toBe(false);
    });
  });

  it('does not mutate previous state', () => {
    const state = createInitialResearchAreaInputState({
      isDropdownOpen: true,
      searchTerm: 'bio',
      focusedIndex: 2,
    });
    const snapshot = JSON.stringify(state);
    researchAreaInputReducer(state, { type: 'CLOSE_DROPDOWN' });
    researchAreaInputReducer(state, { type: 'SELECT_AREA' });
    researchAreaInputReducer(state, { type: 'OPEN_ADD_MODAL' });
    researchAreaInputReducer(state, {
      type: 'SET_FOCUSED_INDEX',
      payload: (prev) => prev + 1,
    });
    researchAreaInputReducer(state, { type: 'SUBMIT_START' });
    expect(JSON.stringify(state)).toBe(snapshot);
  });

  it('returns the same state reference for unknown actions', () => {
    const state = createInitialResearchAreaInputState();
    const next = researchAreaInputReducer(
      state,
      { type: 'NOT_A_REAL_ACTION' } as unknown as ResearchAreaInputAction,
    );
    expect(next).toBe(state);
  });
});

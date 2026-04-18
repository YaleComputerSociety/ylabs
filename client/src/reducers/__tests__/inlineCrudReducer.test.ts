import { describe, expect, it } from 'vitest';

import { createInitialInlineCrudState, inlineCrudReducer } from '../inlineCrudReducer';

interface Row {
  _id: string;
  name: string;
}
interface NewDraft {
  name: string;
  category: string;
}
interface EditDraft {
  name: string;
  category: string;
  active: boolean;
}

const initialNewDraft: NewDraft = { name: '', category: 'A' };
const makeState = () => createInitialInlineCrudState<Row, NewDraft, EditDraft>(initialNewDraft);
const reduce = (
  s: ReturnType<typeof makeState>,
  a: Parameters<typeof inlineCrudReducer<Row, NewDraft, EditDraft>>[1],
) => inlineCrudReducer<Row, NewDraft, EditDraft>(s, a);

describe('inlineCrudReducer (generic)', () => {
  it('initial state: loading, empty items, initial new draft, no edit', () => {
    const state = makeState();
    expect(state.isLoading).toBe(true);
    expect(state.items).toEqual([]);
    expect(state.search).toBe('');
    expect(state.newDraft).toEqual(initialNewDraft);
    expect(state.editingId).toBeNull();
    expect(state.editDraft).toBeNull();
  });

  describe('fetch lifecycle', () => {
    it('FETCH_START sets loading', () => {
      const state = { ...makeState(), isLoading: false };
      expect(reduce(state, { type: 'FETCH_START' }).isLoading).toBe(true);
    });

    it('FETCH_SUCCESS populates items', () => {
      const state = makeState();
      const next = reduce(state, {
        type: 'FETCH_SUCCESS',
        items: [
          { _id: 'a', name: 'A' },
          { _id: 'b', name: 'B' },
        ],
      });
      expect(next.isLoading).toBe(false);
      expect(next.items).toHaveLength(2);
    });

    it('FETCH_FAILURE clears loading but preserves items', () => {
      const withData = reduce(makeState(), {
        type: 'FETCH_SUCCESS',
        items: [{ _id: 'a', name: 'A' }],
      });
      const next = reduce(withData, { type: 'FETCH_FAILURE' });
      expect(next.isLoading).toBe(false);
      expect(next.items).toHaveLength(1);
    });
  });

  describe('new draft', () => {
    it('SET_NEW_DRAFT patches one field', () => {
      const next = reduce(makeState(), {
        type: 'SET_NEW_DRAFT',
        payload: { name: 'Biology' },
      });
      expect(next.newDraft.name).toBe('Biology');
      expect(next.newDraft.category).toBe('A');
    });

    it('SET_NEW_DRAFT can patch multiple fields', () => {
      const next = reduce(makeState(), {
        type: 'SET_NEW_DRAFT',
        payload: { name: 'X', category: 'B' },
      });
      expect(next.newDraft).toEqual({ name: 'X', category: 'B' });
    });

    it('RESET_NEW_DRAFT replaces the entire draft', () => {
      const edited = reduce(makeState(), {
        type: 'SET_NEW_DRAFT',
        payload: { name: 'Biology', category: 'B' },
      });
      const next = reduce(edited, { type: 'RESET_NEW_DRAFT', initial: initialNewDraft });
      expect(next.newDraft).toEqual(initialNewDraft);
    });
  });

  describe('edit draft', () => {
    it('START_EDIT stores id + draft', () => {
      const draft: EditDraft = { name: 'Existing', category: 'A', active: true };
      const next = reduce(makeState(), { type: 'START_EDIT', id: 'abc', draft });
      expect(next.editingId).toBe('abc');
      expect(next.editDraft).toBe(draft);
    });

    it('SET_EDIT_DRAFT patches the current draft', () => {
      const draft: EditDraft = { name: 'Existing', category: 'A', active: true };
      const started = reduce(makeState(), { type: 'START_EDIT', id: 'abc', draft });
      const next = reduce(started, {
        type: 'SET_EDIT_DRAFT',
        payload: { name: 'Updated' },
      });
      expect(next.editDraft).toEqual({ name: 'Updated', category: 'A', active: true });
    });

    it('SET_EDIT_DRAFT is a no-op when no row is being edited', () => {
      const state = makeState();
      const next = reduce(state, {
        type: 'SET_EDIT_DRAFT',
        payload: { name: 'phantom' },
      });
      expect(next).toBe(state);
      expect(next.editDraft).toBeNull();
    });

    it('CANCEL_EDIT clears id + draft', () => {
      const draft: EditDraft = { name: 'Existing', category: 'A', active: true };
      const started = reduce(makeState(), { type: 'START_EDIT', id: 'abc', draft });
      const next = reduce(started, { type: 'CANCEL_EDIT' });
      expect(next.editingId).toBeNull();
      expect(next.editDraft).toBeNull();
    });
  });

  describe('search', () => {
    it('SET_SEARCH stores the value (no page reset — client-side filter)', () => {
      const next = reduce(makeState(), { type: 'SET_SEARCH', payload: 'bio' });
      expect(next.search).toBe('bio');
    });
  });

  it('does not mutate prior state', () => {
    const state = makeState();
    const snapshot = JSON.stringify(state);
    reduce(state, { type: 'SET_NEW_DRAFT', payload: { name: 'X' } });
    reduce(state, {
      type: 'FETCH_SUCCESS',
      items: [{ _id: 'a', name: 'A' }],
    });
    expect(JSON.stringify(state)).toBe(snapshot);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  accountTrackingReducer,
  createInitialAccountTrackingState,
  loadAccountTrackingFromStorage,
} from '../accountTrackingReducer';

describe('accountTrackingReducer', () => {
  describe('initial state', () => {
    it('starts empty', () => {
      const state = createInitialAccountTrackingState();
      expect(state.labStage).toEqual({});
      expect(state.labNotes).toEqual({});
      expect(state.fellowshipStage).toEqual({});
      expect(state.fellowshipNotes).toEqual({});
      expect(state.editingNoteId).toBeNull();
      expect(state.editingFellowshipNoteId).toBeNull();
    });
  });

  describe('TOGGLE_EMAILED_LISTING', () => {
    it('marks a previously-untracked listing as emailed', () => {
      const state = createInitialAccountTrackingState();
      const next = accountTrackingReducer(state, {
        type: 'TOGGLE_EMAILED_LISTING',
        listingId: 'abc',
      });
      expect(next.labStage).toEqual({ abc: 'emailed' });
    });

    it('clears an already-emailed listing', () => {
      const state = createInitialAccountTrackingState({ labStage: { abc: 'emailed' } });
      const next = accountTrackingReducer(state, {
        type: 'TOGGLE_EMAILED_LISTING',
        listingId: 'abc',
      });
      expect(next.labStage.abc).toBeUndefined();
    });

    it('clears a listing at a further-along stage (e.g. interviewing)', () => {
      const state = createInitialAccountTrackingState({
        labStage: { abc: 'interview' },
      });
      const next = accountTrackingReducer(state, {
        type: 'TOGGLE_EMAILED_LISTING',
        listingId: 'abc',
      });
      expect(next.labStage.abc).toBeUndefined();
    });
  });

  describe('SET_LAB_STAGE', () => {
    it('sets a named stage', () => {
      const state = createInitialAccountTrackingState();
      const next = accountTrackingReducer(state, {
        type: 'SET_LAB_STAGE',
        listingId: 'abc',
        stage: 'interview',
      });
      expect(next.labStage.abc).toBe('interview');
    });

    it('removes the entry when stage resets to not_emailed', () => {
      const state = createInitialAccountTrackingState({ labStage: { abc: 'emailed' } });
      const next = accountTrackingReducer(state, {
        type: 'SET_LAB_STAGE',
        listingId: 'abc',
        stage: 'not_emailed',
      });
      expect(next.labStage.abc).toBeUndefined();
    });

    it('does not touch other listings', () => {
      const state = createInitialAccountTrackingState({
        labStage: { abc: 'emailed', xyz: 'responded' },
      });
      const next = accountTrackingReducer(state, {
        type: 'SET_LAB_STAGE',
        listingId: 'abc',
        stage: 'interview',
      });
      expect(next.labStage.xyz).toBe('responded');
    });
  });

  describe('SET_LAB_NOTE + TOGGLE_EDITING_LAB_NOTE', () => {
    it('sets a note per listing', () => {
      const state = createInitialAccountTrackingState();
      const next = accountTrackingReducer(state, {
        type: 'SET_LAB_NOTE',
        listingId: 'abc',
        value: 'Reached out on Monday',
      });
      expect(next.labNotes.abc).toBe('Reached out on Monday');
    });

    it('toggling opens editing for a listing', () => {
      const state = createInitialAccountTrackingState();
      const next = accountTrackingReducer(state, {
        type: 'TOGGLE_EDITING_LAB_NOTE',
        listingId: 'abc',
      });
      expect(next.editingNoteId).toBe('abc');
    });

    it('toggling the already-editing listing closes it', () => {
      const state = createInitialAccountTrackingState({ editingNoteId: 'abc' });
      const next = accountTrackingReducer(state, {
        type: 'TOGGLE_EDITING_LAB_NOTE',
        listingId: 'abc',
      });
      expect(next.editingNoteId).toBeNull();
    });

    it('toggling a different listing switches the open editor', () => {
      const state = createInitialAccountTrackingState({ editingNoteId: 'abc' });
      const next = accountTrackingReducer(state, {
        type: 'TOGGLE_EDITING_LAB_NOTE',
        listingId: 'xyz',
      });
      expect(next.editingNoteId).toBe('xyz');
    });
  });

  describe('fellowship tracking', () => {
    it('SET_FELLOWSHIP_STAGE sets a stage', () => {
      const state = createInitialAccountTrackingState();
      const next = accountTrackingReducer(state, {
        type: 'SET_FELLOWSHIP_STAGE',
        fellowshipId: 'f1',
        stage: 'applied',
      });
      expect(next.fellowshipStage.f1).toBe('applied');
    });

    it('SET_FELLOWSHIP_STAGE with not_applied removes the entry', () => {
      const state = createInitialAccountTrackingState({
        fellowshipStage: { f1: 'applied' },
      });
      const next = accountTrackingReducer(state, {
        type: 'SET_FELLOWSHIP_STAGE',
        fellowshipId: 'f1',
        stage: 'not_applied',
      });
      expect(next.fellowshipStage.f1).toBeUndefined();
    });

    it('TOGGLE_EDITING_FELLOWSHIP_NOTE opens and closes', () => {
      let state = createInitialAccountTrackingState();
      state = accountTrackingReducer(state, {
        type: 'TOGGLE_EDITING_FELLOWSHIP_NOTE',
        fellowshipId: 'f1',
      });
      expect(state.editingFellowshipNoteId).toBe('f1');
      state = accountTrackingReducer(state, {
        type: 'TOGGLE_EDITING_FELLOWSHIP_NOTE',
        fellowshipId: 'f1',
      });
      expect(state.editingFellowshipNoteId).toBeNull();
    });

    it('SET_FELLOWSHIP_NOTE stores the note', () => {
      const state = createInitialAccountTrackingState();
      const next = accountTrackingReducer(state, {
        type: 'SET_FELLOWSHIP_NOTE',
        fellowshipId: 'f1',
        value: 'check deadline',
      });
      expect(next.fellowshipNotes.f1).toBe('check deadline');
    });
  });

  describe('HYDRATE', () => {
    it('applies a partial payload without wiping existing keys', () => {
      const state = createInitialAccountTrackingState({ labNotes: { abc: 'keep' } });
      const next = accountTrackingReducer(state, {
        type: 'HYDRATE',
        payload: { fellowshipStage: { f1: 'applied' } },
      });
      expect(next.labNotes).toEqual({ abc: 'keep' });
      expect(next.fellowshipStage).toEqual({ f1: 'applied' });
    });
  });

  describe('purity', () => {
    it('does not mutate prior state maps', () => {
      const state = createInitialAccountTrackingState({
        labStage: { abc: 'emailed' },
        labNotes: { abc: 'note' },
      });
      const snapshot = JSON.stringify(state);
      accountTrackingReducer(state, {
        type: 'SET_LAB_STAGE',
        listingId: 'abc',
        stage: 'interview',
      });
      accountTrackingReducer(state, {
        type: 'SET_LAB_NOTE',
        listingId: 'abc',
        value: 'new',
      });
      expect(JSON.stringify(state)).toBe(snapshot);
    });
  });
});

describe('loadAccountTrackingFromStorage', () => {
  const makeStorage = (data: Record<string, string>) => {
    const store: Record<string, string> = { ...data };
    return {
      getItem: vi.fn((key: string) => (key in store ? store[key] : null)),
      removeItem: vi.fn((key: string) => {
        delete store[key];
      }),
      _store: store,
    };
  };

  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('returns defaults when storage is empty', () => {
    const storage = makeStorage({});
    const state = loadAccountTrackingFromStorage(storage);
    expect(state.labStage).toEqual({});
    expect(state.fellowshipNotes).toEqual({});
  });

  it('parses stored JSON for each key', () => {
    const storage = makeStorage({
      'ylabs-lab-stages': JSON.stringify({ abc: 'emailed' }),
      'ylabs-lab-notes': JSON.stringify({ abc: 'hi' }),
      'ylabs-fellowship-stages': JSON.stringify({ f1: 'applied' }),
      'ylabs-fellowship-notes': JSON.stringify({ f1: 'note' }),
    });
    const state = loadAccountTrackingFromStorage(storage);
    expect(state.labStage).toEqual({ abc: 'emailed' });
    expect(state.labNotes).toEqual({ abc: 'hi' });
    expect(state.fellowshipStage).toEqual({ f1: 'applied' });
    expect(state.fellowshipNotes).toEqual({ f1: 'note' });
  });

  it('migrates the legacy ylabs-emailed-labs list into labStage', () => {
    const storage = makeStorage({
      'ylabs-emailed-labs': JSON.stringify(['a', 'b']),
    });
    const state = loadAccountTrackingFromStorage(storage);
    expect(state.labStage).toEqual({ a: 'emailed', b: 'emailed' });
    expect(storage.removeItem).toHaveBeenCalledWith('ylabs-emailed-labs');
  });

  it('prefers ylabs-lab-stages over the legacy key when both exist', () => {
    const storage = makeStorage({
      'ylabs-lab-stages': JSON.stringify({ abc: 'interview' }),
      'ylabs-emailed-labs': JSON.stringify(['legacy']),
    });
    const state = loadAccountTrackingFromStorage(storage);
    expect(state.labStage).toEqual({ abc: 'interview' });
    // legacy key should NOT have been touched since we had the new one
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it('falls back to empty object when stored JSON is malformed', () => {
    const storage = makeStorage({ 'ylabs-lab-notes': 'not json' });
    const state = loadAccountTrackingFromStorage(storage);
    expect(state.labNotes).toEqual({});
    warn.mockRestore();
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  MAX_TRACKING_STORAGE_VALUE_LENGTH,
  accountTrackingReducer,
  createInitialAccountTrackingState,
  loadAccountTrackingFromStorage,
  normalizeAccountTrackingStorageOwner,
  persistAccountTrackingToStorage,
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

    it('redacts direct contact details before storing lab notes', () => {
      const state = createInitialAccountTrackingState();
      const next = accountTrackingReducer(state, {
        type: 'SET_LAB_NOTE',
        listingId: 'abc',
        value: 'Email ada@example.edu or call 203-555-1212',
      });
      expect(next.labNotes.abc).toBe('Email [email redacted] or call [phone redacted]');
    });

    it('bounds note length and rejects unsafe listing ids', () => {
      const state = createInitialAccountTrackingState();
      const unsafe = accountTrackingReducer(state, {
        type: 'SET_LAB_NOTE',
        listingId: '../bad',
        value: 'unsafe',
      });
      expect(unsafe.labNotes).toEqual({});

      const next = accountTrackingReducer(state, {
        type: 'SET_LAB_NOTE',
        listingId: 'abc',
        value: 'a'.repeat(2500),
      });
      expect(next.labNotes.abc).toHaveLength(2000);
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

    it('redacts direct contact details before storing fellowship notes', () => {
      const state = createInitialAccountTrackingState();
      const next = accountTrackingReducer(state, {
        type: 'SET_FELLOWSHIP_NOTE',
        fellowshipId: 'f1',
        value: 'Ask grace@example.edu at (203) 555-0100',
      });
      expect(next.fellowshipNotes.f1).toBe('Ask [email redacted] at [phone redacted]');
    });

    it('bounds fellowship note length and rejects unsafe fellowship ids', () => {
      const state = createInitialAccountTrackingState();
      const unsafe = accountTrackingReducer(state, {
        type: 'SET_FELLOWSHIP_NOTE',
        fellowshipId: '$bad',
        value: 'unsafe',
      });
      expect(unsafe.fellowshipNotes).toEqual({});

      const next = accountTrackingReducer(state, {
        type: 'SET_FELLOWSHIP_NOTE',
        fellowshipId: 'f1',
        value: 'b'.repeat(2500),
      });
      expect(next.fellowshipNotes.f1).toHaveLength(2000);
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

    it('normalizes hydrated payload maps before merging into state', () => {
      const state = createInitialAccountTrackingState({ labNotes: { abc: 'keep' } });
      const next = accountTrackingReducer(state, {
        type: 'HYDRATE',
        payload: {
          labNotes: {
            abc: 'a'.repeat(2500),
            '../bad': 'drop',
          },
          labStage: {
            abc: 'interview',
            badstage: 'rooted' as any,
          },
          fellowshipStage: {
            f1: 'applied',
            f2: 'rooted' as any,
          },
        },
      });
      expect(next.labNotes).toEqual({ abc: 'a'.repeat(2000) });
      expect(next.labStage).toEqual({ abc: 'interview' });
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
  const legacyPrefix = ['y', 'labs'].join('');
  const legacyKey = (key: string) => `${legacyPrefix}-${key}`;
  const scopedKey = (key: string) => `yale-research-avery1-${key}`;

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
    const state = loadAccountTrackingFromStorage(storage, 'avery1');
    expect(state.labStage).toEqual({});
    expect(state.fellowshipNotes).toEqual({});
  });

  it('parses stored stages and purges private note keys', () => {
    const storage = makeStorage({
      [scopedKey('lab-stages')]: JSON.stringify({ abc: 'emailed' }),
      [scopedKey('lab-notes')]: JSON.stringify({ abc: 'hi' }),
      [scopedKey('fellowship-stages')]: JSON.stringify({ f1: 'applied' }),
      [scopedKey('fellowship-notes')]: JSON.stringify({ f1: 'note' }),
    });
    const state = loadAccountTrackingFromStorage(storage, 'avery1');
    expect(state.labStage).toEqual({ abc: 'emailed' });
    expect(state.labNotes).toEqual({});
    expect(state.fellowshipStage).toEqual({ f1: 'applied' });
    expect(state.fellowshipNotes).toEqual({});
    expect(storage.removeItem).toHaveBeenCalledWith(scopedKey('lab-notes'));
    expect(storage.removeItem).toHaveBeenCalledWith(scopedKey('fellowship-notes'));
  });

  it('normalizes untrusted stored maps before hydration', () => {
    const storage = makeStorage({
      [scopedKey('lab-stages')]: JSON.stringify({
        abc: 'emailed',
        unsafeStage: 'rooted',
        '../bad': 'interview',
      }),
      [scopedKey('lab-notes')]: JSON.stringify({
        abc: 'a'.repeat(2500),
        '$bad': 'drop',
      }),
      [scopedKey('fellowship-stages')]: JSON.stringify({
        f1: 'applied',
        f2: 'rooted',
      }),
      [scopedKey('fellowship-notes')]: JSON.stringify({
        f1: 'b'.repeat(2500),
        '$bad': 'drop',
      }),
    });
    const state = loadAccountTrackingFromStorage(storage, 'avery1');
    expect(state.labStage).toEqual({ abc: 'emailed' });
    expect(state.labNotes).toEqual({});
    expect(state.fellowshipStage).toEqual({ f1: 'applied' });
    expect(state.fellowshipNotes).toEqual({});
  });

  it('drops hydrated notes instead of retaining private browser storage text', () => {
    const storage = makeStorage({
      [scopedKey('lab-notes')]: JSON.stringify({
        abc: 'Email ada@example.edu',
      }),
      [scopedKey('fellowship-notes')]: JSON.stringify({
        f1: 'Call 203.555.1212',
      }),
    });
    const state = loadAccountTrackingFromStorage(storage, 'avery1');
    expect(state.labNotes).toEqual({});
    expect(state.fellowshipNotes).toEqual({});
    expect(storage.removeItem).toHaveBeenCalledWith(scopedKey('lab-notes'));
    expect(storage.removeItem).toHaveBeenCalledWith(scopedKey('fellowship-notes'));
  });

  it('removes legacy unscoped tracking without hydrating it into the current user', () => {
    const storage = makeStorage({
      [legacyKey('emailed-labs')]: JSON.stringify(['a', '../bad', 'b']),
      'yale-research-fellowship-notes': JSON.stringify({ f1: 'previous user note' }),
    });
    const state = loadAccountTrackingFromStorage(storage, 'avery1');
    expect(state.labStage).toEqual({});
    expect(state.fellowshipNotes).toEqual({});
    expect(storage.removeItem).toHaveBeenCalledWith(legacyKey('emailed-labs'));
    expect(storage.removeItem).toHaveBeenCalledWith('yale-research-fellowship-notes');
  });

  it('uses owner-scoped current lab stages while deleting legacy keys', () => {
    const storage = makeStorage({
      [scopedKey('lab-stages')]: JSON.stringify({ abc: 'interview' }),
      [legacyKey('emailed-labs')]: JSON.stringify(['legacy']),
    });
    const state = loadAccountTrackingFromStorage(storage, 'avery1');
    expect(state.labStage).toEqual({ abc: 'interview' });
    expect(storage.removeItem).toHaveBeenCalledWith(legacyKey('emailed-labs'));
  });

  it('falls back to empty object when stored JSON is malformed', () => {
    const storage = makeStorage({ [scopedKey('lab-notes')]: 'not json' });
    const state = loadAccountTrackingFromStorage(storage, 'avery1');
    expect(state.labNotes).toEqual({});
    expect(storage.removeItem).toHaveBeenCalledWith(scopedKey('lab-notes'));
    warn.mockRestore();
  });

  it('drops oversized storage values before parsing', () => {
    const storage = makeStorage({
      [scopedKey('lab-notes')]: 'x'.repeat(MAX_TRACKING_STORAGE_VALUE_LENGTH + 1),
    });
    const state = loadAccountTrackingFromStorage(storage, 'avery1');

    expect(state.labNotes).toEqual({});
    expect(storage.removeItem).toHaveBeenCalledWith(scopedKey('lab-notes'));
  });
});

describe('persistAccountTrackingToStorage', () => {
  it('normalizes account tracking storage owners', () => {
    expect(normalizeAccountTrackingStorageOwner('Avery1')).toBe('avery1');
    expect(normalizeAccountTrackingStorageOwner('../bad')).toBeUndefined();
  });

  it('caps serialized account tracking values before writing', () => {
    const storage = {
      setItem: vi.fn(),
      removeItem: vi.fn(),
    };

    persistAccountTrackingToStorage(storage, 'fellowship-notes', {
      safe: 'x'.repeat(MAX_TRACKING_STORAGE_VALUE_LENGTH + 1),
    }, 'avery1');

    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).toHaveBeenCalledWith('yale-research-avery1-fellowship-notes');
  });

  it('removes private note keys instead of writing them to localStorage', () => {
    const storage = {
      setItem: vi.fn(),
      removeItem: vi.fn(),
    };

    persistAccountTrackingToStorage(storage, 'fellowship-notes', { f1: 'private note' }, 'avery1');
    persistAccountTrackingToStorage(storage, 'lab-notes', { lab1: 'private note' }, 'avery1');

    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).toHaveBeenCalledWith('yale-research-avery1-fellowship-notes');
    expect(storage.removeItem).toHaveBeenCalledWith('yale-research-avery1-lab-notes');
  });

  it('writes bounded account tracking values with the canonical key prefix', () => {
    const storage = {
      setItem: vi.fn(),
      removeItem: vi.fn(),
    };

    persistAccountTrackingToStorage(storage, 'fellowship-stages', { f1: 'applied' }, 'avery1');

    expect(storage.setItem).toHaveBeenCalledWith(
      'yale-research-avery1-fellowship-stages',
      JSON.stringify({ f1: 'applied' }),
    );
    expect(storage.removeItem).not.toHaveBeenCalled();
  });
});

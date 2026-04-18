import { describe, expect, it } from 'vitest';

import {
  createInitialUnknownUserState,
  unknownUserReducer,
} from '../unknownUserReducer';

describe('unknownUserReducer', () => {
  it('initial state has empty fields, closed dropdown, no errors', () => {
    const state = createInitialUnknownUserState();
    expect(state.firstName).toBe('');
    expect(state.lastName).toBe('');
    expect(state.email).toBe('');
    expect(state.userType).toBe('');
    expect(state.isUserTypeDropdownOpen).toBe(false);
    expect(state.focusedUserTypeIndex).toBe(-1);
    expect(state.errors).toEqual({});
  });

  describe('form value setters', () => {
    it('SET_FIRST_NAME updates firstName', () => {
      const state = createInitialUnknownUserState();
      const next = unknownUserReducer(state, { type: 'SET_FIRST_NAME', payload: 'Ada' });
      expect(next.firstName).toBe('Ada');
    });

    it('SET_LAST_NAME updates lastName', () => {
      const state = createInitialUnknownUserState();
      const next = unknownUserReducer(state, { type: 'SET_LAST_NAME', payload: 'Lovelace' });
      expect(next.lastName).toBe('Lovelace');
    });

    it('SET_EMAIL updates email', () => {
      const state = createInitialUnknownUserState();
      const next = unknownUserReducer(state, {
        type: 'SET_EMAIL',
        payload: 'ada@yale.edu',
      });
      expect(next.email).toBe('ada@yale.edu');
    });

    it('SET_USER_TYPE updates userType without touching the dropdown', () => {
      const state = createInitialUnknownUserState({ isUserTypeDropdownOpen: true });
      const next = unknownUserReducer(state, {
        type: 'SET_USER_TYPE',
        payload: 'undergraduate',
      });
      expect(next.userType).toBe('undergraduate');
      expect(next.isUserTypeDropdownOpen).toBe(true);
    });
  });

  describe('dropdown state', () => {
    it('OPEN_DROPDOWN opens and resets the focus index', () => {
      const state = createInitialUnknownUserState({ focusedUserTypeIndex: 2 });
      const next = unknownUserReducer(state, { type: 'OPEN_DROPDOWN' });
      expect(next.isUserTypeDropdownOpen).toBe(true);
      expect(next.focusedUserTypeIndex).toBe(-1);
    });

    it('CLOSE_DROPDOWN closes the dropdown and resets focus index to -1', () => {
      const state = createInitialUnknownUserState({
        isUserTypeDropdownOpen: true,
        focusedUserTypeIndex: 3,
      });
      const next = unknownUserReducer(state, { type: 'CLOSE_DROPDOWN' });
      expect(next.isUserTypeDropdownOpen).toBe(false);
      expect(next.focusedUserTypeIndex).toBe(-1);
    });

    it('SELECT_USER_TYPE commits the value and closes the dropdown atomically', () => {
      const state = createInitialUnknownUserState({
        isUserTypeDropdownOpen: true,
        focusedUserTypeIndex: 1,
      });
      const next = unknownUserReducer(state, {
        type: 'SELECT_USER_TYPE',
        payload: 'professor',
      });
      expect(next.userType).toBe('professor');
      expect(next.isUserTypeDropdownOpen).toBe(false);
      expect(next.focusedUserTypeIndex).toBe(-1);
    });

    it('SET_FOCUSED_INDEX accepts a numeric payload', () => {
      const state = createInitialUnknownUserState();
      const next = unknownUserReducer(state, {
        type: 'SET_FOCUSED_INDEX',
        payload: 2,
      });
      expect(next.focusedUserTypeIndex).toBe(2);
    });

    it('SET_FOCUSED_INDEX supports a functional updater', () => {
      const state = createInitialUnknownUserState({ focusedUserTypeIndex: 2 });
      const next = unknownUserReducer(state, {
        type: 'SET_FOCUSED_INDEX',
        payload: (prev) => prev + 1,
      });
      expect(next.focusedUserTypeIndex).toBe(3);
    });
  });

  describe('errors', () => {
    it('SET_ERRORS replaces the errors object with a literal payload', () => {
      const state = createInitialUnknownUserState({
        errors: { firstName: 'stale' },
      });
      const next = unknownUserReducer(state, {
        type: 'SET_ERRORS',
        payload: { email: 'Invalid email format' },
      });
      expect(next.errors).toEqual({ email: 'Invalid email format' });
    });

    it('SET_ERRORS supports a functional updater for field-level updates', () => {
      const state = createInitialUnknownUserState({
        errors: { firstName: 'First name is required' },
      });
      const next = unknownUserReducer(state, {
        type: 'SET_ERRORS',
        payload: (prev) => ({ ...prev, email: 'Email is required' }),
      });
      expect(next.errors).toEqual({
        firstName: 'First name is required',
        email: 'Email is required',
      });
    });
  });

  it('does not mutate previous state', () => {
    const state = createInitialUnknownUserState({
      firstName: 'Ada',
      errors: { email: 'Invalid email format' },
      focusedUserTypeIndex: 1,
      isUserTypeDropdownOpen: true,
    });
    const snapshot = JSON.stringify(state);
    unknownUserReducer(state, { type: 'SET_FIRST_NAME', payload: 'Grace' });
    unknownUserReducer(state, { type: 'CLOSE_DROPDOWN' });
    unknownUserReducer(state, { type: 'SELECT_USER_TYPE', payload: 'faculty' });
    unknownUserReducer(state, {
      type: 'SET_ERRORS',
      payload: (prev) => ({ ...prev, firstName: 'x' }),
    });
    unknownUserReducer(state, {
      type: 'SET_FOCUSED_INDEX',
      payload: (prev) => prev + 5,
    });
    expect(JSON.stringify(state)).toBe(snapshot);
  });
});

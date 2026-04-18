import { describe, expect, it } from 'vitest';

import { FacultyProfile } from '../../types/types';
import { createInitialProfileEditorState, profileEditorReducer } from '../profileEditorReducer';

const makeProfile = (overrides: Partial<FacultyProfile> = {}): FacultyProfile =>
  ({
    netid: 'abc123',
    fname: 'Ada',
    lname: 'Lovelace',
    email: 'ada@yale.edu',
    secondary_departments: [],
    departments: [],
    profile_urls: {},
    publications: [],
    research_interests: [],
    topics: [],
    bio: 'A short bio',
    primary_department: 'Computer Science',
    image_url: 'https://example.com/avatar.png',
    profileVerified: true,
    ...overrides,
  }) as unknown as FacultyProfile;

describe('profileEditorReducer', () => {
  it('initial state is loading with nothing populated', () => {
    const state = createInitialProfileEditorState();
    expect(state.loading).toBe(true);
    expect(state.profile).toBeNull();
    expect(state.editing).toBe(false);
    expect(state.message).toBeNull();
    expect(state.validationErrors).toEqual([]);
    expect(state.primaryDept).toBe('');
    expect(state.focusedPrimaryIndex).toBe(-1);
  });

  describe('FETCH_SUCCESS', () => {
    it('hydrates form values from the fetched profile', () => {
      const state = createInitialProfileEditorState();
      const next = profileEditorReducer(state, {
        type: 'FETCH_SUCCESS',
        profile: makeProfile({
          bio: 'hello',
          primary_department: 'CS',
          secondary_departments: ['Math'],
          research_interests: ['AI'],
          image_url: 'https://img',
        }),
      });
      expect(next.loading).toBe(false);
      expect(next.bio).toBe('hello');
      expect(next.primaryDept).toBe('CS');
      expect(next.secondaryDepts).toEqual(['Math']);
      expect(next.researchInterests).toEqual(['AI']);
      expect(next.imageUrl).toBe('https://img');
    });

    it('opens edit mode automatically for unverified profiles', () => {
      const state = createInitialProfileEditorState();
      const next = profileEditorReducer(state, {
        type: 'FETCH_SUCCESS',
        profile: makeProfile({ profileVerified: false }),
      });
      expect(next.editing).toBe(true);
    });

    it('keeps edit mode closed for verified profiles', () => {
      const state = createInitialProfileEditorState();
      const next = profileEditorReducer(state, {
        type: 'FETCH_SUCCESS',
        profile: makeProfile({ profileVerified: true }),
      });
      expect(next.editing).toBe(false);
    });

    it('defaults missing optional fields to empty strings / arrays', () => {
      const state = createInitialProfileEditorState();
      const next = profileEditorReducer(state, {
        type: 'FETCH_SUCCESS',
        profile: makeProfile({
          bio: undefined,
          primary_department: undefined,
          image_url: undefined,
        }),
      });
      expect(next.bio).toBe('');
      expect(next.primaryDept).toBe('');
      expect(next.imageUrl).toBe('');
    });
  });

  it('FETCH_FAILURE clears loading', () => {
    const state = createInitialProfileEditorState();
    const next = profileEditorReducer(state, { type: 'FETCH_FAILURE' });
    expect(next.loading).toBe(false);
  });

  describe('form value setters', () => {
    it('SET_BIO updates bio', () => {
      const state = createInitialProfileEditorState();
      const next = profileEditorReducer(state, { type: 'SET_BIO', payload: 'new bio' });
      expect(next.bio).toBe('new bio');
    });

    it('SET_RESEARCH_INTERESTS supports updater', () => {
      const state = createInitialProfileEditorState({ researchInterests: ['AI'] });
      const next = profileEditorReducer(state, {
        type: 'SET_RESEARCH_INTERESTS',
        payload: (prev) => [...prev, 'ML'],
      });
      expect(next.researchInterests).toEqual(['AI', 'ML']);
    });

    it('CLEAR_PRIMARY_DEPT empties both dept and search', () => {
      const state = createInitialProfileEditorState({
        primaryDept: 'CS',
        primaryDeptSearch: 'Com',
      });
      const next = profileEditorReducer(state, { type: 'CLEAR_PRIMARY_DEPT' });
      expect(next.primaryDept).toBe('');
      expect(next.primaryDeptSearch).toBe('');
    });
  });

  describe('dropdown state', () => {
    it('OPEN_PRIMARY_DROPDOWN opens and clears the search', () => {
      const state = createInitialProfileEditorState({ primaryDeptSearch: 'stale' });
      const next = profileEditorReducer(state, { type: 'OPEN_PRIMARY_DROPDOWN' });
      expect(next.isPrimaryDropdownOpen).toBe(true);
      expect(next.primaryDeptSearch).toBe('');
    });

    it('CLOSE_PRIMARY_DROPDOWN resets search, focus index, and open flag', () => {
      const state = createInitialProfileEditorState({
        isPrimaryDropdownOpen: true,
        primaryDeptSearch: 'abc',
        focusedPrimaryIndex: 2,
      });
      const next = profileEditorReducer(state, { type: 'CLOSE_PRIMARY_DROPDOWN' });
      expect(next.isPrimaryDropdownOpen).toBe(false);
      expect(next.primaryDeptSearch).toBe('');
      expect(next.focusedPrimaryIndex).toBe(-1);
    });

    it('SET_PRIMARY_DEPT_SEARCH resets focus index', () => {
      const state = createInitialProfileEditorState({ focusedPrimaryIndex: 5 });
      const next = profileEditorReducer(state, {
        type: 'SET_PRIMARY_DEPT_SEARCH',
        payload: 'bio',
      });
      expect(next.primaryDeptSearch).toBe('bio');
      expect(next.focusedPrimaryIndex).toBe(-1);
    });

    it('SET_FOCUSED_PRIMARY_INDEX supports a numeric updater', () => {
      const state = createInitialProfileEditorState({ focusedPrimaryIndex: 2 });
      const next = profileEditorReducer(state, {
        type: 'SET_FOCUSED_PRIMARY_INDEX',
        payload: (prev) => prev + 1,
      });
      expect(next.focusedPrimaryIndex).toBe(3);
    });

    it('SELECT_PRIMARY_DEPT commits the dept and closes the dropdown', () => {
      const state = createInitialProfileEditorState({
        isPrimaryDropdownOpen: true,
        primaryDeptSearch: 'abc',
        focusedPrimaryIndex: 0,
      });
      const next = profileEditorReducer(state, {
        type: 'SELECT_PRIMARY_DEPT',
        payload: 'Biology',
      });
      expect(next.primaryDept).toBe('Biology');
      expect(next.isPrimaryDropdownOpen).toBe(false);
      expect(next.primaryDeptSearch).toBe('');
      expect(next.focusedPrimaryIndex).toBe(-1);
    });
  });

  describe('lifecycle', () => {
    it('START_EDITING opens edit mode and clears any stale message', () => {
      const state = createInitialProfileEditorState({
        message: { type: 'error', text: 'stale' },
      });
      const next = profileEditorReducer(state, { type: 'START_EDITING' });
      expect(next.editing).toBe(true);
      expect(next.message).toBeNull();
    });

    it('CANCEL_EDITING restores form values from the profile', () => {
      const profile = makeProfile({
        bio: 'Canonical bio',
        primary_department: 'Physics',
        secondary_departments: ['Math'],
        research_interests: ['Optics'],
        image_url: '',
      });
      const state = createInitialProfileEditorState({
        editing: true,
        bio: 'edited',
        primaryDept: 'Scrambled',
        secondaryDepts: ['Junk'],
        researchInterests: ['Junk'],
        imageUrl: 'junk',
        validationErrors: ['stale'],
      });
      const next = profileEditorReducer(state, { type: 'CANCEL_EDITING', profile });
      expect(next.editing).toBe(false);
      expect(next.bio).toBe('Canonical bio');
      expect(next.primaryDept).toBe('Physics');
      expect(next.secondaryDepts).toEqual(['Math']);
      expect(next.researchInterests).toEqual(['Optics']);
      expect(next.imageUrl).toBe('');
      expect(next.validationErrors).toEqual([]);
    });

    it('SAVE_START sets saving and clears message + validation', () => {
      const state = createInitialProfileEditorState({
        message: { type: 'error', text: 'old' },
        validationErrors: ['old'],
      });
      const next = profileEditorReducer(state, { type: 'SAVE_START' });
      expect(next.saving).toBe(true);
      expect(next.message).toBeNull();
      expect(next.validationErrors).toEqual([]);
    });

    it('SAVE_VALIDATION_FAILED clears saving and records errors', () => {
      const state = createInitialProfileEditorState({ saving: true });
      const next = profileEditorReducer(state, {
        type: 'SAVE_VALIDATION_FAILED',
        errors: ['Primary Department is required.'],
      });
      expect(next.saving).toBe(false);
      expect(next.validationErrors).toEqual(['Primary Department is required.']);
    });

    it('SAVE_SUCCESS commits the profile, closes edit mode, and stores message', () => {
      const profile = makeProfile({ bio: 'After save', primary_department: 'Math' });
      const state = createInitialProfileEditorState({
        saving: true,
        editing: true,
        bio: 'edited',
      });
      const next = profileEditorReducer(state, {
        type: 'SAVE_SUCCESS',
        profile,
        message: { type: 'success', text: 'Saved!' },
      });
      expect(next.saving).toBe(false);
      expect(next.editing).toBe(false);
      expect(next.profile).toBe(profile);
      expect(next.bio).toBe('After save');
      expect(next.primaryDept).toBe('Math');
      expect(next.message).toEqual({ type: 'success', text: 'Saved!' });
    });

    it('SAVE_FAILURE stops saving and records message but preserves edit state', () => {
      const state = createInitialProfileEditorState({
        saving: true,
        editing: true,
        bio: 'edited',
      });
      const next = profileEditorReducer(state, {
        type: 'SAVE_FAILURE',
        message: { type: 'error', text: 'Nope' },
      });
      expect(next.saving).toBe(false);
      expect(next.editing).toBe(true);
      expect(next.bio).toBe('edited');
      expect(next.message).toEqual({ type: 'error', text: 'Nope' });
    });
  });

  it('does not mutate previous state', () => {
    const state = createInitialProfileEditorState({ researchInterests: ['A'] });
    const snapshot = JSON.stringify(state);
    profileEditorReducer(state, {
      type: 'SET_RESEARCH_INTERESTS',
      payload: (prev) => [...prev, 'B'],
    });
    profileEditorReducer(state, { type: 'CLOSE_PRIMARY_DROPDOWN' });
    profileEditorReducer(state, { type: 'SAVE_START' });
    expect(JSON.stringify(state)).toBe(snapshot);
  });
});

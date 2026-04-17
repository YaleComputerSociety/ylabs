import { describe, expect, it } from 'vitest';

import {
  AdminProfileShape,
  FullAdminProfile,
  adminProfileEditReducer,
  createInitialAdminProfileEditState,
} from '../adminProfileEditReducer';

const baseProfile: AdminProfileShape = {
  netid: 'abc123',
  fname: 'Ada',
  lname: 'Lovelace',
  email: 'ada@yale.edu',
  title: 'Professor',
  bio: 'Short bio',
  phone: '555-0100',
  primary_department: 'Computer Science',
  secondary_departments: ['Math'],
  research_interests: ['Algorithms', 'Cryptography'],
  h_index: 42,
  orcid: '0000-0000-0000-0001',
  image_url: 'https://example.com/a.jpg',
  profileVerified: true,
  userType: 'professor',
  userConfirmed: true,
};

describe('adminProfileEditReducer', () => {
  describe('createInitialAdminProfileEditState', () => {
    it('hydrates form values from the profile', () => {
      const state = createInitialAdminProfileEditState(baseProfile);
      expect(state.loading).toBe(true);
      expect(state.saving).toBe(false);
      expect(state.full).toBeNull();
      expect(state.fname).toBe('Ada');
      expect(state.lname).toBe('Lovelace');
      expect(state.email).toBe('ada@yale.edu');
      expect(state.primaryDept).toBe('Computer Science');
      expect(state.userType).toBe('professor');
      expect(state.userConfirmed).toBe(true);
    });

    it('joins array fields into comma-separated strings', () => {
      const state = createInitialAdminProfileEditState(baseProfile);
      expect(state.secondaryDepts).toBe('Math');
      expect(state.researchInterests).toBe('Algorithms, Cryptography');
    });

    it('stringifies h_index and treats undefined as empty string', () => {
      const withHIndex = createInitialAdminProfileEditState(baseProfile);
      expect(withHIndex.hIndex).toBe('42');

      const withoutHIndex = createInitialAdminProfileEditState({
        ...baseProfile,
        h_index: undefined,
      });
      expect(withoutHIndex.hIndex).toBe('');
    });

    it('defaults missing fields to empty strings / false', () => {
      const minimal: AdminProfileShape = {
        netid: 'x',
        fname: '',
        lname: '',
        email: '',
        userType: '',
        userConfirmed: false,
      };
      const state = createInitialAdminProfileEditState(minimal);
      expect(state.title).toBe('');
      expect(state.bio).toBe('');
      expect(state.primaryDept).toBe('');
      expect(state.secondaryDepts).toBe('');
      expect(state.profileVerified).toBe(false);
      // userType empty string triggers the 'professor' fallback
      expect(state.userType).toBe('professor');
    });
  });

  describe('simple setters', () => {
    it('SET_FNAME updates fname', () => {
      const state = createInitialAdminProfileEditState(baseProfile);
      const next = adminProfileEditReducer(state, { type: 'SET_FNAME', payload: 'New' });
      expect(next.fname).toBe('New');
    });

    it('SET_SECONDARY_DEPTS stores the raw comma string for later parsing', () => {
      const state = createInitialAdminProfileEditState(baseProfile);
      const next = adminProfileEditReducer(state, {
        type: 'SET_SECONDARY_DEPTS',
        payload: 'Physics, Chemistry',
      });
      expect(next.secondaryDepts).toBe('Physics, Chemistry');
    });

    it('SET_PROFILE_VERIFIED toggles the flag', () => {
      const state = createInitialAdminProfileEditState({
        ...baseProfile,
        profileVerified: false,
      });
      const next = adminProfileEditReducer(state, {
        type: 'SET_PROFILE_VERIFIED',
        payload: true,
      });
      expect(next.profileVerified).toBe(true);
    });

    it('SET_USER_TYPE stores the picked option', () => {
      const state = createInitialAdminProfileEditState(baseProfile);
      const next = adminProfileEditReducer(state, {
        type: 'SET_USER_TYPE',
        payload: 'admin',
      });
      expect(next.userType).toBe('admin');
    });
  });

  describe('fetch lifecycle', () => {
    it('FETCH_SUCCESS hydrates full profile + form fields + clears loading', () => {
      const state = createInitialAdminProfileEditState(baseProfile);
      const full: FullAdminProfile = {
        ...baseProfile,
        fname: 'Fetched',
        secondary_departments: ['Stats', 'Physics'],
        research_interests: [],
        h_index: 5,
        publications: [],
        topics: [],
      };
      const next = adminProfileEditReducer(state, { type: 'FETCH_SUCCESS', profile: full });
      expect(next.loading).toBe(false);
      expect(next.full).toBe(full);
      expect(next.fname).toBe('Fetched');
      expect(next.secondaryDepts).toBe('Stats, Physics');
      expect(next.researchInterests).toBe('');
      expect(next.hIndex).toBe('5');
    });

    it('FETCH_FAILURE clears loading but keeps current form values', () => {
      const initial = createInitialAdminProfileEditState(baseProfile);
      const edited = adminProfileEditReducer(initial, { type: 'SET_FNAME', payload: 'Edit' });
      const next = adminProfileEditReducer(edited, { type: 'FETCH_FAILURE' });
      expect(next.loading).toBe(false);
      expect(next.fname).toBe('Edit');
    });
  });

  describe('save lifecycle', () => {
    it('SAVE_START flips saving on', () => {
      const state = createInitialAdminProfileEditState(baseProfile);
      const next = adminProfileEditReducer(state, { type: 'SAVE_START' });
      expect(next.saving).toBe(true);
    });

    it('SAVE_END flips saving off', () => {
      const state = adminProfileEditReducer(createInitialAdminProfileEditState(baseProfile), {
        type: 'SAVE_START',
      });
      const next = adminProfileEditReducer(state, { type: 'SAVE_END' });
      expect(next.saving).toBe(false);
    });
  });

  it('does not mutate prior state', () => {
    const state = createInitialAdminProfileEditState(baseProfile);
    const snapshot = JSON.stringify(state);
    adminProfileEditReducer(state, { type: 'SET_FNAME', payload: 'X' });
    adminProfileEditReducer(state, {
      type: 'FETCH_SUCCESS',
      profile: { ...baseProfile, fname: 'Y' } as FullAdminProfile,
    });
    expect(JSON.stringify(state)).toBe(snapshot);
  });
});

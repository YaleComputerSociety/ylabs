import { describe, expect, it } from 'vitest';

import { FacultyProfile } from '../../types/types';
import {
  createInitialProfilePageState,
  profilePageReducer,
} from '../profilePageReducer';

const sampleProfile: FacultyProfile = {
  netid: 'abc123',
  fname: 'Ada',
  lname: 'Lovelace',
  email: 'ada@example.com',
  secondary_departments: [],
  departments: ['Computer Science'],
  profile_urls: {},
  publications: [],
  research_interests: ['analytical engines'],
  topics: [],
  profileVerified: true,
  ownListings: [],
};

const otherProfile: FacultyProfile = {
  ...sampleProfile,
  netid: 'xyz789',
  fname: 'Grace',
  lname: 'Hopper',
  email: 'grace@example.com',
};

describe('profilePageReducer', () => {
  it('initial state starts in loading with no profile, no error, and null coursesAvailable', () => {
    const state = createInitialProfilePageState();
    expect(state.loading).toBe(true);
    expect(state.profile).toBeNull();
    expect(state.error).toBeNull();
    expect(state.coursesAvailable).toBeNull();
  });

  it('FETCH_START sets loading and clears a prior error', () => {
    const state = createInitialProfilePageState({ error: 'old failure', loading: false });
    const next = profilePageReducer(state, { type: 'FETCH_START' });
    expect(next.loading).toBe(true);
    expect(next.error).toBeNull();
  });

  it('FETCH_SUCCESS populates the profile and clears error/loading', () => {
    const state = createInitialProfilePageState({ error: 'network blip' });
    const next = profilePageReducer(state, { type: 'FETCH_SUCCESS', profile: sampleProfile });
    expect(next.loading).toBe(false);
    expect(next.error).toBeNull();
    expect(next.profile).toEqual(sampleProfile);
  });

  it('FETCH_FAILURE preserves a prior profile (stale is better than empty)', () => {
    const loaded = profilePageReducer(createInitialProfilePageState(), {
      type: 'FETCH_SUCCESS',
      profile: sampleProfile,
    });
    const next = profilePageReducer(loaded, {
      type: 'FETCH_FAILURE',
      payload: 'Profile not found.',
    });
    expect(next.error).toBe('Profile not found.');
    expect(next.loading).toBe(false);
    // Explicit preservation assertion
    expect(next.profile).toBe(sampleProfile);
  });

  it('SET_COURSES_AVAILABLE is independent of the fetch lifecycle', () => {
    const loaded = profilePageReducer(createInitialProfilePageState(), {
      type: 'FETCH_SUCCESS',
      profile: sampleProfile,
    });
    const next = profilePageReducer(loaded, {
      type: 'SET_COURSES_AVAILABLE',
      payload: true,
    });
    expect(next.coursesAvailable).toBe(true);
    // Fetch-lifecycle fields are untouched
    expect(next.loading).toBe(loaded.loading);
    expect(next.error).toBe(loaded.error);
    expect(next.profile).toBe(loaded.profile);

    // Also works for null (unknown) and false (unavailable)
    const nulled = profilePageReducer(next, {
      type: 'SET_COURSES_AVAILABLE',
      payload: null,
    });
    expect(nulled.coursesAvailable).toBeNull();
    expect(nulled.profile).toBe(sampleProfile);
  });

  it('reducer does not mutate prior state', () => {
    const state = createInitialProfilePageState();
    const snapshot = JSON.stringify(state);
    profilePageReducer(state, { type: 'FETCH_SUCCESS', profile: sampleProfile });
    profilePageReducer(state, { type: 'FETCH_FAILURE', payload: 'x' });
    profilePageReducer(state, { type: 'SET_COURSES_AVAILABLE', payload: true });
    profilePageReducer(state, { type: 'FETCH_SUCCESS', profile: otherProfile });
    expect(JSON.stringify(state)).toBe(snapshot);
  });

  it('returns same reference for unknown action', () => {
    const state = createInitialProfilePageState();
    // @ts-expect-error intentionally invalid
    expect(profilePageReducer(state, { type: 'NOPE' })).toBe(state);
  });
});

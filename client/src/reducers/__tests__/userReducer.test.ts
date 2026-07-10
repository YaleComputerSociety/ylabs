import { describe, expect, it } from 'vitest';

import { User } from '../../types/types';
import { createInitialUserState, userReducer } from '../userReducer';

const sampleUser = {
  netId: 'fixture-user',
  fname: 'Test',
  lname: 'Person',
  email: 'person@example.test',
  userType: 'student',
} as unknown as User;

describe('userReducer', () => {
  it('initial state starts loading, not authenticated, with no user', () => {
    const state = createInitialUserState();
    expect(state.isLoading).toBe(true);
    expect(state.isAuthenticated).toBe(false);
    expect(state.user).toBeUndefined();
    expect(state.authError).toBeUndefined();
  });

  it('FETCH_START sets loading true and clears stale auth errors', () => {
    const state = createInitialUserState({
      isLoading: false,
      authError: 'Unable to reach server',
    });
    const next = userReducer(state, { type: 'FETCH_START' });
    expect(next.isLoading).toBe(true);
    expect(next.authError).toBeUndefined();
  });

  it('FETCH_SUCCESS with auth populates the user and flips authenticated', () => {
    const state = createInitialUserState();
    const next = userReducer(state, {
      type: 'FETCH_SUCCESS',
      payload: { isAuthenticated: true, user: sampleUser },
    });
    expect(next.isLoading).toBe(false);
    expect(next.isAuthenticated).toBe(true);
    expect(next.user).toBe(sampleUser);
    expect(next.authError).toBeUndefined();
  });

  it('FETCH_SUCCESS without auth clears the user even if one was present', () => {
    const prior = userReducer(createInitialUserState(), {
      type: 'FETCH_SUCCESS',
      payload: { isAuthenticated: true, user: sampleUser },
    });
    const next = userReducer(prior, {
      type: 'FETCH_SUCCESS',
      payload: { isAuthenticated: false },
    });
    expect(next.isLoading).toBe(false);
    expect(next.isAuthenticated).toBe(false);
    expect(next.user).toBeUndefined();
    expect(next.authError).toBeUndefined();
  });

  it('FETCH_FAILURE clears loading, sets an auth error, and preserves prior user', () => {
    const prior = userReducer(createInitialUserState(), {
      type: 'FETCH_SUCCESS',
      payload: { isAuthenticated: true, user: sampleUser },
    });
    const next = userReducer(prior, {
      type: 'FETCH_FAILURE',
      error: 'Unable to reach Yale Labs.',
    });
    expect(next.isLoading).toBe(false);
    // Prior user and authenticated flag are preserved — stale is better than empty
    expect(next.isAuthenticated).toBe(true);
    expect(next.user).toBe(sampleUser);
    expect(next.authError).toBe('Unable to reach Yale Labs.');
  });

  it('FETCH_FAILURE falls back to a useful default message', () => {
    const state = createInitialUserState();
    const next = userReducer(state, { type: 'FETCH_FAILURE' });
    expect(next.authError).toBe(
      'Unable to check your Yale Labs session. Please try again in a moment.',
    );
  });

  it('LOGOUT clears user and sets isAuthenticated false', () => {
    const prior = userReducer(createInitialUserState(), {
      type: 'FETCH_SUCCESS',
      payload: { isAuthenticated: true, user: sampleUser },
    });
    const next = userReducer(prior, { type: 'LOGOUT' });
    expect(next.isAuthenticated).toBe(false);
    expect(next.user).toBeUndefined();
    expect(next.authError).toBeUndefined();
  });

  it('reducer does not mutate prior state', () => {
    const state = createInitialUserState();
    const snapshot = JSON.stringify(state);
    userReducer(state, { type: 'FETCH_START' });
    userReducer(state, {
      type: 'FETCH_SUCCESS',
      payload: { isAuthenticated: true, user: sampleUser },
    });
    userReducer(state, { type: 'FETCH_FAILURE' });
    userReducer(state, { type: 'LOGOUT' });
    expect(JSON.stringify(state)).toBe(snapshot);
  });

  it('returns same reference for unknown action', () => {
    const state = createInitialUserState();
    // @ts-expect-error intentionally invalid
    expect(userReducer(state, { type: 'NOPE' })).toBe(state);
  });
});

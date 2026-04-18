/**
 * Pure reducer for user authentication/session state.
 *
 * Models the auth-check lifecycle (loading → authenticated/unauthenticated)
 * plus an explicit LOGOUT transition so the provider's state changes can be
 * unit-tested without mounting React or mocking axios.
 */
import { User } from '../types/types';

export interface UserState {
  isLoading: boolean;
  isAuthenticated: boolean;
  user?: User;
}

export type UserAction =
  | { type: 'FETCH_START' }
  | { type: 'FETCH_SUCCESS'; payload: { isAuthenticated: boolean; user?: User } }
  | { type: 'FETCH_FAILURE' }
  | { type: 'LOGOUT' };

export const createInitialUserState = (overrides: Partial<UserState> = {}): UserState => ({
  isLoading: true,
  isAuthenticated: false,
  user: undefined,
  ...overrides,
});

export function userReducer(state: UserState, action: UserAction): UserState {
  switch (action.type) {
    case 'FETCH_START':
      return { ...state, isLoading: true };

    case 'FETCH_SUCCESS':
      return {
        ...state,
        isLoading: false,
        isAuthenticated: action.payload.isAuthenticated,
        user: action.payload.isAuthenticated ? action.payload.user : undefined,
      };

    case 'FETCH_FAILURE':
      // Clear loading but preserve any prior user/auth — stale is better than empty
      // on a transient network blip. Explicit LOGOUT is used to actually clear auth.
      return {
        ...state,
        isLoading: false,
      };

    case 'LOGOUT':
      return {
        ...state,
        isAuthenticated: false,
        user: undefined,
      };

    default:
      return state;
  }
}

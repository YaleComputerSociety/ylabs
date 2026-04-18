/**
 * Pure reducer for the faculty profile page fetch lifecycle.
 *
 * Consolidates the profile fetch state (profile, loading, error) and the
 * separate coursesAvailable signal so the page component's state transitions
 * can be unit-tested without mounting React or mocking axios.
 *
 * `coursesAvailable` is resolved by an independent effect inside
 * CourseTableSection and is intentionally independent of the profile fetch
 * lifecycle — it has its own action that does not touch loading/error/profile.
 */
import { FacultyProfile } from '../types/types';

export interface ProfilePageState {
  profile: FacultyProfile | null;
  loading: boolean;
  error: string | null;
  coursesAvailable: boolean | null;
}

export type ProfilePageAction =
  | { type: 'FETCH_START' }
  | { type: 'FETCH_SUCCESS'; profile: FacultyProfile }
  | { type: 'FETCH_FAILURE'; payload: string }
  | { type: 'SET_COURSES_AVAILABLE'; payload: boolean | null };

export const createInitialProfilePageState = (
  overrides: Partial<ProfilePageState> = {},
): ProfilePageState => ({
  profile: null,
  loading: true,
  error: null,
  coursesAvailable: null,
  ...overrides,
});

export function profilePageReducer(
  state: ProfilePageState,
  action: ProfilePageAction,
): ProfilePageState {
  switch (action.type) {
    case 'FETCH_START':
      return { ...state, loading: true, error: null };

    case 'FETCH_SUCCESS':
      return {
        ...state,
        loading: false,
        error: null,
        profile: action.profile,
      };

    case 'FETCH_FAILURE':
      // Preserve stale profile — stale is better than empty if a prior load succeeded.
      return {
        ...state,
        loading: false,
        error: action.payload,
      };

    case 'SET_COURSES_AVAILABLE':
      return { ...state, coursesAvailable: action.payload };

    default:
      return state;
  }
}

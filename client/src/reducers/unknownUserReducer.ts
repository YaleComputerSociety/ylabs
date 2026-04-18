/**
 * Pure reducer for the unknown-user onboarding form.
 *
 * Covers three concerns:
 *   1. Form values (firstName, lastName, email, userType)
 *   2. The userType combobox UI (open state, keyboard focus index)
 *   3. Per-field validation errors
 *
 * Keeping them together lets the component drive everything from a single
 * useReducer while transitions stay pure and unit-testable. Modeled on
 * profileEditorReducer.ts so the combobox patterns stay consistent across
 * pages.
 */

export interface UnknownUserErrors {
  firstName?: string;
  lastName?: string;
  email?: string;
  userType?: string;
}

export interface UnknownUserState {
  firstName: string;
  lastName: string;
  email: string;
  userType: string;

  isUserTypeDropdownOpen: boolean;
  focusedUserTypeIndex: number;

  errors: UnknownUserErrors;
}

export type UnknownUserAction =
  | { type: 'SET_FIRST_NAME'; payload: string }
  | { type: 'SET_LAST_NAME'; payload: string }
  | { type: 'SET_EMAIL'; payload: string }
  | { type: 'SET_USER_TYPE'; payload: string }
  | { type: 'OPEN_DROPDOWN' }
  | { type: 'CLOSE_DROPDOWN' }
  | { type: 'SELECT_USER_TYPE'; payload: string }
  | { type: 'SET_FOCUSED_INDEX'; payload: number | ((prev: number) => number) }
  | { type: 'SET_ERRORS'; payload: UnknownUserErrors | ((prev: UnknownUserErrors) => UnknownUserErrors) };

const resolve = <T>(payload: T | ((prev: T) => T), prev: T): T =>
  typeof payload === 'function' ? (payload as (prev: T) => T)(prev) : payload;

export const createInitialUnknownUserState = (
  overrides: Partial<UnknownUserState> = {},
): UnknownUserState => ({
  firstName: '',
  lastName: '',
  email: '',
  userType: '',
  isUserTypeDropdownOpen: false,
  focusedUserTypeIndex: -1,
  errors: {},
  ...overrides,
});

export function unknownUserReducer(
  state: UnknownUserState,
  action: UnknownUserAction,
): UnknownUserState {
  switch (action.type) {
    case 'SET_FIRST_NAME':
      return { ...state, firstName: action.payload };
    case 'SET_LAST_NAME':
      return { ...state, lastName: action.payload };
    case 'SET_EMAIL':
      return { ...state, email: action.payload };
    case 'SET_USER_TYPE':
      return { ...state, userType: action.payload };

    case 'OPEN_DROPDOWN':
      // Open deterministically: the dropdown is guaranteed open with no stale
      // focus-index from a previous session.
      return { ...state, isUserTypeDropdownOpen: true, focusedUserTypeIndex: -1 };

    case 'CLOSE_DROPDOWN':
      return { ...state, isUserTypeDropdownOpen: false, focusedUserTypeIndex: -1 };

    case 'SELECT_USER_TYPE':
      // Atomic: set the value and close the dropdown in a single transition so
      // we can't render a half-committed UI.
      return {
        ...state,
        userType: action.payload,
        isUserTypeDropdownOpen: false,
        focusedUserTypeIndex: -1,
      };

    case 'SET_FOCUSED_INDEX':
      return {
        ...state,
        focusedUserTypeIndex: resolve(action.payload, state.focusedUserTypeIndex),
      };

    case 'SET_ERRORS':
      return { ...state, errors: resolve(action.payload, state.errors) };

    default:
      return state;
  }
}

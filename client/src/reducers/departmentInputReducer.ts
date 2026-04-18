/**
 * Pure reducer for the DepartmentInput multi-select combobox.
 *
 * Covers a single concern: the dropdown UI (open flag, search text, keyboard
 * focus index). Department membership itself lives in the parent form via
 * onAddDepartment/onRemoveDepartment props, so this reducer only owns the
 * transient combobox state.
 *
 * Modeled on profileEditorReducer.ts and unknownUserReducer.ts so the combobox
 * patterns stay consistent across pages.
 */

export interface DepartmentInputState {
  isDeptDropdownOpen: boolean;
  deptSearchTerm: string;
  focusedDeptIndex: number;
}

export type DepartmentInputAction =
  | { type: 'OPEN_DROPDOWN' }
  | { type: 'CLOSE_DROPDOWN' }
  | { type: 'SET_SEARCH'; payload: string }
  | { type: 'SET_FOCUSED_INDEX'; payload: number | ((prev: number) => number) }
  | { type: 'SELECT_DEPT' };

const resolve = <T>(payload: T | ((prev: T) => T), prev: T): T =>
  typeof payload === 'function' ? (payload as (prev: T) => T)(prev) : payload;

export const createInitialDepartmentInputState = (
  overrides: Partial<DepartmentInputState> = {},
): DepartmentInputState => ({
  isDeptDropdownOpen: false,
  deptSearchTerm: '',
  focusedDeptIndex: -1,
  ...overrides,
});

export function departmentInputReducer(
  state: DepartmentInputState,
  action: DepartmentInputAction,
): DepartmentInputState {
  switch (action.type) {
    case 'OPEN_DROPDOWN':
      // Open deterministically: clear any stale search and focus from a
      // previous session so the dropdown is in a known-clean state.
      return {
        ...state,
        isDeptDropdownOpen: true,
        deptSearchTerm: '',
        focusedDeptIndex: -1,
      };

    case 'CLOSE_DROPDOWN':
      return {
        ...state,
        isDeptDropdownOpen: false,
        deptSearchTerm: '',
        focusedDeptIndex: -1,
      };

    case 'SET_SEARCH':
      // Typing a new query invalidates the current focused index since the
      // filtered list beneath it has changed.
      return {
        ...state,
        deptSearchTerm: action.payload,
        focusedDeptIndex: -1,
      };

    case 'SET_FOCUSED_INDEX':
      return {
        ...state,
        focusedDeptIndex: resolve(action.payload, state.focusedDeptIndex),
      };

    case 'SELECT_DEPT':
      // Semantic alias for CLOSE_DROPDOWN: selecting a department commits the
      // chip via the parent's onAddDepartment callback and closes the dropdown
      // atomically so we can't render a half-committed UI.
      return {
        ...state,
        isDeptDropdownOpen: false,
        deptSearchTerm: '',
        focusedDeptIndex: -1,
      };

    default:
      return state;
  }
}

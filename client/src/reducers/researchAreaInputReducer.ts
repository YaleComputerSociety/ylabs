/**
 * Pure reducer for the ResearchAreaInput combobox.
 *
 * Covers three intertwined concerns:
 *   1. The autocomplete combobox UI (open flag, filter text, keyboard focus
 *      index)
 *   2. The "add new research area" modal (open flag, pending name)
 *   3. The async create lifecycle (isLoading while POSTing to
 *      /api/research-areas)
 *
 * Grouping these keeps multi-field transitions atomic — e.g. selecting an
 * area must close the dropdown, clear the search, and reset keyboard focus
 * in a single render — while leaving the transitions pure and unit-testable.
 * Modeled on profileEditorReducer.ts / unknownUserReducer.ts for consistency.
 */

export interface ResearchAreaInputState {
  isDropdownOpen: boolean;
  searchTerm: string;
  focusedIndex: number;
  isModalOpen: boolean;
  pendingNewArea: string;
  isLoading: boolean;
}

export type ResearchAreaInputAction =
  | { type: 'OPEN_DROPDOWN' }
  | { type: 'CLOSE_DROPDOWN' }
  | { type: 'SET_SEARCH_TERM'; payload: string }
  | { type: 'SET_FOCUSED_INDEX'; payload: number | ((prev: number) => number) }
  | { type: 'SELECT_AREA' }
  | { type: 'OPEN_ADD_MODAL'; payload?: string }
  | { type: 'CLOSE_ADD_MODAL' }
  | { type: 'SET_PENDING_AREA'; payload: string }
  | { type: 'SUBMIT_START' }
  | { type: 'SUBMIT_END' };

const resolve = <T>(payload: T | ((prev: T) => T), prev: T): T =>
  typeof payload === 'function' ? (payload as (prev: T) => T)(prev) : payload;

export const createInitialResearchAreaInputState = (
  overrides: Partial<ResearchAreaInputState> = {},
): ResearchAreaInputState => ({
  isDropdownOpen: false,
  searchTerm: '',
  focusedIndex: -1,
  isModalOpen: false,
  pendingNewArea: '',
  isLoading: false,
  ...overrides,
});

export function researchAreaInputReducer(
  state: ResearchAreaInputState,
  action: ResearchAreaInputAction,
): ResearchAreaInputState {
  switch (action.type) {
    case 'OPEN_DROPDOWN':
      // Open deterministically: clear any stale filter text and reset the
      // keyboard focus so the dropdown opens in a pristine state.
      return { ...state, isDropdownOpen: true, searchTerm: '', focusedIndex: -1 };

    case 'CLOSE_DROPDOWN':
      return { ...state, isDropdownOpen: false, searchTerm: '', focusedIndex: -1 };

    case 'SET_SEARCH_TERM':
      // Any change to the filter invalidates the keyboard focus since the
      // list contents shift underneath it.
      return { ...state, searchTerm: action.payload, focusedIndex: -1 };

    case 'SET_FOCUSED_INDEX':
      return { ...state, focusedIndex: resolve(action.payload, state.focusedIndex) };

    case 'SELECT_AREA':
      // Atomic: after selecting an area the dropdown must close, the filter
      // must clear, and keyboard focus must reset — all in one transition so
      // we never render a half-committed UI.
      return { ...state, isDropdownOpen: false, searchTerm: '', focusedIndex: -1 };

    case 'OPEN_ADD_MODAL':
      // Seed the pending name from the explicit payload when provided,
      // otherwise fall back to the current searchTerm (trimmed) so Enter on a
      // "new area" row in the dropdown carries the typed text into the modal.
      return {
        ...state,
        isModalOpen: true,
        isDropdownOpen: false,
        pendingNewArea:
          action.payload !== undefined ? action.payload : state.searchTerm.trim(),
      };

    case 'CLOSE_ADD_MODAL':
      return { ...state, isModalOpen: false, pendingNewArea: '' };

    case 'SET_PENDING_AREA':
      return { ...state, pendingNewArea: action.payload };

    case 'SUBMIT_START':
      return { ...state, isLoading: true };

    case 'SUBMIT_END':
      return { ...state, isLoading: false };

    default:
      return state;
  }
}

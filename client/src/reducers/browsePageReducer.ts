/**
 * Pure reducer for browse-page UI state shared by the listings (home) and
 * fellowships pages. Owns favorites, the detail modal selection, and the
 * admin-edit modal selection. Opening/closing the detail modal is atomic —
 * isDetailModalOpen and selectedItem flip together so an intermediate render
 * can never show "modal closed but item still selected" or vice versa.
 */

export interface BrowsePageState<T> {
  favIds: string[];
  selectedItem: T | null;
  isDetailModalOpen: boolean;
  adminEditItem: T | null;
}

export type BrowsePageAction<T> =
  | { type: 'OPEN_DETAIL_MODAL'; item: T }
  | { type: 'CLOSE_DETAIL_MODAL' }
  | { type: 'OPEN_ADMIN_EDIT'; item: T }
  | { type: 'CLOSE_ADMIN_EDIT' }
  | { type: 'SET_FAVORITES'; ids: string[] };

export const createInitialBrowsePageState = <T>(
  overrides: Partial<BrowsePageState<T>> = {},
): BrowsePageState<T> => ({
  favIds: [],
  selectedItem: null,
  isDetailModalOpen: false,
  adminEditItem: null,
  ...overrides,
});

export function browsePageReducer<T>(
  state: BrowsePageState<T>,
  action: BrowsePageAction<T>,
): BrowsePageState<T> {
  switch (action.type) {
    case 'OPEN_DETAIL_MODAL':
      return { ...state, selectedItem: action.item, isDetailModalOpen: true };

    case 'CLOSE_DETAIL_MODAL':
      return { ...state, selectedItem: null, isDetailModalOpen: false };

    case 'OPEN_ADMIN_EDIT':
      return { ...state, adminEditItem: action.item };

    case 'CLOSE_ADMIN_EDIT':
      return { ...state, adminEditItem: null };

    case 'SET_FAVORITES':
      return { ...state, favIds: action.ids };

    default:
      return state;
  }
}

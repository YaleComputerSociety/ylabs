/**
 * Pure reducer for the admin fellowships management table.
 *
 * Covers the fetch lifecycle (isLoading + results), search/sort/filter/page
 * query state, and the editingFellowship modal handle. The reducer stays
 * generic over the fellowship shape so the component keeps its own
 * AdminFellowship type local.
 */

export type AdminFellowshipsSortField =
  | 'title'
  | 'deadline'
  | 'views'
  | 'favorites'
  | 'createdAt';

export interface AdminFellowshipsTableState<F> {
  fellowships: F[];
  total: number;
  totalPages: number;
  isLoading: boolean;

  search: string;
  sortBy: AdminFellowshipsSortField;
  sortOrder: 'asc' | 'desc';
  page: number;
  pageSize: number;
  archivedFilter: string;
  auditedFilter: string;

  editingFellowship: F | null;
}

export type AdminFellowshipsTableAction<F> =
  | { type: 'FETCH_START' }
  | {
      type: 'FETCH_SUCCESS';
      payload: { fellowships: F[]; total: number; totalPages: number };
    }
  | { type: 'FETCH_FAILURE' }
  | { type: 'SET_SEARCH'; payload: string }
  | { type: 'SET_ARCHIVED_FILTER'; payload: string }
  | { type: 'SET_AUDITED_FILTER'; payload: string }
  | { type: 'SET_PAGE'; payload: number }
  | { type: 'SET_PAGE_SIZE'; payload: number }
  | { type: 'TOGGLE_SORT'; field: AdminFellowshipsSortField }
  | { type: 'OPEN_EDIT'; fellowship: F }
  | { type: 'CLOSE_EDIT' };

export const createInitialAdminFellowshipsTableState = <F>(
  overrides: Partial<AdminFellowshipsTableState<F>> = {}
): AdminFellowshipsTableState<F> => ({
  fellowships: [],
  total: 0,
  totalPages: 0,
  isLoading: true,
  search: '',
  sortBy: 'createdAt',
  sortOrder: 'desc',
  page: 1,
  pageSize: 25,
  archivedFilter: '',
  auditedFilter: '',
  editingFellowship: null,
  ...overrides,
});

export function adminFellowshipsTableReducer<F>(
  state: AdminFellowshipsTableState<F>,
  action: AdminFellowshipsTableAction<F>
): AdminFellowshipsTableState<F> {
  switch (action.type) {
    case 'FETCH_START':
      return { ...state, isLoading: true };

    case 'FETCH_SUCCESS':
      return {
        ...state,
        isLoading: false,
        fellowships: action.payload.fellowships,
        total: action.payload.total,
        totalPages: action.payload.totalPages,
      };

    case 'FETCH_FAILURE':
      return { ...state, isLoading: false };

    // Changing a query parameter always resets back to page 1 so the user
    // isn't stranded on an out-of-bounds page after the result set shrinks.
    case 'SET_SEARCH':
      return { ...state, search: action.payload, page: 1 };

    case 'SET_ARCHIVED_FILTER':
      return { ...state, archivedFilter: action.payload, page: 1 };

    case 'SET_AUDITED_FILTER':
      return { ...state, auditedFilter: action.payload, page: 1 };

    case 'SET_PAGE':
      return { ...state, page: action.payload };

    case 'SET_PAGE_SIZE':
      return { ...state, pageSize: action.payload, page: 1 };

    case 'TOGGLE_SORT': {
      // Clicking the same column flips direction; clicking a new one resets
      // to 'desc'. Either way, jump back to page 1.
      if (state.sortBy === action.field) {
        return {
          ...state,
          sortOrder: state.sortOrder === 'asc' ? 'desc' : 'asc',
          page: 1,
        };
      }
      return {
        ...state,
        sortBy: action.field,
        sortOrder: 'desc',
        page: 1,
      };
    }

    case 'OPEN_EDIT':
      return { ...state, editingFellowship: action.fellowship };

    case 'CLOSE_EDIT':
      return { ...state, editingFellowship: null };

    default:
      return state;
  }
}

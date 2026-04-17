/**
 * Generic reducer for admin paginated-query tables.
 *
 * Shared by admin tables for fellowships, listings, faculty profiles, etc.
 * Each consumer specializes the three type parameters:
 *   - T         — the row type (AdminFellowship, AdminListing, ...)
 *   - SortField — the union of sortable columns
 *   - Filter    — the union of filter keys (e.g. 'archived' | 'audited')
 *
 * Consumers that need extra actions (e.g. URL-check state) compose by
 * intercepting their actions first and falling back to `adminTableReducer`.
 *
 * Invariants encoded here:
 *   - Any search/filter/sort/page-size change resets `page` to 1.
 *   - TOGGLE_SORT on the active column flips direction; on a new column
 *     it resets direction to 'desc'.
 *   - Fetch failure preserves existing rows (stale data beats an empty grid).
 */

export interface AdminTableState<T, SortField extends string, Filter extends string> {
  items: T[];
  total: number;
  totalPages: number;
  isLoading: boolean;

  search: string;
  sortBy: SortField;
  sortOrder: 'asc' | 'desc';
  page: number;
  pageSize: number;

  filters: Record<Filter, string>;

  editing: T | null;
}

export type AdminTableAction<T, SortField extends string, Filter extends string> =
  | { type: 'FETCH_START' }
  | { type: 'FETCH_SUCCESS'; items: T[]; total: number; totalPages: number }
  | { type: 'FETCH_FAILURE' }
  | { type: 'SET_SEARCH'; payload: string }
  | { type: 'SET_FILTER'; filter: Filter; value: string }
  | { type: 'SET_PAGE'; payload: number }
  | { type: 'SET_PAGE_SIZE'; payload: number }
  | { type: 'TOGGLE_SORT'; field: SortField }
  | { type: 'SET_SORT_BY'; field: SortField }
  | { type: 'TOGGLE_SORT_ORDER' }
  | { type: 'OPEN_EDIT'; item: T }
  | { type: 'CLOSE_EDIT' };

export interface AdminTableDefaults<SortField extends string, Filter extends string> {
  sortBy: SortField;
  sortOrder?: 'asc' | 'desc';
  pageSize?: number;
  filters: Record<Filter, string>;
}

export const createInitialAdminTableState = <T, SortField extends string, Filter extends string>(
  defaults: AdminTableDefaults<SortField, Filter>,
): AdminTableState<T, SortField, Filter> => ({
  items: [],
  total: 0,
  totalPages: 0,
  isLoading: true,
  search: '',
  sortBy: defaults.sortBy,
  sortOrder: defaults.sortOrder ?? 'desc',
  page: 1,
  pageSize: defaults.pageSize ?? 25,
  filters: { ...defaults.filters },
  editing: null,
});

export function adminTableReducer<
  T,
  SortField extends string,
  Filter extends string,
  S extends AdminTableState<T, SortField, Filter> = AdminTableState<T, SortField, Filter>,
>(state: S, action: AdminTableAction<T, SortField, Filter>): S {
  switch (action.type) {
    case 'FETCH_START':
      return { ...state, isLoading: true };

    case 'FETCH_SUCCESS':
      return {
        ...state,
        isLoading: false,
        items: action.items,
        total: action.total,
        totalPages: action.totalPages,
      };

    case 'FETCH_FAILURE':
      return { ...state, isLoading: false };

    case 'SET_SEARCH':
      return { ...state, search: action.payload, page: 1 };

    case 'SET_FILTER':
      return {
        ...state,
        filters: { ...state.filters, [action.filter]: action.value },
        page: 1,
      };

    case 'SET_PAGE':
      return { ...state, page: action.payload };

    case 'SET_PAGE_SIZE':
      return { ...state, pageSize: action.payload, page: 1 };

    case 'TOGGLE_SORT': {
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

    case 'SET_SORT_BY':
      return { ...state, sortBy: action.field, page: 1 };

    case 'TOGGLE_SORT_ORDER':
      return {
        ...state,
        sortOrder: state.sortOrder === 'asc' ? 'desc' : 'asc',
        page: 1,
      };

    case 'OPEN_EDIT':
      return { ...state, editing: action.item };

    case 'CLOSE_EDIT':
      return { ...state, editing: null };

    default:
      return state;
  }
}

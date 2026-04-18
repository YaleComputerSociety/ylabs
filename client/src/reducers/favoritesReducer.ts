/**
 * Pure reducer for the user's favorites dashboard (saved listings + fellowships).
 *
 * Holds the two favorited collections and the sort/filter/view state that shape
 * how they render. Optimistic add/remove lives here; localStorage tracking
 * (emailed/notes) is still owned by accountTrackingReducer. API calls and modal
 * UI toggles stay in the consuming component.
 */
import { Listing, Fellowship } from '../types/types';

export type FavSortKey = 'name' | 'department' | 'status' | 'dateAdded';
export type FavStatusFilter = 'all' | 'open' | 'closed' | 'emailed';
export type DashboardView = 'list' | 'card';

export interface FavoritesState {
  favListings: Listing[];
  favListingsIds: string[];
  favFellowships: Fellowship[];
  favFellowshipIds: string[];
  sortKey: FavSortKey;
  sortAsc: boolean;
  deptFilter: string | null;
  statusFilter: FavStatusFilter;
  dashboardView: DashboardView;
}

export type FavoritesAction =
  | {
      type: 'HYDRATE';
      payload: Partial<
        Pick<
          FavoritesState,
          'favListings' | 'favListingsIds' | 'favFellowships' | 'favFellowshipIds'
        >
      >;
    }
  | { type: 'SET_FAV_LISTINGS'; favListings: Listing[]; favListingsIds: string[] }
  | { type: 'ADD_FAV_LISTING'; listing: Listing }
  | { type: 'REMOVE_FAV_LISTING'; listingId: string }
  | { type: 'UPDATE_FAV_LISTING'; listing: Listing }
  | { type: 'SET_FAV_FELLOWSHIPS'; favFellowships: Fellowship[]; favFellowshipIds: string[] }
  | { type: 'ADD_FAV_FELLOWSHIP_ID'; fellowshipId: string }
  | { type: 'REMOVE_FAV_FELLOWSHIP'; fellowshipId: string }
  | { type: 'TOGGLE_SORT'; key: FavSortKey }
  | { type: 'SET_SORT'; key: FavSortKey; asc: boolean }
  | { type: 'SET_DEPT_FILTER'; value: string | null }
  | { type: 'SET_STATUS_FILTER'; value: FavStatusFilter }
  | { type: 'SET_DASHBOARD_VIEW'; value: DashboardView };

export const createInitialFavoritesState = (
  overrides: Partial<FavoritesState> = {},
): FavoritesState => ({
  favListings: [],
  favListingsIds: [],
  favFellowships: [],
  favFellowshipIds: [],
  sortKey: 'dateAdded',
  sortAsc: true,
  deptFilter: null,
  statusFilter: 'all',
  dashboardView: 'list',
  ...overrides,
});

const getFellowshipId = (f: Fellowship): string => f.id || (f as any)._id;

export function favoritesReducer(
  state: FavoritesState,
  action: FavoritesAction,
): FavoritesState {
  switch (action.type) {
    case 'HYDRATE':
      return { ...state, ...action.payload };

    case 'SET_FAV_LISTINGS':
      return {
        ...state,
        favListings: action.favListings,
        favListingsIds: action.favListingsIds,
      };

    case 'ADD_FAV_LISTING': {
      const id = action.listing.id;
      if (state.favListingsIds.includes(id)) return state;
      return {
        ...state,
        favListings: [action.listing, ...state.favListings],
        favListingsIds: [id, ...state.favListingsIds],
      };
    }

    case 'REMOVE_FAV_LISTING':
      return {
        ...state,
        favListings: state.favListings.filter((l) => l.id !== action.listingId),
        favListingsIds: state.favListingsIds.filter((id) => id !== action.listingId),
      };

    case 'UPDATE_FAV_LISTING':
      return {
        ...state,
        favListings: state.favListings.map((l) =>
          l.id === action.listing.id ? action.listing : l,
        ),
      };

    case 'SET_FAV_FELLOWSHIPS':
      return {
        ...state,
        favFellowships: action.favFellowships,
        favFellowshipIds: action.favFellowshipIds,
      };

    case 'ADD_FAV_FELLOWSHIP_ID':
      if (state.favFellowshipIds.includes(action.fellowshipId)) return state;
      return {
        ...state,
        favFellowshipIds: [action.fellowshipId, ...state.favFellowshipIds],
      };

    case 'REMOVE_FAV_FELLOWSHIP':
      return {
        ...state,
        favFellowships: state.favFellowships.filter(
          (f) => getFellowshipId(f) !== action.fellowshipId,
        ),
        favFellowshipIds: state.favFellowshipIds.filter((id) => id !== action.fellowshipId),
      };

    case 'TOGGLE_SORT':
      if (state.sortKey === action.key) {
        return { ...state, sortAsc: !state.sortAsc };
      }
      return { ...state, sortKey: action.key, sortAsc: true };

    case 'SET_SORT':
      return { ...state, sortKey: action.key, sortAsc: action.asc };

    case 'SET_DEPT_FILTER':
      return { ...state, deptFilter: action.value };

    case 'SET_STATUS_FILTER':
      return { ...state, statusFilter: action.value };

    case 'SET_DASHBOARD_VIEW':
      return { ...state, dashboardView: action.value };

    default:
      return state;
  }
}

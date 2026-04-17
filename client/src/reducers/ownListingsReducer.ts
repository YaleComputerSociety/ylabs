/**
 * Pure reducer for the professor's own-listings dashboard slice of
 * pages/account.tsx.
 *
 * Models the subset of account-page state that tracks a professor's owned
 * listings and the edit/create lifecycle around them: the listing array, a
 * page-level loading flag, and two mutually-connected flags (`isEditing`,
 * `isCreating`) that drive the ListingForm's appearance. The skeleton row
 * used while creating a new listing lives in `ownListings` under the sentinel
 * id `"create"` — START_CREATE appends it, CANCEL_CREATE filters it out.
 *
 * HTTP calls, swal dialogs, and any toast/error UI stay in the consuming
 * component; this module only models state transitions.
 */
import { Listing } from '../types/types';

export interface OwnListingsState {
  ownListings: Listing[];
  isLoading: boolean;
  isEditing: boolean;
  isCreating: boolean;
}

export type OwnListingsAction =
  | { type: 'SET_OWN_LISTINGS'; listings: Listing[] }
  | { type: 'SET_LOADING'; value: boolean }
  | { type: 'START_EDIT' }
  | { type: 'END_EDIT' }
  | { type: 'START_CREATE'; skeleton: Listing }
  | { type: 'CANCEL_CREATE' }
  | { type: 'UPDATE_LISTING'; listing: Listing }
  | { type: 'REMOVE_LISTING'; listingId: string };

export const createInitialOwnListingsState = (
  overrides: Partial<OwnListingsState> = {},
): OwnListingsState => ({
  ownListings: [],
  isLoading: false,
  isEditing: false,
  isCreating: false,
  ...overrides,
});

export function ownListingsReducer(
  state: OwnListingsState,
  action: OwnListingsAction,
): OwnListingsState {
  switch (action.type) {
    case 'SET_OWN_LISTINGS':
      return { ...state, ownListings: action.listings };

    case 'SET_LOADING':
      return { ...state, isLoading: action.value };

    case 'START_EDIT':
      return { ...state, isEditing: true };

    case 'END_EDIT':
      return { ...state, isEditing: false, isCreating: false };

    case 'START_CREATE':
      return {
        ...state,
        ownListings: [...state.ownListings, action.skeleton],
        isEditing: true,
        isCreating: true,
      };

    case 'CANCEL_CREATE':
      return {
        ...state,
        ownListings: state.ownListings.filter((l) => l.id !== 'create'),
        isEditing: false,
        isCreating: false,
      };

    case 'UPDATE_LISTING':
      return {
        ...state,
        ownListings: state.ownListings.map((l) =>
          l.id === action.listing.id ? action.listing : l,
        ),
      };

    case 'REMOVE_LISTING':
      return {
        ...state,
        ownListings: state.ownListings.filter((l) => l.id !== action.listingId),
      };

    default:
      return state;
  }
}

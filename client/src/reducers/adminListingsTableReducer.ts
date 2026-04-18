/**
 * Admin listings table reducer — specializes the generic adminTableReducer
 * and layers listing-specific URL-check state on top.
 *
 * URL_CHECK_* actions are intercepted here; everything else delegates to
 * the generic reducer so the page-reset-on-filter invariant is shared with
 * the fellowships/profiles tables.
 */
import {
  AdminTableAction,
  AdminTableState,
  adminTableReducer,
  createInitialAdminTableState,
} from './adminTableReducer';

export type AdminListingsSortField =
  | 'title'
  | 'ownerLastName'
  | 'descriptionLength'
  | 'views'
  | 'favorites'
  | 'createdAt'
  | 'hiringStatus'
  | 'redFlags';

export type AdminListingsFilter = 'archived' | 'confirmed' | 'audited';

export interface UrlCheckResult {
  url: string;
  reachable: boolean;
  error?: string;
}

export interface AdminListingsTableState<L> extends AdminTableState<
  L,
  AdminListingsSortField,
  AdminListingsFilter
> {
  urlResults: Record<string, UrlCheckResult[]>;
  checkingUrls: string | null;
}

export type AdminListingsTableAction<L> =
  | AdminTableAction<L, AdminListingsSortField, AdminListingsFilter>
  | { type: 'URL_CHECK_START'; listingId: string }
  | { type: 'URL_CHECK_SUCCESS'; listingId: string; results: UrlCheckResult[] }
  | { type: 'URL_CHECK_FAILURE' };

export const createInitialAdminListingsTableState = <L>(): AdminListingsTableState<L> => ({
  ...createInitialAdminTableState<L, AdminListingsSortField, AdminListingsFilter>({
    sortBy: 'createdAt',
    filters: { archived: '', confirmed: '', audited: '' },
  }),
  urlResults: {},
  checkingUrls: null,
});

export function adminListingsTableReducer<L>(
  state: AdminListingsTableState<L>,
  action: AdminListingsTableAction<L>,
): AdminListingsTableState<L> {
  switch (action.type) {
    case 'URL_CHECK_START':
      return { ...state, checkingUrls: action.listingId };
    case 'URL_CHECK_SUCCESS':
      return {
        ...state,
        checkingUrls: null,
        urlResults: { ...state.urlResults, [action.listingId]: action.results },
      };
    case 'URL_CHECK_FAILURE':
      return { ...state, checkingUrls: null };
    default:
      return adminTableReducer<
        L,
        AdminListingsSortField,
        AdminListingsFilter,
        AdminListingsTableState<L>
      >(state, action);
  }
}

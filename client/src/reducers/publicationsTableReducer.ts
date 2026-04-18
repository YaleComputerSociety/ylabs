/**
 * Publications table reducer — thin specialization of the generic
 * adminTableReducer. PublicationsTable has no filters and no edit modal,
 * so the filter key set is empty (`never`) and the `editing` slot plus
 * OPEN_EDIT/CLOSE_EDIT actions are unused. Consumers destructure
 * `editing` as `_editing` and ignore it.
 */
import {
  AdminTableAction,
  AdminTableState,
  adminTableReducer,
  createInitialAdminTableState,
} from './adminTableReducer';

export type PublicationsSortField = 'year' | 'title' | 'venue' | 'cited_by_count';

// No filters on this table — use `never` so Record<Filter, string> is {}.
type PublicationsFilter = never;

export type PublicationsTableState<P> = AdminTableState<P, PublicationsSortField, PublicationsFilter>;

export type PublicationsTableAction<P> = AdminTableAction<P, PublicationsSortField, PublicationsFilter>;

export const createInitialPublicationsTableState = <P>(): PublicationsTableState<P> =>
  createInitialAdminTableState<P, PublicationsSortField, PublicationsFilter>({
    sortBy: 'year',
    sortOrder: 'desc',
    pageSize: 20,
    filters: {} as Record<PublicationsFilter, string>,
  });

export const publicationsTableReducer = <P>(
  state: PublicationsTableState<P>,
  action: PublicationsTableAction<P>,
): PublicationsTableState<P> =>
  adminTableReducer<P, PublicationsSortField, PublicationsFilter>(state, action);

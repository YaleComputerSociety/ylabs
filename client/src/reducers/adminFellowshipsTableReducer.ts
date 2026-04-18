/**
 * Admin fellowships table reducer — thin specialization of the generic
 * adminTableReducer. Pick sort fields and filter keys; delegate transitions.
 */
import {
  AdminTableAction,
  AdminTableState,
  adminTableReducer,
  createInitialAdminTableState,
} from './adminTableReducer';

export type AdminFellowshipsSortField = 'title' | 'deadline' | 'views' | 'favorites' | 'createdAt';

export type AdminFellowshipsFilter = 'archived' | 'audited';

export type AdminFellowshipsTableState<F> = AdminTableState<
  F,
  AdminFellowshipsSortField,
  AdminFellowshipsFilter
>;

export type AdminFellowshipsTableAction<F> = AdminTableAction<
  F,
  AdminFellowshipsSortField,
  AdminFellowshipsFilter
>;

export const createInitialAdminFellowshipsTableState = <F>(): AdminFellowshipsTableState<F> =>
  createInitialAdminTableState<F, AdminFellowshipsSortField, AdminFellowshipsFilter>({
    sortBy: 'createdAt',
    filters: { archived: '', audited: '' },
  });

export const adminFellowshipsTableReducer = <F>(
  state: AdminFellowshipsTableState<F>,
  action: AdminFellowshipsTableAction<F>,
): AdminFellowshipsTableState<F> =>
  adminTableReducer<F, AdminFellowshipsSortField, AdminFellowshipsFilter>(state, action);

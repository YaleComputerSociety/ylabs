/**
 * Admin faculty profiles table reducer — specializes the generic
 * adminTableReducer with its own sort fields and filter keys.
 */
import {
  AdminTableAction,
  AdminTableState,
  adminTableReducer,
  createInitialAdminTableState,
} from './adminTableReducer';

export type AdminFacultyProfilesSortField =
  | 'lname'
  | 'primary_department'
  | 'h_index'
  | 'createdAt';

export type AdminFacultyProfilesFilter = 'profileVerified' | 'hasListings';

export type AdminFacultyProfilesTableState<P> = AdminTableState<
  P,
  AdminFacultyProfilesSortField,
  AdminFacultyProfilesFilter
>;

export type AdminFacultyProfilesTableAction<P> = AdminTableAction<
  P,
  AdminFacultyProfilesSortField,
  AdminFacultyProfilesFilter
>;

export const createInitialAdminFacultyProfilesTableState = <
  P,
>(): AdminFacultyProfilesTableState<P> =>
  createInitialAdminTableState<P, AdminFacultyProfilesSortField, AdminFacultyProfilesFilter>({
    sortBy: 'lname',
    sortOrder: 'asc',
    filters: { profileVerified: '', hasListings: '' },
  });

export const adminFacultyProfilesTableReducer = <P>(
  state: AdminFacultyProfilesTableState<P>,
  action: AdminFacultyProfilesTableAction<P>,
): AdminFacultyProfilesTableState<P> =>
  adminTableReducer<P, AdminFacultyProfilesSortField, AdminFacultyProfilesFilter>(state, action);

/**
 * Admin panel table for managing faculty profiles.
 *
 * Table state lives in reducers/adminFacultyProfilesTableReducer.ts (a thin
 * specialization of the generic adminTableReducer).
 */
import { useEffect, useCallback, useReducer } from 'react';
import axios from '../../utils/axios';
import AdminProfileEditModal from './AdminProfileEditModal';
import {
  adminFacultyProfilesTableReducer,
  createInitialAdminFacultyProfilesTableState,
} from '../../reducers/adminFacultyProfilesTableReducer';

interface AdminProfile {
  _id: string;
  netid: string;
  fname: string;
  lname: string;
  email: string;
  title?: string;
  primary_department?: string;
  secondary_departments?: string[];
  h_index?: number;
  profileVerified?: boolean;
  userType: string;
  userConfirmed: boolean;
  ownListings?: string[];
  createdAt?: string;
  updatedAt?: string;
}

type SortField = 'lname' | 'primary_department' | 'h_index' | 'createdAt';

const TABLE_COLUMNS: { value: SortField; label: string }[] = [
  { value: 'lname', label: 'Name' },
  { value: 'primary_department', label: 'Department' },
  { value: 'h_index', label: 'H-Index' },
  { value: 'createdAt', label: 'Added' },
];

const PAGE_SIZES = [10, 25, 50, 100];

const AdminFacultyProfilesTable = () => {
  const [state, dispatch] = useReducer(
    adminFacultyProfilesTableReducer<AdminProfile>,
    undefined,
    () => createInitialAdminFacultyProfilesTableState<AdminProfile>(),
  );
  const {
    items: profiles,
    total,
    totalPages,
    isLoading,
    search,
    sortBy,
    sortOrder,
    page,
    pageSize,
    filters,
    editing: editingProfile,
  } = state;
  const verifiedFilter = filters.profileVerified;
  const hasListingsFilter = filters.hasListings;

  const fetchProfiles = useCallback(async () => {
    dispatch({ type: 'FETCH_START' });
    try {
      const params: any = { search, sortBy, sortOrder, page, pageSize };
      if (verifiedFilter) params.profileVerified = verifiedFilter;
      if (hasListingsFilter) params.hasListings = hasListingsFilter;

      const res = await axios.get('/admin/profiles', { params });
      dispatch({
        type: 'FETCH_SUCCESS',
        items: res.data.profiles,
        total: res.data.total,
        totalPages: res.data.totalPages,
      });
    } catch (err) {
      console.error('Error fetching profiles:', err);
      dispatch({ type: 'FETCH_FAILURE' });
    }
  }, [search, sortBy, sortOrder, page, pageSize, verifiedFilter, hasListingsFilter]);

  useEffect(() => {
    fetchProfiles();
  }, [fetchProfiles]);

  // Preserve the original sort-direction defaults: alpha columns start
  // ascending, numeric/date columns start descending. Clicking the active
  // column flips direction.
  const handleColumnSort = (field: SortField) => {
    if (sortBy === field) {
      dispatch({ type: 'TOGGLE_SORT_ORDER' });
      return;
    }
    const preferred: 'asc' | 'desc' =
      field === 'lname' || field === 'primary_department' ? 'asc' : 'desc';
    dispatch({ type: 'SET_SORT_BY', field });
    if (sortOrder !== preferred) {
      dispatch({ type: 'TOGGLE_SORT_ORDER' });
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <input
          type="text"
          placeholder="Search by name, netid, department..."
          value={search}
          onChange={(e) => dispatch({ type: 'SET_SEARCH', payload: e.target.value })}
          className="flex-1 min-w-[200px] px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        />

        <select
          value={verifiedFilter}
          onChange={(e) =>
            dispatch({ type: 'SET_FILTER', filter: 'profileVerified', value: e.target.value })
          }
          className="px-3 py-2 text-sm border border-gray-200 rounded-lg"
        >
          <option value="">All Verified</option>
          <option value="true">Verified</option>
          <option value="false">Unverified</option>
        </select>

        <select
          value={hasListingsFilter}
          onChange={(e) =>
            dispatch({ type: 'SET_FILTER', filter: 'hasListings', value: e.target.value })
          }
          className="px-3 py-2 text-sm border border-gray-200 rounded-lg"
        >
          <option value="">All Listings</option>
          <option value="true">Has Listings</option>
          <option value="false">No Listings</option>
        </select>

        <select
          value={pageSize}
          onChange={(e) => dispatch({ type: 'SET_PAGE_SIZE', payload: Number(e.target.value) })}
          className="px-3 py-2 text-sm border border-gray-200 rounded-lg"
        >
          {PAGE_SIZES.map((s) => (
            <option key={s} value={s}>
              {s} / page
            </option>
          ))}
        </select>
      </div>

      <p className="text-xs text-gray-500 mb-2">
        {total} profile{total !== 1 ? 's' : ''} found
      </p>

      <div className="overflow-x-auto border border-gray-200 rounded-lg">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              {TABLE_COLUMNS.map((col) => (
                <th
                  key={col.value}
                  onClick={() => handleColumnSort(col.value)}
                  className="text-left px-4 py-3 font-semibold text-gray-600 cursor-pointer hover:text-gray-900 whitespace-nowrap"
                >
                  {col.label}
                  {sortBy === col.value && (
                    <span className="ml-1">{sortOrder === 'asc' ? '\u25B2' : '\u25BC'}</span>
                  )}
                </th>
              ))}
              <th className="text-left px-4 py-3 font-semibold text-gray-600 whitespace-nowrap">
                Listings
              </th>
              <th className="text-left px-4 py-3 font-semibold text-gray-600 whitespace-nowrap">
                Status
              </th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={6} className="text-center py-8 text-gray-400">
                  Loading...
                </td>
              </tr>
            ) : profiles.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center py-8 text-gray-400">
                  No profiles found.
                </td>
              </tr>
            ) : (
              profiles.map((p) => (
                <tr
                  key={p._id}
                  onClick={() => dispatch({ type: 'OPEN_EDIT', item: p })}
                  className="border-t border-gray-100 cursor-pointer hover:bg-blue-50 transition-colors"
                >
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-800">
                      {p.fname} {p.lname}
                    </div>
                    <div className="text-xs text-gray-400">{p.netid}</div>
                  </td>
                  <td className="px-4 py-3 text-gray-600 max-w-[200px] truncate">
                    {p.primary_department || '—'}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{p.h_index ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                    {p.createdAt ? new Date(p.createdAt).toLocaleDateString() : '—'}
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {(p.ownListings?.length || 0) > 0 ? (
                      <a
                        href={`/profile/${p.netid}?tab=listings`}
                        onClick={(e) => e.stopPropagation()}
                        className="text-blue-600 hover:text-blue-800 hover:underline font-medium"
                      >
                        {p.ownListings?.length}
                      </a>
                    ) : (
                      <span>0</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      {p.profileVerified ? (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-green-50 text-green-600">
                          Verified
                        </span>
                      ) : (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-600">
                          Unverified
                        </span>
                      )}
                      {p.userConfirmed && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-600">
                          Confirmed
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <button
            onClick={() => dispatch({ type: 'SET_PAGE', payload: Math.max(1, page - 1) })}
            disabled={page === 1}
            className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40"
          >
            Previous
          </button>
          <span className="text-sm text-gray-500">
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() => dispatch({ type: 'SET_PAGE', payload: Math.min(totalPages, page + 1) })}
            disabled={page === totalPages}
            className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}

      {editingProfile && (
        <AdminProfileEditModal
          profile={editingProfile}
          onClose={() => dispatch({ type: 'CLOSE_EDIT' })}
          onSaved={() => {
            dispatch({ type: 'CLOSE_EDIT' });
            fetchProfiles();
          }}
        />
      )}
    </div>
  );
};

export default AdminFacultyProfilesTable;

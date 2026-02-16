/**
 * Admin panel table for managing faculty profiles.
 */
import { useState, useEffect, useCallback } from "react";
import axios from "../../utils/axios";
import AdminProfileEditModal from "./AdminProfileEditModal";

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

type SortField = "lname" | "primary_department" | "h_index" | "createdAt";

const TABLE_COLUMNS: { value: SortField; label: string }[] = [
  { value: "lname", label: "Name" },
  { value: "primary_department", label: "Department" },
  { value: "h_index", label: "H-Index" },
  { value: "createdAt", label: "Added" },
];

const PAGE_SIZES = [10, 25, 50, 100];

const AdminFacultyProfilesTable = () => {
  const [profiles, setProfiles] = useState<AdminProfile[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortField>("lname");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [verifiedFilter, setVerifiedFilter] = useState<string>("");
  const [hasListingsFilter, setHasListingsFilter] = useState<string>("");

  const [editingProfile, setEditingProfile] = useState<AdminProfile | null>(null);

  const fetchProfiles = useCallback(async () => {
    setIsLoading(true);
    try {
      const params: any = { search, sortBy, sortOrder, page, pageSize };
      if (verifiedFilter) params.profileVerified = verifiedFilter;
      if (hasListingsFilter) params.hasListings = hasListingsFilter;

      const res = await axios.get("/admin/profiles", { params });
      setProfiles(res.data.profiles);
      setTotal(res.data.total);
      setTotalPages(res.data.totalPages);
    } catch (err) {
      console.error("Error fetching profiles:", err);
    } finally {
      setIsLoading(false);
    }
  }, [search, sortBy, sortOrder, page, pageSize, verifiedFilter, hasListingsFilter]);

  useEffect(() => {
    fetchProfiles();
  }, [fetchProfiles]);

  useEffect(() => {
    setPage(1);
  }, [search, verifiedFilter, hasListingsFilter]);

  const handleColumnSort = (field: SortField) => {
    if (sortBy === field) {
      setSortOrder((o) => (o === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(field);
      setSortOrder(field === "lname" || field === "primary_department" ? "asc" : "desc");
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <input
          type="text"
          placeholder="Search by name, netid, department..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[200px] px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        />

        <select
          value={verifiedFilter}
          onChange={(e) => setVerifiedFilter(e.target.value)}
          className="px-3 py-2 text-sm border border-gray-200 rounded-lg"
        >
          <option value="">All Verified</option>
          <option value="true">Verified</option>
          <option value="false">Unverified</option>
        </select>

        <select
          value={hasListingsFilter}
          onChange={(e) => setHasListingsFilter(e.target.value)}
          className="px-3 py-2 text-sm border border-gray-200 rounded-lg"
        >
          <option value="">All Listings</option>
          <option value="true">Has Listings</option>
          <option value="false">No Listings</option>
        </select>

        <select
          value={pageSize}
          onChange={(e) => setPageSize(Number(e.target.value))}
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
        {total} profile{total !== 1 ? "s" : ""} found
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
                    <span className="ml-1">{sortOrder === "asc" ? "\u25B2" : "\u25BC"}</span>
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
                  onClick={() => setEditingProfile(p)}
                  className="border-t border-gray-100 cursor-pointer hover:bg-blue-50 transition-colors"
                >
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-800">
                      {p.fname} {p.lname}
                    </div>
                    <div className="text-xs text-gray-400">{p.netid}</div>
                  </td>
                  <td className="px-4 py-3 text-gray-600 max-w-[200px] truncate">
                    {p.primary_department || "—"}
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {p.h_index ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                    {p.createdAt
                      ? new Date(p.createdAt).toLocaleDateString()
                      : "—"}
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
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40"
          >
            Previous
          </button>
          <span className="text-sm text-gray-500">
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
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
          onClose={() => setEditingProfile(null)}
          onSaved={() => {
            setEditingProfile(null);
            fetchProfiles();
          }}
        />
      )}
    </div>
  );
};

export default AdminFacultyProfilesTable;

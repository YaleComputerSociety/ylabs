/**
 * Admin panel table for managing listings.
 */
import { useState, useEffect, useCallback } from "react";
import axios from "../../utils/axios";
import swal from "sweetalert";
import AdminListingEditModal from "./AdminListingEditModal";

interface AdminListing {
  _id: string;
  title: string;
  ownerId: string;
  ownerFirstName: string;
  ownerLastName: string;
  ownerEmail: string;
  departments: string[];
  description: string;
  websites: string[];
  emails: string[];
  researchAreas: string[];
  professorNames: string[];
  professorIds: string[];
  applicantDescription: string;
  hiringStatus: number;
  views: number;
  favorites: number;
  archived: boolean;
  confirmed: boolean;
  audited: boolean;
  createdAt: string;
}

type SortField =
  | "title"
  | "ownerLastName"
  | "descriptionLength"
  | "views"
  | "favorites"
  | "createdAt"
  | "hiringStatus"
  | "redFlags";

const TABLE_COLUMNS: { value: SortField; label: string }[] = [
  { value: "title", label: "Title" },
  { value: "ownerLastName", label: "Owner" },
  { value: "descriptionLength", label: "Desc Len" },
  { value: "views", label: "Views" },
  { value: "favorites", label: "Favs" },
  { value: "hiringStatus", label: "Status" },
  { value: "createdAt", label: "Added" },
];

const SORT_OPTIONS: { value: SortField; label: string }[] = [
  { value: "redFlags", label: "Red Flags (Issues)" },
  ...TABLE_COLUMNS,
];

const PAGE_SIZES = [10, 25, 50, 100];

const AdminListingsTable = () => {
  const [listings, setListings] = useState<AdminListing[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortField>("createdAt");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [archivedFilter, setArchivedFilter] = useState<string>("");
  const [confirmedFilter, setConfirmedFilter] = useState<string>("");
  const [auditedFilter, setAuditedFilter] = useState<string>("");

  const [editingListing, setEditingListing] = useState<AdminListing | null>(null);

  const [urlResults, setUrlResults] = useState<Record<string, { url: string; reachable: boolean; error?: string }[]>>({});
  const [checkingUrls, setCheckingUrls] = useState<string | null>(null);

  const fetchListings = useCallback(async () => {
    setIsLoading(true);
    try {
      const params: any = {
        search: search.trim(),
        sortBy,
        sortOrder,
        page,
        pageSize,
      };
      if (archivedFilter) params.archived = archivedFilter;
      if (confirmedFilter) params.confirmed = confirmedFilter;
      if (auditedFilter) params.audited = auditedFilter;

      const response = await axios.get("/admin/listings", { params, withCredentials: true });
      setListings(response.data.listings);
      setTotal(response.data.total);
      setTotalPages(response.data.totalPages);
    } catch (error) {
      console.error("Error fetching admin listings:", error);
      swal({ text: "Failed to fetch listings", icon: "error" });
    } finally {
      setIsLoading(false);
    }
  }, [search, sortBy, sortOrder, page, pageSize, archivedFilter, confirmedFilter, auditedFilter]);

  useEffect(() => {
    const debounce = setTimeout(() => {
      fetchListings();
    }, search ? 400 : 0);
    return () => clearTimeout(debounce);
  }, [fetchListings]);

  const handleDelete = async (listing: AdminListing) => {
    const confirmed = await swal({
      title: "Delete Listing",
      text: `Are you sure you want to permanently delete "${listing.title}"? This cannot be undone.`,
      icon: "warning",
      buttons: ["Cancel", "Delete"],
      dangerMode: true,
    });

    if (!confirmed) return;

    try {
      await axios.delete(`/admin/listings/${listing._id}`, { withCredentials: true });
      swal({ text: "Listing deleted", icon: "success", timer: 1500 });
      fetchListings();
    } catch (error) {
      console.error("Error deleting listing:", error);
      swal({ text: "Failed to delete listing", icon: "error" });
    }
  };

  const handleCheckUrls = async (listing: AdminListing) => {
    if (!listing.websites || listing.websites.length === 0) {
      swal({ text: "No URLs to check for this listing", icon: "info" });
      return;
    }

    setCheckingUrls(listing._id);
    try {
      const response = await axios.post(
        "/admin/check-urls",
        { urls: listing.websites },
        { withCredentials: true }
      );
      setUrlResults((prev) => ({ ...prev, [listing._id]: response.data.results }));
    } catch (error) {
      console.error("Error checking URLs:", error);
      swal({ text: "Failed to check URLs", icon: "error" });
    } finally {
      setCheckingUrls(null);
    }
  };

  const handleEditSave = () => {
    setEditingListing(null);
    fetchListings();
  };

  const handleSort = (field: SortField) => {
    if (sortBy === field) {
      setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(field);
      setSortOrder("desc");
    }
    setPage(1);
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortBy !== field) return <span className="text-gray-300 ml-1">{"\u2195"}</span>;
    return <span className="text-blue-600 ml-1">{sortOrder === "asc" ? "\u25B2" : "\u25BC"}</span>;
  };

  return (
    <div>
      <div className="bg-white rounded-lg shadow-md p-4 border border-gray-200 mb-4">
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs font-medium text-gray-600 mb-1">Search</label>
            <input
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Search by title, owner, description..."
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Archived</label>
            <select
              value={archivedFilter}
              onChange={(e) => {
                setArchivedFilter(e.target.value);
                setPage(1);
              }}
              className="border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All</option>
              <option value="true">Archived</option>
              <option value="false">Not Archived</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Confirmed</label>
            <select
              value={confirmedFilter}
              onChange={(e) => {
                setConfirmedFilter(e.target.value);
                setPage(1);
              }}
              className="border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All</option>
              <option value="true">Confirmed</option>
              <option value="false">Unconfirmed</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Audited</label>
            <select
              value={auditedFilter}
              onChange={(e) => {
                setAuditedFilter(e.target.value);
                setPage(1);
              }}
              className="border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All</option>
              <option value="true">Audited</option>
              <option value="false">Not Audited</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Sort By</label>
            <div className="flex gap-1">
              <select
                value={sortBy}
                onChange={(e) => {
                  setSortBy(e.target.value as SortField);
                  setPage(1);
                }}
                className={`border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                  sortBy === "redFlags" ? "border-red-400 bg-red-50" : "border-gray-300"
                }`}
              >
                {SORT_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <button
                onClick={() => setSortOrder(sortOrder === "asc" ? "desc" : "asc")}
                className="border border-gray-300 rounded-md px-2 py-2 text-sm hover:bg-gray-50"
                title={sortOrder === "asc" ? "Ascending" : "Descending"}
              >
                {sortOrder === "asc" ? "↑" : "↓"}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Per Page</label>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
              className="border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {PAGE_SIZES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-2 text-sm text-gray-500">
          {total} listing{total !== 1 ? "s" : ""} total
          {sortBy === "redFlags" && (
            <span className="ml-2 text-red-600 font-medium">
              • Sorted by red flags (no dept, no views, old, etc.)
            </span>
          )}
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-md border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b">
                {TABLE_COLUMNS.map((col) => (
                  <th
                    key={col.value}
                    onClick={() => handleSort(col.value)}
                    className="text-left py-3 px-2 font-semibold text-gray-700 cursor-pointer hover:bg-gray-100 select-none whitespace-nowrap text-xs"
                  >
                    {col.label}
                    <SortIcon field={col.value} />
                  </th>
                ))}
                <th className="text-left py-3 px-2 font-semibold text-gray-700 whitespace-nowrap text-xs">Depts</th>
                <th className="text-center py-3 px-2 font-semibold text-gray-700 whitespace-nowrap text-xs">Arch</th>
                <th className="text-center py-3 px-2 font-semibold text-gray-700 whitespace-nowrap text-xs">Conf</th>
                <th className="text-center py-3 px-2 font-semibold text-gray-700 whitespace-nowrap text-xs">Audit</th>
                <th className="text-center py-3 px-2 font-semibold text-gray-700 whitespace-nowrap text-xs">URLs</th>
                <th className="text-center py-3 px-2 font-semibold text-gray-700 whitespace-nowrap text-xs">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={13} className="text-center py-8 text-gray-500">
                    Loading...
                  </td>
                </tr>
              ) : listings.length === 0 ? (
                <tr>
                  <td colSpan={13} className="text-center py-8 text-gray-500">
                    No listings found
                  </td>
                </tr>
              ) : (
                listings.map((listing) => {
                  const isOld = new Date(listing.createdAt) < new Date(Date.now() - 2 * 365 * 24 * 60 * 60 * 1000);
                  const noDepts = !listing.departments || listing.departments.length === 0;
                  const noViews = listing.views === 0;
                  const hasRedFlags = isOld || noDepts || noViews;

                  return (
                  <tr key={listing._id} className={`border-b hover:bg-gray-50 ${hasRedFlags ? "bg-red-50/50" : ""}`}>
                    <td className="py-1.5 px-2 max-w-[180px] truncate text-xs" title={listing.title}>
                      {listing.title}
                    </td>
                    <td className="py-1.5 px-2 whitespace-nowrap text-xs">
                      {listing.ownerFirstName} {listing.ownerLastName}
                      <div className="text-[10px] text-gray-400">{listing.ownerId}</div>
                    </td>
                    <td className="py-1.5 px-2 text-right text-xs">{listing.description?.length || 0}</td>
                    <td className={`py-1.5 px-2 text-right text-xs ${noViews ? "text-red-600 font-medium" : ""}`}>
                      {listing.views}
                    </td>
                    <td className="py-1.5 px-2 text-right text-xs">{listing.favorites}</td>
                    <td className="py-1.5 px-2 whitespace-nowrap">
                      {listing.hiringStatus >= 0 ? (
                        <span className="text-green-700 bg-green-100 px-1.5 py-0.5 rounded text-[10px] font-medium">Open</span>
                      ) : (
                        <span className="text-red-700 bg-red-100 px-1.5 py-0.5 rounded text-[10px] font-medium">Closed</span>
                      )}
                    </td>
                    <td className={`py-1.5 px-2 whitespace-nowrap text-xs ${isOld ? "text-red-600 font-medium" : "text-gray-500"}`}>
                      {new Date(listing.createdAt).toLocaleDateString()}
                    </td>
                    <td className="py-1.5 px-2 max-w-[100px]">
                      {noDepts ? (
                        <span className="text-red-600 text-xs font-medium">None!</span>
                      ) : (
                        <div className="flex flex-wrap gap-0.5">
                          {listing.departments?.slice(0, 2).map((d) => (
                            <span key={d} className="text-[10px] bg-blue-100 text-blue-800 px-1 py-0.5 rounded">
                              {d.split(" - ")[0]}
                            </span>
                          ))}
                          {listing.departments?.length > 2 && (
                            <span className="text-[10px] text-gray-400">+{listing.departments.length - 2}</span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="py-1.5 px-2 text-center">
                      {listing.archived ? (
                        <span className="text-yellow-700 bg-yellow-100 px-1.5 py-0.5 rounded text-[10px] font-medium">Yes</span>
                      ) : (
                        <span className="text-gray-400 text-[10px]">No</span>
                      )}
                    </td>
                    <td className="py-1.5 px-2 text-center">
                      {listing.confirmed ? (
                        <span className="text-gray-400 text-[10px]">Yes</span>
                      ) : (
                        <span className="text-orange-700 bg-orange-100 px-1.5 py-0.5 rounded text-[10px] font-medium">No</span>
                      )}
                    </td>
                    <td className="py-1.5 px-2 text-center">
                      {listing.audited ? (
                        <span className="text-green-700 bg-green-100 px-1.5 py-0.5 rounded text-[10px] font-medium">✓</span>
                      ) : (
                        <span className="text-gray-400 text-[10px]">—</span>
                      )}
                    </td>
                    <td className="py-1.5 px-2 text-center">
                      {listing.websites?.length > 0 ? (
                        <button
                          onClick={() => handleCheckUrls(listing)}
                          disabled={checkingUrls === listing._id}
                          className="text-[10px] text-blue-600 hover:text-blue-800 underline disabled:opacity-50"
                        >
                          {checkingUrls === listing._id ? "..." : listing.websites.length}
                        </button>
                      ) : (
                        <span className="text-[10px] text-gray-300">--</span>
                      )}
                    </td>
                    <td className="py-1.5 px-2">
                      <div className="flex gap-1 justify-center">
                        <button
                          onClick={() => setEditingListing(listing)}
                          className="text-[10px] bg-blue-600 text-white px-2 py-1 rounded hover:bg-blue-700 transition-colors"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(listing)}
                          className="text-[10px] bg-red-600 text-white px-2 py-1 rounded hover:bg-red-700 transition-colors"
                        >
                          Del
                        </button>
                      </div>
                    </td>
                  </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <div className="text-sm text-gray-500">
            Page {page} of {totalPages}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setPage(1)}
              disabled={page === 1}
              className="px-3 py-1.5 text-sm border rounded hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              First
            </button>
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-1.5 text-sm border rounded hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Prev
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="px-3 py-1.5 text-sm border rounded hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Next
            </button>
            <button
              onClick={() => setPage(totalPages)}
              disabled={page === totalPages}
              className="px-3 py-1.5 text-sm border rounded hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Last
            </button>
          </div>
        </div>
      )}

      {editingListing && (
        <AdminListingEditModal
          listing={editingListing}
          onClose={() => setEditingListing(null)}
          onSave={handleEditSave}
        />
      )}
    </div>
  );
};

export default AdminListingsTable;

/**
 * Admin panel table for managing fellowships.
 */
import { useState, useEffect, useCallback, useReducer } from "react";
import axios from "../../utils/axios";
import swal from "sweetalert";
import {
  adminFellowshipsTableReducer,
  createInitialAdminFellowshipsTableState,
} from "../../reducers/adminFellowshipsTableReducer";

interface FellowshipLink {
  label: string;
  url: string;
}

interface AdminFellowship {
  _id: string;
  title: string;
  competitionType: string;
  summary: string;
  description: string;
  applicationInformation: string;
  eligibility: string;
  restrictionsToUseOfAward: string;
  additionalInformation: string;
  links: FellowshipLink[];
  applicationLink: string;
  awardAmount: string;
  isAcceptingApplications: boolean;
  applicationOpenDate: string | null;
  deadline: string | null;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  contactOffice: string;
  yearOfStudy: string[];
  termOfAward: string[];
  purpose: string[];
  globalRegions: string[];
  citizenshipStatus: string[];
  archived: boolean;
  audited: boolean;
  views: number;
  favorites: number;
  createdAt: string;
}

type SortField =
  | "title"
  | "deadline"
  | "views"
  | "favorites"
  | "createdAt"
;

const TABLE_COLUMNS: { value: SortField; label: string }[] = [
  { value: "title", label: "Title" },
  { value: "deadline", label: "Deadline" },
  { value: "views", label: "Views" },
  { value: "favorites", label: "Favs" },
  { value: "createdAt", label: "Added" },
];

const PAGE_SIZES = [10, 25, 50, 100];

const AdminFellowshipsTable = () => {
  const [state, dispatch] = useReducer(
    adminFellowshipsTableReducer<AdminFellowship>,
    undefined,
    () => createInitialAdminFellowshipsTableState<AdminFellowship>()
  );
  const {
    fellowships,
    total,
    totalPages,
    isLoading,
    search,
    sortBy,
    sortOrder,
    page,
    pageSize,
    archivedFilter,
    auditedFilter,
    editingFellowship,
  } = state;

  const fetchFellowships = useCallback(async () => {
    dispatch({ type: 'FETCH_START' });
    try {
      const params: any = {
        search: search.trim(),
        sortBy,
        sortOrder,
        page,
        pageSize,
      };
      if (archivedFilter) params.archived = archivedFilter;
      if (auditedFilter) params.audited = auditedFilter;

      const response = await axios.get("/admin/fellowships", { params, withCredentials: true });
      dispatch({
        type: 'FETCH_SUCCESS',
        payload: {
          fellowships: response.data.fellowships,
          total: response.data.total,
          totalPages: response.data.totalPages,
        },
      });
    } catch (error) {
      console.error("Error fetching admin fellowships:", error);
      swal({ text: "Failed to fetch fellowships", icon: "error" });
      dispatch({ type: 'FETCH_FAILURE' });
    }
  }, [search, sortBy, sortOrder, page, pageSize, archivedFilter, auditedFilter]);

  useEffect(() => {
    const debounce = setTimeout(() => {
      fetchFellowships();
    }, search ? 400 : 0);
    return () => clearTimeout(debounce);
  }, [fetchFellowships]);

  const handleDelete = async (fellowship: AdminFellowship) => {
    const confirmed = await swal({
      title: "Delete Fellowship",
      text: `Are you sure you want to permanently delete "${fellowship.title}"? This cannot be undone.`,
      icon: "warning",
      buttons: ["Cancel", "Delete"],
      dangerMode: true,
    });

    if (!confirmed) return;

    try {
      await axios.delete(`/admin/fellowships/${fellowship._id}`, { withCredentials: true });
      swal({ text: "Fellowship deleted", icon: "success", timer: 1500 });
      fetchFellowships();
    } catch (error) {
      console.error("Error deleting fellowship:", error);
      swal({ text: "Failed to delete fellowship", icon: "error" });
    }
  };

  const handleArchive = async (fellowship: AdminFellowship) => {
    const action = fellowship.archived ? "unarchive" : "archive";
    try {
      await axios.put(`/admin/fellowships/${fellowship._id}/${action}`, {}, { withCredentials: true });
      swal({ text: `Fellowship ${action}d`, icon: "success", timer: 1500 });
      fetchFellowships();
    } catch (error) {
      console.error(`Error ${action}ing fellowship:`, error);
      swal({ text: `Failed to ${action} fellowship`, icon: "error" });
    }
  };

  const handleSave = async (updatedData: Partial<AdminFellowship>) => {
    if (!editingFellowship) return;

    try {
      await axios.put(
        `/admin/fellowships/${editingFellowship._id}`,
        { data: updatedData },
        { withCredentials: true }
      );
      swal({ text: "Fellowship updated", icon: "success", timer: 1500 });
      dispatch({ type: 'CLOSE_EDIT' });
      fetchFellowships();
    } catch (error) {
      console.error("Error updating fellowship:", error);
      swal({ text: "Failed to update fellowship", icon: "error" });
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "N/A";
    return new Date(dateStr).toLocaleDateString();
  };

  const handleSort = (field: SortField) => {
    dispatch({ type: 'TOGGLE_SORT', field });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-4 items-center">
        <input
          type="text"
          placeholder="Search fellowships..."
          value={search}
          onChange={(e) => dispatch({ type: 'SET_SEARCH', payload: e.target.value })}
          className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 w-64"
        />

        <select
          value={archivedFilter}
          onChange={(e) => dispatch({ type: 'SET_ARCHIVED_FILTER', payload: e.target.value })}
          className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">All</option>
          <option value="false">Active</option>
          <option value="true">Archived</option>
        </select>

        <select
          value={auditedFilter}
          onChange={(e) => dispatch({ type: 'SET_AUDITED_FILTER', payload: e.target.value })}
          className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">All (Audit)</option>
          <option value="true">Audited</option>
          <option value="false">Not Audited</option>
        </select>

        <select
          value={pageSize}
          onChange={(e) => dispatch({ type: 'SET_PAGE_SIZE', payload: Number(e.target.value) })}
          className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {PAGE_SIZES.map((size) => (
            <option key={size} value={size}>
              {size} per page
            </option>
          ))}
        </select>

        <span className="text-sm text-gray-500">
          {total} fellowship{total !== 1 ? "s" : ""} total
        </span>
      </div>

      <div className="overflow-x-auto border rounded-lg">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              {TABLE_COLUMNS.map((col) => (
                <th
                  key={col.value}
                  onClick={() => handleSort(col.value)}
                  className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                >
                  <div className="flex items-center gap-1">
                    {col.label}
                    {sortBy === col.value && (
                      <span>{sortOrder === "asc" ? "↑" : "↓"}</span>
                    )}
                  </div>
                </th>
              ))}
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                Audit
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {isLoading ? (
              <tr>
                <td colSpan={TABLE_COLUMNS.length + 2} className="px-4 py-8 text-center text-gray-500">
                  Loading...
                </td>
              </tr>
            ) : fellowships.length === 0 ? (
              <tr>
                <td colSpan={TABLE_COLUMNS.length + 2} className="px-4 py-8 text-center text-gray-500">
                  No fellowships found
                </td>
              </tr>
            ) : (
              fellowships.map((fellowship) => (
                <tr
                  key={fellowship._id}
                  className={`hover:bg-gray-50 ${fellowship.archived ? "opacity-50" : ""}`}
                >
                  <td className="px-4 py-3">
                    <div className="max-w-xs">
                      <p className="text-sm font-medium text-gray-900 truncate" title={fellowship.title}>
                        {fellowship.title}
                      </p>
                      {fellowship.archived && (
                        <span className="text-xs text-red-600">(Archived)</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {formatDate(fellowship.deadline)}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">{fellowship.views}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{fellowship.favorites}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {formatDate(fellowship.createdAt)}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {fellowship.audited ? (
                      <span className="text-green-700 bg-green-100 px-1.5 py-0.5 rounded text-xs font-medium">✓</span>
                    ) : (
                      <span className="text-gray-400 text-xs">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <div className="flex gap-2">
                      <button
                        onClick={() => dispatch({ type: 'OPEN_EDIT', fellowship })}
                        className="text-blue-600 hover:text-blue-800"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleArchive(fellowship)}
                        className="text-yellow-600 hover:text-yellow-800"
                      >
                        {fellowship.archived ? "Unarchive" : "Archive"}
                      </button>
                      <button
                        onClick={() => handleDelete(fellowship)}
                        className="text-red-600 hover:text-red-800"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <div className="text-sm text-gray-500">
            Page {page} of {totalPages}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => dispatch({ type: 'SET_PAGE', payload: Math.max(1, page - 1) })}
              disabled={page === 1}
              className="px-3 py-1 border rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
            >
              Previous
            </button>
            <button
              onClick={() => dispatch({ type: 'SET_PAGE', payload: Math.min(totalPages, page + 1) })}
              disabled={page === totalPages}
              className="px-3 py-1 border rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {editingFellowship && (
        <FellowshipEditModal
          fellowship={editingFellowship}
          onSave={handleSave}
          onClose={() => dispatch({ type: 'CLOSE_EDIT' })}
        />
      )}
    </div>
  );
};

const ArrayFieldEditor = ({
  label,
  values,
  onChange,
  placeholder,
}: {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
}) => {
  const [inputValue, setInputValue] = useState("");

  const handleAdd = () => {
    const trimmed = inputValue.trim();
    if (trimmed && !values.includes(trimmed)) {
      onChange([...values, trimmed]);
      setInputValue("");
    }
  };

  const handleRemove = (value: string) => {
    onChange(values.filter((v) => v !== value));
  };

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {values.map((value) => (
          <span
            key={value}
            className="inline-flex items-center bg-blue-50 text-blue-800 text-sm px-2 py-0.5 rounded border border-blue-200"
          >
            {value}
            <button
              type="button"
              onClick={() => handleRemove(value)}
              className="ml-1.5 text-blue-400 hover:text-blue-600"
            >
              &times;
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleAdd();
            }
          }}
          placeholder={placeholder || `Add ${label.toLowerCase()}...`}
          className="flex-1 px-3 py-1.5 border border-gray-300 rounded-lg text-sm"
        />
        <button
          type="button"
          onClick={handleAdd}
          className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700"
        >
          Add
        </button>
      </div>
    </div>
  );
};

const LinksEditor = ({
  links,
  onChange,
}: {
  links: FellowshipLink[];
  onChange: (links: FellowshipLink[]) => void;
}) => {
  const [newLabel, setNewLabel] = useState("");
  const [newUrl, setNewUrl] = useState("");

  const handleAdd = () => {
    const trimmedUrl = newUrl.trim();
    if (!trimmedUrl) return;
    onChange([...links, { label: newLabel.trim() || trimmedUrl, url: trimmedUrl }]);
    setNewLabel("");
    setNewUrl("");
  };

  const handleRemove = (index: number) => {
    onChange(links.filter((_, i) => i !== index));
  };

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">Links to Additional Information</label>
      {links.length > 0 && (
        <div className="space-y-1.5 mb-2">
          {links.map((link, i) => (
            <div key={i} className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded px-2 py-1 text-sm">
              <span className="font-medium text-blue-800 truncate">{link.label}</span>
              <span className="text-blue-400 truncate flex-shrink min-w-0">{link.url}</span>
              <button
                type="button"
                onClick={() => handleRemove(i)}
                className="ml-auto text-blue-400 hover:text-blue-600 flex-shrink-0"
              >
                &times;
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <input
          type="text"
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          placeholder="Label (optional)"
          className="w-1/3 px-3 py-1.5 border border-gray-300 rounded-lg text-sm"
        />
        <input
          type="text"
          value={newUrl}
          onChange={(e) => setNewUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleAdd();
            }
          }}
          placeholder="URL"
          className="flex-1 px-3 py-1.5 border border-gray-300 rounded-lg text-sm"
        />
        <button
          type="button"
          onClick={handleAdd}
          className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700"
        >
          Add
        </button>
      </div>
    </div>
  );
};

const toDatetimeLocal = (dateStr: string | null): string => {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const FellowshipEditModal = ({
  fellowship,
  onSave,
  onClose,
}: {
  fellowship: AdminFellowship;
  onSave: (data: Partial<AdminFellowship>) => void;
  onClose: () => void;
}) => {
  const [title, setTitle] = useState(fellowship.title);
  const [competitionType, setCompetitionType] = useState(fellowship.competitionType || "");
  const [summary, setSummary] = useState(fellowship.summary);
  const [description, setDescription] = useState(fellowship.description);
  const [applicationInformation, setApplicationInformation] = useState(fellowship.applicationInformation || "");
  const [eligibility, setEligibility] = useState(fellowship.eligibility);
  const [restrictionsToUseOfAward, setRestrictionsToUseOfAward] = useState(fellowship.restrictionsToUseOfAward || "");
  const [additionalInformation, setAdditionalInformation] = useState(fellowship.additionalInformation || "");
  const [links, setLinks] = useState<FellowshipLink[]>([...(fellowship.links || [])]);
  const [applicationLink, setApplicationLink] = useState(fellowship.applicationLink);
  const [awardAmount, setAwardAmount] = useState(fellowship.awardAmount || "");
  const [contactName, setContactName] = useState(fellowship.contactName || "");
  const [contactEmail, setContactEmail] = useState(fellowship.contactEmail);
  const [contactPhone, setContactPhone] = useState(fellowship.contactPhone || "");
  const [contactOffice, setContactOffice] = useState(fellowship.contactOffice || "");
  const [isAcceptingApplications, setIsAcceptingApplications] = useState(fellowship.isAcceptingApplications);
  const [applicationOpenDate, setApplicationOpenDate] = useState(
    toDatetimeLocal(fellowship.applicationOpenDate)
  );
  const [deadline, setDeadline] = useState(
    toDatetimeLocal(fellowship.deadline)
  );
  const [yearOfStudy, setYearOfStudy] = useState<string[]>([...fellowship.yearOfStudy]);
  const [termOfAward, setTermOfAward] = useState<string[]>([...fellowship.termOfAward]);
  const [purpose, setPurpose] = useState<string[]>([...fellowship.purpose]);
  const [globalRegions, setGlobalRegions] = useState<string[]>([...fellowship.globalRegions]);
  const [citizenshipStatus, setCitizenshipStatus] = useState<string[]>([...fellowship.citizenshipStatus]);
  const [audited, setAudited] = useState(fellowship.audited ?? false);
  const [archived, setArchived] = useState(fellowship.archived ?? false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      title,
      competitionType,
      summary,
      description,
      applicationInformation,
      eligibility,
      restrictionsToUseOfAward,
      additionalInformation,
      links,
      applicationLink,
      awardAmount,
      contactName,
      contactEmail,
      contactPhone,
      contactOffice,
      isAcceptingApplications,
      applicationOpenDate: applicationOpenDate || null,
      deadline: deadline || null,
      yearOfStudy,
      termOfAward,
      purpose,
      globalRegions,
      citizenshipStatus,
      audited,
      archived,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto p-6">
        <h3 className="text-lg font-semibold mb-4">Edit Fellowship</h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Competition Type</label>
            <input value={competitionType} onChange={(e) => setCompetitionType(e.target.value)} placeholder="e.g. Application/Funded Research" className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
          </div>

          <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
            <p className="text-xs text-gray-500 mb-1">
              <strong>Tip:</strong> To add a clickable link inside any text field, use the format: <code className="bg-gray-200 px-1 rounded">[link text](https://url)</code>
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Brief Description</label>
            <textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={3} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Full Description</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={6} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Application Information</label>
            <textarea value={applicationInformation} onChange={(e) => setApplicationInformation(e.target.value)} rows={4} className="w-full px-3 py-2 border border-gray-300 rounded-lg" placeholder="How to apply, required documents, etc." />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Special Eligibility Requirements</label>
            <textarea value={eligibility} onChange={(e) => setEligibility(e.target.value)} rows={3} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Restrictions to Use of Award</label>
            <textarea value={restrictionsToUseOfAward} onChange={(e) => setRestrictionsToUseOfAward(e.target.value)} rows={3} className="w-full px-3 py-2 border border-gray-300 rounded-lg" placeholder="Any restrictions on how funds can be used..." />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Additional Information</label>
            <textarea value={additionalInformation} onChange={(e) => setAdditionalInformation(e.target.value)} rows={4} className="w-full px-3 py-2 border border-gray-300 rounded-lg" placeholder="Any other relevant details..." />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Application Link</label>
            <input value={applicationLink} onChange={(e) => setApplicationLink(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Award Amount</label>
            <input value={awardAmount} onChange={(e) => setAwardAmount(e.target.value)} placeholder="e.g. $5,000" className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
          </div>

          <div className="border-t pt-4 mt-4">
            <LinksEditor links={links} onChange={setLinks} />
          </div>

          <div className="border-t pt-4 mt-4">
            <h4 className="text-sm font-semibold text-gray-800 mb-3">Contact Information</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Contact Name</label>
                <input value={contactName} onChange={(e) => setContactName(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg" placeholder="e.g. John Smith" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Contact Email</label>
                <input value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Contact Phone</label>
                <input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg" placeholder="e.g. (203) 432-1234" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Contact Office</label>
                <input value={contactOffice} onChange={(e) => setContactOffice(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg" placeholder="e.g. 55 Whitney Ave, Room 200" />
              </div>
            </div>
          </div>

          <div className="border-t pt-4 mt-4">
            <h4 className="text-sm font-semibold text-gray-800 mb-3">Status & Dates</h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Accepting Applications</label>
                <select
                  value={isAcceptingApplications ? "true" : "false"}
                  onChange={(e) => setIsAcceptingApplications(e.target.value === "true")}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                >
                  <option value="true">Yes</option>
                  <option value="false">No</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Application Open Date & Time</label>
                <input
                  type="datetime-local"
                  value={applicationOpenDate}
                  onChange={(e) => setApplicationOpenDate(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Deadline Date & Time</label>
                <input
                  type="datetime-local"
                  value={deadline}
                  onChange={(e) => setDeadline(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                />
              </div>
            </div>
          </div>

          <div className="border-t pt-4 mt-4">
            <h4 className="text-sm font-semibold text-gray-800 mb-3">Admin Flags</h4>
            <div className="flex gap-6">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={archived}
                  onChange={(e) => setArchived(e.target.checked)}
                  className="rounded"
                />
                Archived
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={audited}
                  onChange={(e) => setAudited(e.target.checked)}
                  className="rounded"
                />
                Audited
              </label>
            </div>
          </div>

          <div className="border-t pt-4 mt-4">
            <h4 className="text-sm font-semibold text-gray-800 mb-3">Categories & Filters</h4>
            <div className="space-y-4">
              <ArrayFieldEditor label="Year of Study" values={yearOfStudy} onChange={setYearOfStudy} placeholder="e.g. Freshman, Sophomore..." />
              <ArrayFieldEditor label="Term of Award" values={termOfAward} onChange={setTermOfAward} placeholder="e.g. Fall, Spring, Summer..." />
              <ArrayFieldEditor label="Purpose" values={purpose} onChange={setPurpose} placeholder="e.g. Research, Study Abroad..." />
              <ArrayFieldEditor label="Global Regions" values={globalRegions} onChange={setGlobalRegions} placeholder="e.g. North America, Europe..." />
              <ArrayFieldEditor label="Citizenship Status" values={citizenshipStatus} onChange={setCitizenshipStatus} placeholder="e.g. US Citizen, International..." />
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              Save Changes
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AdminFellowshipsTable;

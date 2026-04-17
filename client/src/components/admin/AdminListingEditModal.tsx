/**
 * Admin modal for editing listing details.
 *
 * Form/UI state lives in reducers/adminListingEditReducer.ts.
 * This component owns the save/delete side effects and the body-scroll lock.
 */
import { useEffect, useReducer, useCallback } from "react";
import axios from "../../utils/axios";
import swal from "sweetalert";
import { useConfig } from "../../hooks/useConfig";
import {
  adminListingEditReducer,
  createInitialAdminListingEditState,
} from "../../reducers/adminListingEditReducer";

interface AdminListing {
  _id: string;
  title: string;
  ownerId: string;
  ownerFirstName: string;
  ownerLastName: string;
  ownerEmail: string;
  ownerTitle?: string;
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
  createdAt: string;
  updatedAt: string;
}

interface Props {
  listing: AdminListing;
  onClose: () => void;
  onSave: () => void;
  onDelete?: () => void;
}

const AdminListingEditModal = ({ listing, onClose, onSave, onDelete }: Props) => {
  const config = useConfig();

  const [state, dispatch] = useReducer(
    adminListingEditReducer,
    listing,
    createInitialAdminListingEditState
  );

  const {
    ownerTitle,
    title,
    description,
    applicantDescription,
    departments,
    researchAreas,
    professorNames,
    professorIds,
    emails,
    websites,
    hiringStatus,
    archived,
    confirmed,
    audited,
    resetCreatedAt,
    isSaving,
    deptSearch,
    showDeptDropdown,
    raSearch,
    showRaDropdown,
    newProfName,
    newProfId,
    newEmail,
    newWebsite,
  } = state;

  const getResetDate = () => {
    const original = new Date(listing.createdAt);
    return new Date(2025, original.getMonth(), original.getDate());
  };

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  const handleSave = async () => {
    if (!title.trim()) {
      swal({ text: "Title is required", icon: "warning" });
      return;
    }
    if (!description.trim()) {
      swal({ text: "Description is required", icon: "warning" });
      return;
    }

    const confirmSave = await swal({
      title: "Save Changes",
      text: "Are you sure you want to update this listing?",
      icon: "info",
      buttons: ["Cancel", "Save"],
    });

    if (!confirmSave) return;

    dispatch({ type: 'SET_SAVING', payload: true });
    try {
      await axios.put(
        `/admin/listings/${listing._id}`,
        {
          data: {
            ownerTitle,
            title,
            description,
            applicantDescription,
            departments,
            researchAreas,
            professorNames,
            professorIds,
            emails,
            websites,
            hiringStatus,
            archived,
            confirmed,
            audited,
          },
          resetCreatedAt,
        },
        { withCredentials: true }
      );
      swal({ text: "Listing updated", icon: "success", timer: 1500 });
      onSave();
    } catch (error: any) {
      console.error("Error updating listing:", error);
      swal({ text: error.response?.data?.error || "Failed to update listing", icon: "error" });
    } finally {
      dispatch({ type: 'SET_SAVING', payload: false });
    }
  };

  const filteredDepts = config.departments
    .filter((d) => !departments.includes(d.displayName))
    .filter((d) =>
      deptSearch
        ? d.displayName.toLowerCase().includes(deptSearch.toLowerCase()) ||
          d.abbreviation.toLowerCase().includes(deptSearch.toLowerCase())
        : true
    );

  const availableResearchAreas = config.researchAreas
    .filter((a) => !researchAreas.includes(a.name))
    .filter((a) =>
      raSearch ? a.name.toLowerCase().includes(raSearch.toLowerCase()) : true
    );

  const addToArray = (
    arr: string[],
    setArr: React.Dispatch<React.SetStateAction<string[]>>,
    value: string,
    setInput: React.Dispatch<React.SetStateAction<string>>
  ) => {
    const v = value.trim();
    if (v && !arr.includes(v)) {
      setArr([...arr, v]);
      setInput("");
    }
  };

  const removeFromArray = (
    arr: string[],
    setArr: React.Dispatch<React.SetStateAction<string[]>>,
    index: number
  ) => {
    setArr(arr.filter((_, i) => i !== index));
  };

  // Stable Dispatch-compatible setters for the inline ArrayField helper below.
  const setProfessorNames = useCallback(
    (value: React.SetStateAction<string[]>) =>
      dispatch({ type: 'SET_PROFESSOR_NAMES', payload: value }),
    []
  ) as React.Dispatch<React.SetStateAction<string[]>>;
  const setProfessorIds = useCallback(
    (value: React.SetStateAction<string[]>) =>
      dispatch({ type: 'SET_PROFESSOR_IDS', payload: value }),
    []
  ) as React.Dispatch<React.SetStateAction<string[]>>;
  const setEmails = useCallback(
    (value: React.SetStateAction<string[]>) =>
      dispatch({ type: 'SET_EMAILS', payload: value }),
    []
  ) as React.Dispatch<React.SetStateAction<string[]>>;
  const setWebsites = useCallback(
    (value: React.SetStateAction<string[]>) =>
      dispatch({ type: 'SET_WEBSITES', payload: value }),
    []
  ) as React.Dispatch<React.SetStateAction<string[]>>;
  const setDepartments = useCallback(
    (value: React.SetStateAction<string[]>) =>
      dispatch({ type: 'SET_DEPARTMENTS', payload: value }),
    []
  ) as React.Dispatch<React.SetStateAction<string[]>>;
  const setResearchAreas = useCallback(
    (value: React.SetStateAction<string[]>) =>
      dispatch({ type: 'SET_RESEARCH_AREAS', payload: value }),
    []
  ) as React.Dispatch<React.SetStateAction<string[]>>;

  const setNewProfName = useCallback(
    (value: React.SetStateAction<string>) => {
      const next = typeof value === 'function' ? (value as (prev: string) => string)(newProfName) : value;
      dispatch({ type: 'SET_NEW_PROF_NAME', payload: next });
    },
    [newProfName]
  ) as React.Dispatch<React.SetStateAction<string>>;
  const setNewProfId = useCallback(
    (value: React.SetStateAction<string>) => {
      const next = typeof value === 'function' ? (value as (prev: string) => string)(newProfId) : value;
      dispatch({ type: 'SET_NEW_PROF_ID', payload: next });
    },
    [newProfId]
  ) as React.Dispatch<React.SetStateAction<string>>;
  const setNewEmail = useCallback(
    (value: React.SetStateAction<string>) => {
      const next = typeof value === 'function' ? (value as (prev: string) => string)(newEmail) : value;
      dispatch({ type: 'SET_NEW_EMAIL', payload: next });
    },
    [newEmail]
  ) as React.Dispatch<React.SetStateAction<string>>;
  const setNewWebsite = useCallback(
    (value: React.SetStateAction<string>) => {
      const next = typeof value === 'function' ? (value as (prev: string) => string)(newWebsite) : value;
      dispatch({ type: 'SET_NEW_WEBSITE', payload: next });
    },
    [newWebsite]
  ) as React.Dispatch<React.SetStateAction<string>>;

  const ArrayField = ({
    label,
    items,
    setItems,
    newValue,
    setNewValue,
    placeholder,
    type = "text",
  }: {
    label: string;
    items: string[];
    setItems: React.Dispatch<React.SetStateAction<string[]>>;
    newValue: string;
    setNewValue: React.Dispatch<React.SetStateAction<string>>;
    placeholder: string;
    type?: string;
  }) => (
    <div className="mb-3">
      <label className="block text-xs font-semibold text-gray-600 mb-1">{label}</label>
      <div className="flex flex-wrap gap-1 mb-1">
        {items.map((item, i) => (
          <span
            key={i}
            className="bg-blue-100 text-blue-800 px-2 py-0.5 rounded text-xs flex items-center gap-1"
          >
            {item}
            <button
              onClick={() => removeFromArray(items, setItems, i)}
              className="text-blue-500 hover:text-blue-700"
            >
              x
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-1">
        <input
          type={type}
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addToArray(items, setItems, newValue, setNewValue);
            }
          }}
          placeholder={placeholder}
          className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        <button
          onClick={() => addToArray(items, setItems, newValue, setNewValue)}
          className="text-xs bg-gray-200 hover:bg-gray-300 px-2 py-1 rounded"
        >
          Add
        </button>
      </div>
    </div>
  );

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-start justify-center z-[1200] overflow-y-auto py-8"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white rounded-lg shadow-xl w-full max-w-3xl mx-4">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div>
            <h3 className="text-lg font-bold text-gray-900">Edit Listing</h3>
            <p className="text-xs text-gray-500">
              ID: {listing._id} | Owner: {listing.ownerFirstName} {listing.ownerLastName} ({listing.ownerId})
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">
            &times;
          </button>
        </div>

        <div className="px-6 py-4 max-h-[70vh] overflow-y-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <div className="mb-3">
                <label className="block text-xs font-semibold text-gray-600 mb-1">
                  Professor Title
                </label>
                <input
                  value={ownerTitle}
                  onChange={(e) => dispatch({ type: 'SET_OWNER_TITLE', payload: e.target.value })}
                  placeholder="e.g. Professor of Sociology"
                  className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div className="mb-3">
                <label className="block text-xs font-semibold text-gray-600 mb-1">
                  Title <span className="text-red-500">*</span>
                </label>
                <input
                  value={title}
                  onChange={(e) => dispatch({ type: 'SET_TITLE', payload: e.target.value })}
                  className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div className="mb-3">
                <label className="block text-xs font-semibold text-gray-600 mb-1">
                  Description <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={description}
                  onChange={(e) => dispatch({ type: 'SET_DESCRIPTION', payload: e.target.value })}
                  rows={6}
                  className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <span className="text-xs text-gray-400">{description.length} chars</span>
              </div>

              <div className="mb-3">
                <label className="block text-xs font-semibold text-gray-600 mb-1">
                  Applicant Description
                </label>
                <textarea
                  value={applicantDescription}
                  onChange={(e) => dispatch({ type: 'SET_APPLICANT_DESCRIPTION', payload: e.target.value })}
                  rows={3}
                  className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div className="mb-3">
                <label className="block text-xs font-semibold text-gray-600 mb-1">Hiring Status</label>
                <select
                  value={hiringStatus}
                  onChange={(e) => dispatch({ type: 'SET_HIRING_STATUS', payload: Number(e.target.value) })}
                  className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value={0}>Open to Applicants</option>
                  <option value={-1}>Not Open to Applicants</option>
                </select>
              </div>

              <div className="flex gap-6 mb-3">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={archived}
                    onChange={(e) => dispatch({ type: 'SET_ARCHIVED', payload: e.target.checked })}
                    className="rounded"
                  />
                  Archived
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={(e) => dispatch({ type: 'SET_CONFIRMED', payload: e.target.checked })}
                    className="rounded"
                  />
                  Confirmed
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={audited}
                    onChange={(e) => dispatch({ type: 'SET_AUDITED', payload: e.target.checked })}
                    className="rounded"
                  />
                  Audited
                </label>
              </div>

              <div className="mb-3 p-3 bg-yellow-50 border border-yellow-200 rounded">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={resetCreatedAt}
                    onChange={(e) => dispatch({ type: 'SET_RESET_CREATED_AT', payload: e.target.checked })}
                    className="rounded"
                  />
                  <span>
                    Reset "Created At" to 2025
                  </span>
                </label>
                {resetCreatedAt && (
                  <p className="text-xs text-yellow-700 mt-1 ml-6">
                    {new Date(listing.createdAt).toLocaleDateString()} → {getResetDate().toLocaleDateString()}
                  </p>
                )}
              </div>
            </div>

            <div>
              <div className="mb-3 relative">
                <label className="block text-xs font-semibold text-gray-600 mb-1">Departments</label>
                <div className="flex flex-wrap gap-1 mb-1">
                  {departments.map((dept, i) => (
                    <span
                      key={i}
                      className="bg-blue-100 text-blue-800 px-2 py-0.5 rounded text-xs flex items-center gap-1"
                    >
                      {dept.split(" - ")[0]}
                      <button
                        onClick={() => removeFromArray(departments, setDepartments, i)}
                        className="text-blue-500 hover:text-blue-700"
                      >
                        x
                      </button>
                    </span>
                  ))}
                </div>
                <input
                  value={deptSearch}
                  onChange={(e) => dispatch({ type: 'SET_DEPT_SEARCH', payload: e.target.value })}
                  onFocus={() => dispatch({ type: 'SHOW_DEPT_DROPDOWN', payload: true })}
                  placeholder="Search departments..."
                  className="w-full border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                {showDeptDropdown && filteredDepts.length > 0 && (
                  <div className="absolute z-10 w-full bg-white border border-gray-300 rounded mt-1 max-h-40 overflow-y-auto shadow-lg">
                    {filteredDepts.slice(0, 20).map((dept) => (
                      <button
                        key={dept.abbreviation}
                        onClick={() => dispatch({ type: 'ADD_DEPARTMENT', payload: dept.displayName })}
                        className="block w-full text-left px-3 py-1.5 text-sm hover:bg-blue-50"
                      >
                        {dept.displayName}
                      </button>
                    ))}
                  </div>
                )}
                {showDeptDropdown && (
                  <div
                    className="fixed inset-0 z-[5]"
                    onClick={() => dispatch({ type: 'SHOW_DEPT_DROPDOWN', payload: false })}
                  />
                )}
              </div>

              <div className="mb-3 relative">
                <label className="block text-xs font-semibold text-gray-600 mb-1">Research Areas</label>
                <div className="flex flex-wrap gap-1 mb-1">
                  {researchAreas.map((ra, i) => (
                    <span
                      key={i}
                      className="bg-purple-100 text-purple-800 px-2 py-0.5 rounded text-xs flex items-center gap-1"
                    >
                      {ra}
                      <button
                        onClick={() => removeFromArray(researchAreas, setResearchAreas, i)}
                        className="text-purple-500 hover:text-purple-700"
                      >
                        x
                      </button>
                    </span>
                  ))}
                </div>
                <input
                  value={raSearch}
                  onChange={(e) => dispatch({ type: 'SET_RA_SEARCH', payload: e.target.value })}
                  onFocus={() => dispatch({ type: 'SHOW_RA_DROPDOWN', payload: true })}
                  placeholder="Search research areas..."
                  className="w-full border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                {showRaDropdown && availableResearchAreas.length > 0 && (
                  <div className="absolute z-10 w-full bg-white border border-gray-300 rounded mt-1 max-h-40 overflow-y-auto shadow-lg">
                    {availableResearchAreas.slice(0, 20).map((area) => (
                      <button
                        key={area.name}
                        onClick={() => dispatch({ type: 'ADD_RESEARCH_AREA', payload: area.name })}
                        className="block w-full text-left px-3 py-1.5 text-sm hover:bg-purple-50"
                      >
                        {area.name}
                        <span className="text-xs text-gray-400 ml-2">{area.field}</span>
                      </button>
                    ))}
                  </div>
                )}
                {showRaDropdown && (
                  <div
                    className="fixed inset-0 z-[5]"
                    onClick={() => dispatch({ type: 'SHOW_RA_DROPDOWN', payload: false })}
                  />
                )}
              </div>

              <ArrayField
                label="Professor Names"
                items={professorNames}
                setItems={setProfessorNames}
                newValue={newProfName}
                setNewValue={setNewProfName}
                placeholder="Add professor name"
              />

              <ArrayField
                label="Professor IDs (NetIDs)"
                items={professorIds}
                setItems={setProfessorIds}
                newValue={newProfId}
                setNewValue={setNewProfId}
                placeholder="Add professor NetID"
              />

              <ArrayField
                label="Emails"
                items={emails}
                setItems={setEmails}
                newValue={newEmail}
                setNewValue={setNewEmail}
                placeholder="Add email"
                type="email"
              />

              <ArrayField
                label="Websites"
                items={websites}
                setItems={setWebsites}
                newValue={newWebsite}
                setNewValue={setNewWebsite}
                placeholder="Add website URL"
                type="url"
              />
            </div>
          </div>
        </div>

        <div className="flex justify-between px-6 py-4 border-t bg-gray-50 rounded-b-lg">
          <button
            onClick={async () => {
              const confirmed = await swal({
                title: "Delete Listing",
                text: `Permanently delete "${listing.title}"? This cannot be undone.`,
                icon: "warning",
                buttons: ["Cancel", "Delete"],
                dangerMode: true,
              });
              if (!confirmed) return;
              try {
                await axios.delete(`/admin/listings/${listing._id}`, { withCredentials: true });
                swal({ text: "Listing deleted", icon: "success", timer: 1500 });
                if (onDelete) onDelete();
                else onSave();
              } catch (error: any) {
                swal({ text: error.response?.data?.error || "Failed to delete", icon: "error" });
              }
            }}
            className="px-4 py-2 text-sm text-red-600 border border-red-200 rounded-md hover:bg-red-50 transition-colors"
          >
            Delete Listing
          </button>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-100 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {isSaving ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminListingEditModal;

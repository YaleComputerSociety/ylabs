import { useState, useEffect } from "react";
import axios from "../../utils/axios";
import swal from "sweetalert";
import { useConfig } from "../../hooks/useConfig";

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

  const [ownerTitle, setOwnerTitle] = useState(listing.ownerTitle || "");
  const [title, setTitle] = useState(listing.title || "");
  const [description, setDescription] = useState(listing.description || "");
  const [applicantDescription, setApplicantDescription] = useState(listing.applicantDescription || "");
  const [departments, setDepartments] = useState<string[]>(listing.departments || []);
  const [researchAreas, setResearchAreas] = useState<string[]>(listing.researchAreas || []);
  const [professorNames, setProfessorNames] = useState<string[]>(listing.professorNames || []);
  const [professorIds, setProfessorIds] = useState<string[]>(listing.professorIds || []);
  const [emails, setEmails] = useState<string[]>(listing.emails || []);
  const [websites, setWebsites] = useState<string[]>(listing.websites || []);
  const [hiringStatus, setHiringStatus] = useState(listing.hiringStatus >= 0 ? 0 : -1);
  const [archived, setArchived] = useState(listing.archived);
  const [confirmed, setConfirmed] = useState(listing.confirmed);
  const [audited, setAudited] = useState(listing.audited ?? false);
  const [resetCreatedAt, setResetCreatedAt] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Calculate what the new createdAt would be (same month/day but 2025)
  const getResetDate = () => {
    const original = new Date(listing.createdAt);
    return new Date(2025, original.getMonth(), original.getDate());
  };

  // Department search
  const [deptSearch, setDeptSearch] = useState("");
  const [showDeptDropdown, setShowDeptDropdown] = useState(false);

  // Research area search
  const [raSearch, setRaSearch] = useState("");
  const [showRaDropdown, setShowRaDropdown] = useState(false);

  // Array input temps
  const [newProfName, setNewProfName] = useState("");
  const [newProfId, setNewProfId] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newWebsite, setNewWebsite] = useState("");

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

    setIsSaving(true);
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
      setIsSaving(false);
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
        {/* Header */}
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

        {/* Body */}
        <div className="px-6 py-4 max-h-[70vh] overflow-y-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Left column */}
            <div>
              <div className="mb-3">
                <label className="block text-xs font-semibold text-gray-600 mb-1">
                  Professor Title
                </label>
                <input
                  value={ownerTitle}
                  onChange={(e) => setOwnerTitle(e.target.value)}
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
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div className="mb-3">
                <label className="block text-xs font-semibold text-gray-600 mb-1">
                  Description <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
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
                  onChange={(e) => setApplicantDescription(e.target.value)}
                  rows={3}
                  className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              {/* Hiring Status */}
              <div className="mb-3">
                <label className="block text-xs font-semibold text-gray-600 mb-1">Hiring Status</label>
                <select
                  value={hiringStatus}
                  onChange={(e) => setHiringStatus(Number(e.target.value))}
                  className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value={0}>Open to Applicants</option>
                  <option value={-1}>Not Open to Applicants</option>
                </select>
              </div>

              {/* Status toggles */}
              <div className="flex gap-6 mb-3">
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
                    checked={confirmed}
                    onChange={(e) => setConfirmed(e.target.checked)}
                    className="rounded"
                  />
                  Confirmed
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

              {/* Reset Created Date */}
              <div className="mb-3 p-3 bg-yellow-50 border border-yellow-200 rounded">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={resetCreatedAt}
                    onChange={(e) => setResetCreatedAt(e.target.checked)}
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

            {/* Right column */}
            <div>
              {/* Departments */}
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
                  onChange={(e) => {
                    setDeptSearch(e.target.value);
                    setShowDeptDropdown(true);
                  }}
                  onFocus={() => setShowDeptDropdown(true)}
                  placeholder="Search departments..."
                  className="w-full border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                {showDeptDropdown && filteredDepts.length > 0 && (
                  <div className="absolute z-10 w-full bg-white border border-gray-300 rounded mt-1 max-h-40 overflow-y-auto shadow-lg">
                    {filteredDepts.slice(0, 20).map((dept) => (
                      <button
                        key={dept.abbreviation}
                        onClick={() => {
                          setDepartments([...departments, dept.displayName]);
                          setDeptSearch("");
                          setShowDeptDropdown(false);
                        }}
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
                    onClick={() => setShowDeptDropdown(false)}
                  />
                )}
              </div>

              {/* Research Areas */}
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
                  onChange={(e) => {
                    setRaSearch(e.target.value);
                    setShowRaDropdown(true);
                  }}
                  onFocus={() => setShowRaDropdown(true)}
                  placeholder="Search research areas..."
                  className="w-full border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                {showRaDropdown && availableResearchAreas.length > 0 && (
                  <div className="absolute z-10 w-full bg-white border border-gray-300 rounded mt-1 max-h-40 overflow-y-auto shadow-lg">
                    {availableResearchAreas.slice(0, 20).map((area) => (
                      <button
                        key={area.name}
                        onClick={() => {
                          setResearchAreas([...researchAreas, area.name]);
                          setRaSearch("");
                          setShowRaDropdown(false);
                        }}
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
                    onClick={() => setShowRaDropdown(false)}
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

        {/* Footer */}
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

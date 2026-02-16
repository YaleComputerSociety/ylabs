/**
 * Admin modal for editing faculty profile fields.
 */
import { useState, useEffect } from "react";
import axios from "../../utils/axios";
import { Publication } from "../../types/types";

interface AdminProfile {
  _id: string;
  netid: string;
  fname: string;
  lname: string;
  email: string;
  title?: string;
  bio?: string;
  phone?: string;
  primary_department?: string;
  secondary_departments?: string[];
  research_interests?: string[];
  h_index?: number;
  orcid?: string;
  openalex_id?: string;
  image_url?: string;
  profileVerified?: boolean;
  userType: string;
  userConfirmed: boolean;
}

interface FullProfile extends AdminProfile {
  publications?: Publication[];
  topics?: string[];
  profile_urls?: Record<string, string>;
}

interface AdminProfileEditModalProps {
  profile: AdminProfile;
  onClose: () => void;
  onSaved: () => void;
}

const AdminProfileEditModal = ({
  profile,
  onClose,
  onSaved,
}: AdminProfileEditModalProps) => {
  const [full, setFull] = useState<FullProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [fname, setFname] = useState(profile.fname);
  const [lname, setLname] = useState(profile.lname);
  const [email, setEmail] = useState(profile.email);
  const [title, setTitle] = useState(profile.title || "");
  const [bio, setBio] = useState(profile.bio || "");
  const [phone, setPhone] = useState(profile.phone || "");
  const [primaryDept, setPrimaryDept] = useState(profile.primary_department || "");
  const [secondaryDepts, setSecondaryDepts] = useState(
    (profile.secondary_departments || []).join(", ")
  );
  const [researchInterests, setResearchInterests] = useState(
    (profile.research_interests || []).join(", ")
  );
  const [hIndex, setHIndex] = useState(profile.h_index?.toString() || "");
  const [orcid, setOrcid] = useState(profile.orcid || "");
  const [imageUrl, setImageUrl] = useState(profile.image_url || "");
  const [profileVerified, setProfileVerified] = useState(
    profile.profileVerified || false
  );
  const [userType, setUserType] = useState(profile.userType);
  const [userConfirmed, setUserConfirmed] = useState(profile.userConfirmed);

  useEffect(() => {
    axios
      .get(`/admin/profiles/${profile.netid}`)
      .then((res) => {
        const p = res.data.profile;
        setFull(p);
        setFname(p.fname || "");
        setLname(p.lname || "");
        setEmail(p.email || "");
        setTitle(p.title || "");
        setBio(p.bio || "");
        setPhone(p.phone || "");
        setPrimaryDept(p.primary_department || "");
        setSecondaryDepts((p.secondary_departments || []).join(", "));
        setResearchInterests((p.research_interests || []).join(", "));
        setHIndex(p.h_index?.toString() || "");
        setOrcid(p.orcid || "");
        setImageUrl(p.image_url || "");
        setProfileVerified(p.profileVerified || false);
        setUserType(p.userType || "professor");
        setUserConfirmed(p.userConfirmed || false);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [profile.netid]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await axios.put(`/admin/profiles/${profile.netid}`, {
        data: {
          fname: fname.trim(),
          lname: lname.trim(),
          email: email.trim(),
          title: title.trim(),
          bio,
          phone: phone.trim(),
          primary_department: primaryDept.trim(),
          secondary_departments: secondaryDepts
            .split(",")
            .map((d) => d.trim())
            .filter(Boolean),
          research_interests: researchInterests
            .split(",")
            .map((d) => d.trim())
            .filter(Boolean),
          h_index: hIndex ? parseInt(hIndex, 10) : undefined,
          orcid: orcid.trim() || undefined,
          image_url: imageUrl.trim(),
          profileVerified,
          userType,
          userConfirmed,
        },
      });
      onSaved();
    } catch (err: any) {
      console.error("Error saving profile:", err);
      alert(err.response?.data?.error || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div
      className="fixed inset-0 bg-black/60 z-[1200] flex items-center justify-center overflow-y-auto p-4 pt-20"
      onClick={handleBackdropClick}
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex-shrink-0 border-b border-gray-100 px-6 py-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-900">
              Edit Profile: {profile.fname} {profile.lname}
            </h2>
            <p className="text-xs text-gray-400">NetID: {profile.netid}</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600"
          >
            <svg
              className="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    First Name
                  </label>
                  <input
                    type="text"
                    value={fname}
                    onChange={(e) => setFname(e.target.value)}
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Last Name
                  </label>
                  <input
                    type="text"
                    value={lname}
                    onChange={(e) => setLname(e.target.value)}
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Email
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Phone
                  </label>
                  <input
                    type="text"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Title
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Bio
                </label>
                <textarea
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  rows={4}
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Primary Department
                  </label>
                  <input
                    type="text"
                    value={primaryDept}
                    onChange={(e) => setPrimaryDept(e.target.value)}
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Secondary Departments (comma-separated)
                  </label>
                  <input
                    type="text"
                    value={secondaryDepts}
                    onChange={(e) => setSecondaryDepts(e.target.value)}
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Research Interests (comma-separated)
                </label>
                <input
                  type="text"
                  value={researchInterests}
                  onChange={(e) => setResearchInterests(e.target.value)}
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    H-Index
                  </label>
                  <input
                    type="number"
                    value={hIndex}
                    onChange={(e) => setHIndex(e.target.value)}
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    ORCID
                  </label>
                  <input
                    type="text"
                    value={orcid}
                    onChange={(e) => setOrcid(e.target.value)}
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Image URL
                  </label>
                  <input
                    type="text"
                    value={imageUrl}
                    onChange={(e) => setImageUrl(e.target.value)}
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              {full?.publications && full.publications.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Publications ({full.publications.length})
                  </label>
                  <div className="max-h-[200px] overflow-y-auto border border-gray-200 rounded-lg p-3 space-y-2">
                    {full.publications.slice(0, 50).map((pub, i) => (
                      <div
                        key={i}
                        className="text-xs text-gray-600 flex items-start gap-2"
                      >
                        <span className="text-gray-400 whitespace-nowrap">
                          {pub.year || "—"}
                        </span>
                        <span className="truncate">{pub.title}</span>
                        {pub.doi && (
                          <a
                            href={`https://doi.org/${pub.doi}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-500 hover:underline whitespace-nowrap flex-shrink-0"
                          >
                            DOI
                          </a>
                        )}
                      </div>
                    ))}
                    {full.publications.length > 50 && (
                      <p className="text-xs text-gray-400">
                        ... and {full.publications.length - 50} more
                      </p>
                    )}
                  </div>
                </div>
              )}

              <div className="flex flex-wrap gap-6 pt-2">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={profileVerified}
                    onChange={(e) => setProfileVerified(e.target.checked)}
                    className="rounded border-gray-300"
                  />
                  Profile Verified
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={userConfirmed}
                    onChange={(e) => setUserConfirmed(e.target.checked)}
                    className="rounded border-gray-300"
                  />
                  Account Confirmed
                </label>
                <div>
                  <label className="text-xs font-medium text-gray-600 mr-2">
                    User Type:
                  </label>
                  <select
                    value={userType}
                    onChange={(e) => setUserType(e.target.value)}
                    className="text-sm border border-gray-200 rounded-lg px-2 py-1"
                  >
                    <option value="professor">Professor</option>
                    <option value="faculty">Faculty</option>
                    <option value="admin">Admin</option>
                    <option value="graduate">Graduate</option>
                    <option value="undergraduate">Undergraduate</option>
                    <option value="unknown">Unknown</option>
                  </select>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex-shrink-0 border-t border-gray-100 px-6 py-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || loading}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AdminProfileEditModal;

/**
 * Admin modal for editing faculty profile fields.
 */
import { useEffect, useReducer } from 'react';
import axios from '../../utils/axios';
import {
  adminProfileEditReducer,
  createInitialAdminProfileEditState,
} from '../../reducers/adminProfileEditReducer';

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

interface AdminProfileEditModalProps {
  profile: AdminProfile;
  onClose: () => void;
  onSaved: () => void;
}

const AdminProfileEditModal = ({ profile, onClose, onSaved }: AdminProfileEditModalProps) => {
  const [state, dispatch] = useReducer(
    adminProfileEditReducer,
    profile,
    createInitialAdminProfileEditState,
  );
  const {
    full,
    loading,
    saving,
    fname,
    lname,
    email,
    title,
    bio,
    phone,
    primaryDept,
    secondaryDepts,
    researchInterests,
    hIndex,
    orcid,
    imageUrl,
    profileVerified,
    userType,
    userConfirmed,
  } = state;

  useEffect(() => {
    axios
      .get(`/admin/profiles/${profile.netid}`)
      .then((res) => {
        dispatch({ type: 'FETCH_SUCCESS', profile: res.data.profile });
      })
      .catch((err) => {
        console.error(err);
        dispatch({ type: 'FETCH_FAILURE' });
      });
  }, [profile.netid]);

  const handleSave = async () => {
    dispatch({ type: 'SAVE_START' });
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
            .split(',')
            .map((d) => d.trim())
            .filter(Boolean),
          research_interests: researchInterests
            .split(',')
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
      console.error('Error saving profile:', err);
      alert(err.response?.data?.error || 'Failed to save');
    } finally {
      dispatch({ type: 'SAVE_END' });
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
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
                  <label className="block text-xs font-medium text-gray-600 mb-1">First Name</label>
                  <input
                    type="text"
                    value={fname}
                    onChange={(e) => dispatch({ type: 'SET_FNAME', payload: e.target.value })}
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Last Name</label>
                  <input
                    type="text"
                    value={lname}
                    onChange={(e) => dispatch({ type: 'SET_LNAME', payload: e.target.value })}
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => dispatch({ type: 'SET_EMAIL', payload: e.target.value })}
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Phone</label>
                  <input
                    type="text"
                    value={phone}
                    onChange={(e) => dispatch({ type: 'SET_PHONE', payload: e.target.value })}
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Title</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => dispatch({ type: 'SET_TITLE', payload: e.target.value })}
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Bio</label>
                <textarea
                  value={bio}
                  onChange={(e) => dispatch({ type: 'SET_BIO', payload: e.target.value })}
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
                    onChange={(e) =>
                      dispatch({ type: 'SET_PRIMARY_DEPT', payload: e.target.value })
                    }
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
                    onChange={(e) =>
                      dispatch({ type: 'SET_SECONDARY_DEPTS', payload: e.target.value })
                    }
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
                  onChange={(e) =>
                    dispatch({ type: 'SET_RESEARCH_INTERESTS', payload: e.target.value })
                  }
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">H-Index</label>
                  <input
                    type="number"
                    value={hIndex}
                    onChange={(e) => dispatch({ type: 'SET_H_INDEX', payload: e.target.value })}
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">ORCID</label>
                  <input
                    type="text"
                    value={orcid}
                    onChange={(e) => dispatch({ type: 'SET_ORCID', payload: e.target.value })}
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Image URL</label>
                  <input
                    type="text"
                    value={imageUrl}
                    onChange={(e) => dispatch({ type: 'SET_IMAGE_URL', payload: e.target.value })}
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
                      <div key={i} className="text-xs text-gray-600 flex items-start gap-2">
                        <span className="text-gray-400 whitespace-nowrap">{pub.year || '—'}</span>
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
                    onChange={(e) =>
                      dispatch({ type: 'SET_PROFILE_VERIFIED', payload: e.target.checked })
                    }
                    className="rounded border-gray-300"
                  />
                  Profile Verified
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={userConfirmed}
                    onChange={(e) =>
                      dispatch({ type: 'SET_USER_CONFIRMED', payload: e.target.checked })
                    }
                    className="rounded border-gray-300"
                  />
                  Account Confirmed
                </label>
                <div>
                  <label className="text-xs font-medium text-gray-600 mr-2">User Type:</label>
                  <select
                    value={userType}
                    onChange={(e) => dispatch({ type: 'SET_USER_TYPE', payload: e.target.value })}
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
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AdminProfileEditModal;

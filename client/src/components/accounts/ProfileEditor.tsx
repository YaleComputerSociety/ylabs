/**
 * Professor profile editor with department, research, and verification.
 *
 * Form/UI/lifecycle state lives in reducers/profileEditorReducer.ts. This
 * component owns the fetch/save side effects and the click-outside handler.
 */
import { useEffect, useRef, useMemo, useReducer, useCallback } from 'react';
import { FacultyProfile } from '../../types/types';
import axios from '../../utils/axios';
import { useConfig } from '../../hooks/useConfig';
import DepartmentInput from './ListingForm/FormFields/DepartmentInput';
import ResearchAreaInput from './ListingForm/FormFields/ResearchAreaInput';
import {
  createInitialProfileEditorState,
  profileEditorReducer,
} from '../../reducers/profileEditorReducer';

interface ProfileEditorProps {
  netid: string;
}

const ProfileEditor = ({ netid }: ProfileEditorProps) => {
  const [state, dispatch] = useReducer(profileEditorReducer, undefined, () =>
    createInitialProfileEditorState(),
  );
  const {
    profile,
    loading,
    saving,
    editing,
    message,
    validationErrors,
    bio,
    primaryDept,
    secondaryDepts,
    researchInterests,
    imageUrl,
    primaryDeptSearch,
    isPrimaryDropdownOpen,
    focusedPrimaryIndex,
  } = state;

  const { departments: allDepartmentsConfig, isLoading: configLoading } = useConfig();
  const departmentNames = useMemo(
    () => allDepartmentsConfig.map((d) => d.displayName),
    [allDepartmentsConfig],
  );

  const primaryDropdownRef = useRef<HTMLDivElement>(null);
  const primaryInputRef = useRef<HTMLInputElement>(null);

  const filteredPrimaryDepts = useMemo(() => {
    const search = isPrimaryDropdownOpen ? primaryDeptSearch : '';
    return departmentNames.filter(
      (dept) =>
        dept.toLowerCase().includes(search.toLowerCase()) &&
        dept !== primaryDept &&
        !secondaryDepts.includes(dept),
    );
  }, [departmentNames, primaryDeptSearch, primaryDept, secondaryDepts, isPrimaryDropdownOpen]);

  const availableSecondaryDepts = useMemo(() => {
    return departmentNames
      .filter((dept) => dept !== primaryDept && !secondaryDepts.includes(dept))
      .sort();
  }, [departmentNames, primaryDept, secondaryDepts]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (primaryDropdownRef.current && !primaryDropdownRef.current.contains(e.target as Node)) {
        dispatch({ type: 'CLOSE_PRIMARY_DROPDOWN' });
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    axios
      .get(`/profiles/${netid}`)
      .then((res) => {
        const p: FacultyProfile = res.data.profile;
        dispatch({ type: 'FETCH_SUCCESS', profile: p });
      })
      .catch((err) => {
        console.error(err);
        dispatch({ type: 'FETCH_FAILURE' });
      });
  }, [netid]);

  const isUnverified = profile ? !profile.profileVerified : false;

  const handleSave = async () => {
    dispatch({ type: 'SAVE_START' });

    const errors: string[] = [];
    if (!primaryDept.trim()) errors.push('Primary Department is required.');
    if (researchInterests.length === 0) errors.push('At least one Research Interest is required.');
    if (errors.length > 0) {
      dispatch({ type: 'SAVE_VALIDATION_FAILED', errors });
      return;
    }

    try {
      const data: any = {
        bio,
        primary_department: primaryDept.trim(),
        secondary_departments: secondaryDepts,
        research_interests: researchInterests,
        image_url: imageUrl.trim(),
      };

      await axios.put('/profiles/me', data);

      if (isUnverified) {
        const verifyRes = await axios.put('/profiles/me/verify');
        const updatedProfile: FacultyProfile = {
          ...(profile as FacultyProfile),
          ...verifyRes.data.profile,
          profileVerified: true,
        };
        dispatch({
          type: 'SAVE_SUCCESS',
          profile: updatedProfile,
          message: { type: 'success', text: 'Profile verified! You can now create listings.' },
        });
      } else {
        const res = await axios.put('/profiles/me', data);
        const updatedProfile: FacultyProfile = {
          ...(profile as FacultyProfile),
          ...res.data.profile,
        };
        dispatch({
          type: 'SAVE_SUCCESS',
          profile: updatedProfile,
          message: {
            type: 'success',
            text: 'Profile updated. Department changes have been applied to your listings.',
          },
        });
      }
    } catch (err: any) {
      dispatch({
        type: 'SAVE_FAILURE',
        message: { type: 'error', text: err.response?.data?.error || 'Failed to save profile.' },
      });
    }
  };

  const setSecondaryDepts = useCallback((value: React.SetStateAction<string[]>) => {
    dispatch({ type: 'SET_SECONDARY_DEPTS', payload: value });
  }, []);

  const setResearchInterests = useCallback((value: React.SetStateAction<string[]>) => {
    dispatch({ type: 'SET_RESEARCH_INTERESTS', payload: value });
  }, []);

  const handlePrimaryKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        dispatch({
          type: 'SET_FOCUSED_PRIMARY_INDEX',
          payload: (prev) => (prev < filteredPrimaryDepts.length - 1 ? prev + 1 : prev),
        });
        break;
      case 'ArrowUp':
        e.preventDefault();
        dispatch({
          type: 'SET_FOCUSED_PRIMARY_INDEX',
          payload: (prev) => (prev > 0 ? prev - 1 : 0),
        });
        break;
      case 'Enter':
        e.preventDefault();
        if (focusedPrimaryIndex >= 0 && focusedPrimaryIndex < filteredPrimaryDepts.length) {
          dispatch({
            type: 'SELECT_PRIMARY_DEPT',
            payload: filteredPrimaryDepts[focusedPrimaryIndex],
          });
        }
        break;
      case 'Escape':
        e.preventDefault();
        dispatch({ type: 'CLOSE_PRIMARY_DROPDOWN' });
        primaryInputRef.current?.blur();
        break;
      case 'Tab':
        dispatch({ type: 'CLOSE_PRIMARY_DROPDOWN' });
        break;
    }
  };

  if (loading || configLoading) {
    return (
      <div className="flex justify-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!profile) return null;

  const fullName = `${profile.fname} ${profile.lname}`;
  const initials =
    `${profile.fname?.charAt(0) || ''}${profile.lname?.charAt(0) || ''}`.toUpperCase();

  return (
    <section className="mb-8">
      {isUnverified && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg mb-6">
          <p className="text-sm font-medium text-amber-800">
            Your faculty profile has been auto-populated from Yale directories and academic
            databases.
          </p>
          <p className="text-xs text-amber-600 mt-0.5">
            Please review your information below. A primary department and at least one research
            interest are required to save and verify your profile.
          </p>
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-xl p-6">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-4">
            {profile.image_url ? (
              <img
                src={profile.image_url}
                alt={fullName}
                className="w-16 h-16 rounded-xl object-cover"
              />
            ) : (
              <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-blue-100 to-blue-200 flex items-center justify-center">
                <span className="text-xl font-bold text-blue-700">{initials}</span>
              </div>
            )}
            <div>
              <h3 className="text-lg font-bold text-gray-900">{fullName}</h3>
              {profile.title && <p className="text-sm text-gray-500">{profile.title}</p>}
              <a
                href={`/profile/${netid}`}
                className="text-xs text-blue-600 hover:underline mt-0.5 inline-block"
              >
                View full profile
              </a>
            </div>
          </div>
          {!editing && (
            <button
              onClick={() => dispatch({ type: 'START_EDITING' })}
              className="px-4 py-2 text-sm font-medium text-blue-600 border border-blue-200 rounded-lg hover:bg-blue-50 transition-colors"
            >
              Edit Profile
            </button>
          )}
        </div>

        {message && (
          <div
            className={`p-3 rounded-lg mb-4 text-sm ${
              message.type === 'success'
                ? 'bg-green-50 text-green-700 border border-green-200'
                : 'bg-red-50 text-red-700 border border-red-200'
            }`}
          >
            {message.text}
          </div>
        )}

        {validationErrors.length > 0 && (
          <div className="p-3 rounded-lg mb-4 text-sm bg-red-50 text-red-700 border border-red-200">
            <ul className="list-disc list-inside space-y-0.5">
              {validationErrors.map((err, i) => (
                <li key={i}>{err}</li>
              ))}
            </ul>
          </div>
        )}

        {editing ? (
          <div className="space-y-4 mt-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Bio</label>
              <textarea
                value={bio}
                onChange={(e) => dispatch({ type: 'SET_BIO', payload: e.target.value })}
                rows={4}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div ref={primaryDropdownRef}>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Primary Department <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <input
                    ref={primaryInputRef}
                    type="text"
                    value={isPrimaryDropdownOpen ? primaryDeptSearch : primaryDept}
                    onClick={() => dispatch({ type: 'OPEN_PRIMARY_DROPDOWN' })}
                    onChange={(e) =>
                      dispatch({ type: 'SET_PRIMARY_DEPT_SEARCH', payload: e.target.value })
                    }
                    onKeyDown={handlePrimaryKeyDown}
                    onFocus={() => dispatch({ type: 'OPEN_PRIMARY_DROPDOWN' })}
                    readOnly={!isPrimaryDropdownOpen}
                    className={`w-full text-sm border rounded-lg px-3 py-2 pr-8 focus:outline-none focus:ring-2 focus:ring-blue-500 truncate ${
                      isUnverified && !primaryDept.trim() ? 'border-red-300' : 'border-gray-200'
                    } ${!isPrimaryDropdownOpen && primaryDept ? 'text-gray-900' : 'text-gray-700'}`}
                    placeholder="Select primary department..."
                  />
                  <div
                    className="absolute inset-y-0 right-0 flex items-center px-2 text-gray-500 cursor-pointer"
                    onClick={() => {
                      if (isPrimaryDropdownOpen) {
                        dispatch({ type: 'CLOSE_PRIMARY_DROPDOWN' });
                      } else {
                        dispatch({ type: 'OPEN_PRIMARY_DROPDOWN' });
                        primaryInputRef.current?.focus();
                      }
                    }}
                  >
                    <svg
                      className="fill-current h-4 w-4"
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 20 20"
                    >
                      <path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z" />
                    </svg>
                  </div>

                  {isPrimaryDropdownOpen && (
                    <div className="absolute w-full bg-white rounded-lg z-10 shadow-lg border overflow-hidden mt-1 border-gray-300">
                      {primaryDept && (
                        <div className="px-3 py-2 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
                          <span className="text-sm text-gray-700">{primaryDept}</span>
                          <button
                            type="button"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => {
                              dispatch({ type: 'CLEAR_PRIMARY_DEPT' });
                              primaryInputRef.current?.focus();
                            }}
                            className="text-xs text-red-500 hover:text-red-700"
                          >
                            Clear
                          </button>
                        </div>
                      )}
                      <ul className="max-h-[250px] p-1 overflow-y-auto">
                        {filteredPrimaryDepts.length > 0 ? (
                          filteredPrimaryDepts.map((dept, index) => (
                            <li
                              key={index}
                              onClick={() =>
                                dispatch({ type: 'SELECT_PRIMARY_DEPT', payload: dept })
                              }
                              className={`p-2 cursor-pointer text-sm ${
                                focusedPrimaryIndex === index ? 'bg-blue-100' : 'hover:bg-gray-100'
                              }`}
                              onMouseDown={(e) => e.preventDefault()}
                            >
                              {dept}
                            </li>
                          ))
                        ) : (
                          <li className="p-2 text-gray-500 text-sm">No departments found</li>
                        )}
                      </ul>
                    </div>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Profile Image URL
                </label>
                <input
                  type="text"
                  value={imageUrl}
                  onChange={(e) => dispatch({ type: 'SET_IMAGE_URL', payload: e.target.value })}
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <DepartmentInput
              label="Joint Appointments"
              departments={secondaryDepts}
              availableDepartments={availableSecondaryDepts}
              onAddDepartment={(dept) => setSecondaryDepts((prev) => [...prev, dept])}
              onRemoveDepartment={(index) =>
                setSecondaryDepts((prev) => prev.filter((_, i) => i !== index))
              }
            />

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Research Interests <span className="text-red-500">*</span>
              </label>
              <ResearchAreaInput
                researchAreas={researchInterests}
                onAddResearchArea={(area) => setResearchInterests((prev) => [...prev, area])}
                onRemoveResearchArea={(index) =>
                  setResearchInterests((prev) => prev.filter((_, i) => i !== index))
                }
              />
            </div>

            <div className="flex gap-2 pt-2">
              <button
                onClick={handleSave}
                disabled={saving}
                className={`px-4 py-2 text-white text-sm font-medium rounded-lg disabled:opacity-50 transition-colors ${
                  isUnverified ? 'bg-amber-600 hover:bg-amber-700' : 'bg-blue-600 hover:bg-blue-700'
                }`}
              >
                {saving ? 'Saving...' : isUnverified ? 'Save & Verify' : 'Save Changes'}
              </button>
              <button
                onClick={() => {
                  if (profile) dispatch({ type: 'CANCEL_EDITING', profile });
                }}
                className="px-4 py-2 text-sm font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-2 space-y-2 text-sm text-gray-600">
            {profile.primary_department && (
              <p>
                <span className="font-medium text-gray-700">Department:</span>{' '}
                {profile.primary_department}
              </p>
            )}
            {profile.secondary_departments?.length > 0 && (
              <p>
                <span className="font-medium text-gray-700">Joint Appointments:</span>{' '}
                {profile.secondary_departments.join(', ')}
              </p>
            )}
            {profile.email && (
              <p>
                <span className="font-medium text-gray-700">Email:</span> {profile.email}
              </p>
            )}
            {profile.bio && <p className="line-clamp-3">{profile.bio}</p>}
          </div>
        )}
      </div>
    </section>
  );
};

export default ProfileEditor;

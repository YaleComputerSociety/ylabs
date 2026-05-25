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
import { getUniqueDepartmentLabels } from '../../utils/departmentNames';
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
    () =>
      getUniqueDepartmentLabels(
        allDepartmentsConfig.map((d) => d.name || d.displayName),
        allDepartmentsConfig,
      ),
    [allDepartmentsConfig],
  );

  const primaryDropdownRef = useRef<HTMLDivElement>(null);
  const primaryInputRef = useRef<HTMLInputElement>(null);
  const validationSummaryRef = useRef<HTMLDivElement>(null);

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
      window.setTimeout(() => validationSummaryRef.current?.focus(), 0);
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

      const saveRes = await axios.put('/profiles/me', data);
      const savedProfile: FacultyProfile = {
        ...(profile as FacultyProfile),
        ...saveRes.data.profile,
      };

      if (isUnverified) {
        await axios.put('/profiles/me/verify');
        dispatch({
          type: 'SAVE_SUCCESS',
          profile: { ...savedProfile, profileVerified: true },
          message: { type: 'success', text: 'Profile verified. Students can now trust this profile.' },
        });
      } else {
        dispatch({
          type: 'SAVE_SUCCESS',
          profile: savedProfile,
          message: {
            type: 'success',
            text: 'Profile updated. Department changes have been applied to your research profile.',
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
  const primaryDeptError = validationErrors.includes('Primary Department is required.');
  const researchInterestError = validationErrors.includes(
    'At least one Research Interest is required.',
  );
  const readinessItems = [
    { label: 'Department', complete: Boolean(primaryDept.trim()) },
    { label: 'Research interests', complete: researchInterests.length > 0 },
    { label: 'Bio', complete: Boolean(bio.trim()) },
    { label: 'Profile photo', complete: Boolean(imageUrl.trim()) },
  ];
  const readinessCount = readinessItems.filter((item) => item.complete).length;
  const readinessPercent = Math.round((readinessCount / readinessItems.length) * 100);
  const bioId = `profile-bio-${netid}`;
  const imageUrlId = `profile-image-url-${netid}`;
  const primaryDeptId = `profile-primary-dept-${netid}`;
  const primaryDeptListId = `profile-primary-dept-list-${netid}`;
  const primaryDeptErrorId = `profile-primary-dept-error-${netid}`;
  const researchInterestsErrorId = `profile-research-interests-error-${netid}`;

  return (
    <section className="mb-8">
      {isUnverified && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-md mb-6">
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

      <div className="bg-[var(--yr-panel)] border border-[var(--yr-line)] rounded-md p-6">
        <div className="flex flex-col gap-4 border-b border-[var(--yr-line)] pb-5 md:flex-row md:items-start md:justify-between">
          <div className="flex items-center gap-4">
            {profile.image_url ? (
              <img
                src={profile.image_url}
                alt={fullName}
                className="w-16 h-16 rounded-md object-cover"
              />
            ) : (
              <div className="w-16 h-16 rounded-md bg-[var(--yr-blue-soft)] flex items-center justify-center">
                <span className="text-xl font-bold text-blue-700">{initials}</span>
              </div>
            )}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">
                Public faculty profile
              </p>
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
              className="min-h-[44px] px-4 py-2 text-sm font-medium text-blue-600 border border-blue-200 rounded-md hover:bg-[var(--yr-blue-soft)] transition-colors"
            >
              Edit Profile
            </button>
          )}
        </div>

        <div className="border-b border-[var(--yr-line)] py-5">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-sm font-semibold text-gray-900">Profile readiness</p>
              <p className="text-sm text-gray-500">
                Students use these fields to judge fit before deciding whether to reach out.
              </p>
            </div>
            <p className="text-sm font-semibold text-gray-700">
              {readinessCount}/{readinessItems.length} complete
            </p>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--yr-panel-muted)]">
            <div className="h-full bg-blue-600" style={{ width: `${readinessPercent}%` }} />
          </div>
          <ul className="mt-3 grid gap-2 text-xs text-gray-600 sm:grid-cols-2 lg:grid-cols-4">
            {readinessItems.map((item) => (
              <li key={item.label} className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className={`h-2 w-2 rounded-full ${
                    item.complete ? 'bg-green-500' : 'bg-gray-300'
                  }`}
                />
                <span className={item.complete ? 'text-gray-700' : 'text-gray-500'}>
                  {item.label}
                </span>
              </li>
            ))}
          </ul>
        </div>

        {message && (
          <div
            className={`p-3 rounded-md my-4 text-sm ${
              message.type === 'success'
                ? 'bg-green-50 text-green-700 border border-green-200'
                : 'bg-red-50 text-red-700 border border-red-200'
            }`}
          >
            {message.text}
          </div>
        )}

        {validationErrors.length > 0 && (
          <div
            ref={validationSummaryRef}
            tabIndex={-1}
            role="alert"
            className="p-3 rounded-md my-4 text-sm bg-red-50 text-red-700 border border-red-200 focus:outline-none focus:ring-2 focus:ring-red-300"
          >
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
              <label htmlFor={bioId} className="block text-xs font-medium text-gray-600 mb-1">
                Bio
              </label>
              <textarea
                id={bioId}
                value={bio}
                onChange={(e) => dispatch({ type: 'SET_BIO', payload: e.target.value })}
                rows={4}
                className="w-full text-sm border border-[var(--yr-line)] rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div ref={primaryDropdownRef}>
                <label
                  htmlFor={primaryDeptId}
                  className="block text-xs font-medium text-gray-600 mb-1"
                >
                  Primary Department <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <input
                    id={primaryDeptId}
                    ref={primaryInputRef}
                    type="text"
                    value={isPrimaryDropdownOpen ? primaryDeptSearch : primaryDept}
                    onClick={() => {
                      if (!isPrimaryDropdownOpen) dispatch({ type: 'OPEN_PRIMARY_DROPDOWN' });
                    }}
                    onChange={(e) =>
                      dispatch({ type: 'SET_PRIMARY_DEPT_SEARCH', payload: e.target.value })
                    }
                    onKeyDown={handlePrimaryKeyDown}
                    onFocus={() => {
                      if (!isPrimaryDropdownOpen) dispatch({ type: 'OPEN_PRIMARY_DROPDOWN' });
                    }}
                    role="combobox"
                    aria-expanded={isPrimaryDropdownOpen}
                    aria-controls={primaryDeptListId}
                    aria-autocomplete="list"
                    aria-invalid={primaryDeptError || undefined}
                    aria-describedby={primaryDeptError ? primaryDeptErrorId : undefined}
                    className={`w-full text-sm border rounded-md px-3 py-2 pr-8 focus:outline-none focus:ring-2 focus:ring-blue-500 truncate ${
                      primaryDeptError ? 'border-red-300' : 'border-[var(--yr-line)]'
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
                    <div className="absolute w-full bg-[var(--yr-panel)] rounded-lg z-10 shadow-lg border overflow-hidden mt-1 border-[var(--yr-line-strong)]">
                      {primaryDept && (
                        <div className="px-3 py-2 border-b border-[var(--yr-line)] bg-[var(--yr-panel-muted)] flex items-center justify-between">
                          <span className="text-sm text-gray-700">{primaryDept}</span>
                          <button
                            type="button"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => {
                              dispatch({ type: 'CLEAR_PRIMARY_DEPT' });
                              dispatch({ type: 'CLOSE_PRIMARY_DROPDOWN' });
                            }}
                            className="text-xs text-red-500 hover:text-red-700"
                          >
                            Clear
                          </button>
                        </div>
                      )}
                      <ul
                        id={primaryDeptListId}
                        role="listbox"
                        className="max-h-[250px] p-1 overflow-y-auto"
                      >
                        {filteredPrimaryDepts.length > 0 ? (
                          filteredPrimaryDepts.map((dept, index) => (
                            <li
                              key={index}
                              role="option"
                              aria-selected={focusedPrimaryIndex === index}
                              onClick={() =>
                                dispatch({ type: 'SELECT_PRIMARY_DEPT', payload: dept })
                              }
                              className={`p-2 cursor-pointer text-sm ${
                                focusedPrimaryIndex === index ? 'bg-[var(--yr-blue-soft)]' : 'hover:bg-[var(--yr-panel-muted)]'
                              }`}
                              onMouseDown={(e) => e.preventDefault()}
                            >
                              {dept}
                            </li>
                          ))
                        ) : (
                          <li className="p-2 text-gray-500 text-sm" role="option" aria-disabled>
                            No departments found
                          </li>
                        )}
                      </ul>
                    </div>
                  )}
                </div>
                {primaryDeptError && (
                  <p id={primaryDeptErrorId} className="mt-1 text-xs text-red-600">
                    Primary Department is required.
                  </p>
                )}
              </div>

              <div>
                <label htmlFor={imageUrlId} className="block text-xs font-medium text-gray-600 mb-1">
                  Profile Image URL
                </label>
                <input
                  id={imageUrlId}
                  type="text"
                  value={imageUrl}
                  onChange={(e) => dispatch({ type: 'SET_IMAGE_URL', payload: e.target.value })}
                  className="w-full text-sm border border-[var(--yr-line)] rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
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
              <div
                aria-invalid={researchInterestError || undefined}
                aria-describedby={researchInterestError ? researchInterestsErrorId : undefined}
              >
                <ResearchAreaInput
                  researchAreas={researchInterests}
                  onAddResearchArea={(area) => setResearchInterests((prev) => [...prev, area])}
                  onRemoveResearchArea={(index) =>
                    setResearchInterests((prev) => prev.filter((_, i) => i !== index))
                  }
                />
              </div>
              {researchInterestError && (
                <p id={researchInterestsErrorId} className="mt-1 text-xs text-red-600">
                  At least one Research Interest is required.
                </p>
              )}
            </div>

            <div className="flex gap-2 pt-2">
              <button
                onClick={handleSave}
                disabled={saving}
                className={`min-h-[44px] px-4 py-2 text-white text-sm font-medium rounded-md disabled:opacity-50 transition-colors ${
                  isUnverified ? 'bg-amber-600 hover:bg-amber-700' : 'bg-blue-600 hover:bg-blue-700'
                }`}
              >
                {saving ? 'Saving...' : isUnverified ? 'Save & Verify' : 'Save Changes'}
              </button>
              <button
                onClick={() => {
                  if (profile) dispatch({ type: 'CANCEL_EDITING', profile });
                }}
                className="min-h-[44px] px-4 py-2 text-sm font-medium text-gray-600 border border-[var(--yr-line)] rounded-md hover:bg-[var(--yr-panel-muted)] transition-colors"
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

/**
 * Faculty profile page with bio, research, and courses tabs.
 *
 * State split: fetch-lifecycle state (profile, loading, error, coursesAvailable)
 * lives in a useReducer backed by `profilePageReducer` so transitions are pure
 * and unit-testable. UI-only state (`activeTab`, `showAdminEdit`) intentionally
 * stays as plain local state — each is single-concern and unrelated to the
 * fetch lifecycle, so the reducer indirection would obscure rather than clarify.
 */
import { useState, useEffect, useContext, useReducer, type ReactNode } from 'react';
import { Link, useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { FacultyProfile } from '../types/types';
import UserContext from '../contexts/UserContext';
import axios from '../utils/axios';
import ProfileHeader from '../components/profile/ProfileHeader';
import ResearchInterests from '../components/profile/ResearchInterests';
import CourseTableSection from '../components/profile/CourseTableSection';
import LabPapersList from '../components/labs/LabPapersList';
import AdminProfileEditModal from '../components/admin/AdminProfileEditModal';
import LongText from '../components/shared/LongText';
import useDocumentTitle from '../hooks/useDocumentTitle';
import {
  createInitialProfilePageState,
  profilePageReducer,
} from '../reducers/profilePageReducer';
import { formatTitleCaseLabel } from '../utils/displayText';

type Tab = 'bio' | 'research' | 'courses';
const VALID_TABS: Tab[] = ['bio', 'research', 'courses'];

const SectionHeading = ({ children }: { children: ReactNode }) => (
  <h2 className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-3">
    {children}
  </h2>
);

const formatRoleLabel = (role?: string) =>
  role
    ? role
        .split('-')
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ')
    : '';

const Profile = () => {
  const { netid } = useParams<{ netid: string }>();
  const { user } = useContext(UserContext);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [state, dispatch] = useReducer(
    profilePageReducer,
    undefined,
    () => createInitialProfilePageState(),
  );
  const { profile, loading, error, coursesAvailable } = state;
  const tabParam = searchParams.get('tab') as Tab | null;
  const [activeTab, setActiveTab] = useState<Tab>(
    tabParam && VALID_TABS.includes(tabParam) ? tabParam : 'bio',
  );
  const [showAdminEdit, setShowAdminEdit] = useState(false);

  const isOwnProfile = user?.netId === netid;
  const isAdmin = user?.userType === 'admin';
  const bioText = profile?.bio || '';
  useDocumentTitle(profile ? `${profile.fname} ${profile.lname}` : 'Faculty profile');

  const fetchProfile = () => {
    if (!netid) return;
    dispatch({ type: 'FETCH_START' });
    axios
      .get(`/profiles/${netid}`)
      .then((res) => {
        dispatch({ type: 'FETCH_SUCCESS', profile: res.data.profile as FacultyProfile });
      })
      .catch((err) => {
        if (err.response?.status === 404) {
          dispatch({ type: 'FETCH_FAILURE', payload: 'Profile not found.' });
        } else {
          dispatch({ type: 'FETCH_FAILURE', payload: 'Failed to load profile.' });
        }
      });
  };

  useEffect(() => {
    fetchProfile();
  }, [netid]);

  useEffect(() => {
    const nextTab = tabParam && VALID_TABS.includes(tabParam) ? tabParam : 'bio';
    setActiveTab(nextTab);
  }, [tabParam]);

  const handleTabClick = (tab: Tab) => {
    setActiveTab(tab);
    const nextParams = new URLSearchParams(searchParams);
    if (tab === 'bio') {
      nextParams.delete('tab');
    } else {
      nextParams.set('tab', tab);
    }
    setSearchParams(nextParams);
  };

  const tabs: { key: Tab; label: string; show: boolean }[] = [
    { key: 'bio', label: 'Bio', show: true },
    { key: 'research', label: 'Research', show: true },
    { key: 'courses', label: 'Courses', show: coursesAvailable === true },
  ];

  if (loading) {
    return (
      <div className="yr-page flex min-h-[calc(100vh-8rem)] items-center justify-center px-4 py-16">
        <div
          className="h-10 w-10 animate-spin rounded-full border-b-2 border-[var(--yr-blue)]"
          aria-label="Loading profile"
        />
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="yr-page flex min-h-[calc(100vh-8rem)] items-center justify-center px-4 py-16">
        <div className="yr-panel max-w-md rounded-md p-6 text-center">
          <p className="yr-kicker mb-3">Profile</p>
          <h1 className="text-2xl font-semibold text-slate-950">
            {error || 'Profile not found'}
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            The faculty member you're looking for may not have a profile yet.
          </p>
          <Link
            to="/research"
            className="mt-6 inline-flex min-h-[44px] items-center justify-center rounded-md bg-[var(--yr-blue)] px-4 py-2 text-sm font-semibold text-white hover:bg-blue-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
          >
            Explore Research
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="yr-page w-full">
      <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <ProfileHeader profile={profile} />
        </div>
        {isAdmin && (
          <button
            onClick={() => setShowAdminEdit(true)}
            className="ml-4 inline-flex min-h-[44px] flex-shrink-0 items-center justify-center rounded-md bg-gray-700 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-300"
          >
            Edit Profile
          </button>
        )}
      </div>

      {isOwnProfile && !profile.profileVerified && (
        <div className="mt-6 p-4 bg-amber-50 border border-amber-200 rounded-lg flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-amber-800">
              Your profile has been auto-populated from Yale directories and academic databases.
            </p>
            <p className="text-xs text-amber-600 mt-0.5">
              Please review and edit your information, then confirm verification so students can
              trust this profile.
            </p>
          </div>
          <button
            onClick={() => navigate('/account')}
            className="flex-shrink-0 px-4 py-2 bg-amber-600 text-white text-sm font-medium rounded-lg hover:bg-amber-700 transition-colors"
          >
            Review &amp; Verify
          </button>
        </div>
      )}

      <div className="border-b border-gray-200 mt-8">
        <nav className="flex gap-1" role="tablist" aria-label="Profile sections">
          {tabs
            .filter((t) => t.show)
            .map((tab) => (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={activeTab === tab.key}
                aria-controls={`profile-${tab.key}-panel`}
                id={`profile-${tab.key}-tab`}
                onClick={() => handleTabClick(tab.key)}
                className={`min-h-[44px] px-5 py-3 text-sm font-semibold border-b-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200 ${
                  activeTab === tab.key
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                {tab.label}
              </button>
            ))}
        </nav>
      </div>

      <div className="mt-6">
        {activeTab === 'bio' && (
          <div
            id="profile-bio-panel"
            role="tabpanel"
            aria-labelledby="profile-bio-tab"
          >
            {bioText ? (
              <LongText text={bioText} className="text-sm text-gray-700 leading-relaxed" />
            ) : (
              <p className="text-gray-500 text-sm py-8 text-center">No bio available.</p>
            )}
          </div>
        )}

        {activeTab === 'research' && (
          <div
            id="profile-research-panel"
            role="tabpanel"
            aria-labelledby="profile-research-tab"
            className="space-y-8"
          >
            <ResearchInterests
              interests={profile.research_interests || []}
              topics={profile.topics || []}
              summary={profile.research_interest_summary}
            />
            {(profile.researchEntities?.length ?? 0) > 0 && (
              <section>
                <SectionHeading>Research Homes</SectionHeading>
                <div className="space-y-3">
                  {(profile.researchEntities || []).map((entity) => {
                    const title = entity.displayName || entity.name || 'Untitled research home';
                    const description = entity.shortDescription || entity.description || '';
                    const roleLabel = formatRoleLabel(entity.role);
                    return (
                      <article
                        key={entity._id || entity.slug || title}
                        className="rounded-md border border-gray-200 bg-white p-4"
                      >
                        <div className="flex flex-col gap-2">
                          <div className="flex flex-wrap items-center gap-2">
                            {entity.slug ? (
                              <Link
                                to={`/research/${entity.slug}`}
                                className="text-base font-semibold text-blue-800 hover:text-blue-950 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
                              >
                                {title}
                              </Link>
                            ) : (
                              <h3 className="text-base font-semibold text-gray-950">{title}</h3>
                            )}
                            {roleLabel && (
                              <span className="rounded bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700">
                                {roleLabel}
                              </span>
                            )}
                          </div>
                          {description && (
                            <p className="text-sm leading-relaxed text-gray-600">{description}</p>
                          )}
                          {(entity.researchAreas?.length ?? 0) > 0 && (
                            <div className="flex flex-wrap gap-1.5">
                              {(entity.researchAreas || []).slice(0, 4).map((area) => (
                                <span
                                  key={area}
                                  className="rounded bg-gray-50 px-2 py-0.5 text-xs font-semibold text-gray-600"
                                >
                                  {formatTitleCaseLabel(area)}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            )}
            {(profile.scholarlyLinks?.length ?? 0) > 0 && (
              <section>
                <SectionHeading>Research Activity</SectionHeading>
                <LabPapersList
                  papers={profile.scholarlyLinks || []}
                  emptyText="No scholarly links are attached to this profile yet."
                />
              </section>
            )}
          </div>
        )}

        {activeTab === 'courses' && netid && (
          <div
            id="profile-courses-panel"
            role="tabpanel"
            aria-labelledby="profile-courses-tab"
          >
            <CourseTableSection
              netid={netid}
              onAvailabilityChange={(available) =>
                dispatch({ type: 'SET_COURSES_AVAILABLE', payload: available })
              }
            />
          </div>
        )}
      </div>

      {showAdminEdit && (
        <AdminProfileEditModal
          profile={profile as any}
          onClose={() => setShowAdminEdit(false)}
          onSaved={() => {
            setShowAdminEdit(false);
            fetchProfile();
          }}
        />
      )}
      </div>
    </div>
  );
};

export default Profile;

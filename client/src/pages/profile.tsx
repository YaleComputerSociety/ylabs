/**
 * Faculty profile page with bio, research, listings, and courses tabs.
 *
 * State split: fetch-lifecycle state (profile, loading, error, coursesAvailable)
 * lives in a useReducer backed by `profilePageReducer` so transitions are pure
 * and unit-testable. UI-only state (`activeTab`, `showAdminEdit`) intentionally
 * stays as plain local state — each is single-concern and unrelated to the
 * fetch lifecycle, so the reducer indirection would obscure rather than clarify.
 */
import { useState, useEffect, useContext, useReducer } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { FacultyProfile } from '../types/types';
import UserContext from '../contexts/UserContext';
import axios from '../utils/axios';
import ProfileHeader from '../components/profile/ProfileHeader';
import ResearchInterests from '../components/profile/ResearchInterests';
import ProfileListings from '../components/profile/ProfileListings';
import CourseTableSection from '../components/profile/CourseTableSection';
import AdminProfileEditModal from '../components/admin/AdminProfileEditModal';
import {
  createInitialProfilePageState,
  profilePageReducer,
} from '../reducers/profilePageReducer';

type Tab = 'bio' | 'research' | 'listings' | 'courses';
const VALID_TABS: Tab[] = ['bio', 'research', 'listings', 'courses'];

const Profile = () => {
  const { netid } = useParams<{ netid: string }>();
  const { user } = useContext(UserContext);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
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

  const tabs: { key: Tab; label: string; show: boolean }[] = [
    { key: 'bio', label: 'Bio', show: true },
    { key: 'research', label: 'Research', show: true },
    { key: 'listings', label: 'Listings', show: true },
    { key: 'courses', label: 'Courses', show: coursesAvailable === true },
  ];

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-16 flex justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-16 text-center">
        <h2 className="text-xl font-semibold text-gray-800">{error || 'Profile not found'}</h2>
        <p className="text-gray-500 mt-2">
          The faculty member you're looking for may not have a profile yet.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <ProfileHeader profile={profile} onTabChange={(tab) => setActiveTab(tab as Tab)} />
        </div>
        {isAdmin && (
          <button
            onClick={() => setShowAdminEdit(true)}
            className="flex-shrink-0 ml-4 px-4 py-2 text-sm font-medium text-white bg-gray-700 rounded-lg hover:bg-gray-800 transition-colors"
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
              Please review and edit your information, then confirm verification to start posting
              listings.
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
        <nav className="flex gap-1">
          {tabs
            .filter((t) => t.show)
            .map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`px-5 py-3 text-sm font-semibold border-b-2 transition-colors ${
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
          <div>
            {profile.bio ? (
              <div className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
                {profile.bio}
              </div>
            ) : (
              <p className="text-gray-500 text-sm py-8 text-center">No bio available.</p>
            )}
          </div>
        )}

        {activeTab === 'research' && (
          <ResearchInterests
            interests={profile.research_interests || []}
            topics={profile.topics || []}
          />
        )}

        {activeTab === 'listings' && netid && <ProfileListings netid={netid} />}

        {activeTab === 'courses' && netid && (
          <CourseTableSection
            netid={netid}
            onAvailabilityChange={(available) =>
              dispatch({ type: 'SET_COURSES_AVAILABLE', payload: available })
            }
          />
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
  );
};

export default Profile;

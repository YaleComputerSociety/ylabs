/**
 * Account dashboard page. Composes the three extracted sections:
 *   - ProfileEditor (professor-side profile form, if in professor view)
 *   - ListingEditor (own-listings CRUD, if in professor view)
 *   - FavoritesManager (saved labs + fellowships; variant shifts UI between
 *     the kanban-heavy student view and the simpler professor-side browse view)
 *
 * The page itself only owns the admin view toggle and the confirmation banner.
 */
import { useContext, useState } from 'react';
import UserContext from '../contexts/UserContext';
import ProfileEditor from '../components/accounts/ProfileEditor';
import ListingEditor from '../components/accounts/ListingEditor';
import FavoritesManager from '../components/accounts/FavoritesManager';

const Account = () => {
  const { user } = useContext(UserContext);
  const [adminViewMode, setAdminViewMode] = useState<'student' | 'professor'>('student');

  const isAdmin = user?.userType === 'admin';
  const isProfessorUser = user?.userType === 'professor' || user?.userType === 'faculty';
  const showProfView = isAdmin ? adminViewMode === 'professor' : isProfessorUser;

  return (
    <div className="mx-auto max-w-[1300px] px-6 pt-6 pb-16 w-full">
      {isAdmin && (
        <div className="flex justify-center mb-6">
          <div className="inline-flex border border-gray-200 rounded-lg overflow-hidden">
            <button
              onClick={() => setAdminViewMode('student')}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                adminViewMode === 'student'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              Student View
            </button>
            <button
              onClick={() => setAdminViewMode('professor')}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                adminViewMode === 'professor'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              Professor View
            </button>
          </div>
        </div>
      )}

      {user && !user.userConfirmed && (user.userType === 'professor' || user.userType === 'faculty') && (
        <div className="bg-amber-100 border-l-4 border-amber-500 text-amber-700 p-4 mb-6 rounded shadow-sm">
          <div className="flex items-center">
            <p className="font-medium">
              Your account is pending confirmation. Any listings that you create will not be
              publicly visible as favorites or in search results until your account is confirmed.
            </p>
          </div>
        </div>
      )}

      {showProfView && user && <ProfileEditor netid={user.netId} />}
      {showProfView && user && <ListingEditor user={user} />}

      <FavoritesManager variant={showProfView ? 'professor' : 'student'} />
    </div>
  );
};

export default Account;

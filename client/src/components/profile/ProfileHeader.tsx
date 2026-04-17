/**
 * Profile header with name, department, contact, and metrics.
 */
import { FacultyProfile } from '../../types/types';
import { safeUrl } from '../../utils/url';

interface ProfileHeaderProps {
  profile: FacultyProfile;
  onTabChange?: (tab: string) => void;
}

const ProfileHeader = ({ profile, onTabChange }: ProfileHeaderProps) => {
  const fullName = `${profile.fname} ${profile.lname}`;
  const initials = `${profile.fname?.charAt(0) || ''}${profile.lname?.charAt(0) || ''}`.toUpperCase();

  const building = profile.building_desk
    ? profile.building_desk.split(',')[0].trim()
    : profile.physical_location || '';

  const allDepartments = [
    profile.primary_department,
    ...(profile.secondary_departments || []),
  ].filter(Boolean);

  return (
    <div className="flex flex-col md:flex-row gap-6 items-start">
      <div className="flex-shrink-0">
        {profile.image_url ? (
          <img
            src={profile.image_url}
            alt={fullName}
            className="w-28 h-28 rounded-xl object-cover shadow-md"
          />
        ) : (
          <div className="w-28 h-28 rounded-xl bg-gradient-to-br from-blue-100 to-blue-200 flex items-center justify-center shadow-md">
            <span className="text-3xl font-bold text-blue-700">{initials}</span>
          </div>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <h1 className="text-2xl font-bold text-gray-900">{fullName}</h1>
        {profile.title && (
          <p className="text-base text-gray-500 mt-0.5">{profile.title}</p>
        )}

        {allDepartments.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {allDepartments.map((dept, i) => (
              <span
                key={dept}
                className={`text-xs rounded-md px-2 py-1 ${
                  i === 0
                    ? 'bg-blue-100 text-blue-700 font-medium'
                    : 'bg-gray-100 text-gray-600'
                }`}
              >
                {dept}
              </span>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-4 mt-3 text-sm text-gray-600">
          {profile.email && (
            <a
              href={`mailto:${profile.email}`}
              className="flex items-center gap-1.5 text-blue-600 hover:text-blue-800 hover:underline"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="4" width="20" height="16" rx="2" />
                <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
              </svg>
              {profile.email}
            </a>
          )}
          {building && (
            <span className="flex items-center gap-1.5">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
                <circle cx="12" cy="10" r="3" />
              </svg>
              {building}
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-4 mt-3">
          {profile.ownListings && profile.ownListings.length > 0 && (
            <button
              onClick={() => onTabChange?.('listings')}
              className="text-xs px-2 py-1 rounded-full bg-blue-50 text-blue-700 font-medium hover:bg-blue-100 transition-colors cursor-pointer"
            >
              {profile.ownListings.length} listing{profile.ownListings.length !== 1 ? 's' : ''}
            </button>
          )}
          {profile.profile_urls &&
            Object.entries(profile.profile_urls)
              .filter(([key]) => key !== 'orcid')
              .map(([key, url]) => {
                const href = safeUrl(url);
                if (!href) return null;
                return (
                  <a
                    key={key}
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs px-2 py-1 rounded-full bg-gray-50 text-gray-600 font-medium hover:bg-gray-100 transition-colors capitalize"
                  >
                    {key.replace(/_/g, ' ')}
                  </a>
                );
              })}
        </div>
      </div>
    </div>
  );
};

export default ProfileHeader;

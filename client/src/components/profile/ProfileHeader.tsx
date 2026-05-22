/**
 * Profile header with name, department, contact, and metrics.
 */
import { FacultyProfile } from '../../types/types';
import { getUniqueDepartmentLabels } from '../../utils/departmentNames';
import { useConfig } from '../../hooks/useConfig';
import { safeUrl } from '../../utils/url';

interface ProfileHeaderProps {
  profile: FacultyProfile;
}

const orcidHref = (orcid: unknown, profileUrl: unknown): string => {
  const raw = typeof orcid === 'string' && orcid.trim() ? orcid : profileUrl;
  if (typeof raw !== 'string') return '';

  const trimmed = raw.trim();
  if (!trimmed) return '';

  const bareOrcid = trimmed.replace(/^https?:\/\/orcid\.org\//i, '');
  if (/^\d{4}-\d{4}-\d{4}-[\dX]{4}$/i.test(bareOrcid)) {
    return `https://orcid.org/${bareOrcid.toUpperCase()}`;
  }

  const href = safeUrl(trimmed);
  try {
    const parsed = new URL(href);
    return parsed.hostname === 'orcid.org' ? href : '';
  } catch {
    return '';
  }
};

const profileUrlLinks = (profileUrls: FacultyProfile['profile_urls'] | undefined) => {
  const seen = new Set<string>();
  return Object.entries(profileUrls || {}).flatMap(([key, url]) => {
    if (key === 'orcid') return [];
    const href = safeUrl(url);
    if (!href) return [];
    const dedupeKey = href.replace(/\/+$/, '').toLowerCase();
    if (seen.has(dedupeKey)) return [];
    seen.add(dedupeKey);
    return [{ key, href }];
  });
};

const ProfileHeader = ({ profile }: ProfileHeaderProps) => {
  const { departments } = useConfig();
  const fullName = `${profile.fname} ${profile.lname}`;
  const initials =
    `${profile.fname?.charAt(0) || ''}${profile.lname?.charAt(0) || ''}`.toUpperCase();
  const orcidProfileHref = orcidHref(profile.orcid, profile.profile_urls?.orcid);
  const websiteHref = safeUrl(profile.website);

  const building = profile.building_desk
    ? profile.building_desk.split(',')[0].trim()
    : profile.physical_location || '';

  const allDepartments = getUniqueDepartmentLabels([
    profile.primary_department,
    ...(profile.secondary_departments || []),
  ].filter((department): department is string => Boolean(department)), departments);
  const profileLinkClass =
    'yr-pill inline-flex min-h-[44px] items-center rounded-md px-3 text-xs font-medium transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200';

  return (
    <div className="yr-panel flex flex-col items-start gap-6 rounded-md p-4 md:flex-row md:p-6">
      <div className="flex-shrink-0">
        {profile.image_url ? (
          <img
            src={profile.image_url}
            alt={fullName}
            className="h-28 w-28 rounded-md object-cover object-top shadow-sm ring-1 ring-slate-200"
          />
        ) : (
          <div className="flex h-28 w-28 items-center justify-center rounded-md bg-[var(--yr-blue-soft)] shadow-sm ring-1 ring-blue-100">
            <span className="text-3xl font-semibold text-[var(--yr-blue)]">{initials}</span>
          </div>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <p className="yr-kicker mb-2">Faculty profile</p>
        <h1 className="text-2xl font-semibold text-slate-950">{fullName}</h1>
        {profile.title && <p className="mt-1 text-base text-slate-600">{profile.title}</p>}

        {allDepartments.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {allDepartments.map((dept, i) => (
              <span
                key={dept}
                className={`text-xs rounded-md px-2 py-1 ${
                  i === 0 ? 'yr-pill yr-pill-blue' : 'yr-pill'
                }`}
              >
                {dept}
              </span>
            ))}
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-gray-600">
          {profile.email && (
            <a
              href={`mailto:${profile.email}`}
              className="yr-link inline-flex min-h-[44px] items-center gap-1.5 rounded-md px-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="2" y="4" width="20" height="16" rx="2" />
                <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
              </svg>
              {profile.email}
            </a>
          )}
          {building && (
            <span className="inline-flex min-h-[44px] items-center gap-1.5">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
                <circle cx="12" cy="10" r="3" />
              </svg>
              {building}
            </span>
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {websiteHref && (
            <a
              href={websiteHref}
              target="_blank"
              rel="noopener noreferrer"
              className={profileLinkClass}
            >
              Website
            </a>
          )}
          {orcidProfileHref && (
            <a
              href={orcidProfileHref}
              target="_blank"
              rel="noopener noreferrer"
              className={profileLinkClass}
              aria-label={`${fullName} ORCID profile`}
            >
              ORCID
            </a>
          )}
          {profileUrlLinks(profile.profile_urls).map(({ key, href }) => (
            <a
              key={key}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className={`${profileLinkClass} capitalize`}
            >
              {key.replace(/_/g, ' ')}
            </a>
          ))}
        </div>
      </div>
    </div>
  );
};

export default ProfileHeader;

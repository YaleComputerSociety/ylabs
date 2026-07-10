/**
 * Profile header with name, department, contact, and metrics.
 */
import { FacultyProfile } from '../../types/types';
import { getUniqueDepartmentLabels } from '../../utils/departmentNames';
import { useConfig } from '../../hooks/useConfig';
import { EXTERNAL_IMAGE_REFERRER_POLICY, safeHttpUrl } from '../../utils/url';
import { trackResearchEvent } from '../../utils/researchAnalytics';

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

  const href = safeHttpUrl(trimmed);
  try {
    const parsed = new URL(href);
    return parsed.hostname === 'orcid.org' ? href : '';
  } catch {
    return '';
  }
};

const profileLinkDedupeKey = (href: string): string => href.replace(/\/+$/, '').toLowerCase();

const profileUrlLinks = (
  profileUrls: FacultyProfile['profile_urls'] | undefined,
  alreadyRenderedHrefs: string[] = [],
) => {
  const seen = new Set(alreadyRenderedHrefs.map(profileLinkDedupeKey));
  return Object.entries(profileUrls || {}).flatMap(([key, url]) => {
    if (key === 'orcid') return [];
    const href = safeHttpUrl(url);
    if (!href) return [];
    const dedupeKey = profileLinkDedupeKey(href);
    if (seen.has(dedupeKey)) return [];
    seen.add(dedupeKey);
    return [{ key, href }];
  });
};

const shouldHideBroadSchoolLabel = (label: string, labels: string[]): boolean => {
  if (labels.length <= 1) return false;
  return /\bschool of\b/i.test(label);
};

const ProfileHeader = ({ profile }: ProfileHeaderProps) => {
  const { departments } = useConfig();
  const fullName = `${profile.fname} ${profile.lname}`;
  const initials =
    `${profile.fname?.charAt(0) || ''}${profile.lname?.charAt(0) || ''}`.toUpperCase();
  const orcidProfileHref = orcidHref(profile.orcid, profile.profile_urls?.orcid);
  const websiteHref = safeHttpUrl(profile.website);
  const profileImageHref = safeHttpUrl(profile.image_url);

  const resolvedDepartments = getUniqueDepartmentLabels(
    [
      profile.primary_department,
      ...(profile.secondary_departments || []),
      ...(profile.departments || []),
    ].filter((department): department is string => Boolean(department)),
    departments,
    { preferDisplayName: true },
  );
  const allDepartments = resolvedDepartments.filter(
    (department) => !shouldHideBroadSchoolLabel(department, resolvedDepartments),
  );
  const profileLinkClass =
    'yr-pill inline-flex min-h-[44px] items-center rounded-md px-3 text-xs font-medium transition-colors hover:bg-[var(--yr-panel)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200';

  return (
    <div className="yr-panel flex flex-col items-start gap-6 rounded-md p-4 md:flex-row md:p-6">
      <div className="flex-shrink-0">
        {profileImageHref ? (
          <img
            src={profileImageHref}
            alt={fullName}
            referrerPolicy={EXTERNAL_IMAGE_REFERRER_POLICY}
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

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {websiteHref && (
            <a
              href={websiteHref}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() =>
                trackResearchEvent({
                  eventType: 'source_link_click',
                  entityType: 'profile',
                  entityId: profile.netid,
                  payload: { sourceCategory: 'profile', url: websiteHref },
                })
              }
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
              onClick={() =>
                trackResearchEvent({
                  eventType: 'source_link_click',
                  entityType: 'profile',
                  entityId: profile.netid,
                  payload: { sourceCategory: 'profile', url: orcidProfileHref },
                })
              }
              className={profileLinkClass}
              aria-label={`${fullName} ORCID profile`}
            >
              ORCID
            </a>
          )}
          {profileUrlLinks(profile.profile_urls, [websiteHref]).map(({ key, href }) => (
            <a
              key={key}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() =>
                trackResearchEvent({
                  eventType: 'source_link_click',
                  entityType: 'profile',
                  entityId: profile.netid,
                  payload: {
                    sourceCategory: key === 'website' ? 'profile' : 'external',
                    url: href,
                  },
                })
              }
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

/**
 * Hero header for a lab detail page: name, kind badge, school, location,
 * trust-gradient evidence pill, departments, research areas, website link.
 *
 * Pure presentational — takes a ResearchGroup, no fetching or context.
 *
 * The evidence pill replaces the legacy boolean-only "Accepting Undergrads"
 * pill with a trust gradient ("Strong evidence" / "Some evidence" /
 * "Evidence unknown" / "Not currently available"). The verdict is computed by the shared
 * `computeAcceptanceVerdict` helper so this surface stays consistent with the
 * browse cards and the inquire CTA.
 */
import { ResearchGroup, ResearchGroupKind } from '../../types/researchGroup';
import { getUniqueDepartmentLabels } from '../../utils/departmentNames';
import { formatTitleCaseLabel } from '../../utils/displayText';
import { useConfig } from '../../hooks/useConfig';
import { ensureHttpPrefix } from '../../utils/url';
import {
  computeAcceptanceVerdict,
  verdictBadgeStyles,
  verdictLabel,
} from '../../utils/undergradAcceptance';

interface LabHeaderProps {
  group: ResearchGroup;
  dedupeWebsiteUrls?: Array<string | undefined | null>;
  actions?: React.ReactNode;
  /**
   * Whether the research home has at least one active canonical posted
   * opportunity. Legacy listings are not counted here.
   */
  hasActivePostedOpportunity?: boolean;
}

const KIND_LABELS: Record<ResearchGroupKind, string> = {
  lab: 'Lab',
  center: 'Center',
  institute: 'Institute',
  program: 'Program',
  initiative: 'Initiative',
  group: 'Group',
  individual: 'Faculty Research',
  solo: 'Faculty Research',
};

const normalizeActionUrl = (url?: string | null): string => {
  const href = url ? ensureHttpPrefix(url) : '';
  if (!href) return '';

  try {
    const parsed = new URL(href);
    parsed.hash = '';
    parsed.search = '';
    parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/';
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return href.replace(/\/+$/, '');
  }
};

const LabHeader = ({
  group,
  dedupeWebsiteUrls = [],
  actions,
  hasActivePostedOpportunity = false,
}: LabHeaderProps) => {
  const { departments } = useConfig();
  const { verdict } = computeAcceptanceVerdict(group, hasActivePostedOpportunity);
  const verdictClasses = verdictBadgeStyles(verdict);
  const verdictText = verdictLabel(verdict);
  const websiteHref = group.websiteUrl ? ensureHttpPrefix(group.websiteUrl) : '';
  const websiteDedupeKey = normalizeActionUrl(websiteHref);
  const hideWebsiteHref =
    Boolean(websiteDedupeKey) &&
    dedupeWebsiteUrls.some((url) => normalizeActionUrl(url) === websiteDedupeKey);
  const departmentLabels = getUniqueDepartmentLabels(group.departments, departments);
  const departmentKeys = new Set(departmentLabels.map((dept) => dept.toLowerCase()));
  const researchAreaKeys = new Set((group.researchAreas || []).map((area) => area.toLowerCase()));
  const visibleProfileResearchAreas = (group.profileResearchAreas || []).filter((area) => {
    const key = area.toLowerCase();
    return !departmentKeys.has(key) && !researchAreaKeys.has(key);
  });
  const showProfileResearchAreas =
    visibleProfileResearchAreas.length > 0 && group.researchAreaSource !== 'PI_PROFILE_FALLBACK';
  const isFacultyResearchEntity =
    group.kind === 'individual' ||
    group.kind === 'solo' ||
    group.entityType === 'FACULTY_RESEARCH_AREA' ||
    group.entityType === 'INDIVIDUAL_RESEARCH';
  const kindLabel =
    group.descriptionSource === 'PI_PROFILE_SYNTHESIS' && isFacultyResearchEntity
      ? 'Faculty Research'
      : KIND_LABELS[group.kind] || 'Lab';

  return (
    <div className="yr-panel flex flex-col gap-4 rounded-md p-4 sm:p-6">
      <div className="flex flex-wrap items-center gap-2">
        <span className="yr-pill yr-pill-blue">
          {kindLabel}
        </span>
        <span
          className={`yr-pill ${verdictClasses}`}
          data-verdict={verdict}
        >
          {verdictText}
        </span>
        {group.school && (
          <span className="yr-pill">
            {group.school}
          </span>
        )}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="yr-kicker mb-2">Research profile</p>
          <h1 className="text-3xl font-semibold leading-tight text-slate-950">{group.name}</h1>
          {group.location && (
            <p className="mt-2 flex items-center gap-1.5 text-sm text-slate-600">
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
              {group.location}
            </p>
          )}
        </div>
        {actions && (
          <div className="w-full shrink-0 sm:w-auto">
            {actions}
          </div>
        )}
      </div>

      {departmentLabels.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {departmentLabels.map((dept, i) => (
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

      {showProfileResearchAreas && (
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-gray-500">
            PI research interests
          </p>
          <div className="flex flex-wrap gap-1.5">
            {visibleProfileResearchAreas.map((area) => (
              <span
                key={area}
            className="yr-pill rounded-md"
              >
                {formatTitleCaseLabel(area)}
              </span>
            ))}
          </div>
        </div>
      )}

      {websiteHref && !hideWebsiteHref && (
        <a
          href={websiteHref}
          target="_blank"
          rel="noopener noreferrer"
          className="yr-link inline-flex min-h-[44px] w-fit items-center gap-1.5 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
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
            <circle cx="12" cy="12" r="10" />
            <line x1="2" y1="12" x2="22" y2="12" />
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
          </svg>
          Visit lab website
        </a>
      )}
    </div>
  );
};

export default LabHeader;

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
import { ensureHttpPrefix } from '../../utils/url';
import {
  computeAcceptanceVerdict,
  verdictBadgeStyles,
  verdictLabel,
} from '../../utils/undergradAcceptance';

interface LabHeaderProps {
  group: ResearchGroup;
  /**
   * Whether the lab has at least one non-archived listing. The detail page
   * fetches listings as part of the payload and threads this through.
   * Defaults to false on browse-card surfaces that don't have it yet.
   */
  hasActiveListing?: boolean;
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

const LabHeader = ({ group, hasActiveListing = false }: LabHeaderProps) => {
  const { verdict } = computeAcceptanceVerdict(group, hasActiveListing);
  const verdictClasses = verdictBadgeStyles(verdict);
  const verdictText = verdictLabel(verdict);
  const websiteHref = group.websiteUrl ? ensureHttpPrefix(group.websiteUrl) : '';

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 font-medium uppercase tracking-wider">
          {KIND_LABELS[group.kind] || 'Lab'}
        </span>
        <span
          className={`text-xs px-2 py-0.5 rounded-full font-medium ${verdictClasses}`}
          data-verdict={verdict}
        >
          {verdictText}
        </span>
        {group.school && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
            {group.school}
          </span>
        )}
      </div>

      <div>
        <h1 className="text-3xl font-bold text-gray-900 leading-tight">{group.name}</h1>
        {group.location && (
          <p className="text-sm text-gray-500 mt-1 flex items-center gap-1.5">
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

      {group.departments && group.departments.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {group.departments.map((dept, i) => (
            <span
              key={dept}
              className={`text-xs rounded-md px-2 py-1 ${
                i === 0 ? 'bg-blue-100 text-blue-700 font-medium' : 'bg-gray-100 text-gray-600'
              }`}
            >
              {dept}
            </span>
          ))}
        </div>
      )}

      {group.researchAreas && group.researchAreas.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {group.researchAreas.map((area) => (
            <span
              key={area}
              className="bg-purple-50 text-purple-700 text-xs rounded-md px-2 py-1"
            >
              {area}
            </span>
          ))}
        </div>
      )}

      {websiteHref && (
        <a
          href={websiteHref}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-800 hover:underline w-fit"
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
          Visit website
        </a>
      )}

      {group.description && (
        <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap mt-2">
          {group.description}
        </p>
      )}
    </div>
  );
};

export default LabHeader;

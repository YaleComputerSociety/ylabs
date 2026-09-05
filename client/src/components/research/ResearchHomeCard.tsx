import { Link, useNavigate } from 'react-router-dom';
import { memo, type MouseEvent } from 'react';

import {
  buildWayInBadges,
  buildResearchHomeContextLine,
  type ResearchCluster,
} from '../../utils/researchDiscoveryAdapters';
import { formatTitleCaseLabel } from '../../utils/displayText';
import { sanitizeResearchEntityCopy } from '../../utils/researchEntityCopy';
import { EXTERNAL_LINK_REL, safeHttpUrl, safeRouteSegment } from '../../utils/url';
import { principalInvestigatorLinkFromResearchEntity } from '../../utils/principalInvestigatorLinks';

interface ResearchHomeCardProps {
  home: ResearchCluster;
  onSelect?: (label: string) => void;
  onPreview?: (home: ResearchCluster) => void;
  onOpen?: (home: ResearchCluster) => void;
  variant?: 'default' | 'compact';
  showAdminQuality?: boolean;
}

const countLabel = (count: number, singular: string, plural: string): string =>
  `${count} ${count === 1 ? singular : plural}`;

const isInteractiveElement = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && Boolean(target.closest('a, button'));

const titleCaseContactRole = (role?: string): string => {
  const trimmed = (role || '').trim();
  if (!trimmed) return 'Principal investigator';
  return formatTitleCaseLabel(trimmed);
};

const ACCESS_SIGNAL_LABELS: Record<string, string> = {
  'Undergrad evidence': 'Has hosted undergraduate researchers',
  'Student project evidence': 'Supervises student projects',
  'Contact route': 'Open to inquiries',
};

const ACCESS_SIGNAL_PRIORITY = ['Undergrad evidence', 'Student project evidence', 'Contact route'];

const ELEVATED_ACCESS_SIGNALS = new Set(['Undergrad evidence', 'Student project evidence']);

const accessSignalLabel = (label: string): string => ACCESS_SIGNAL_LABELS[label] ?? label;

const accessSignalRank = (label: string): number => {
  const index = ACCESS_SIGNAL_PRIORITY.indexOf(label);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
};

const orderAccessSignals = (badges: string[]): string[] =>
  [...badges].sort((a, b) => accessSignalRank(a) - accessSignalRank(b));

const adminQualityLabels = (home: ResearchCluster): string[] => {
  const flags = new Set(
    home.entities.flatMap((entity) => entity.qualitySummary?.repairFlags || []),
  );
  const labels: string[] = [];

  if (flags.has('missing_description') || flags.has('thin_description')) {
    labels.push('Needs description');
  }
  if (flags.has('profile_fallback_only')) labels.push('Profile fallback');
  if (flags.has('missing_lead')) labels.push('Missing lead');
  if (flags.has('missing_source_url')) labels.push('Missing source');
  if (flags.has('duplicate_risk')) labels.push('Duplicate review');

  return labels;
};

const ResearchHomeCard = ({
  home,
  onSelect,
  onPreview,
  onOpen,
  variant = 'default',
  showAdminQuality = false,
}: ResearchHomeCardProps) => {
  const navigate = useNavigate();
  const isCompact = variant === 'compact';
  const homeEntities = home.entities.slice(0, 3).map((entity) => ({
    id: entity._id || entity.slug,
    slug: entity.slug,
    label: entity.displayName || entity.name || 'Untitled research profile',
  }));
  const primaryLinkedEntity = homeEntities.find((entity) => Boolean(entity.slug));
  const singleLinkedEntity =
    home.entities.length === 1 && primaryLinkedEntity && homeEntities.length === 1
      ? primaryLinkedEntity
      : null;
  const wayInBadges = home.wayInBadges?.length
    ? home.wayInBadges
    : buildWayInBadges(home.entities[0], home.pathways || []);
  const orderedAccessSignals = orderAccessSignals(wayInBadges);
  const leadAccessSignal = orderedAccessSignals.find((signal) =>
    ELEVATED_ACCESS_SIGNALS.has(signal),
  );
  const secondaryAccessSignals = orderedAccessSignals.filter(
    (signal) => signal !== leadAccessSignal,
  );
  const contextLine = home.contextLine || buildResearchHomeContextLine(home.entities[0]);
  const contextLineKeys = new Set(
    contextLine
      .split('·')
      .map((part) => part.trim().toLowerCase())
      .filter(Boolean),
  );
  const isInContextLine = (label: string): boolean =>
    contextLineKeys.has(label.trim().toLowerCase());
  const metadataBadges = Array.from(new Set(home.metadataTags)).filter(
    (label) => !isInContextLine(label),
  );
  const metadataBadgeKeys = new Set(metadataBadges.map((label) => label.toLowerCase()));
  const topicBadges = Array.from(
    new Set(
      home.labels.filter(
        (label) => !metadataBadgeKeys.has(label.toLowerCase()) && !isInContextLine(label),
      ),
    ),
  );
  const mobileTopicCap = isCompact ? 2 : 3;
  const desktopTopicCap = isCompact ? 3 : 5;
  const alwaysVisibleTopicBadges = topicBadges.slice(0, mobileTopicCap);
  const desktopOnlyTopicBadges = isCompact
    ? []
    : topicBadges.slice(mobileTopicCap, desktopTopicCap);
  const mobileMoreCount = topicBadges.length - mobileTopicCap;
  const desktopMoreCount = topicBadges.length - desktopTopicCap;
  const description = sanitizeResearchEntityCopy(home.description, home.entities[0]);
  const primaryProfileUrl = primaryLinkedEntity
    ? `/research/${safeRouteSegment(primaryLinkedEntity.slug)}`
    : '';
  const isCardClickable = Boolean(primaryProfileUrl || onSelect);
  const primaryEvidenceUrl = safeHttpUrl(home.evidence[0]?.url);
  const showEvidenceFooter = !isCompact && Boolean(primaryEvidenceUrl);
  const leadEntity = home.entities.find((entity) => (entity.contactName || '').trim());
  const leadName = leadEntity?.contactName?.trim();
  const leadProfileLink = principalInvestigatorLinkFromResearchEntity(leadEntity);
  const leadRole = titleCaseContactRole(leadEntity?.contactRole);
  const qualityLabels = showAdminQuality ? adminQualityLabels(home) : [];
  const activateCard = () => {
    if (primaryProfileUrl) {
      onOpen?.(home);
      navigate(primaryProfileUrl);
      return;
    }

    onSelect?.(home.label);
  };
  const activateCardFromClick = (event: MouseEvent<HTMLElement>) => {
    if (!isCardClickable || isInteractiveElement(event.target)) return;
    activateCard();
  };

  return (
    <article
      className={`yr-card-interactive yr-fade-in flex h-full flex-col rounded-md ${
        isCompact ? 'p-3 sm:p-4' : 'p-4'
      } ${isCardClickable ? 'cursor-pointer' : ''}`}
      onClick={activateCardFromClick}
      onFocus={() => onPreview?.(home)}
      onMouseEnter={() => onPreview?.(home)}
    >
      <div className="flex flex-col gap-2">
        <div className="flex items-start justify-between gap-3">
          <h3
            className={`${isCompact ? 'text-base' : 'text-lg'} min-w-0 font-semibold leading-tight text-gray-950`}
          >
            {singleLinkedEntity ? (
              <Link
                to={`/research/${safeRouteSegment(singleLinkedEntity.slug)}`}
                className="yr-link yr-focus-ring rounded-sm"
                onClick={(event) => {
                  event.stopPropagation();
                  onOpen?.(home);
                }}
              >
                {home.label}
              </Link>
            ) : (
              home.label
            )}
          </h3>
        </div>

        {contextLine && (
          <p className="text-xs font-medium leading-relaxed text-gray-500">{contextLine}</p>
        )}

        {leadName && (
          <p className="text-xs font-medium leading-relaxed text-gray-600">
            {leadRole}:{' '}
            {leadProfileLink?.external ? (
              <a
                href={leadProfileLink.href}
                target="_blank"
                rel={EXTERNAL_LINK_REL}
                className="yr-link yr-focus-ring rounded-sm"
                onClick={(event) => event.stopPropagation()}
              >
                {leadName}
              </a>
            ) : leadProfileLink ? (
              <Link
                to={leadProfileLink.href}
                className="yr-link yr-focus-ring rounded-sm"
                onClick={(event) => event.stopPropagation()}
              >
                {leadName}
              </Link>
            ) : (
              <span>{leadName}</span>
            )}
          </p>
        )}

        {qualityLabels.length > 0 && (
          <div className="flex flex-wrap gap-1.5" aria-label="Admin quality flags">
            {qualityLabels.map((label) => (
              <span
                key={label}
                className="rounded border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-900"
              >
                {label}
              </span>
            ))}
          </div>
        )}

        <div className="flex flex-wrap gap-1.5">
          {metadataBadges.map((label) => (
            <span key={label} className="yr-pill yr-pill-blue min-h-0 rounded px-2 py-0.5">
              {formatTitleCaseLabel(label)}
            </span>
          ))}
          {alwaysVisibleTopicBadges.map((label) => (
            <span key={label} className="yr-pill yr-pill-blue min-h-0 rounded px-2 py-0.5">
              {formatTitleCaseLabel(label)}
            </span>
          ))}
          {desktopOnlyTopicBadges.map((label) => (
            <span
              key={label}
              className="yr-pill yr-pill-blue hidden min-h-0 rounded px-2 py-0.5 sm:inline-flex"
            >
              {formatTitleCaseLabel(label)}
            </span>
          ))}
          {mobileMoreCount > 0 && (
            <span className="yr-pill min-h-0 rounded px-2 py-0.5 sm:hidden">
              +{mobileMoreCount} more
            </span>
          )}
          {desktopMoreCount > 0 && !isCompact && (
            <span className="yr-pill hidden min-h-0 rounded px-2 py-0.5 sm:inline-flex">
              +{desktopMoreCount} more
            </span>
          )}
          {home.contextState === 'sparse' && home.contextLabel && (
            <span className="yr-pill yr-pill-gold min-h-0 rounded px-2 py-0.5">
              {home.contextLabel}
            </span>
          )}
        </div>

        <p className={`${isCompact ? 'line-clamp-4' : ''} text-sm leading-relaxed text-gray-600`}>
          {description}
        </p>
      </div>

      {!isCompact && (
        <div className="mt-3 flex flex-wrap gap-2 text-xs text-gray-600">
          {home.entityCount > 1 && (
            <span className="yr-pill min-h-0 rounded px-2 py-1">
              {countLabel(home.entityCount, 'research home', 'research homes')}
            </span>
          )}
          {home.peopleCount > 1 && (
            <span className="yr-pill min-h-0 rounded px-2 py-1">
              {countLabel(home.peopleCount, 'contact', 'contacts')}
            </span>
          )}
          {home.pathwayCount > 1 && (
            <span className="yr-pill min-h-0 rounded px-2 py-1">
              {countLabel(home.pathwayCount, 'next step', 'next steps')}
            </span>
          )}
        </div>
      )}

      {orderedAccessSignals.length > 0 && (
        <div
          className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5"
          aria-label="Ways to get involved"
        >
          {leadAccessSignal && (
            <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--yr-green)]">
              <svg
                viewBox="0 0 20 20"
                fill="currentColor"
                className="h-4 w-4 shrink-0"
                aria-hidden="true"
              >
                <path
                  fillRule="evenodd"
                  d="M16.704 5.29a1 1 0 010 1.42l-7.5 7.5a1 1 0 01-1.42 0l-3.5-3.5a1 1 0 011.42-1.42l2.79 2.8 6.79-6.8a1 1 0 011.42 0z"
                  clipRule="evenodd"
                />
              </svg>
              {accessSignalLabel(leadAccessSignal)}
            </span>
          )}
          {secondaryAccessSignals.slice(0, isCompact ? 2 : undefined).map((badge) => (
            <span key={badge} className="yr-pill yr-pill-green min-h-0 rounded px-2 py-0.5">
              {accessSignalLabel(badge)}
            </span>
          ))}
        </div>
      )}

      {home.entities.length > 0 && !singleLinkedEntity && !isCompact && (
        <div className="mt-4 border-t border-[var(--yr-line)] pt-3">
          <p className="yr-kicker mb-2 text-[0.68rem]">Research homes</p>
          <div className="flex flex-col gap-1">
            {homeEntities.map((entity) => {
              if (!entity.slug) {
                return (
                  <span
                    key={entity.id || entity.label}
                    className="text-sm text-gray-700"
                    title="Research profile link is not available yet."
                  >
                    {entity.label}
                  </span>
                );
              }

              return (
                <Link
                  key={entity.slug}
                  to={`/research/${safeRouteSegment(entity.slug)}`}
                  className="yr-focus-ring yr-link inline-flex min-h-[44px] items-center text-sm font-medium"
                  onClick={(event) => event.stopPropagation()}
                >
                  {entity.label}
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {showEvidenceFooter && (
        <div className="mt-4 border-t border-[var(--yr-line)] pt-3">
          <p className="yr-kicker mb-2 text-[0.68rem]">Evidence</p>
          <div className="flex flex-wrap items-center gap-2 text-sm text-gray-600">
            {primaryEvidenceUrl && (
              <a
                href={primaryEvidenceUrl}
                target="_blank"
                rel={EXTERNAL_LINK_REL}
                className="yr-focus-ring yr-link inline-flex min-h-[44px] items-center text-xs font-semibold"
                onClick={(event) => event.stopPropagation()}
              >
                Open source
              </a>
            )}
          </div>
        </div>
      )}

      {primaryLinkedEntity ? (
        <div className="mt-auto flex flex-wrap gap-2 pt-4">
          <Link
            to={`/research/${safeRouteSegment(primaryLinkedEntity.slug)}`}
            className={`yr-focus-ring inline-flex min-h-[44px] items-center rounded-md px-3 py-2 text-sm font-semibold transition active:scale-[0.98] ${
              isCompact
                ? 'border border-[var(--yr-blue)] bg-[var(--yr-blue)] text-white hover:bg-brand-navy'
                : 'border border-[var(--yr-line)] bg-[var(--yr-panel)] text-[var(--yr-blue)] hover:border-[var(--yr-line-strong)] hover:bg-[var(--yr-blue-soft)]'
            }`}
            onClick={(event) => event.stopPropagation()}
          >
            View profile →
          </Link>
        </div>
      ) : !primaryLinkedEntity && onSelect ? (
        <div className="mt-auto pt-4">
          <button
            type="button"
            onClick={() => onSelect(home.label)}
            className="yr-focus-ring inline-flex min-h-[44px] items-center rounded-md border border-[var(--yr-line)] bg-[var(--yr-panel)] px-3 py-2 text-sm font-semibold text-[var(--yr-blue)] transition active:scale-[0.98] hover:border-[var(--yr-line-strong)] hover:bg-[var(--yr-blue-soft)]"
          >
            Search this area
          </button>
        </div>
      ) : null}
    </article>
  );
};

export default memo(ResearchHomeCard);

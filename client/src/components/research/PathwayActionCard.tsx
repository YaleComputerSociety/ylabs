import { Link } from 'react-router-dom';

import EvidenceSourceRow from './EvidenceSourceRow';
import type { PathwaySearchHit } from '../../types/pathway';
import {
  buildPathwayEvidenceRows,
  getEvidenceStrengthLabel,
  getPathwayActionLabel,
  getPathwayTypeLabel,
} from '../../utils/researchDiscoveryAdapters';
import { EXTERNAL_LINK_REL, safeHttpUrl, safeRouteSegment } from '../../utils/url';

interface PathwayActionCardProps {
  pathway: PathwaySearchHit;
}

const formatDate = (value?: string): string => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
};

const directoryFirstPathwayLabel = (label: string): string => {
  if (label === 'Plan targeted outreach') return 'Review source context';
  if (label === 'Contact program') return 'Review source route';
  return label;
};

const directoryFirstNextStep = (label: string): string =>
  label
    .replace(
      'Contact the program with a specific question.',
      'Review the program source and note any specific questions.',
    )
    .replace(/outreach note/gi, 'planning note')
    .replace(/targeted outreach/gi, 'source review');

const PathwayActionCard = ({ pathway }: PathwayActionCardProps) => {
  const researchEntity = pathway.researchEntity;
  const researchEntityLabel =
    researchEntity?.displayName || researchEntity?.name || 'Research profile';
  const researchEntityLink = researchEntity?.slug
    ? `/research/${safeRouteSegment(researchEntity.slug)}`
    : '/research';
  const actionLabel = directoryFirstPathwayLabel(
    getPathwayActionLabel(pathway.bestNextStepCategory),
  );
  const nextStep = directoryFirstNextStep(
    pathway.bestNextStep || pathway.studentFacingLabel || actionLabel,
  );
  const opportunityDeadline = formatDate(pathway.activePostedOpportunity?.deadline);
  const applicationUrl = safeHttpUrl(pathway.activePostedOpportunity?.applicationUrl);

  return (
    <article className="rounded-md border border-gray-200 bg-white p-4">
      <div className="mb-3 flex flex-wrap gap-1.5">
        <span className="rounded bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700">
          {actionLabel}
        </span>
        <span className="rounded bg-gray-100 px-2 py-1 text-xs font-semibold text-gray-700">
          {getPathwayTypeLabel(pathway.pathwayType)}
        </span>
        {pathway.evidenceStrength && (
          <span className="rounded bg-gray-100 px-2 py-1 text-xs font-semibold text-gray-700">
            {getEvidenceStrengthLabel(pathway.evidenceStrength)}
          </span>
        )}
      </div>

      <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
        Best next step
      </p>
      <h3 className="mt-1 text-base font-semibold leading-snug text-gray-950">{nextStep}</h3>

      <Link
        to={researchEntityLink}
        className="mt-3 inline-flex min-h-[44px] items-center text-sm font-semibold text-blue-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
      >
        {researchEntityLabel}
      </Link>

      {(pathway.activePostedOpportunity?.title || opportunityDeadline) && (
        <p className="mt-1 text-xs leading-relaxed text-gray-500">
          {[
            pathway.activePostedOpportunity?.title,
            opportunityDeadline && `Deadline ${opportunityDeadline}`,
          ]
            .filter(Boolean)
            .join(' | ')}
        </p>
      )}

      {applicationUrl && (
        <a
          href={applicationUrl}
          target="_blank"
          rel={EXTERNAL_LINK_REL}
          className="mt-3 inline-flex min-h-[44px] items-center rounded-md bg-blue-700 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
        >
          Open application
        </a>
      )}

      <div className="mt-3">
        <EvidenceSourceRow evidence={buildPathwayEvidenceRows(pathway)} compact />
      </div>
    </article>
  );
};

export default PathwayActionCard;

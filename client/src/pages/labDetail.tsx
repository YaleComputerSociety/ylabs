/**
 * Research detail page rendered at `/research/:slug`.
 *
 * Smart-component responsibilities:
 *   - Resolve the slug from the URL and fetch the detail payload from
 *     `GET /api/research/:slug` via the labDetailReducer.
 *   - Compose the small presentational components in `components/labs/`.
 *   - Own the "Inquire" modal toggle (delegated to the reducer so the
 *     transitions are pure and testable).
 *
 * No business logic lives in the layout components themselves — they take
 * props and render. This keeps the page consistent with the
 * `pages/profile.tsx` pattern.
 */
import { useEffect, useReducer, useRef, useState } from 'react';
import { isCancel } from 'axios';
import { Link, useParams } from 'react-router-dom';
import axios from '../utils/axios';
import {
  createInitialLabDetailState,
  labDetailReducer,
} from '../reducers/labDetailReducer';
import LabHeader from '../components/labs/LabHeader';
import LabMembersList from '../components/labs/LabMembersList';
import LabPapersList from '../components/labs/LabPapersList';
import LabInquireCard from '../components/labs/LabInquireCard';
import LabInquireModal from '../components/labs/LabInquireModal';
import LongText from '../components/shared/LongText';
import FirstSaveCallout from '../components/shared/FirstSaveCallout';
import FavoriteButton from '../components/shared/FavoriteButton';
import useFavorites from '../hooks/useFavorites';
import useDocumentTitle from '../hooks/useDocumentTitle';
import {
  LabAccessSignal,
  LabContactRoute,
  LabEntityRelationship,
  LabEntryPathway,
  LabMember,
  LabPostedOpportunity,
  LabResearchActivityLink,
} from '../types/labDetail';
import type { ResearchEntity, ResearchEntityRepairFlag } from '../types/researchEntity';
import { normalizeResearchEntityDetailPayload } from '../types/researchEntity';
import {
  buildResearchDetailSources,
  normalizeSourceUrl,
  ResearchDetailSource,
} from '../utils/researchDetailSources';
import { formatTitleCaseLabel } from '../utils/displayText';
import {
  getEvidenceSignalLabel,
  getEvidenceStrengthLabel,
} from '../utils/researchDiscoveryAdapters';
import { computeAcceptanceVerdict, verdictLabel } from '../utils/undergradAcceptance';

const FIRST_RESEARCH_PLAN_SAVE_KEY = 'yale-research.firstResearchPlanSave.v1';

const SectionHeading = ({ children }: { children: React.ReactNode }) => (
  <h2 className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-3">
    {children}
  </h2>
);

const formatEntityKindTag = (kind?: string | null): string | undefined =>
  kind ? formatTitleCaseLabel(kind.replace(/[_-]+/g, ' ')) : undefined;

const RelatedResearchEntitiesSection = ({
  relationships,
  relatedResearchEntities,
}: {
  relationships: LabEntityRelationship[];
  relatedResearchEntities: ResearchEntity[];
}) => {
  const relationshipByTargetId = new Map(
    relationships.map((relationship) => [relationship.targetResearchEntityId, relationship]),
  );

  return (
    <section>
      <SectionHeading>Related labs and groups</SectionHeading>
      <div className="grid gap-3 sm:grid-cols-2">
        {relatedResearchEntities.map((entity) => {
          const relationship = relationshipByTargetId.get(entity.id || entity._id);
          const description =
            entity.shortDescription || entity.fullDescription || entity.description || '';
          const tags = uniqueCompact(
            [relationship?.label, formatEntityKindTag(entity.kind), ...(entity.departments || [])],
            3,
          );
          return (
            <Link
              key={entity.id || entity._id || entity.slug}
              to={`/research/${entity.slug}`}
              className="block rounded-lg border border-[var(--yr-line)] bg-[var(--yr-panel)] p-4 transition hover:border-blue-300 hover:shadow-sm"
            >
              <div className="flex flex-wrap gap-2">
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full bg-[var(--yr-blue-soft)] px-2 py-1 text-xs font-medium text-blue-700"
                  >
                    {tag}
                  </span>
                ))}
              </div>
              <h3 className="mt-3 text-sm font-semibold text-gray-900">{entity.name}</h3>
              {description && (
                <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-gray-600">
                  {description}
                </p>
              )}
            </Link>
          );
        })}
      </div>
    </section>
  );
};

const AffiliatedResearchEntitiesSection = ({
  affiliatedResearchEntities,
}: {
  affiliatedResearchEntities: ResearchEntity[];
}) => (
  <section>
    <SectionHeading>Affiliated with</SectionHeading>
    <div className="grid gap-3 sm:grid-cols-2">
      {affiliatedResearchEntities.map((entity) => (
        <Link
          key={entity.id || entity._id || entity.slug}
          to={`/research/${entity.slug}`}
          className="block rounded-lg border border-[var(--yr-line)] bg-[var(--yr-panel)] p-4 transition hover:border-blue-300 hover:shadow-sm"
        >
          <div className="flex flex-wrap gap-2">
            {uniqueCompact([formatEntityKindTag(entity.kind), ...(entity.departments || [])], 3).map(
              (tag) => (
                <span
                  key={tag}
                  className="rounded-full bg-[var(--yr-panel-muted)] px-2 py-1 text-xs font-medium text-gray-700"
                >
                  {tag}
                </span>
              ),
            )}
          </div>
          <h3 className="mt-3 text-sm font-semibold text-gray-900">{entity.name}</h3>
        </Link>
      ))}
    </div>
  </section>
);

const sourceHost = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

const uniqueCompact = (values: Array<string | undefined | null>, limit = 6): string[] =>
  Array.from(new Set(values.map((value) => (value || '').trim()).filter(Boolean))).slice(0, limit);

const BulletList = ({ items }: { items: string[] }) => (
  <ul className="space-y-1.5 text-sm leading-relaxed text-gray-700">
    {items.map((item) => (
      <li key={item} className="flex gap-2">
        <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500" aria-hidden="true" />
        <span>{item}</span>
      </li>
    ))}
  </ul>
);

const detailDescription = (group: any): string =>
  (group.fullDescription || group.shortDescription || group.description || '')
    .replace(/[ \t\f\v]+/g, ' ')
    .trim();

const hasProfileSynthesisDescription = (group: any): boolean =>
  group.descriptionSource === 'PI_PROFILE_SYNTHESIS' &&
  Boolean((group.profileSynthesisDescription || '').trim());

const isProfileLikeWebsiteUrl = (url?: string): boolean =>
  /(?:^|[/-])(?:profile|profiles|people|faculty)(?:[/-]|$)/i.test(url || '');

const isFacultyResearchFallback = (group: any): boolean => {
  const hasOnlyProfileWebsite =
    (!group.websiteUrl || isProfileLikeWebsiteUrl(group.websiteUrl)) &&
    (!group.website || isProfileLikeWebsiteUrl(group.website));

  return (
    group.descriptionSource === 'PI_PROFILE_SYNTHESIS' &&
    (hasOnlyProfileWebsite ||
      ['individual', 'solo'].includes(group.kind || '') ||
      ['FACULTY_RESEARCH_AREA', 'INDIVIDUAL_RESEARCH'].includes(group.entityType || ''))
  );
};

const isFacultyResearchEntity = (group: any): boolean =>
  group.kind === 'individual' ||
  group.kind === 'solo' ||
  group.entityType === 'FACULTY_RESEARCH_AREA' ||
  group.entityType === 'INDIVIDUAL_RESEARCH';

const isGenericTopic = (value: string): boolean =>
  /^(yale\s+)?school of\b/i.test(value) ||
  /^yale school\b/i.test(value) ||
  /^yale faculty\b/i.test(value);

const detailTopics = (group: any, limit = 6): string[] =>
  uniqueCompact(
    [
      ...(group.researchAreas || []),
    ],
    limit * 2,
  )
    .filter((value) => !isGenericTopic(value))
    .slice(0, limit);

const decisionNextStep = ({
  pathways,
  contactRoutes,
}: {
  pathways: LabEntryPathway[];
  contactRoutes: LabContactRoute[];
}): string => {
  const pathwayStep = pathways.find((item) => item.bestNextStep)?.bestNextStep;
  if (pathwayStep) return pathwayStep;
  const route = contactRoutes[0];
  if (route?.routeType === 'OFFICIAL_APPLICATION') {
    return 'Use the official application route, then verify timing and eligibility on the source page.';
  }
  if (route) {
    return 'Review the official profile first, then decide whether targeted outreach is appropriate.';
  }
  return 'Review the official profile first, then decide whether targeted outreach is appropriate.';
};

const reachOutStatus = ({
  postedOpportunities,
  pathways,
  contactRoutes,
}: {
  postedOpportunities: LabPostedOpportunity[];
  pathways: LabEntryPathway[];
  contactRoutes: LabContactRoute[];
}): string => {
  if (postedOpportunities.length > 0) return 'Posted route available';
  if (pathways.length > 0 || contactRoutes.length > 0) return 'Reach-out possible, verify first';
  return 'Verify before reaching out';
};

const ResearchPlanSaveButton = ({
  isSaved,
  onToggle,
}: {
  isSaved: boolean;
  onToggle: (e: React.MouseEvent) => void;
}) => (
  <FavoriteButton
    isFavorite={isSaved}
    onToggle={onToggle}
    size={20}
    ariaLabel={isSaved ? 'Saved to Dashboard' : 'Save research plan'}
    title={isSaved ? 'Saved to Dashboard' : 'Save research plan'}
    className="flex w-full items-start gap-3 rounded-md border border-[var(--yr-line)] bg-[var(--yr-panel)] px-3 py-2 text-left transition-colors hover:border-blue-200 hover:bg-[var(--yr-blue-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200 sm:w-auto sm:min-w-[13rem]"
    iconClassName="mt-0.5 shrink-0"
  >
    <span className="min-w-0 flex-1">
      <span className="block text-sm font-semibold text-gray-900">
        {isSaved ? 'Saved to Dashboard' : 'Save research plan'}
      </span>
      <span className="mt-0.5 block text-xs leading-relaxed text-gray-600">
        Track notes and funding matches
      </span>
    </span>
  </FavoriteButton>
);

const resolveDecisionProfileUrl = (
  fallbackSourceUrl: string | undefined,
  contactRoutes: LabContactRoute[],
): string | undefined => {
  const facultyProfileRoute = contactRoutes.find(
    (route) => route.routeType === 'FACULTY_PI' && Boolean(route.url),
  );

  if (facultyProfileRoute?.url) return facultyProfileRoute.url;
  if (fallbackSourceUrl && isProfileLikeWebsiteUrl(fallbackSourceUrl)) return fallbackSourceUrl;
  return undefined;
};

const normalizeActionDestination = (url?: string | null): string | null => {
  const normalized = normalizeSourceUrl(url);
  if (!normalized) return null;

  try {
    const parsed = new URL(normalized);
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
    const path = parsed.pathname.replace(/\/+$/, '') || '/';
    return `${host}${path}`;
  } catch {
    return normalized
      .replace(/^https?:\/\//i, '')
      .replace(/^www\./i, '')
      .replace(/\/+$/, '')
      .toLowerCase();
  }
};

const resolveDecisionOfficialRoute = (
  profileUrl: string | undefined,
  contactRoutes: LabContactRoute[],
  group?: any,
): LabContactRoute | undefined => {
  const normalizedProfileUrl = normalizeActionDestination(profileUrl);
  const labWebsiteDestinations = new Set(
    [group?.websiteUrl, group?.website]
      .map((url) => normalizeActionDestination(url))
      .filter(Boolean),
  );

  return contactRoutes.find((item) => {
    const normalizedRouteUrl = normalizeActionDestination(item.url);
    return (
      normalizedRouteUrl &&
      normalizedRouteUrl !== normalizedProfileUrl &&
      !labWebsiteDestinations.has(normalizedRouteUrl) &&
      item.routeType !== 'FACULTY_PI'
    );
  });
};

const memberDisplayName = (member: LabMember): string =>
  member.user.displayName ||
  [member.user.fname, member.user.lname].filter(Boolean).join(' ') ||
  'Lead professor';

const memberId = (member: LabMember): string => String(member.user._id || '');

const adminQualityNotes = (flags: ResearchEntityRepairFlag[] = []): string[] => {
  const flagSet = new Set(flags);
  const notes: string[] = [];

  if (flagSet.has('missing_description')) {
    notes.push('Missing public research description.');
  } else if (flagSet.has('thin_description')) {
    notes.push('Thin public research description.');
  }
  if (flagSet.has('profile_fallback_only')) {
    notes.push('Only profile-derived context is available.');
  }
  if (flagSet.has('missing_lead')) {
    notes.push('No lead professor is attached to this research profile.');
  }
  if (flagSet.has('missing_source_url')) {
    notes.push('No official source URL is attached.');
  }

  return notes;
};

const DecisionSummary = ({
  group,
  pathways,
  contactRoutes,
  postedOpportunities,
  fallbackSourceUrl,
  hasActivePostedOpportunity,
  leadProfessor,
}: {
  group: any;
  pathways: LabEntryPathway[];
  contactRoutes: LabContactRoute[];
  postedOpportunities: LabPostedOpportunity[];
  fallbackSourceUrl?: string;
  hasActivePostedOpportunity: boolean;
  leadProfessor?: LabMember;
}) => {
  const topics = detailTopics(group, 5);
  const usesProfileSynthesis = hasProfileSynthesisDescription(group) && !detailDescription(group);
  const usesFacultyResearchWording =
    isFacultyResearchEntity(group) || (usesProfileSynthesis && isFacultyResearchFallback(group));
  const sourceBackedDescription = detailDescription(group);
  const description =
    (usesProfileSynthesis ? group.profileSynthesisDescription : '') ||
    sourceBackedDescription ||
    (topics.length > 0
      ? `Research connected to ${topics.slice(0, 3).join(', ')}.`
      : 'A Yale research profile with limited public description.');
  const { verdict } = computeAcceptanceVerdict(group, hasActivePostedOpportunity);
  const evidenceLevel = verdictLabel(verdict);
  const profileUrl = resolveDecisionProfileUrl(fallbackSourceUrl, contactRoutes);
  const officialRoute = resolveDecisionOfficialRoute(profileUrl, contactRoutes, group);
  const leadProfessorName = leadProfessor ? memberDisplayName(leadProfessor) : '';
  const leadProfessorMeta = uniqueCompact(
    [leadProfessor?.user.title, leadProfessor?.user.primary_department],
    2,
  ).join(' · ');

  return (
    <section className="rounded-lg border border-blue-100 bg-[var(--yr-panel)] p-4 shadow-sm sm:p-5">
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_16rem] md:gap-5">
        <div>
          <SectionHeading>Student decision</SectionHeading>
          <h2 className="text-lg font-semibold text-gray-950">
            {usesFacultyResearchWording
              ? 'What this faculty research area covers'
              : 'What this lab studies'}
          </h2>
          <LongText
            text={description}
            className="mt-2 text-base leading-relaxed text-gray-800"
          />
          {usesProfileSynthesis && (
            <p className="mt-3 text-sm leading-relaxed text-gray-600">
              This is profile-derived context. Yale Research has not found a separate lab
              description or posted undergraduate opening for this research home.
            </p>
          )}

          {topics.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-600">
                Best fit for
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {topics.map((topic) => (
                  <span
                    key={topic}
                    className="rounded-md border border-blue-100 bg-[var(--yr-blue-soft)] px-2.5 py-1 text-xs font-medium text-blue-800"
                  >
                    {formatTitleCaseLabel(topic)}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="order-first rounded-md border border-[var(--yr-line)] bg-[var(--yr-panel-muted)] p-4 md:order-none">
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wider text-gray-600">
                Evidence level
              </dt>
              <dd className="mt-1 font-semibold text-gray-900">{evidenceLevel}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wider text-gray-600">
                Reach-out status
              </dt>
              <dd className="mt-1 font-semibold text-gray-900">
                {reachOutStatus({ postedOpportunities, pathways, contactRoutes })}
              </dd>
            </div>
          </dl>
          {leadProfessor && (
            <div className="mt-4 border-t border-[var(--yr-line)] pt-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-600">
                Lead professor
              </p>
              {leadProfessor.user.netid ? (
                <Link
                  to={`/profile/${leadProfessor.user.netid}`}
                  className="mt-2 flex min-h-11 flex-col justify-center rounded-md border border-blue-100 bg-[var(--yr-panel)] px-3 py-2 text-sm transition-colors hover:border-blue-300 hover:bg-[var(--yr-blue-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
                >
                  <span className="font-semibold text-blue-800">{leadProfessorName}</span>
                  {leadProfessorMeta && (
                    <span className="mt-0.5 text-xs leading-relaxed text-gray-600">
                      {leadProfessorMeta}
                    </span>
                  )}
                </Link>
              ) : (
                <div className="mt-2 rounded-md border border-[var(--yr-line)] bg-[var(--yr-panel)] px-3 py-2 text-sm">
                  <p className="font-semibold text-gray-900">{leadProfessorName}</p>
                  {leadProfessorMeta && (
                    <p className="mt-0.5 text-xs leading-relaxed text-gray-600">
                      {leadProfessorMeta}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
          <div className="mt-4 border-t border-[var(--yr-line)] pt-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-600">
              Recommended next step
            </p>
            <p className="mt-1 text-sm leading-relaxed text-gray-800">
              {decisionNextStep({ pathways, contactRoutes })}
            </p>
            {profileUrl && (
              <a
                href={profileUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-flex min-h-11 items-center justify-center rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
              >
                Open official profile
              </a>
            )}
            {officialRoute?.url && (
              <a
                href={officialRoute.url}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-flex min-h-11 items-center justify-center rounded-md border border-blue-200 bg-[var(--yr-panel)] px-3 py-2 text-sm font-semibold text-blue-700 transition-colors hover:bg-[var(--yr-blue-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
              >
                Open official route
              </a>
            )}
          </div>
        </div>
      </div>
    </section>
  );
};

const ProfileStatusSection = ({
  group,
  missingItems,
  accessSignals,
  fallbackSourceUrl,
}: {
  group: any;
  missingItems: string[];
  accessSignals: LabAccessSignal[];
  fallbackSourceUrl?: string;
}) => {
  const researchStructureLabel = isFacultyResearchEntity(group)
    ? 'faculty research profile'
    : 'lab';
  const knownItems = uniqueCompact([
    group.description || group.shortDescription
      ? `A public profile describes what this ${researchStructureLabel} covers.`
      : '',
    accessSignals.length > 0
      ? `Access signal: ${getEvidenceSignalLabel(accessSignals[0].signalType)}.`
      : '',
    fallbackSourceUrl ? 'An official profile or lab website is available.' : '',
  ]);
  const missingProfileItems =
    missingItems.length > 0 ? missingItems : ['No major profile gaps are currently flagged.'];
  const qualityNotes = adminQualityNotes(group.qualitySummary?.repairFlags);

  return (
    <section className="rounded-md border border-[var(--yr-line)] bg-[var(--yr-panel)] p-4">
      <SectionHeading>Profile status</SectionHeading>
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Source-backed details</h3>
          <div className="mt-2">
            <BulletList
              items={
                knownItems.length > 0
                  ? knownItems
                  : ['This research home is indexed from Yale source metadata.']
              }
            />
          </div>
        </div>
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Still missing</h3>
          <div className="mt-2">
            <BulletList items={missingProfileItems} />
          </div>
        </div>
      </div>
      {qualityNotes.length > 0 && (
        <div className="mt-4 border-t border-amber-100 pt-4">
          <h3 className="text-sm font-semibold text-amber-950">Admin quality notes</h3>
          <div className="mt-2">
            <BulletList items={qualityNotes} />
          </div>
        </div>
      )}
    </section>
  );
};

const WaysToApproachSection = ({
  pathways,
  postedOpportunities,
}: {
  pathways: LabEntryPathway[];
  postedOpportunities: LabPostedOpportunity[];
}) => {
  const posted = postedOpportunities[0];
  const pathway = pathways[0];

  return (
    <section>
      <SectionHeading>Ways to approach this lab</SectionHeading>
      <div className="grid gap-3 md:grid-cols-3">
        <article className="rounded-md border border-[var(--yr-line)] bg-[var(--yr-panel)] p-4">
          <h3 className="text-sm font-semibold text-gray-900">Explore first</h3>
          <p className="mt-2 text-sm leading-relaxed text-gray-700">
            Best if you are unsure whether this lab accepts undergrads. Open the official profile
            and look for current instructions.
          </p>
        </article>
        <article className="rounded-md border border-[var(--yr-line)] bg-[var(--yr-panel)] p-4">
          <h3 className="text-sm font-semibold text-gray-900">Send exploratory email</h3>
          <p className="mt-2 text-sm leading-relaxed text-gray-700">
            Best if the research area strongly matches your interests. Ask whether undergraduates
            can get involved this semester or summer.
          </p>
          {pathway?.evidenceStrength && (
            <span className="mt-3 inline-flex rounded border border-[var(--yr-line)] bg-[var(--yr-panel-muted)] px-2 py-1 text-xs text-gray-600">
              {getEvidenceStrengthLabel(pathway.evidenceStrength)}
            </span>
          )}
        </article>
        <article className="rounded-md border border-[var(--yr-line)] bg-[var(--yr-panel)] p-4">
          <h3 className="text-sm font-semibold text-gray-900">
            {posted ? 'Review posted opportunity' : 'Look for related labs'}
          </h3>
          <p className="mt-2 text-sm leading-relaxed text-gray-700">
            {posted
              ? 'Use the posted opportunity when an official application or listing exists.'
              : 'Best if you need clearer undergraduate opportunities in the same research area.'}
          </p>
          {posted && (
            <Link
              to={`/opportunities/${posted._id}`}
              className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-blue-700 underline underline-offset-2 hover:text-blue-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
            >
              View posted opportunity
            </Link>
          )}
        </article>
      </div>
    </section>
  );
};

const OutreachSection = ({ group, onDraft }: { group: any; onDraft: () => void }) => {
  const topics = detailTopics(group, 4);
  const coursework = uniqueCompact(
    [
      ...(group.departments || []),
      ...(topics.some((topic) => /comput|data|stat/i.test(topic)) ? ['statistics or CS'] : []),
      ...(topics.some((topic) => /genetic|dna|biology/i.test(topic)) ? ['genetics or biology'] : []),
    ],
    4,
  );

  return (
    <section className="rounded-lg border border-blue-100 bg-[var(--yr-blue-soft)]/50 p-5">
      <SectionHeading>Outreach</SectionHeading>
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_13rem]">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Recommended outreach angle</h3>
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-600">
                Mention your interest in
              </p>
              <BulletList
                items={[
                  topics.length > 0
                    ? 'one specific Best fit topic above'
                    : 'the research described on the official profile',
                  'a question that shows you reviewed the official profile',
                ]}
              />
            </div>
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-600">
                Relevant preparation
              </p>
              <BulletList
                items={
                  coursework.length > 0
                    ? coursework
                    : ['coursework, projects, or reading connected to the lab']
                }
              />
            </div>
          </div>
          <p className="mt-4 rounded-md border border-blue-100 bg-[var(--yr-panel)] px-3 py-2 text-sm leading-relaxed text-gray-800">
            Ask: "Are there any opportunities for undergraduates to get involved with the lab this
            semester or summer?"
          </p>
        </div>
        <div className="flex items-start md:justify-end">
          <button
            type="button"
            onClick={onDraft}
            className="inline-flex min-h-11 w-full items-center justify-center rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
          >
            Draft outreach email
          </button>
        </div>
      </div>
    </section>
  );
};

const SourcesSection = ({ sources }: { sources: ResearchDetailSource[] }) => {
  if (sources.length === 0) return null;
  const hasActionContext = sources.some((source) =>
    source.contexts.some((context) => !context.startsWith('Profile')),
  );

  return (
    <div className="rounded-lg border border-[var(--yr-line)] bg-[var(--yr-panel)]">
      <div className="border-b border-[var(--yr-line)] px-4 py-3">
        <p className="text-sm text-gray-600">
          {hasActionContext
            ? 'These official pages support the profile details and action evidence shown above.'
            : 'These official pages support the research profile details shown above.'}
        </p>
      </div>
      <div className="divide-y divide-gray-100">
        {sources.map((source) => (
          <article key={source.url} className="px-4 py-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-gray-900">{source.label}</p>
                <p className="mt-1 break-all text-xs text-gray-600">{sourceHost(source.url)}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {source.contexts.map((context) => (
                    <span
                      key={context}
                      className="rounded border border-[var(--yr-line)] bg-[var(--yr-panel-muted)] px-2 py-1 text-xs text-gray-600"
                    >
                      {context}
                    </span>
                  ))}
                </div>
              </div>
              <a
                href={source.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-md border border-[var(--yr-line-strong)] px-3 text-sm font-semibold text-gray-800 hover:bg-[var(--yr-panel-muted)] focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
              >
                Open source
              </a>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
};

const PUBLIC_LEAD_ROLES = new Set(['pi', 'co-pi', 'director', 'co-director']);

const hasArrayContent = (values?: unknown[]): boolean => Array.isArray(values) && values.length > 0;

const hasPublicPlanningRoute = (contactRoutes: LabContactRoute[]): boolean =>
  contactRoutes.some(
    (route) => route.visibility === 'PUBLIC' && Boolean(route.url) && route.routeType !== 'FACULTY_PI',
  );

const hasSpecificWaysToApproach = (
  pathways: LabEntryPathway[],
  postedOpportunities: LabPostedOpportunity[],
): boolean =>
  postedOpportunities.length > 0 ||
  pathways.some(
    (pathway) =>
      pathway.pathwayType !== 'EXPLORATORY_CONTACT' &&
      pathway.pathwayType !== 'REACH_OUT_PLAUSIBLE',
  );

const hasPlanningSidebarContent = ({
  group,
  contactRoutes,
  hasActivePostedOpportunity,
}: {
  group: any;
  contactRoutes: LabContactRoute[];
  hasActivePostedOpportunity: boolean;
}): boolean =>
  Boolean(
    group.contactEmail ||
      hasActivePostedOpportunity ||
      hasPublicPlanningRoute(contactRoutes) ||
      hasArrayContent(group.typicalUndergradRoles) ||
      hasArrayContent(group.prerequisiteCourses) ||
      hasArrayContent(group.creditOptions) ||
      hasArrayContent(group.fundingPrograms) ||
      hasArrayContent(group.recentGrants) ||
      hasArrayContent(group.independentStudyCourses) ||
      hasArrayContent(group.pastUndergradAdvisees) ||
      group.timeCommitmentHoursPerWeek ||
      (group.recentPaperCount ?? 0) > 0,
  );

const LabDetail = () => {
  const { slug } = useParams<{ slug: string }>();
  const [state, dispatch] = useReducer(
    labDetailReducer,
    undefined,
    () => createInitialLabDetailState(),
  );
  const { payload, loading, error, isInquireModalOpen } = state;
  const requestIdRef = useRef(0);
  const fetchAbortRef = useRef<AbortController | null>(null);
  const [showResearchPlanSavedCallout, setShowResearchPlanSavedCallout] = useState(false);
  const {
    favIds: savedResearchPlanIds,
    setFavorite: setSavedResearchPlanFavorite,
  } = useFavorites('researchPlans');
  const documentTitleGroup = payload ? payload.group ?? payload.researchEntity : null;
  useDocumentTitle(
    documentTitleGroup?.displayName || documentTitleGroup?.name || 'Research profile',
  );

  useEffect(() => {
    if (!slug) return;
    const requestId = ++requestIdRef.current;
    const controller = new AbortController();

    fetchAbortRef.current?.abort();
    fetchAbortRef.current = controller;
    dispatch({ type: 'FETCH_START' });
    axios
      .get(`/research/${slug}`, { signal: controller.signal })
      .then((res) => {
        if (requestId !== requestIdRef.current || controller.signal.aborted) return;
        dispatch({
          type: 'FETCH_SUCCESS',
          payload: normalizeResearchEntityDetailPayload(res.data),
        });
      })
      .catch((err) => {
        if (isCancel(err) || requestId !== requestIdRef.current) return;
        if (err?.response?.status === 404) {
          dispatch({ type: 'FETCH_FAILURE', payload: 'Research profile not found.' });
        } else {
          dispatch({ type: 'FETCH_FAILURE', payload: 'Failed to load this research profile.' });
        }
      });
    return () => {
      fetchAbortRef.current?.abort();
    };
  }, [slug]);

  if (loading && !payload) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-16 flex justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600" />
      </div>
    );
  }

  if (error && !payload) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-16 text-center">
        <h2 className="text-xl font-semibold text-gray-800">{error}</h2>
        <p className="text-gray-600 mt-2">
          The research profile you're looking for may not exist or may have been removed.
        </p>
      </div>
    );
  }

  if (!payload) return null;

  const {
    group: legacyGroup,
    researchEntity,
    members,
    researchActivityLinks: payloadResearchActivityLinks = [],
    scholarlyLinks = [],
    memberScholarlyLinks = [],
    recentPapers = [],
    recentArxivPreprints = [],
    contactRoutes = [],
    entryPathways = [],
    accessSignals = [],
    postedOpportunities = [],
    entityRelationships = [],
    relatedResearchEntities = [],
    affiliatedResearchEntities = [],
  } = payload;
  const group = legacyGroup ?? researchEntity;
  const researchActivityLinks: LabResearchActivityLink[] =
    payloadResearchActivityLinks.length > 0
      ? payloadResearchActivityLinks
      : [
          ...scholarlyLinks.map((link) => ({
            ...link,
            relationshipBasis: 'explicit_entity_link' as const,
            evidenceLabel: 'Linked to this research profile',
          })),
          ...memberScholarlyLinks.map((link) => ({
            ...link,
            relationshipBasis: 'member_authorship' as const,
            evidenceLabel: 'Authored by a listed professor',
          })),
        ];
  const directRelatedResearchLinks = researchActivityLinks.filter(
    (link) => link.relationshipBasis !== 'member_authorship',
  );
  const memberRecentWorkLinks = researchActivityLinks.filter(
    (link) => link.relationshipBasis === 'member_authorship',
  );
  const hasActivePostedOpportunity = postedOpportunities.length > 0;
  const hasDirectRelatedResearch =
    directRelatedResearchLinks.length > 0 || recentPapers.length > 0 || recentArxivPreprints.length > 0;
  const hasMemberRecentWork = memberRecentWorkLinks.length > 0;
  const hasResearchActivity = hasDirectRelatedResearch || hasMemberRecentWork;
  const hasWaysIn = entryPathways.length > 0 || postedOpportunities.length > 0;
  const hasRelatedResearchEntities = relatedResearchEntities.length > 0;
  const hasAffiliatedResearchEntities = affiliatedResearchEntities.length > 0;
  const showWaysToApproach = hasSpecificWaysToApproach(entryPathways, postedOpportunities);
  const missingSparseItems = [
    !hasResearchActivity ? 'Research activity links have not been attached yet.' : '',
    !hasWaysIn ? 'No action-ready or evidence-backed ways in are indexed yet.' : '',
    accessSignals.length === 0 ? 'Access evidence has not been attached yet.' : '',
  ].filter(Boolean);
  const sources = buildResearchDetailSources({
    group,
    pathways: entryPathways,
    accessSignals,
    contactRoutes,
    postedOpportunities,
  });
  const fallbackSourceUrl = group.websiteUrl || sources[0]?.url;
  const decisionProfileUrl = resolveDecisionProfileUrl(fallbackSourceUrl, contactRoutes);
  const decisionOfficialRoute = resolveDecisionOfficialRoute(
    decisionProfileUrl,
    contactRoutes,
    group,
  );
  const principalInvestigators = members.filter((member) =>
    PUBLIC_LEAD_ROLES.has(member.role),
  );
  const membersById = new Map(members.map((member) => [memberId(member), member]));
  const primaryRecentWorkMember =
    memberRecentWorkLinks
      .map((link) => (link.userId ? membersById.get(link.userId) : undefined))
      .find((member): member is LabMember => Boolean(member)) || principalInvestigators[0];
  const primaryRecentWorkMemberName = primaryRecentWorkMember
    ? memberDisplayName(primaryRecentWorkMember)
    : 'the lead professor';
  const primaryRecentWorkProfilePath = primaryRecentWorkMember?.user.netid
    ? `/profile/${primaryRecentWorkMember.user.netid}?tab=research`
    : '';
  const showOutreachSection = Boolean(group.contactEmail);
  const showPlanningAside = hasPlanningSidebarContent({
    group,
    contactRoutes,
    hasActivePostedOpportunity,
  });
  const primaryPathway = entryPathways[0];
  const isPrimaryPathwaySaved = primaryPathway
    ? savedResearchPlanIds.includes(primaryPathway._id)
    : false;

  const handleToggleSavedResearchPlan = (pathwayId: string, shouldSave: boolean) => {
    setSavedResearchPlanFavorite(pathwayId, shouldSave);
    if (shouldSave && !window.localStorage.getItem(FIRST_RESEARCH_PLAN_SAVE_KEY)) {
      window.localStorage.setItem(FIRST_RESEARCH_PLAN_SAVE_KEY, 'true');
      setShowResearchPlanSavedCallout(true);
    }
  };

  return (
    <div className="mx-auto w-full max-w-screen-2xl px-4 py-6 sm:py-8 lg:px-8">
      <div className={`grid grid-cols-1 gap-6 lg:gap-8 ${showPlanningAside ? 'xl:grid-cols-[minmax(0,1fr)_24rem] 2xl:grid-cols-[minmax(0,1fr)_26rem]' : ''}`}>
        <div className={`${showPlanningAside ? 'min-w-0' : 'lg:mx-auto lg:w-full lg:max-w-5xl'} space-y-6 sm:space-y-8`}>
          {showResearchPlanSavedCallout && (
            <FirstSaveCallout
              kind="researchPlan"
              onDismiss={() => setShowResearchPlanSavedCallout(false)}
            />
          )}

          <LabHeader
            group={group}
            dedupeWebsiteUrls={[decisionProfileUrl, decisionOfficialRoute?.url]}
            hasActivePostedOpportunity={hasActivePostedOpportunity}
            actions={
              primaryPathway ? (
                <ResearchPlanSaveButton
                  isSaved={isPrimaryPathwaySaved}
                  onToggle={(e) => {
                    e.stopPropagation();
                    handleToggleSavedResearchPlan(primaryPathway._id, !isPrimaryPathwaySaved);
                  }}
                />
              ) : undefined
            }
          />

          <DecisionSummary
            group={group}
            pathways={entryPathways}
            contactRoutes={contactRoutes}
            postedOpportunities={postedOpportunities}
            fallbackSourceUrl={fallbackSourceUrl}
            hasActivePostedOpportunity={hasActivePostedOpportunity}
            leadProfessor={principalInvestigators[0]}
          />

          <section>
            <SectionHeading>Principal Investigator</SectionHeading>
            <LabMembersList members={principalInvestigators} />
          </section>

          {hasDirectRelatedResearch && (
            <section>
              <SectionHeading>Related Research</SectionHeading>
              <LabPapersList
                papers={
                  directRelatedResearchLinks.length > 0
                    ? directRelatedResearchLinks
                    : [...recentPapers, ...recentArxivPreprints]
                }
                emptyText="No scholarly links are attached to this research profile yet."
                showPreprintMeta={directRelatedResearchLinks.length === 0 && recentPapers.length === 0}
              />
            </section>
          )}

          {hasMemberRecentWork && (
            <section>
              <SectionHeading>Recent work by {primaryRecentWorkMemberName}</SectionHeading>
              <div className="space-y-3">
                <LabPapersList
                  papers={memberRecentWorkLinks.slice(0, 3)}
                  emptyText="No professor research activity is attached yet."
                />
                {primaryRecentWorkProfilePath && (
                  <Link
                    to={primaryRecentWorkProfilePath}
                    className="inline-flex min-h-11 items-center text-sm font-semibold text-blue-700 hover:text-blue-900 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
                  >
                    View all research activity on {primaryRecentWorkMemberName}’s profile
                  </Link>
                )}
              </div>
            </section>
          )}

          {showWaysToApproach && (
            <WaysToApproachSection
              pathways={entryPathways}
              postedOpportunities={postedOpportunities}
            />
          )}

          {hasRelatedResearchEntities && (
            <RelatedResearchEntitiesSection
              relationships={entityRelationships}
              relatedResearchEntities={relatedResearchEntities}
            />
          )}

          {hasAffiliatedResearchEntities && (
            <AffiliatedResearchEntitiesSection
              affiliatedResearchEntities={affiliatedResearchEntities}
            />
          )}

          {showOutreachSection && (
            <OutreachSection
              group={group}
              onDraft={() => dispatch({ type: 'OPEN_INQUIRE_MODAL' })}
            />
          )}

          <ProfileStatusSection
            group={group}
            missingItems={missingSparseItems}
            accessSignals={accessSignals}
            fallbackSourceUrl={fallbackSourceUrl}
          />

          {sources.length > 0 && (
            <section>
              <SectionHeading>Sources</SectionHeading>
              <SourcesSection sources={sources} />
            </section>
          )}
        </div>

        {showPlanningAside && (
          <aside>
            <div className="xl:sticky xl:top-6">
              <LabInquireCard
                group={group}
                members={members}
                contactRoutes={contactRoutes}
                hasActivePostedOpportunity={hasActivePostedOpportunity}
                onInquire={() => dispatch({ type: 'OPEN_INQUIRE_MODAL' })}
              />
            </div>
          </aside>
        )}
      </div>

      <LabInquireModal
        isOpen={isInquireModalOpen}
        onClose={() => dispatch({ type: 'CLOSE_INQUIRE_MODAL' })}
        group={group}
        members={members}
      />
    </div>
  );
};

export default LabDetail;

/**
 * Research detail page rendered at `/research/:slug`.
 *
 * Smart-component responsibilities:
 *   - Resolve the slug from the URL and fetch the detail payload from
 *     `GET /api/research/:slug` via the labDetailReducer.
 *   - Compose the small presentational components in `components/labs/`.
 *   - Own saved-plan interactions and profile detail state.
 *
 * No business logic lives in the layout components themselves - they take
 * props and render. This keeps the page consistent with the
 * `pages/profile.tsx` pattern.
 */
import { useContext, useEffect, useReducer, useRef, useState } from 'react';
import { isCancel } from 'axios';
import { Link, useParams } from 'react-router-dom';
import axios from '../utils/axios';
import { createInitialLabDetailState, labDetailReducer } from '../reducers/labDetailReducer';
import LabHeader from '../components/labs/LabHeader';
import LabMembersList from '../components/labs/LabMembersList';
import LabPapersList from '../components/labs/LabPapersList';
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
  LabRelatedResearchEntitySummary,
  LabResearchActivityLink,
} from '../types/labDetail';
import type { ResearchEntityRepairFlag } from '../types/researchEntity';
import { normalizeResearchEntityDetailPayload } from '../types/researchEntity';
import {
  buildResearchDetailSources,
  normalizeActionDestination,
  normalizeSourceUrl,
  ResearchDetailSource,
} from '../utils/researchDetailSources';
import { EXTERNAL_LINK_REL, safeHttpUrl, safeRouteSegment } from '../utils/url';
import { formatTitleCaseLabel } from '../utils/displayText';
import {
  getEvidenceSignalLabel,
  getEvidenceStrengthLabel,
} from '../utils/researchDiscoveryAdapters';
import { computeAcceptanceVerdict, EvidenceItem, verdictLabel } from '../utils/undergradAcceptance';
import {
  approachHeadingLabel,
  decisionHeadingLabel,
  isFacultyResearchEntity,
  relationshipTypeLabel,
  researchStructureLabel,
  researchWebsiteLabel,
  sanitizeFacultyResearchCopy,
} from '../utils/researchEntityCopy';
import { getUniqueDepartmentLabels } from '../utils/departmentNames';
import UserContext from '../contexts/UserContext';
import ListingClaimRequestPanel from '../components/faculty/ListingClaimRequestPanel';

const FIRST_RESEARCH_PLAN_SAVE_KEY = 'yale-research.firstResearchPlanSave.v1';

const SectionHeading = ({ children }: { children: React.ReactNode }) => (
  <h2 className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-3">{children}</h2>
);

const formatEntityKindTag = (kind?: string | null): string | undefined =>
  kind ? formatTitleCaseLabel(kind.replace(/[_-]+/g, ' ')) : undefined;

const RelatedResearchEntitiesSection = ({
  relationships,
  relatedResearchEntities,
}: {
  relationships: LabEntityRelationship[];
  relatedResearchEntities: LabRelatedResearchEntitySummary[];
}) => {
  const relationshipByEntityKey = new Map(
    relationships.flatMap((relationship) =>
      [relationship.relatedResearchEntitySlug, relationship.relatedResearchEntityId]
        .filter(Boolean)
        .map((key) => [key, relationship] as const),
    ),
  );

  return (
    <section>
      <SectionHeading>Related labs and groups</SectionHeading>
      <div className="grid gap-3 sm:grid-cols-2">
        {relatedResearchEntities.map((entity) => {
          const relationship = relationshipByEntityKey.get(entity.slug || entity.id);
          const description = entity.blurb || '';
          const tags = uniqueCompact(
            [
              relationship?.label || relationshipTypeLabel(relationship?.relationshipType),
              formatEntityKindTag(entity.kind),
              ...compactDepartmentLabels(entity.departments),
            ],
            3,
          );
          return (
            <Link
              key={entity.id || entity.slug}
              to={`/research/${safeRouteSegment(entity.slug)}`}
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
  affiliatedResearchEntities: LabRelatedResearchEntitySummary[];
}) => (
  <section>
    <SectionHeading>Affiliated with</SectionHeading>
    <div className="grid gap-3 sm:grid-cols-2">
      {affiliatedResearchEntities.map((entity) => {
        const content = (
          <>
            <div className="flex flex-wrap gap-2">
              {uniqueCompact(
                [formatEntityKindTag(entity.kind), ...compactDepartmentLabels(entity.departments)],
                3,
              ).map((tag) => (
                <span
                  key={tag}
                  className="rounded-full bg-[var(--yr-panel-muted)] px-2 py-1 text-xs font-medium text-gray-700"
                >
                  {tag}
                </span>
              ))}
            </div>
            <h3 className="mt-3 text-sm font-semibold text-gray-900">{entity.name}</h3>
          </>
        );
        const className =
          'block rounded-lg border border-[var(--yr-line)] bg-[var(--yr-panel)] p-4 transition';
        const canOpenDetail = Boolean(entity.slug);
        return canOpenDetail ? (
          <Link
            key={entity.id || entity.slug}
            to={`/research/${safeRouteSegment(entity.slug)}`}
            className={`${className} hover:border-blue-300 hover:shadow-sm`}
          >
            {content}
          </Link>
        ) : (
          <div key={entity.id || entity.slug} className={className}>
            {content}
          </div>
        );
      })}
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

const compactDepartmentLabels = (
  departments: Array<string | undefined | null> | undefined,
): string[] =>
  getUniqueDepartmentLabels(
    (departments || []).filter((department): department is string => Boolean(department)),
  );

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

const isGenericTopic = (value: string): boolean =>
  /^(yale\s+)?school of\b/i.test(value) ||
  /^yale school\b/i.test(value) ||
  /^yale faculty\b/i.test(value);

const detailTopics = (group: any, limit = 6): string[] =>
  uniqueCompact([...(group.researchAreas || [])], limit * 2)
    .filter((value) => !isGenericTopic(value))
    .slice(0, limit);

const directoryFirstPlanningCopy = (value: string | undefined | null, group: any): string => {
  if (!value) return '';
  return sanitizeFacultyResearchCopy(value, group)
    .replace('Plan careful exploratory outreach.', 'Plan from source-backed context.')
    .replace(
      'This profile has source-backed evidence that outreach may be plausible, but no active posted role is attached.',
      'This profile has source-backed context for planning, but no active posted role is attached.',
    )
    .replace(
      'Review the PI profile and lab site first, then decide whether targeted exploratory outreach is appropriate.',
      'Review the PI profile and lab site first, then decide what source details you should verify next.',
    )
    .replace(
      'Review the profile before outreach.',
      'Review the profile and source details before planning next steps.',
    )
    .replace(
      'Contact the program manager through the listed route.',
      'Review the listed route and verify whether it has current instructions.',
    )
    .replace(
      'Plan a specific outreach note that references the group’s work.',
      'Plan notes that reference the group’s work before taking next steps.',
    )
    .replace(
      /targeted exploratory outreach is appropriate/gi,
      'source details you should verify next',
    )
    .replace(/targeted outreach is appropriate/gi, 'source details you should verify next')
    .replace(/outreach may be plausible/gi, 'planning context is available')
    .replace(/before outreach/gi, 'before planning next steps')
    .replace(/outreach note/gi, 'planning note');
};

const decisionNextStep = ({
  group,
  pathways,
  contactRoutes,
}: {
  group: any;
  pathways: LabEntryPathway[];
  contactRoutes: LabContactRoute[];
}): string => {
  const pathwayStep = pathways.find((item) => item.bestNextStep)?.bestNextStep;
  if (pathwayStep) {
    return directoryFirstPlanningCopy(pathwayStep, group);
  }
  const route = contactRoutes[0];
  if (route?.routeType === 'OFFICIAL_APPLICATION') {
    return 'Use the official application route, then verify timing and eligibility on the source page.';
  }
  if (route) {
    return 'Review the official profile first, then use the source details to plan what to verify next.';
  }
  return 'Review the official profile first, then use the source details to plan what to verify next.';
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
  if (pathways.length > 0 || contactRoutes.length > 0) return 'Planning context available';
  return 'Source review needed';
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
  group?: any,
): string | undefined => {
  if (group?.leadIdentityStatus === 'under_review') return undefined;
  const labWebsiteDestinations = new Set(
    [group?.websiteUrl, group?.website]
      .filter((url) => url && !isProfileLikeWebsiteUrl(url))
      .map((url) => normalizeActionDestination(url))
      .filter(Boolean),
  );
  const facultyProfileRoute = contactRoutes.find(
    (route) =>
      route.routeType === 'FACULTY_PI' &&
      Boolean(route.url) &&
      !labWebsiteDestinations.has(normalizeActionDestination(route.url)),
  );

  if (facultyProfileRoute?.url) return normalizeSourceUrl(facultyProfileRoute.url) || undefined;
  if (
    fallbackSourceUrl &&
    isProfileLikeWebsiteUrl(fallbackSourceUrl) &&
    !labWebsiteDestinations.has(normalizeActionDestination(fallbackSourceUrl))
  ) {
    return normalizeSourceUrl(fallbackSourceUrl) || undefined;
  }
  return undefined;
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

const LEAD_ROLE_PRIORITY = new Map([
  ['pi', 0],
  ['co-pi', 1],
  ['director', 2],
  ['co-director', 3],
]);

const normalizedMemberIdentityPart = (value: unknown): string =>
  String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const leadMemberIdentityKey = (member: LabMember): string => {
  const user = member.user;
  const stableId = normalizedMemberIdentityPart(user.netid || user._id);
  if (stableId) return `id:${stableId}`;

  const name = normalizedMemberIdentityPart(memberDisplayName(member));
  const department = normalizedMemberIdentityPart(
    user.primary_department || user.primaryDepartment,
  );
  const title = normalizedMemberIdentityPart(user.title);
  return [name, department, title].filter(Boolean).join('|');
};

const dedupeLeadMembers = (members: LabMember[]): LabMember[] => {
  const byPerson = new Map<string, LabMember>();

  for (const member of members) {
    if (!PUBLIC_LEAD_ROLES.has(member.role)) continue;
    const key = leadMemberIdentityKey(member);
    if (!key) continue;

    const current = byPerson.get(key);
    if (
      !current ||
      (LEAD_ROLE_PRIORITY.get(member.role) ?? 99) < (LEAD_ROLE_PRIORITY.get(current.role) ?? 99)
    ) {
      byPerson.set(key, member);
    }
  }

  return Array.from(byPerson.values()).sort(
    (a, b) => (LEAD_ROLE_PRIORITY.get(a.role) ?? 99) - (LEAD_ROLE_PRIORITY.get(b.role) ?? 99),
  );
};

const memberId = (member: LabMember): string => String(member.user.publicKey || '');

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
  if (flagSet.has('pi_identity_conflict')) {
    notes.push('Lead identity needs review before this profile is student-ready.');
  }
  if (flagSet.has('missing_source_url')) {
    notes.push('No official source URL is attached.');
  }

  return notes;
};

/**
 * Summarize recent grants like "Funded: 2x NIH R01, 1x NSF". Bucketed by agency
 * since the chip conveys breadth, not specific awards. (Relocated from the
 * retired contact-route card so the decision summary owns the evidence signals.)
 */
const formatGrantSummary = (group: any): string | null => {
  const grants = group.recentGrants || [];
  if (grants.length === 0) return null;
  const counts: Record<string, number> = {};
  for (const g of grants) {
    const agency = (g.agency || '').trim();
    if (!agency) continue;
    counts[agency] = (counts[agency] || 0) + 1;
  }
  const parts = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([agency, n]) => `${n}× ${agency}`);
  if (parts.length === 0) return null;
  return `Funded: ${parts.join(', ')}`;
};

const formatPastAdvisees = (group: any): string | null => {
  const total = (group.pastUndergradAdvisees || []).reduce(
    (sum: number, p: any) => sum + (p?.count ?? 1),
    0,
  );
  if (total <= 0) return null;
  const years = (group.pastUndergradAdvisees || [])
    .map((p: any) => p?.year)
    .filter((y: unknown): y is number => typeof y === 'number' && y > 0)
    .sort((a: number, b: number) => a - b);
  const range =
    years.length > 0
      ? years[0] === years[years.length - 1]
        ? `${years[0]}`
        : `${years[0]}–${years[years.length - 1]}`
      : null;
  return `Advised ${total} ${total === 1 ? 'undergrad' : 'undergrads'}${
    range ? ` (${range})` : ''
  }`;
};

const EvidenceChip = ({ item }: { item: EvidenceItem }) => {
  const tone =
    item.strength === 'strong'
      ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
      : 'bg-[var(--yr-blue-soft)] text-blue-700 border-blue-100';
  const negativeTone = 'bg-red-50 text-red-700 border-red-100';
  const isNegative = item.kind === 'closed-toggle' || item.kind === 'closed-evidence';
  const cls = isNegative ? negativeTone : tone;
  return (
    <span
      title={item.detail}
      className={`inline-flex items-center gap-1 text-xs rounded-md border px-2 py-1 ${cls}`}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {isNegative ? (
          <>
            <circle cx="12" cy="12" r="10" />
            <line x1="15" y1="9" x2="9" y2="15" />
            <line x1="9" y1="9" x2="15" y2="15" />
          </>
        ) : (
          <polyline points="20 6 9 17 4 12" />
        )}
      </svg>
      <span>{item.label}</span>
    </span>
  );
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
  const studentDecisionExplanation = group.studentDecisionExplanation;
  const displayStudentDecisionExplanation = studentDecisionExplanation
    ? {
        ...studentDecisionExplanation,
        headline: directoryFirstPlanningCopy(studentDecisionExplanation.headline, group),
        explanation: directoryFirstPlanningCopy(studentDecisionExplanation.explanation, group),
        why: studentDecisionExplanation.why.map((item: string) =>
          directoryFirstPlanningCopy(item, group),
        ),
      }
    : null;
  const rawDescription =
    (usesProfileSynthesis ? group.profileSynthesisDescription : '') ||
    sourceBackedDescription ||
    (topics.length > 0
      ? `Research connected to ${topics.slice(0, 3).join(', ')}.`
      : 'A Yale research profile with limited public description.');
  const description = sanitizeFacultyResearchCopy(rawDescription, group);
  const { verdict, evidence } = computeAcceptanceVerdict(group, hasActivePostedOpportunity);
  const evidenceLevel = verdictLabel(verdict);
  const grantSummary = formatGrantSummary(group);
  const pastAdvisees = formatPastAdvisees(group);
  const hasEvidenceDetail = evidence.length > 0 || Boolean(grantSummary) || Boolean(pastAdvisees);
  const profileUrl = resolveDecisionProfileUrl(fallbackSourceUrl, contactRoutes, group);
  const officialRoute = resolveDecisionOfficialRoute(profileUrl, contactRoutes, group);
  const officialRouteUrl = safeHttpUrl(officialRoute?.url);
  const leadProfessorName = leadProfessor ? memberDisplayName(leadProfessor) : '';
  const leadProfessorMeta = uniqueCompact(
    [leadProfessor?.user.title, leadProfessor?.user.primary_department],
    2,
  ).join(' · ');
  return (
    <section className="rounded-lg border border-blue-100 bg-[var(--yr-panel)] p-4 shadow-sm sm:p-5">
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_16rem] md:gap-5">
        <div>
          <SectionHeading>Research summary</SectionHeading>
          <h2 className="text-lg font-semibold text-gray-950">
            {usesFacultyResearchWording
              ? 'What this faculty research area covers'
              : decisionHeadingLabel(group)}
          </h2>
          <LongText text={description} className="mt-2 text-base leading-relaxed text-gray-800" />
          {displayStudentDecisionExplanation && (
            <div className="mt-5 rounded-md border border-[var(--yr-line)] bg-[var(--yr-panel-muted)] p-4">
              <SectionHeading>Student decision</SectionHeading>
              <h3 className="text-base font-semibold text-gray-950">
                {displayStudentDecisionExplanation.headline}
              </h3>
              <p className="mt-2 text-base leading-relaxed text-gray-800">
                {displayStudentDecisionExplanation.explanation}
              </p>
              {displayStudentDecisionExplanation.why.length > 0 && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-gray-600">
                    Why
                  </p>
                  <div className="mt-2">
                    <BulletList items={displayStudentDecisionExplanation.why} />
                  </div>
                </div>
              )}
              {displayStudentDecisionExplanation.notThis && (
                <div className="rounded-md border border-[var(--yr-line)] bg-[var(--yr-panel-muted)] px-3 py-2">
                  <p className="text-xs font-semibold uppercase tracking-wider text-gray-600">
                    What this page is
                  </p>
                  <p className="mt-1 text-sm leading-relaxed text-gray-800">
                    {displayStudentDecisionExplanation.notThis === 'Not a posted opening.'
                      ? 'This page summarizes the research context and source evidence, not a posted opening.'
                      : displayStudentDecisionExplanation.notThis}
                  </p>
                </div>
              )}
            </div>
          )}
          {usesProfileSynthesis && (
            <p className="mt-3 text-sm leading-relaxed text-gray-600">
              This is profile-derived context. Yale Research has not found a separate research
              website or posted undergraduate opening for this research home.
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

        <div className="rounded-md border border-[var(--yr-line)] bg-[var(--yr-panel-muted)] p-4">
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wider text-gray-600">
                Evidence level
              </dt>
              <dd className="mt-1 font-semibold text-gray-900">{evidenceLevel}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wider text-gray-600">
                Planning status
              </dt>
              <dd className="mt-1 font-semibold text-gray-900">
                {reachOutStatus({ postedOpportunities, pathways, contactRoutes })}
              </dd>
            </div>
          </dl>
          {hasEvidenceDetail && (
            <div
              className="mt-4 border-t border-[var(--yr-line)] pt-4"
              aria-label="Evidence supporting the acceptance signal"
            >
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-600">
                Evidence
              </p>
              {evidence.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {evidence.slice(0, 4).map((item, i) => (
                    <EvidenceChip key={`${item.kind}-${i}`} item={item} />
                  ))}
                </div>
              )}
              {(grantSummary || pastAdvisees) && (
                <ul className="mt-3 space-y-1 text-xs text-gray-600">
                  {grantSummary && <li>• {grantSummary}</li>}
                  {pastAdvisees && <li>• {pastAdvisees}</li>}
                </ul>
              )}
            </div>
          )}
          {leadProfessor && (
            <div className="mt-4 border-t border-[var(--yr-line)] pt-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-600">
                Lead professor
              </p>
              <div className="mt-2 rounded-md border border-[var(--yr-line)] bg-[var(--yr-panel)] px-3 py-2 text-sm">
                <p className="font-semibold text-gray-900">{leadProfessorName}</p>
                {leadProfessorMeta && (
                  <p className="mt-0.5 text-xs leading-relaxed text-gray-600">
                    {leadProfessorMeta}
                  </p>
                )}
              </div>
            </div>
          )}
          <div className="mt-4 border-t border-[var(--yr-line)] pt-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-600">
              Recommended next step
            </p>
            <p className="mt-1 text-sm leading-relaxed text-gray-800">
              {decisionNextStep({ group, pathways, contactRoutes })}
            </p>
            {profileUrl && (
              <a
                href={profileUrl}
                target="_blank"
                rel={EXTERNAL_LINK_REL}
                className="mt-3 inline-flex min-h-11 items-center justify-center rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
              >
                Open official profile
              </a>
            )}
            {officialRouteUrl && (
              <a
                href={officialRouteUrl}
                target="_blank"
                rel={EXTERNAL_LINK_REL}
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
  const structureLabel = researchStructureLabel(group);
  const websiteLabel = researchWebsiteLabel(group);
  const knownItems = uniqueCompact([
    group.description || group.shortDescription
      ? `A public profile describes what this ${structureLabel} covers.`
      : '',
    accessSignals.length > 0
      ? `Access signal: ${getEvidenceSignalLabel(accessSignals[0].signalType)}.`
      : '',
    fallbackSourceUrl ? `An official profile or ${websiteLabel} is available.` : '',
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
  group,
  pathways,
  postedOpportunities,
}: {
  group: any;
  pathways: LabEntryPathway[];
  postedOpportunities: LabPostedOpportunity[];
}) => {
  const posted = postedOpportunities[0];
  const pathway = pathways[0];
  const facultyResearch = isFacultyResearchEntity(group);
  const structureLabel = researchStructureLabel(group);

  return (
    <section>
      <SectionHeading>{approachHeadingLabel(group)}</SectionHeading>
      <div className="grid gap-3 md:grid-cols-3">
        <article className="rounded-md border border-[var(--yr-line)] bg-[var(--yr-panel)] p-4">
          <h3 className="text-sm font-semibold text-gray-900">Explore first</h3>
          <p className="mt-2 text-sm leading-relaxed text-gray-700">
            {facultyResearch
              ? 'Best if you are unsure whether this research area has undergraduate routes. Open the official profile and look for current instructions.'
              : `Best if you are unsure whether this ${structureLabel} accepts undergrads. Open the official profile and look for current instructions.`}
          </p>
        </article>
        <article className="rounded-md border border-[var(--yr-line)] bg-[var(--yr-panel)] p-4">
          <h3 className="text-sm font-semibold text-gray-900">Review source instructions</h3>
          <p className="mt-2 text-sm leading-relaxed text-gray-700">
            Best if the research area strongly matches your interests. Check whether the official
            source names current undergraduate instructions, timing, or eligibility.
          </p>
          {pathway?.evidenceStrength && (
            <span className="mt-3 inline-flex rounded border border-[var(--yr-line)] bg-[var(--yr-panel-muted)] px-2 py-1 text-xs text-gray-600">
              {getEvidenceStrengthLabel(pathway.evidenceStrength)}
            </span>
          )}
        </article>
        <article className="rounded-md border border-[var(--yr-line)] bg-[var(--yr-panel)] p-4">
          <h3 className="text-sm font-semibold text-gray-900">
            {posted ? 'Review posted opportunity' : 'Look for related research homes'}
          </h3>
          <p className="mt-2 text-sm leading-relaxed text-gray-700">
            {posted
              ? 'Use the posted opportunity when an official application or listing exists.'
              : 'Best if you need clearer undergraduate opportunities in the same research area.'}
          </p>
          {posted && (
            <Link
              to={`/opportunities/${safeRouteSegment(posted._id)}`}
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
        {sources.map((source) => {
          const sourceUrl = safeHttpUrl(source.url);
          return (
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
                {sourceUrl && (
                  <a
                    href={sourceUrl}
                    target="_blank"
                    rel={EXTERNAL_LINK_REL}
                    className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-md border border-[var(--yr-line-strong)] px-3 text-sm font-semibold text-gray-800 hover:bg-[var(--yr-panel-muted)] focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                  >
                    Open source
                  </a>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
};

const PUBLIC_LEAD_ROLES = new Set(['pi', 'co-pi', 'director', 'co-director']);

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

const LabDetail = () => {
  const { user } = useContext(UserContext);
  const { slug } = useParams<{ slug: string }>();
  const [state, dispatch] = useReducer(labDetailReducer, undefined, () =>
    createInitialLabDetailState(),
  );
  const { payload, loading, error, isInquireModalOpen } = state;
  const requestIdRef = useRef(0);
  const fetchAbortRef = useRef<AbortController | null>(null);
  const [showResearchPlanSavedCallout, setShowResearchPlanSavedCallout] = useState(false);
  const [outreachRecordError, setOutreachRecordError] = useState('');
  const { favIds: savedResearchPlanIds, setFavorite: setSavedResearchPlanFavorite } =
    useFavorites('researchPlans');
  const documentTitleGroup = payload ? (payload.group ?? payload.researchEntity) : null;
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
    earlierResearchActivityLinks = [],
    scholarlyLinks = [],
    memberScholarlyLinks = [],
    recentPapers = [],
    recentArxivPreprints = [],
    contactRoutes = [],
    entryPathways = [],
    accessSignals = [],
    postedOpportunities = [],
    activeListings = [],
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
  const memberRecentWorkLinks = researchActivityLinks.filter(
    (link) =>
      Boolean(link.memberKey) ||
      link.relationshipBasis === 'member_authorship' ||
      link.relationshipBasis === 'identity_authorship',
  );
  const directRelatedResearchLinks = researchActivityLinks.filter(
    (link) => !memberRecentWorkLinks.includes(link),
  );
  const hasActivePostedOpportunity = postedOpportunities.length > 0;
  const hasDirectRelatedResearch =
    directRelatedResearchLinks.length > 0 ||
    recentPapers.length > 0 ||
    recentArxivPreprints.length > 0;
  const hasMemberRecentWork = memberRecentWorkLinks.length > 0;
  const hasResearchActivity = hasDirectRelatedResearch || hasMemberRecentWork;
  const hasWaysIn = entryPathways.length > 0 || postedOpportunities.length > 0;
  const hasRelatedResearchEntities = relatedResearchEntities.length > 0;
  const hasAffiliatedResearchEntities = affiliatedResearchEntities.length > 0;
  const showWaysToApproach = hasSpecificWaysToApproach(entryPathways, postedOpportunities);
  const missingSparseItems = [
    !hasResearchActivity ? 'Research activity links have not been attached yet.' : '',
    !hasWaysIn ? 'No indexed planning routes are attached yet.' : '',
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
  const decisionProfileUrl = resolveDecisionProfileUrl(fallbackSourceUrl, contactRoutes, group);
  const decisionOfficialRoute = resolveDecisionOfficialRoute(
    decisionProfileUrl,
    contactRoutes,
    group,
  );
  const approvedOutreachRoute = contactRoutes.find(
    (route) => route.reviewStatus === 'approved' && Boolean(safeHttpUrl(route.url)),
  );
  const principalInvestigators = dedupeLeadMembers(members);
  const leadIdentityUnderReview = group.leadIdentityStatus === 'under_review';
  const membersById = new Map(members.map((member) => [memberId(member), member]));
  const primaryRecentWorkMember =
    memberRecentWorkLinks
      .map((link) => (link.memberKey ? membersById.get(link.memberKey) : undefined))
      .find((member): member is LabMember => Boolean(member)) || principalInvestigators[0];
  const primaryRecentWorkMemberName = primaryRecentWorkMember
    ? memberDisplayName(primaryRecentWorkMember)
    : 'the lead professor';
  const isResearchEntitySaved = savedResearchPlanIds.includes(group._id);
  const canRequestListingReview =
    Boolean(user?.userConfirmed) &&
    ['professor', 'faculty', 'staff'].includes(user?.userType || '') &&
    activeListings.length > 0;

  const handleToggleSavedResearchPlan = (entityId: string, shouldSave: boolean) => {
    setSavedResearchPlanFavorite(entityId, shouldSave);
    if (shouldSave && !window.localStorage.getItem(FIRST_RESEARCH_PLAN_SAVE_KEY)) {
      window.localStorage.setItem(FIRST_RESEARCH_PLAN_SAVE_KEY, 'true');
      setShowResearchPlanSavedCallout(true);
    }
  };

  return (
    <div className="mx-auto w-full max-w-screen-2xl px-4 py-6 sm:py-8 lg:px-8">
      <div className="grid grid-cols-1 gap-6 lg:gap-8">
        <div className="lg:mx-auto lg:w-full lg:max-w-5xl space-y-6 sm:space-y-8">
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
              <ResearchPlanSaveButton
                isSaved={isResearchEntitySaved}
                onToggle={(e) => {
                  e.stopPropagation();
                  handleToggleSavedResearchPlan(group._id, !isResearchEntitySaved);
                }}
              />
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

          <section className="rounded-md border border-[var(--yr-line)] bg-[var(--yr-panel)] p-4">
            <SectionHeading>Contact options</SectionHeading>
            {approvedOutreachRoute ? (
              <>
                <p className="text-sm leading-relaxed text-gray-700">
                  An administrator reviewed this official route and its source. Direct email is
                  withheld; review the current instructions before contacting the research home.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setOutreachRecordError('');
                    dispatch({ type: 'OPEN_INQUIRE_MODAL' });
                  }}
                  className="mt-3 inline-flex min-h-11 items-center rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
                >
                  Prepare inquiry
                </button>
              </>
            ) : (
              <p className="text-sm leading-relaxed text-gray-700">
                No verified contact route is available yet. Administrators must approve an official
                source before outreach is enabled.
              </p>
            )}
            {outreachRecordError && (
              <p role="alert" className="mt-2 text-sm text-amber-800">
                {outreachRecordError}
              </p>
            )}
          </section>

          <section>
            <SectionHeading>Principal Investigator</SectionHeading>
            {leadIdentityUnderReview ? (
              <div
                className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950"
                role="status"
              >
                <p className="font-semibold">Lead identity under review</p>
                <p className="mt-1">
                  The research information remains available, but this lead and profile link are not
                  shown until their sources agree.
                </p>
              </div>
            ) : (
              <LabMembersList members={principalInvestigators} />
            )}
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
                showPreprintMeta={
                  directRelatedResearchLinks.length === 0 && recentPapers.length === 0
                }
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
              </div>
            </section>
          )}

          {earlierResearchActivityLinks.length > 0 && (
            <section>
              <SectionHeading>Earlier work by listed professors</SectionHeading>
              <LabPapersList
                papers={earlierResearchActivityLinks.slice(0, 3)}
                emptyText="No earlier work is attached."
              />
            </section>
          )}

          {showWaysToApproach && (
            <WaysToApproachSection
              group={group}
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

          <ProfileStatusSection
            group={group}
            missingItems={missingSparseItems}
            accessSignals={accessSignals}
            fallbackSourceUrl={fallbackSourceUrl}
          />

          {canRequestListingReview && <ListingClaimRequestPanel listing={activeListings[0]} />}

          {sources.length > 0 && (
            <section>
              <SectionHeading>Sources</SectionHeading>
              <SourcesSection sources={sources} />
            </section>
          )}
        </div>
      </div>

      <LabInquireModal
        isOpen={isInquireModalOpen}
        onClose={() => dispatch({ type: 'CLOSE_INQUIRE_MODAL' })}
        group={group}
        members={members}
        contactRoutes={contactRoutes}
        onOfficialRouteOpen={() => {
          axios.post(`/research/${safeRouteSegment(slug || '')}/outreach`, {}).catch((err) => {
            setOutreachRecordError(
              err?.response?.status === 401 || err?.response?.status === 403
                ? 'Sign in with a student profile to record this outreach attempt.'
                : 'The official route opened, but this outreach attempt was not recorded.',
            );
          });
        }}
      />
    </div>
  );
};

export default LabDetail;

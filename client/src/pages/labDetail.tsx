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
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import axios from '../utils/axios';
import { createInitialLabDetailState, labDetailReducer } from '../reducers/labDetailReducer';
import LabHeader from '../components/labs/LabHeader';
import LabMembersList from '../components/labs/LabMembersList';
import NotFound from './notFound';
import ResearchTeamSection from '../components/labs/ResearchTeamSection';
import LongText from '../components/shared/LongText';
import FirstSaveCallout from '../components/shared/FirstSaveCallout';
import FavoriteButton from '../components/shared/FavoriteButton';
import useFavorites from '../hooks/useFavorites';
import useDocumentTitle from '../hooks/useDocumentTitle';
import {
  LabEntityRelationship,
  LabMember,
  LabRelatedResearchEntitySummary,
} from '../types/labDetail';
import { normalizeResearchEntityDetailPayload } from '../types/researchEntity';
import {
  buildResearchDetailSources,
  isSuppressedResearchWebsiteCtaUrl,
  normalizeSourceUrl,
  prefersOrgEngagementOutreach,
  resolveDecisionProfileUrl,
  resolveOutreachOfficialSource,
  ResearchDetailSource,
} from '../utils/researchDetailSources';
import { EXTERNAL_LINK_REL, safeHttpUrl, safeRouteSegment } from '../utils/url';
import { officialProfileUrlFromMemberUser } from '../utils/principalInvestigatorLinks';
import { formatTitleCaseLabel } from '../utils/displayText';
import {
  computeAcceptanceVerdict,
  EvidenceItem,
  REACH_OUT_PLAUSIBLE_LABEL,
} from '../utils/undergradAcceptance';
import {
  decisionHeadingLabel,
  isFacultyResearchEntity,
  relationshipTypeLabel,
  researchEntityDisplayName,
  sanitizeFacultyResearchCopy,
} from '../utils/researchEntityCopy';
import { getUniqueDepartmentLabels } from '../utils/departmentNames';
import { canonicalizeResearcherDepartmentLabel } from '../utils/researcherDepartmentLabel';
import { useConfig } from '../hooks/useConfig';
import { leadRoleFamily, leadSectionHeading } from '../utils/leadRoleDisplay';
import UserContext from '../contexts/UserContext';
import ListingClaimRequestPanel from '../components/faculty/ListingClaimRequestPanel';
import {
  createResearchAnalyticsInteractionId,
  trackResearchEvent,
  trackResearchEventOnce,
} from '../utils/researchAnalytics';
import { captureClientError } from '../utils/errorTracking';
import { UndergraduateLogisticsSection } from '../components/research/UndergraduateLogisticsSection';

const FIRST_RESEARCH_PLAN_SAVE_KEY = 'yale-research.firstResearchPlanSave.v1';
const YALE_DIRECTORY_URL = 'https://directory.yale.edu/';
const RESEARCH_PROFILE_NOT_FOUND_ERROR = 'Research profile not found.';

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
              key={entity.slug || entity.id}
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
            key={entity.slug || entity.id}
            to={`/research/${safeRouteSegment(entity.slug)}`}
            className={`${className} hover:border-blue-300 hover:shadow-sm`}
          >
            {content}
          </Link>
        ) : (
          <div key={entity.slug || entity.id} className={className}>
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

const researchEntitySummaryKey = (entity: LabRelatedResearchEntitySummary): string =>
  (entity.slug || entity.id || '').trim().toLowerCase();

const dedupeResearchEntitySummaries = (
  entities: LabRelatedResearchEntitySummary[],
): LabRelatedResearchEntitySummary[] => {
  const seen = new Set<string>();
  const deduped: LabRelatedResearchEntitySummary[] = [];
  for (const entity of entities) {
    const key = researchEntitySummaryKey(entity);
    if (key) {
      if (seen.has(key)) continue;
      seen.add(key);
    }
    deduped.push(entity);
  }
  return deduped;
};

const detailDescription = (group: any): string =>
  (group.fullDescription || group.shortDescription || '').replace(/[ \t\f\v]+/g, ' ').trim();

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
        Keep private notes and reach out later
      </span>
    </span>
    <span className="sr-only" role="status">
      {isSaved ? 'Research plan saved' : ''}
    </span>
  </FavoriteButton>
);

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
  profileUrl,
  websiteUrl,
  officialSource,
  preferOrgEngagementOutreach = false,
  principalInvestigator,
}: {
  group: any;
  profileUrl?: string;
  websiteUrl?: string;
  officialSource?: ResearchDetailSource;
  preferOrgEngagementOutreach?: boolean;
  principalInvestigator?: LabMember;
}) => {
  const { departments } = useConfig();
  const topics = detailTopics(group, 5);
  const usesProfileSynthesis = hasProfileSynthesisDescription(group) && !detailDescription(group);
  const usesFacultyResearchWording =
    isFacultyResearchEntity(group) || (usesProfileSynthesis && isFacultyResearchFallback(group));
  const sourceBackedDescription = detailDescription(group);
  const rawDescription =
    (usesProfileSynthesis ? group.profileSynthesisDescription : '') || sourceBackedDescription;
  const description = sanitizeFacultyResearchCopy(rawDescription, group);
  useEffect(() => {
    if (description) return;
    captureClientError(
      new Error(
        `Public research description invariant failed for ${String(
          group.slug || group._id || 'unknown',
        )}`,
      ),
    );
  }, [description, group._id, group.slug]);
  const { evidence } = computeAcceptanceVerdict(group);
  const grantSummary = formatGrantSummary(group);
  const pastAdvisees = formatPastAdvisees(group);
  const piEmail = principalInvestigator?.user?.email?.trim();
  const piName =
    principalInvestigator?.user?.displayName?.trim() ||
    [principalInvestigator?.user?.fname, principalInvestigator?.user?.lname]
      .filter(Boolean)
      .join(' ')
      .trim();
  const canonicalPiDepartment = canonicalizeResearcherDepartmentLabel(
    principalInvestigator?.user?.primaryDepartment ||
      principalInvestigator?.user?.primary_department,
    departments,
    group.departments,
  );
  const piAffiliation = [(canonicalPiDepartment || '').trim(), (group.school || '').trim()]
    .filter(Boolean)
    .join(' · ');
  const hasActionablePath =
    Boolean(piEmail) || Boolean(profileUrl) || Boolean(websiteUrl) || Boolean(officialSource);
  const visibleEvidence = hasActionablePath
    ? evidence
    : evidence.filter((item) => item.label !== REACH_OUT_PLAUSIBLE_LABEL);
  const hasEvidenceDetail =
    visibleEvidence.length > 0 || Boolean(grantSummary) || Boolean(pastAdvisees);
  return (
    <section className="rounded-lg border border-blue-100 bg-[var(--yr-panel)] p-4 shadow-sm sm:p-5">
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_16rem] md:gap-5">
        <div>
          {description && (
            <>
              <SectionHeading>Research summary</SectionHeading>
              <h2 className="text-lg font-semibold text-gray-950">
                {usesFacultyResearchWording
                  ? 'What this faculty research area covers'
                  : decisionHeadingLabel(group)}
              </h2>
              <LongText
                text={description}
                className="mt-2 text-base leading-relaxed text-gray-800"
              />
            </>
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

        <div className="divide-y divide-[var(--yr-line)] rounded-md border border-[var(--yr-line)] bg-[var(--yr-panel-muted)] p-4">
          {hasEvidenceDetail && (
            <div
              className="py-4 first:pt-0 last:pb-0"
              aria-label="Evidence supporting the acceptance signal"
            >
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-600">
                Evidence
              </p>
              {visibleEvidence.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {visibleEvidence.slice(0, 4).map((item, i) => (
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
          {principalInvestigator && (
            <div className="py-4 first:pt-0 last:pb-0">
              <SectionHeading>{leadSectionHeading([principalInvestigator])}</SectionHeading>
              <div>
                <LabMembersList
                  members={[principalInvestigator]}
                  singleColumn
                  entityDepartments={group.departments}
                />
              </div>
            </div>
          )}
          <div className="py-4 first:pt-0 last:pb-0">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-600">
              How to get involved
            </p>
            <p className="mt-1 text-sm leading-relaxed text-gray-800">
              {preferOrgEngagementOutreach
                ? 'This research home coordinates involvement at the organization level. Open its get-involved page to see how undergraduates can take part, then reach out to introduce yourself.'
                : piEmail
                  ? 'Undergraduate research almost always starts with an email. Reach out to introduce yourself and ask about getting involved.'
                  : profileUrl
                    ? 'Undergraduate research almost always starts by reaching out. Open the official profile to find contact details and introduce yourself.'
                    : websiteUrl
                      ? 'Undergraduate research almost always starts by reaching out. Visit the official website to find contact details and introduce yourself.'
                      : officialSource
                        ? 'Undergraduate research almost always starts by reaching out. Open the official page to find contact details and introduce yourself.'
                        : 'Undergraduate research almost always starts by reaching out.'}
            </p>
            {preferOrgEngagementOutreach && officialSource ? (
              <div className="mt-3 flex flex-col gap-2">
                <a
                  href={officialSource.url}
                  target="_blank"
                  rel={EXTERNAL_LINK_REL}
                  className="inline-flex min-h-11 items-center justify-center rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
                >
                  See how to get involved
                </a>
                {piEmail ? (
                  <a
                    href={`mailto:${piEmail}?subject=${encodeURIComponent(
                      'Interest in undergraduate research',
                    )}`}
                    className="inline-flex min-h-11 items-center justify-center rounded-md border border-blue-200 px-3 py-2 text-sm font-semibold text-blue-700 transition-colors hover:bg-blue-50"
                  >
                    {piName ? `Email ${piName}` : 'Email the director'}
                  </a>
                ) : profileUrl && principalInvestigator ? (
                  <a
                    href={profileUrl}
                    target="_blank"
                    rel={EXTERNAL_LINK_REL}
                    className="inline-flex min-h-11 items-center justify-center rounded-md border border-blue-200 px-3 py-2 text-sm font-semibold text-blue-700 transition-colors hover:bg-blue-50"
                  >
                    {piName ? `Contact ${piName}` : 'Contact the director'}
                  </a>
                ) : null}
              </div>
            ) : piEmail || profileUrl ? (
              <div className="mt-3 flex flex-col gap-2">
                {piEmail && (
                  <a
                    href={`mailto:${piEmail}?subject=${encodeURIComponent(
                      'Interest in undergraduate research',
                    )}`}
                    className="inline-flex min-h-11 items-center justify-center rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
                  >
                    {piName ? `Email ${piName}` : 'Email the PI'}
                  </a>
                )}
                {profileUrl && (
                  <a
                    href={profileUrl}
                    target="_blank"
                    rel={EXTERNAL_LINK_REL}
                    className={
                      piEmail
                        ? 'inline-flex min-h-11 items-center justify-center rounded-md border border-blue-200 px-3 py-2 text-sm font-semibold text-blue-700 transition-colors hover:bg-blue-50'
                        : 'inline-flex min-h-11 items-center justify-center rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200'
                    }
                  >
                    Open official profile
                  </a>
                )}
              </div>
            ) : websiteUrl ? (
              <div className="mt-3 flex flex-col gap-2">
                <a
                  href={websiteUrl}
                  target="_blank"
                  rel={EXTERNAL_LINK_REL}
                  className="inline-flex min-h-11 items-center justify-center rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
                >
                  Visit official website
                </a>
              </div>
            ) : officialSource ? (
              <div className="mt-3 flex flex-col gap-2">
                <a
                  href={officialSource.url}
                  target="_blank"
                  rel={EXTERNAL_LINK_REL}
                  className="inline-flex min-h-11 items-center justify-center rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
                >
                  Open the official page
                </a>
              </div>
            ) : (
              <div className="mt-3 rounded-md border border-[var(--yr-line)] bg-[var(--yr-panel)] p-3">
                <p className="text-sm leading-relaxed text-gray-800">
                  {piName
                    ? `Yale Research does not have a direct link for ${piName}${
                        piAffiliation ? ` (${piAffiliation})` : ''
                      } yet.`
                    : 'Yale Research does not have a direct link for this research home yet.'}
                </p>
                <p className="mt-1 text-sm leading-relaxed text-gray-600">
                  {piName
                    ? 'Look them up in the Yale Directory to find their contact details, then email to introduce yourself.'
                    : 'Search the Yale Directory and official Yale department pages to find a contact, then email to introduce yourself.'}
                </p>
                <a
                  href={YALE_DIRECTORY_URL}
                  target="_blank"
                  rel={EXTERNAL_LINK_REL}
                  className="mt-3 inline-flex min-h-11 items-center justify-center rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
                >
                  Search the Yale Directory
                </a>
              </div>
            )}
          </div>
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
        {sources.map((source) => {
          const sourceUrl = safeHttpUrl(source.url);
          return (
            <article key={source.url} className="px-4 py-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-gray-900">{source.label}</p>
                    {source.isLikelyUnavailable && (
                      <span className="inline-flex items-center rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[11px] font-medium text-gray-500">
                        may be unavailable
                      </span>
                    )}
                  </div>
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

const LabDetail = () => {
  const { isAuthenticated, user } = useContext(UserContext);
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [state, dispatch] = useReducer(labDetailReducer, undefined, () =>
    createInitialLabDetailState(),
  );
  const { payload, loading, error } = state;
  const requestIdRef = useRef(0);
  const fetchAbortRef = useRef<AbortController | null>(null);
  const [showResearchPlanSavedCallout, setShowResearchPlanSavedCallout] = useState(false);
  const { favIds: savedResearchPlanIds, setFavorite: setSavedResearchPlanFavorite } =
    useFavorites('researchPlans');
  const documentTitleGroup = payload ? (payload.group ?? payload.researchEntity) : null;
  const isNotFound = error === RESEARCH_PROFILE_NOT_FOUND_ERROR && !payload;
  useDocumentTitle(
    isNotFound
      ? 'Page not found'
      : researchEntityDisplayName(documentTitleGroup) || 'Research profile',
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
        const finalUrl: string = res.request?.responseURL || '';
        const canonicalMatch = finalUrl.match(/\/research\/([^/?#]+)(?:[/?#]|$)/i);
        const canonicalSlug = canonicalMatch ? decodeURIComponent(canonicalMatch[1]) : '';
        if (canonicalSlug && canonicalSlug.toLowerCase() !== slug.toLowerCase()) {
          navigate(`/research/${safeRouteSegment(canonicalSlug)}`, { replace: true });
          return;
        }
        dispatch({
          type: 'FETCH_SUCCESS',
          payload: normalizeResearchEntityDetailPayload(res.data),
        });
      })
      .catch((err) => {
        if (isCancel(err) || requestId !== requestIdRef.current) return;
        if (err?.response?.status === 404) {
          dispatch({ type: 'FETCH_FAILURE', payload: RESEARCH_PROFILE_NOT_FOUND_ERROR });
        } else {
          dispatch({ type: 'FETCH_FAILURE', payload: 'Failed to load this research profile.' });
        }
      });
    return () => {
      fetchAbortRef.current?.abort();
    };
  }, [slug, navigate]);

  useEffect(() => {
    const entity = payload?.researchEntity || payload?.group;
    if (!entity?._id) return;
    void trackResearchEventOnce(`profile:${location.key}:${entity._id}`, {
      eventType: 'research_profile_open',
      entityType: 'research_entity',
      entityId: entity._id,
      payload: { source: 'direct' },
    });
  }, [location.key, payload]);

  if (loading && !payload) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-16 flex justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600" />
      </div>
    );
  }

  if (error && !payload) {
    if (error === RESEARCH_PROFILE_NOT_FOUND_ERROR) {
      return <NotFound />;
    }
    return (
      <div className="yr-page flex min-h-[calc(100vh-8rem)] flex-col items-center justify-center px-4 py-14">
        <div className="yr-panel max-w-md rounded-md p-6 text-center">
          <h2 className="mb-4 text-2xl font-semibold leading-tight text-slate-950">{error}</h2>
          <p className="mb-8 text-slate-600">
            Something went wrong loading this research profile. Please try again, or head back to
            Explore Research to keep looking.
          </p>
          <Link
            to="/research"
            className="inline-flex min-h-[44px] items-center justify-center rounded-md bg-[var(--yr-blue)] px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-blue-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
          >
            Explore Yale Research
          </Link>
        </div>
      </div>
    );
  }

  if (!payload) return null;

  const {
    group: legacyGroup,
    researchEntity,
    members,
    roster = {
      status: 'no-verified-data',
      returned: 0,
      truncated: false,
      withheldCount: 0,
    },
    accessSignals = [],
    activeListings = [],
    entityRelationships = [],
    relatedResearchEntities = [],
    affiliatedResearchEntities = [],
    undergraduateLogistics,
  } = payload;
  const group = legacyGroup ?? researchEntity;
  const dedupedRelatedResearchEntities = dedupeResearchEntitySummaries(relatedResearchEntities);
  const dedupedAffiliatedResearchEntities =
    dedupeResearchEntitySummaries(affiliatedResearchEntities);
  const hasRelatedResearchEntities = dedupedRelatedResearchEntities.length > 0;
  const hasAffiliatedResearchEntities = dedupedAffiliatedResearchEntities.length > 0;
  const loadedEntitySlug = (group.slug || '').toLowerCase();
  const requestedSlug = (slug || '').toLowerCase();
  const isEntityTransition =
    loading && loadedEntitySlug !== '' && requestedSlug !== '' && loadedEntitySlug !== requestedSlug;
  const sources = buildResearchDetailSources({
    group,
    accessSignals,
    undergraduateLogistics,
    sourceLinkHealth: group.sourceLinkHealth,
  });
  const primaryWebsiteUrl =
    group.websiteUrl && !isSuppressedResearchWebsiteCtaUrl(group.websiteUrl)
      ? group.websiteUrl
      : undefined;
  const fallbackSourceUrl = primaryWebsiteUrl || sources[0]?.url;
  const leadIdentityUnderReview = group.leadIdentityStatus === 'under_review';
  const principalInvestigators = dedupeLeadMembers(members);
  const singlePrincipalInvestigator =
    !leadIdentityUnderReview && principalInvestigators.length === 1
      ? principalInvestigators[0]
      : undefined;
  const leadOfficialProfileUrl = leadIdentityUnderReview
    ? undefined
    : officialProfileUrlFromMemberUser(
        singlePrincipalInvestigator?.user as Record<string, unknown> | undefined,
      );
  const decisionProfileUrl = resolveDecisionProfileUrl(
    fallbackSourceUrl,
    group,
    leadOfficialProfileUrl,
  );
  const officialWebsiteUrl = safeHttpUrl(primaryWebsiteUrl) || undefined;
  const outreachOfficialSource = resolveOutreachOfficialSource(
    sources,
    [decisionProfileUrl, officialWebsiteUrl],
    leadIdentityUnderReview,
    group.entityType,
  );
  const singleLeadIsGenuinePrincipalInvestigator = singlePrincipalInvestigator
    ? leadRoleFamily(singlePrincipalInvestigator) === 'pi'
    : false;
  const preferOrgEngagementOutreach = prefersOrgEngagementOutreach(
    group.entityType,
    outreachOfficialSource,
    singleLeadIsGenuinePrincipalInvestigator,
  );
  const showDedicatedPrincipalInvestigatorSection =
    leadIdentityUnderReview || principalInvestigators.length !== 1;
  const isResearchEntitySaved = savedResearchPlanIds.includes(group._id);
  const canRequestListingReview =
    Boolean(user?.userConfirmed) &&
    ['professor', 'faculty', 'staff'].includes(user?.userType || '') &&
    activeListings.length > 0;

  const handleDetailLinkOpen = (event: React.MouseEvent<HTMLElement>) => {
    const anchor = (event.target as HTMLElement).closest('a');
    const sourceUrl = safeHttpUrl(anchor?.getAttribute('href'));
    if (!sourceUrl) return;
    const planningContext = group.planningContext;
    const isQualifiedAction =
      planningContext && normalizeSourceUrl(planningContext.url) === normalizeSourceUrl(sourceUrl);
    if (isQualifiedAction) {
      void trackResearchEvent({
        eventType: 'research_qualified_action',
        entityType: 'research_entity',
        entityId: group._id,
        payload: { actionCategory: planningContext.category },
        dedupeKey: createResearchAnalyticsInteractionId('action'),
      });
      return;
    }

    const sourceText = `${anchor?.textContent || ''} ${sourceUrl}`.toLowerCase();
    const sourceCategory =
      sourceText.includes('publication') || sourceText.includes('doi.org')
        ? 'publication'
        : sourceText.includes('orcid')
          ? 'orcid'
          : sourceText.includes('faculty') || sourceText.includes('profile')
            ? 'faculty_profile'
            : sourceText.includes('website') ||
                (Boolean(group.websiteUrl) && sourceText.includes(group.websiteUrl.toLowerCase()))
              ? 'entity_website'
              : sourceText.includes('evidence') || sourceText.includes('application')
                ? 'evidence'
                : 'other';
    void trackResearchEvent({
      eventType: 'research_source_review',
      entityType: 'research_entity',
      entityId: group._id,
      payload: { sourceCategory },
      dedupeKey: createResearchAnalyticsInteractionId('source'),
    });
  };

  const handleToggleSavedResearchPlan = async (entityId: string, shouldSave: boolean) => {
    if (!isAuthenticated) {
      navigate('/login', { state: { from: `${location.pathname}${location.search}` } });
      return;
    }

    const saved = await setSavedResearchPlanFavorite(entityId, shouldSave);
    if (saved && shouldSave && !window.localStorage.getItem(FIRST_RESEARCH_PLAN_SAVE_KEY)) {
      window.localStorage.setItem(FIRST_RESEARCH_PLAN_SAVE_KEY, 'true');
      setShowResearchPlanSavedCallout(true);
    }
  };

  return (
    <div
      className="mx-auto w-full max-w-screen-2xl px-4 py-6 sm:py-8 lg:px-8"
      onClickCapture={handleDetailLinkOpen}
    >
      {isEntityTransition && (
        <div
          className="fixed inset-x-0 top-0 z-50 h-0.5 animate-pulse bg-blue-500"
          role="progressbar"
          aria-label="Loading research profile"
        />
      )}
      <div
        className={`grid grid-cols-1 gap-6 transition-opacity duration-200 lg:gap-8 ${
          isEntityTransition ? 'pointer-events-none opacity-60' : ''
        }`}
        aria-busy={isEntityTransition}
      >
        <div className="lg:mx-auto lg:w-full lg:max-w-5xl space-y-6 sm:space-y-8">
          {showResearchPlanSavedCallout && (
            <FirstSaveCallout
              kind="researchPlan"
              onDismiss={() => setShowResearchPlanSavedCallout(false)}
            />
          )}

          <LabHeader
            group={group}
            dedupeWebsiteUrls={[decisionProfileUrl]}
            actions={
              <ResearchPlanSaveButton
                isSaved={isResearchEntitySaved}
                onToggle={(e) => {
                  e.stopPropagation();
                  void handleToggleSavedResearchPlan(group._id, !isResearchEntitySaved);
                }}
              />
            }
          />

          <DecisionSummary
            group={group}
            profileUrl={decisionProfileUrl}
            websiteUrl={officialWebsiteUrl}
            officialSource={outreachOfficialSource}
            preferOrgEngagementOutreach={preferOrgEngagementOutreach}
            principalInvestigator={singlePrincipalInvestigator}
          />

          <UndergraduateLogisticsSection logistics={undergraduateLogistics} />

          {showDedicatedPrincipalInvestigatorSection && (
            <section>
              <SectionHeading>{leadSectionHeading(principalInvestigators)}</SectionHeading>
              {leadIdentityUnderReview ? (
                <div
                  className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950"
                  role="status"
                >
                  <p className="font-semibold">Lead identity under review</p>
                  <p className="mt-1">
                    The research information remains available, but this lead and profile link are
                    not shown until their sources agree.
                  </p>
                </div>
              ) : (
                <LabMembersList
                  members={principalInvestigators}
                  entityDepartments={group.departments}
                />
              )}
            </section>
          )}

          <ResearchTeamSection members={members} roster={roster} />

          {hasRelatedResearchEntities && (
            <RelatedResearchEntitiesSection
              relationships={entityRelationships}
              relatedResearchEntities={dedupedRelatedResearchEntities}
            />
          )}

          {hasAffiliatedResearchEntities && (
            <AffiliatedResearchEntitiesSection
              affiliatedResearchEntities={dedupedAffiliatedResearchEntities}
            />
          )}

          {canRequestListingReview && <ListingClaimRequestPanel listing={activeListings[0]} />}

          {sources.length > 0 && (
            <section>
              <SectionHeading>Sources</SectionHeading>
              <SourcesSection sources={sources} />
            </section>
          )}
        </div>
      </div>
    </div>
  );
};

export default LabDetail;

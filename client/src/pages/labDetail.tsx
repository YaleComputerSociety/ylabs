import { dedupeLeadMembers, memberPersonName } from '../utils/leadMemberDedupe';
import {
  decisionSummaryShowsWebsiteCta,
  resolveResearchDetailActionLinkContext,
  resolveResearchDetailActionLinks,
} from '../utils/researchDetailActionLinks';
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
  firstCitedResearchDetailSource,
  isLikelyUnavailableSourceLink,
  isSameActionDestination,
  isSuppressedResearchWebsiteCtaUrl,
  isUnreachableResearchWebsiteCtaUrl,
  normalizeSourceUrl,
  prefersOrgEngagementOutreach,
  ResearchDetailSource,
  resolveDecisionProfileUrl,
  resolveOutreachOfficialSource,
  sourceLedgerKey,
} from '../utils/researchDetailSources';
import { EXTERNAL_LINK_REL, safeHttpUrl, safeMailtoHref, safeRouteSegment } from '../utils/url';
import { officialProfileUrlFromMemberUser } from '../utils/principalInvestigatorLinks';
import { formatTitleCaseLabel } from '../utils/displayText';
import {
  decisionHeadingLabel,
  entityKindLabel,
  isFacultyResearchEntity,
  relationshipTypeLabel,
  researchEntityTitle,
  researchWebsiteCtaLabel,
  sanitizeResearchEntityCopy,
} from '../utils/researchEntityCopy';
import { getUniqueDepartmentLabels } from '../utils/departmentNames';
import { canonicalizeResearcherDepartmentLabel } from '../utils/researcherDepartmentLabel';
import { useConfig } from '../hooks/useConfig';
import { DepartmentResearchContextSection } from '../components/research/DepartmentResearchContextSection';
import { leadRoleFamily, leadSectionHeading } from '../utils/leadRoleDisplay';
import UserContext from '../contexts/UserContext';
import EntityCorrectionReportPanel from '../components/research/EntityCorrectionReportPanel';
import {
  createResearchAnalyticsInteractionId,
  trackResearchEvent,
  trackResearchEventOnce,
} from '../utils/researchAnalytics';
import { captureClientError } from '../utils/errorTracking';

const FIRST_RESEARCH_PLAN_SAVE_KEY = 'yale-research.firstResearchPlanSave.v1';
const YALE_DIRECTORY_URL = 'https://directory.yale.edu/';
const buildYaleDirectorySearchUrl = (name?: string): string => {
  const trimmed = name?.trim();
  if (!trimmed) return YALE_DIRECTORY_URL;
  return `${YALE_DIRECTORY_URL}?query=${encodeURIComponent(trimmed)}`;
};
const RESEARCH_PROFILE_NOT_FOUND_ERROR = 'Research profile not found.';

const SectionHeading = ({ children }: { children: React.ReactNode }) => (
  <h2 className="yr-kicker mb-3">{children}</h2>
);

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
              entityKindLabel(entity),
              ...compactDepartmentLabels(entity.departments),
            ],
            3,
          );
          return (
            <Link
              key={entity.slug || entity.id}
              to={`/research/${safeRouteSegment(entity.slug)}`}
              className="block rounded-card border border-[var(--yr-line)] bg-[var(--yr-panel)] p-4 [transition-property:color,background-color,border-color,box-shadow] hover:border-line-strong hover:shadow-yr-raised yr-focus-ring"
            >
              <div className="flex flex-wrap gap-2">
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full bg-brand-soft px-2 py-1 text-xs font-medium text-brand"
                  >
                    {tag}
                  </span>
                ))}
              </div>
              <h3 className="mt-3 text-sm font-semibold text-ink">{researchEntityTitle(entity)}</h3>
              {description && (
                <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-muted">
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
                [entityKindLabel(entity), ...compactDepartmentLabels(entity.departments)],
                3,
              ).map((tag) => (
                <span
                  key={tag}
                  className="rounded-full bg-[var(--yr-panel-muted)] px-2 py-1 text-xs font-medium text-ink-soft"
                >
                  {tag}
                </span>
              ))}
            </div>
            <h3 className="mt-3 text-sm font-semibold text-ink">{researchEntityTitle(entity)}</h3>
          </>
        );
        const className =
          'block rounded-card border border-[var(--yr-line)] bg-[var(--yr-panel)] p-4 [transition-property:color,background-color,border-color,box-shadow] yr-focus-ring';
        const canOpenDetail = Boolean(entity.slug);
        return canOpenDetail ? (
          <Link
            key={entity.slug || entity.id}
            to={`/research/${safeRouteSegment(entity.slug)}`}
            className={`${className} hover:border-line-strong hover:shadow-yr-raised`}
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

const SimilarResearchEntitiesSection = ({
  similarResearchEntities,
}: {
  similarResearchEntities: LabRelatedResearchEntitySummary[];
}) => (
  <section>
    <SectionHeading>More like this</SectionHeading>
    <p className="-mt-2 mb-3 text-sm text-muted">Other research studying similar topics.</p>
    <div className="grid gap-3 sm:grid-cols-2">
      {similarResearchEntities.map((entity) => (
        <Link
          key={entity.slug || entity.id}
          to={`/research/${safeRouteSegment(entity.slug)}`}
          className="block rounded-card border border-dashed border-[var(--yr-line)] bg-[var(--yr-panel)] p-4 [transition-property:color,background-color,border-color,box-shadow] hover:border-line-strong hover:shadow-yr-raised yr-focus-ring"
        >
          <div className="flex flex-wrap gap-2">
            {uniqueCompact(
              [entityKindLabel(entity), ...compactDepartmentLabels(entity.departments)],
              3,
            ).map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-[var(--yr-panel-muted)] px-2 py-1 text-xs font-medium text-ink-soft"
              >
                {tag}
              </span>
            ))}
          </div>
          <h3 className="mt-3 text-sm font-semibold text-ink">{researchEntityTitle(entity)}</h3>
          {entity.blurb && (
            <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-muted">{entity.blurb}</p>
          )}
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

const detailMethods = (group: any, limit = 8): string[] =>
  uniqueCompact([...(group.methods || [])], limit);

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
    className="flex w-full items-start gap-3 rounded-card border border-[var(--yr-line)] bg-[var(--yr-panel)] px-3 py-2 text-left transition-colors hover:border-line-brand hover:bg-brand-soft yr-focus-ring sm:w-auto sm:min-w-[13rem]"
    iconClassName="mt-0.5 shrink-0"
  >
    <span className="min-w-0 flex-1">
      <span className="block text-sm font-semibold text-ink">
        {isSaved ? 'Saved to Dashboard' : 'Save research plan'}
      </span>
      <span className="mt-0.5 block text-xs leading-relaxed text-muted">
        Keep private notes and reach out later
      </span>
    </span>
    <span className="sr-only" role="status">
      {isSaved ? 'Research plan saved' : ''}
    </span>
  </FavoriteButton>
);

const GuestSaveCta = ({ returnPath }: { returnPath: string }) => (
  <Link
    to="/login"
    state={{ from: returnPath }}
    className="yr-pressable flex w-full items-start gap-3 rounded-card border border-[var(--yr-line)] bg-[var(--yr-panel)] px-3 py-2 text-left transition-colors hover:border-line-brand hover:bg-brand-soft yr-focus-ring sm:w-auto sm:min-w-[13rem]"
  >
    <span className="min-w-0 flex-1">
      <span className="block text-sm font-semibold text-ink">Log in with Yale to save</span>
      <span className="mt-0.5 block text-xs leading-relaxed text-muted">
        Save this research, keep private notes, and reach out
      </span>
    </span>
  </Link>
);

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

const DecisionSummary = ({
  group,
  profileUrl,
  websiteUrl,
  officialSource,
  preferOrgEngagementOutreach = false,
  principalInvestigator,
  leadProfilesLinkedInline = false,
}: {
  group: any;
  profileUrl?: string;
  websiteUrl?: string;
  officialSource?: ResearchDetailSource;
  preferOrgEngagementOutreach?: boolean;
  principalInvestigator?: LabMember;
  leadProfilesLinkedInline?: boolean;
}) => {
  const { departments, departmentPillEligibleLabels } = useConfig();
  const topics = detailTopics(group, 5);
  const methods = detailMethods(group);
  const usesProfileSynthesis = hasProfileSynthesisDescription(group) && !detailDescription(group);
  const usesFacultyResearchWording =
    isFacultyResearchEntity(group) || (usesProfileSynthesis && isFacultyResearchFallback(group));
  const sourceBackedDescription = detailDescription(group);
  const rawDescription =
    (usesProfileSynthesis ? group.profileSynthesisDescription : '') || sourceBackedDescription;
  const description = sanitizeResearchEntityCopy(rawDescription, group);
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
  const grantSummary = formatGrantSummary(group);
  const pastAdvisees = formatPastAdvisees(group);
  const piEmail = principalInvestigator?.user?.email?.trim();
  const piName =
    principalInvestigator?.user?.displayName?.trim() ||
    [principalInvestigator?.user?.fname, principalInvestigator?.user?.lname]
      .filter(Boolean)
      .join(' ')
      .trim();
  const directorySearchName = piName || researchEntityTitle(group).trim();
  const directorySearchUrl = buildYaleDirectorySearchUrl(directorySearchName);
  const canonicalPiDepartment = canonicalizeResearcherDepartmentLabel(
    principalInvestigator?.user?.primaryDepartment ||
      principalInvestigator?.user?.primary_department,
    departments,
    {
      pillEligibleLabels: departmentPillEligibleLabels,
      entityDepartments: group.departments,
    },
  );
  const piAffiliation = [(canonicalPiDepartment || '').trim(), (group.school || '').trim()]
    .filter(Boolean)
    .join(' · ');
  const piMailtoHref = safeMailtoHref(piEmail);
  const hasActionablePath =
    Boolean(piMailtoHref) || Boolean(profileUrl) || Boolean(websiteUrl) || Boolean(officialSource);
  const hasEvidenceDetail = Boolean(grantSummary) || Boolean(pastAdvisees);
  const profileNeedsOwnButton =
    Boolean(profileUrl) && !principalInvestigator && !leadProfilesLinkedInline;
  const actionLinks = resolveResearchDetailActionLinks({
    websiteUrl,
    profileUrl,
    piEmail: piMailtoHref,
    hasLeadCard: Boolean(principalInvestigator),
    profileNeedsOwnButton,
    preferOrgEngagementOutreach,
    officialSource,
  });
  const showsWebsiteCta = actionLinks.showsWebsiteCta;
  const leadCardProfileUrl = actionLinks.leadCardProfileUrl;
  /**
   * The fallback branch below tells a student y/labs has no direct link and sends
   * them to the directory. That is false whenever the card above already links this
   * person's profile, and emptying the website slot (#2854) makes this the branch
   * those rows land on, so the copy has to know which of the two situations it is in.
   */
  const leadCardLinksProfile = actionLinks.leadCardLinksProfile;
  const showGetInvolvedBlock =
    (preferOrgEngagementOutreach && Boolean(officialSource)) ||
    Boolean(piMailtoHref) ||
    profileNeedsOwnButton ||
    showsWebsiteCta ||
    Boolean(officialSource) ||
    !hasActionablePath;
  return (
    <section className="rounded-card border border-line bg-panel p-4 shadow-yr-raised sm:p-5">
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_16rem] md:gap-5">
        <div>
          <SectionHeading>Research summary</SectionHeading>
          {description ? (
            <>
              <h2 className="text-lg font-semibold text-ink">
                {usesFacultyResearchWording
                  ? 'What this faculty research covers'
                  : decisionHeadingLabel(group)}
              </h2>
              <LongText
                text={description}
                className="mt-2 max-w-[68ch] text-base leading-relaxed text-ink"
                paragraphClassName="mt-4 first:mt-0"
              />
            </>
          ) : (
            <>
              <h2 className="text-lg font-semibold text-ink">No published research summary yet</h2>
              <p className="mt-2 max-w-[68ch] text-base leading-relaxed text-ink-soft">
                This section normally explains what the research covers, in its own words. Yale
                Research has not found a description it can publish for this one
                {showGetInvolvedBlock
                  ? ', so use the sources and contacts listed here to check the work directly before deciding fit.'
                  : '. Check the linked sources further down this page before deciding fit.'}
              </p>
            </>
          )}
          {usesProfileSynthesis && (
            <p className="mt-3 text-sm leading-relaxed text-muted">
              This is profile-derived context. y/labs has not found a separate research website or
              posted undergraduate opening for this research.
            </p>
          )}

          {topics.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted">
                Best fit for
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {topics.map((topic) => (
                  <span
                    key={topic}
                    className="rounded-card border border-line-brand bg-brand-soft px-2.5 py-1 text-xs font-medium text-brand"
                  >
                    {formatTitleCaseLabel(topic)}
                  </span>
                ))}
              </div>
            </div>
          )}

          {methods.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted">
                Methods and techniques
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {methods.map((method) => (
                  <span
                    key={method}
                    className="inline-flex items-center rounded-card border border-[var(--yr-line)] bg-[var(--yr-panel-muted)] px-2.5 py-1 text-xs font-medium text-ink-soft"
                  >
                    {formatTitleCaseLabel(method)}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="divide-y divide-[var(--yr-line)] self-start rounded-card border border-[var(--yr-line)] bg-[var(--yr-panel-muted)] p-4">
          {hasEvidenceDetail && (
            <div className="py-4 first:pt-0 last:pb-0" aria-label="Research activity evidence">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted">Evidence</p>
              {(grantSummary || pastAdvisees) && (
                <ul className="mt-3 space-y-1 text-xs text-muted">
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
                  resolveMemberProfileUrl={() => leadCardProfileUrl}
                />
              </div>
            </div>
          )}
          {showGetInvolvedBlock && (
            <div className="py-4 first:pt-0 last:pb-0">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted">
                How to get involved
              </p>
              {preferOrgEngagementOutreach && officialSource ? (
                <>
                  <p className="mt-1 text-sm leading-relaxed text-ink">
                    This organization coordinates involvement centrally. Open its get-involved page
                    to see how undergraduates can take part, then reach out to introduce yourself.
                  </p>
                  <div className="mt-3 flex flex-col gap-2">
                    <a
                      href={officialSource.url}
                      target="_blank"
                      rel={EXTERNAL_LINK_REL}
                      className="yr-pressable inline-flex min-h-11 items-center justify-center rounded-control bg-brand px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-navy yr-focus-ring"
                    >
                      See how to get involved
                    </a>
                    {profileUrl && principalInvestigator ? (
                      <a
                        href={profileUrl}
                        target="_blank"
                        rel={EXTERNAL_LINK_REL}
                        className="yr-pressable inline-flex min-h-11 items-center justify-center rounded-control border border-line px-3 py-2 text-sm font-semibold text-brand transition-colors hover:bg-brand-soft yr-focus-ring"
                      >
                        {piName ? `Contact ${piName}` : 'Contact the director'}
                      </a>
                    ) : null}
                  </div>
                </>
              ) : profileNeedsOwnButton ? (
                <div className="mt-3 flex flex-col gap-2">
                  <a
                    href={profileUrl}
                    target="_blank"
                    rel={EXTERNAL_LINK_REL}
                    className="yr-pressable inline-flex min-h-11 items-center justify-center rounded-control bg-brand px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-navy yr-focus-ring"
                  >
                    Open official profile
                  </a>
                </div>
              ) : showsWebsiteCta ? (
                <div className="mt-3 flex flex-col gap-2">
                  <a
                    href={websiteUrl}
                    target="_blank"
                    rel={EXTERNAL_LINK_REL}
                    className="yr-pressable inline-flex min-h-11 items-center justify-center rounded-control bg-brand px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-navy yr-focus-ring"
                  >
                    {researchWebsiteCtaLabel(group)}
                  </a>
                </div>
              ) : officialSource ? (
                <div className="mt-3 flex flex-col gap-2">
                  <a
                    href={officialSource.url}
                    target="_blank"
                    rel={EXTERNAL_LINK_REL}
                    className="yr-pressable inline-flex min-h-11 items-center justify-center rounded-control bg-brand px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-navy yr-focus-ring"
                  >
                    Open the official page
                  </a>
                </div>
              ) : (
                <div className="mt-3 rounded-card border border-[var(--yr-line)] bg-[var(--yr-panel)] p-3">
                  {leadCardLinksProfile ? (
                    <>
                      <p className="text-sm leading-relaxed text-ink">
                        {piName
                          ? `${piName}'s official profile is linked in the card above.`
                          : 'The official profile is linked in the card above.'}
                      </p>
                      <p className="mt-1 text-sm leading-relaxed text-muted">
                        y/labs has no separate website for this research, so open that profile for
                        contact details, then email to introduce yourself.
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="text-sm leading-relaxed text-ink">
                        {piName
                          ? `y/labs does not have a direct link for ${piName}${
                              piAffiliation ? ` (${piAffiliation})` : ''
                            } yet.`
                          : 'y/labs does not have a direct link for this research yet.'}
                      </p>
                      <p className="mt-1 text-sm leading-relaxed text-muted">
                        {piName
                          ? 'Look them up in the Yale Directory to find their contact details, then email to introduce yourself.'
                          : 'Search the Yale Directory and official Yale department pages to find a contact, then email to introduce yourself.'}
                      </p>
                      <a
                        href={directorySearchUrl}
                        target="_blank"
                        rel={EXTERNAL_LINK_REL}
                        className="yr-pressable mt-3 inline-flex min-h-11 items-center justify-center rounded-control bg-brand px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-navy yr-focus-ring"
                      >
                        Search the Yale Directory
                      </a>
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
};

const SourcesSection = ({
  sources,
  primaryProfileUrl,
}: {
  sources: ResearchDetailSource[];
  primaryProfileUrl?: string;
}) => {
  if (sources.length === 0) return null;
  /**
   * Only an access-signal context is action evidence. The previous test was "any context not
   * starting with Profile", which a per-field contribution label satisfies, so serving the
   * attribution for a row's topics or methods announced action evidence the page does not
   * have (#3341).
   */
  const hasActionContext = sources.some((source) =>
    source.contexts.some((context) => /\bevidence$/i.test(context)),
  );

  return (
    <div className="rounded-card border border-[var(--yr-line)] bg-[var(--yr-panel)]">
      <div className="border-b border-[var(--yr-line)] px-4 py-3">
        <p className="text-sm text-muted">
          {hasActionContext
            ? 'These official pages support the profile details and action evidence shown above.'
            : 'These official pages support the research profile details shown above.'}
        </p>
      </div>
      <div className="divide-y divide-line">
        {sources.map((source) => {
          const sourceUrl = safeHttpUrl(source.url);
          return (
            <article key={source.url} className="px-4 py-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-ink">{source.label}</p>
                    {isSameActionDestination(source.url, primaryProfileUrl) && (
                      <span className="inline-flex items-center rounded-card border border-line-brand bg-brand-soft px-1.5 py-0.5 text-[11px] font-medium text-ink-soft">
                        opened above
                      </span>
                    )}
                    {source.isLikelyUnavailable && (
                      <span className="inline-flex items-center rounded-card border border-line bg-panel-muted px-1.5 py-0.5 text-[11px] font-medium text-muted">
                        may be unavailable
                      </span>
                    )}
                    {source.isPrivateNetworkOnly && (
                      <span className="inline-flex items-center rounded-card border border-line bg-panel-muted px-1.5 py-0.5 text-[11px] font-medium text-muted">
                        on-campus network only
                      </span>
                    )}
                  </div>
                  <p className="mt-1 break-all text-xs text-muted">{sourceHost(source.url)}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {source.contexts.map((context) => (
                      <span
                        key={context}
                        className="rounded-card border border-[var(--yr-line)] bg-[var(--yr-panel-muted)] px-2 py-1 text-xs text-muted"
                      >
                        {context}
                      </span>
                    ))}
                  </div>
                </div>
                {sourceUrl && !source.isLikelyUnavailable && (
                  <a
                    href={sourceUrl}
                    target="_blank"
                    rel={EXTERNAL_LINK_REL}
                    className="yr-pressable inline-flex min-h-11 shrink-0 items-center justify-center rounded-card border border-[var(--yr-line-strong)] px-3 text-sm font-semibold text-ink hover:bg-[var(--yr-panel-muted)] yr-focus-ring"
                  >
                    Open source
                  </a>
                )}
                {sourceUrl && source.isLikelyUnavailable && (
                  <p className="shrink-0 self-center text-xs text-muted">
                    No longer reachable, kept as the record of what this page cited
                  </p>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
};

const LabDetail = () => {
  const { isAuthenticated } = useContext(UserContext);
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
  const { favIds: savedResearchPlanIds, setFavorite: setSavedResearchPlanFavorite } = useFavorites(
    'researchPlans',
    { enabled: isAuthenticated },
  );
  const documentTitleGroup = payload ? (payload.group ?? payload.researchEntity) : null;
  const isNotFound = error === RESEARCH_PROFILE_NOT_FOUND_ERROR && !payload;
  useDocumentTitle(
    isNotFound ? 'Page not found' : researchEntityTitle(documentTitleGroup) || 'Research profile',
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
          void navigate(`/research/${safeRouteSegment(canonicalSlug)}`, { replace: true });
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
      <div
        role="status"
        aria-label="Loading research profile"
        className="max-w-6xl mx-auto px-4 py-16 flex justify-center"
      >
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-brand" />
      </div>
    );
  }

  if (error && !payload) {
    if (error === RESEARCH_PROFILE_NOT_FOUND_ERROR) {
      return <NotFound />;
    }
    return (
      <div className="yr-page flex min-h-[calc(100vh-8rem)] flex-col items-center justify-center px-4 py-14">
        <div className="yr-panel max-w-md rounded-card p-6 text-center">
          <h2 className="yr-display mb-4 text-2xl font-semibold leading-tight text-ink">{error}</h2>
          <p className="mb-8 text-muted">
            Something went wrong loading this research profile. Please try again, or head back to
            Explore Research to keep looking.
          </p>
          <Link
            to="/research"
            className="yr-pressable inline-flex min-h-[44px] items-center justify-center rounded-control bg-[var(--yr-blue)] px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-navy yr-focus-ring"
          >
            Explore research
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
    departmentCourseCreditRoutes = [],
    entityRelationships = [],
    relatedResearchEntities = [],
    affiliatedResearchEntities = [],
    similarResearchEntities = [],
  } = payload;
  const group = legacyGroup ?? researchEntity;
  const dedupedRelatedResearchEntities = dedupeResearchEntitySummaries(relatedResearchEntities);
  const dedupedAffiliatedResearchEntities = dedupeResearchEntitySummaries(
    affiliatedResearchEntities,
  );
  const structuralResearchEntityKeys = new Set(
    [...dedupedRelatedResearchEntities, ...dedupedAffiliatedResearchEntities].map(
      researchEntitySummaryKey,
    ),
  );
  const dedupedSimilarResearchEntities = dedupeResearchEntitySummaries(
    similarResearchEntities,
  ).filter((entity) => !structuralResearchEntityKeys.has(researchEntitySummaryKey(entity)));
  const hasRelatedResearchEntities = dedupedRelatedResearchEntities.length > 0;
  const hasAffiliatedResearchEntities = dedupedAffiliatedResearchEntities.length > 0;
  const hasSimilarResearchEntities = dedupedSimilarResearchEntities.length > 0;
  const loadedEntitySlug = (group.slug || '').toLowerCase();
  const requestedSlug = (slug || '').toLowerCase();
  const isEntityTransition =
    loading &&
    loadedEntitySlug !== '' &&
    requestedSlug !== '' &&
    loadedEntitySlug !== requestedSlug;
  const sources = buildResearchDetailSources({
    group,
    accessSignals,
    sourceLinkHealth: group.sourceLinkHealth,
    sourceFieldContributions: group.sourceFieldContributions,
  });
  const primaryWebsiteUrl =
    group.websiteUrl &&
    !isSuppressedResearchWebsiteCtaUrl(group.websiteUrl) &&
    !isUnreachableResearchWebsiteCtaUrl(group.websiteUrl, group.sourceLinkHealth)
      ? group.websiteUrl
      : undefined;
  const primaryWebsiteHealthKey = sourceLedgerKey(primaryWebsiteUrl);
  const primaryWebsiteHealth = primaryWebsiteHealthKey
    ? group.sourceLinkHealth?.find(
        (entry) => sourceLedgerKey(entry.url) === primaryWebsiteHealthKey,
      )
    : undefined;
  const isPrimaryWebsiteLikelyUnavailable = isLikelyUnavailableSourceLink(primaryWebsiteHealth);
  const fallbackSourceUrl = primaryWebsiteUrl || firstCitedResearchDetailSource(sources)?.url;
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
  const leadPersonNames = principalInvestigators.map(memberPersonName).filter(Boolean);
  const decisionProfileUrl = resolveDecisionProfileUrl(
    fallbackSourceUrl,
    group,
    leadOfficialProfileUrl,
    leadPersonNames,
  );
  const officialWebsiteUrl = isPrimaryWebsiteLikelyUnavailable
    ? undefined
    : safeHttpUrl(primaryWebsiteUrl) || undefined;
  const outreachOfficialSource = resolveOutreachOfficialSource(
    sources,
    [decisionProfileUrl, officialWebsiteUrl],
    leadIdentityUnderReview,
    group.entityType,
    { schools: [group.school, ...(Array.isArray(group.schools) ? group.schools : [])] },
    leadPersonNames,
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
  const resolveLeadOfficialProfileUrl = (member: LabMember): string | undefined =>
    officialProfileUrlFromMemberUser(member.user as unknown as Record<string, unknown>);
  const leadProfilesLinkedInline =
    showDedicatedPrincipalInvestigatorSection &&
    !leadIdentityUnderReview &&
    principalInvestigators.some((member) => Boolean(resolveLeadOfficialProfileUrl(member)));
  // One composition, shared with `research-entity:audit-duplicate-action-links`. The
  // audit must not build this context a second way, or it stops measuring the page.
  const decisionSummaryLinksWebsite = decisionSummaryShowsWebsiteCta(
    resolveResearchDetailActionLinkContext({ group, members, accessSignals }),
  );
  const headerWebsiteDedupeUrls = decisionSummaryLinksWebsite
    ? [decisionProfileUrl, officialWebsiteUrl]
    : [decisionProfileUrl];
  const isResearchEntitySaved = savedResearchPlanIds.includes(group._id);
  const handleDetailLinkOpen = (event: React.MouseEvent<HTMLElement>) => {
    const anchor = (event.target as HTMLElement).closest('a');
    const href = anchor?.getAttribute('href');
    // Reaching out is the one step that says the directory worked, and it is the step this
    // handler used to drop: `safeHttpUrl` rejects a `mailto:` scheme, so every click on a lead's
    // email returned early and recorded nothing. The href itself is never sent, only the coarse
    // method, because the analytics contract forbids retaining a contact destination.
    if (typeof href === 'string' && /^mailto:/i.test(href.trim())) {
      void trackResearchEvent({
        eventType: 'contact_route_click',
        entityType: 'research_entity',
        entityId: group._id,
        payload: { contactMethod: 'email' },
        dedupeKey: createResearchAnalyticsInteractionId('contact'),
      });
      return;
    }
    const sourceUrl = safeHttpUrl(href);
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
      void navigate('/login', { state: { from: `${location.pathname}${location.search}` } });
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
          className="fixed inset-x-0 top-0 z-50 h-0.5 animate-pulse bg-brand"
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
            dedupeWebsiteUrls={headerWebsiteDedupeUrls}
            actions={
              isAuthenticated ? (
                <ResearchPlanSaveButton
                  isSaved={isResearchEntitySaved}
                  onToggle={(e) => {
                    e.stopPropagation();
                    void handleToggleSavedResearchPlan(group._id, !isResearchEntitySaved);
                  }}
                />
              ) : (
                <GuestSaveCta returnPath={`${location.pathname}${location.search}`} />
              )
            }
          />

          <DecisionSummary
            group={group}
            profileUrl={decisionProfileUrl}
            websiteUrl={officialWebsiteUrl}
            officialSource={outreachOfficialSource}
            preferOrgEngagementOutreach={preferOrgEngagementOutreach}
            principalInvestigator={singlePrincipalInvestigator}
            leadProfilesLinkedInline={leadProfilesLinkedInline}
          />

          <DepartmentResearchContextSection routes={departmentCourseCreditRoutes} />

          {showDedicatedPrincipalInvestigatorSection && (
            <section>
              <SectionHeading>{leadSectionHeading(principalInvestigators)}</SectionHeading>
              {leadIdentityUnderReview ? (
                <div
                  className="rounded-card border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950"
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
                  resolveMemberProfileUrl={resolveLeadOfficialProfileUrl}
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

          {hasSimilarResearchEntities && (
            <SimilarResearchEntitiesSection
              similarResearchEntities={dedupedSimilarResearchEntities}
            />
          )}

          {sources.length > 0 && (
            <section>
              <SectionHeading>Sources</SectionHeading>
              <SourcesSection sources={sources} primaryProfileUrl={decisionProfileUrl} />
            </section>
          )}

          {isAuthenticated && slug && (
            <EntityCorrectionReportPanel slug={slug} entityName={researchEntityTitle(group)} />
          )}
        </div>
      </div>
    </div>
  );
};

export default LabDetail;

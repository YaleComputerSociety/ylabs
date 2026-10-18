import { dedupeLeadMembers, memberPersonName } from '../utils/leadMemberDedupe';
import { formatLeadHonors } from '../utils/leadHonors';
import {
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
import ResearchProfileSkeleton, {
  researchProfileColumnClassName,
  researchProfileGridClassName,
  researchProfilePageClassName,
} from '../components/labs/ResearchProfileSkeleton';
import { undergraduateMemberEvidence } from '../utils/undergraduateMemberEvidence';
import { formatPastAdvisees } from '../utils/pastUndergradAdvisees';
import ResearchResultsBackLink from '../components/research/ResearchResultsBackLink';
import { deeperResearchResultsReturnState } from '../utils/researchResultsReturn';
import LabMembersList from '../components/labs/LabMembersList';
import NotFound from './notFound';
import { searchQueryFromResearchSlug } from '../utils/researchSlugSearchQuery';
import ResearchTeamSection from '../components/labs/ResearchTeamSection';
import FellowshipRecipientsSection from '../components/labs/FellowshipRecipientsSection';
import LongText from '../components/shared/LongText';
import ArrowRightIcon from '../components/shared/ArrowRightIcon';
import FirstSaveCallout from '../components/shared/FirstSaveCallout';
import UndoRemovalBanner from '../components/shared/UndoRemovalBanner';
import useUndoableRemoval from '../hooks/useUndoableRemoval';
import OperatorPreviewNotice from '../components/labs/OperatorPreviewNotice';
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
  findSourceLinkHealthEntry,
  isLikelyUnavailableSourceLink,
  isSameActionDestination,
  isSuppressedResearchWebsiteCtaUrl,
  isUnreachableResearchWebsiteCtaUrl,
  prefersOrgEngagementOutreach,
  ResearchDetailSource,
  resolveDecisionProfileUrl,
  resolveOutreachApplySource,
  servedResearchWebsiteUrl,
  resolveOutreachOfficialSource,
  vettedJoinPageUrls,
  ACCESS_SIGNAL_SOURCE_CONTEXTS,
  isCitableAccessSignal,
  joinPageLinkLabel,
} from '../utils/researchDetailSources';
import { formatGrantSummary } from '../utils/grantAgencyNames';
import LeadRoleExplanation from '../components/research/LeadRoleExplanation';
import { EXTERNAL_LINK_REL, safeHttpUrl, safeMailtoHref, safeRouteSegment } from '../utils/url';
import { officialProfileUrlFromMemberUser } from '../utils/principalInvestigatorLinks';
import { formatTitleCaseLabel, formatTopicChipLabel } from '../utils/displayText';
import {
  decisionHeadingLabel,
  entityKindLabel,
  isCreativePracticeEntity,
  leadRoleLabelForEntity,
  relationshipTypeLabel,
  researchEntityTitle,
  researchWebsiteCtaLabel,
  sanitizeResearchEntityCopy,
  summarySectionLabel,
} from '../utils/researchEntityCopy';
import { getUniqueDepartmentLabels } from '../utils/departmentNames';
import { canonicalizeResearcherDepartmentLabel } from '../utils/researcherDepartmentLabel';
import { useConfig } from '../hooks/useConfig';
import { leadRoleFamily, leadSectionHeading } from '../utils/leadRoleDisplay';
import UserContext from '../contexts/UserContext';
import EntityCorrectionReportPanel from '../components/research/EntityCorrectionReportPanel';
import {
  createResearchAnalyticsInteractionId,
  readResearchProfileOpenSource,
  researchProfileOpenState,
  trackResearchEvent,
  trackResearchEventOnce,
} from '../utils/researchAnalytics';
import { captureClientError } from '../utils/errorTracking';
import {
  UNDERGRAD_QUOTE_LABEL,
  undergradQuoteEvidenceFromEntity,
} from '../utils/undergradQuoteEvidence';

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

type RelatedProfileOpenState = ReturnType<typeof researchProfileOpenState> &
  ReturnType<typeof deeperResearchResultsReturnState>;

const PRINCIPAL_INVESTIGATOR_HEADING = /^Principal Investigators?$/;

const LeadSectionHeading = ({ heading }: { heading: string }) => (
  <>
    <SectionHeading>{heading}</SectionHeading>
    {PRINCIPAL_INVESTIGATOR_HEADING.test(heading) && (
      <LeadRoleExplanation plural={heading.endsWith('s')} />
    )}
  </>
);

const RelatedResearchEntitiesSection = ({
  relationships,
  relatedResearchEntities,
  relatedProfileOpenState,
}: {
  relationships: LabEntityRelationship[];
  relatedResearchEntities: LabRelatedResearchEntitySummary[];
  relatedProfileOpenState: RelatedProfileOpenState;
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
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
              state={relatedProfileOpenState}
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
  relatedProfileOpenState,
}: {
  affiliatedResearchEntities: LabRelatedResearchEntitySummary[];
  relatedProfileOpenState: RelatedProfileOpenState;
}) => (
  <section>
    <SectionHeading>Affiliated with</SectionHeading>
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
            state={relatedProfileOpenState}
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
  relatedProfileOpenState,
}: {
  similarResearchEntities: LabRelatedResearchEntitySummary[];
  relatedProfileOpenState: RelatedProfileOpenState;
}) => (
  <section>
    <SectionHeading>More like this</SectionHeading>
    <p className="-mt-2 mb-3 text-sm text-muted">Other research studying similar topics.</p>
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {similarResearchEntities.map((entity) => (
        <Link
          key={entity.slug || entity.id}
          to={`/research/${safeRouteSegment(entity.slug)}`}
          state={relatedProfileOpenState}
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
        {isSaved
          ? 'Press again to remove it. You can undo.'
          : 'Keep private notes and reach out later'}
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

const PendingSaveActionSlot = () => (
  <div
    aria-hidden="true"
    className="invisible flex w-full items-start gap-3 rounded-card border px-3 py-2 sm:w-auto sm:min-w-[13rem]"
  >
    <span className="min-w-0 flex-1">
      <span className="block text-sm font-semibold">Log in with Yale to save</span>
      <span className="mt-0.5 block text-xs leading-relaxed">
        Save this research, keep private notes, and reach out
      </span>
    </span>
  </div>
);

const emeritusResearchLabel = (group: any): string => {
  if (isCreativePracticeEntity(group)) return 'Emeritus faculty';
  if (group.entityType === 'LAB') return 'Emeritus lab';
  if (group.entityType === 'FACULTY_RESEARCH_AREA' || group.entityType === 'FACULTY_PROJECT') {
    return 'Emeritus faculty research';
  }
  return 'Led by emeritus faculty';
};

const EmeritusCurrentActivityNotice = ({
  group,
  activityCheckUrl,
  leadCardLinksProfile,
}: {
  group: any;
  activityCheckUrl?: string;
  leadCardLinksProfile: boolean;
}) => {
  const activityNoRecord = `y/labs has no record that this ${
    isCreativePracticeEntity(group) ? 'practice' : 'research'
  } is active now, so it lists no way to join.`;
  return (
    <div className="py-4 first:pt-0 last:pb-0" role="note" aria-label="Current activity">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted">Current activity</p>
      <p className="mt-1 text-sm leading-relaxed text-ink">
        {emeritusResearchLabel(group)}: check the official page for current activity.
      </p>
      <p className="mt-1 text-sm leading-relaxed text-muted">
        {activityCheckUrl || !leadCardLinksProfile
          ? activityNoRecord
          : `${activityNoRecord} The official profile above is the place to check.`}
      </p>
      {activityCheckUrl && (
        <a
          href={activityCheckUrl}
          target="_blank"
          rel={EXTERNAL_LINK_REL}
          className="yr-focus-ring yr-pressable mt-3 inline-flex min-h-11 items-center gap-1 rounded-control text-sm font-semibold text-brand transition-colors hover:text-brand-navy"
        >
          Open the official page
          <ArrowRightIcon />
        </a>
      )}
    </div>
  );
};

const DecisionSummary = ({
  group,
  profileUrl,
  websiteUrl,
  officialSource,
  applySource,
  preferOrgEngagementOutreach = false,
  principalInvestigator,
  leadProfilesLinkedInline = false,
  rosterListsUndergraduates = false,
  teamSectionCountsPastUndergraduates = false,
}: {
  group: any;
  profileUrl?: string;
  websiteUrl?: string;
  officialSource?: ResearchDetailSource;
  applySource?: ResearchDetailSource;
  preferOrgEngagementOutreach?: boolean;
  principalInvestigator?: LabMember;
  leadProfilesLinkedInline?: boolean;
  rosterListsUndergraduates?: boolean;
  teamSectionCountsPastUndergraduates?: boolean;
}) => {
  const { departments, departmentPillEligibleLabels } = useConfig();
  const topics = detailTopics(group, 5);
  const methods = detailMethods(group);
  const description = sanitizeResearchEntityCopy(detailDescription(group), group);
  useEffect(() => {
    if (description) return;
    void captureClientError(new Error('Public research description invariant failed'));
  }, [description, group._id, group.slug]);
  const grantSummary = formatGrantSummary(group.recentGrants);
  const pastAdvisees = formatPastAdvisees(
    group,
    rosterListsUndergraduates || teamSectionCountsPastUndergraduates,
  );
  const honors = formatLeadHonors(group);
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
  const wayInWithheld = group.wayInWithheld === true;
  const hasActionablePath =
    Boolean(piMailtoHref) || Boolean(profileUrl) || Boolean(websiteUrl) || Boolean(officialSource);
  const undergradQuote =
    wayInWithheld || rosterListsUndergraduates
      ? undefined
      : undergradQuoteEvidenceFromEntity(group);
  const hasEvidenceList =
    Boolean(grantSummary) || pastAdvisees.length > 0 || Boolean(honors.recent || honors.other);
  const profileNeedsOwnButton =
    Boolean(profileUrl) && !principalInvestigator && !leadProfilesLinkedInline;
  const actionLinks = resolveResearchDetailActionLinks({
    websiteUrl,
    profileUrl,
    hasLeadCard: Boolean(principalInvestigator),
    profileNeedsOwnButton,
    preferOrgEngagementOutreach,
    officialSource,
    hasApplyPage: Boolean(applySource),
    wayInWithheld,
  });
  const showsWebsiteCta = actionLinks.showsWebsiteCta;
  const leadCardProfileUrl = actionLinks.leadCardProfileUrl;
  /**
   * The directory fallback tells a student y/labs has no direct link, which is false
   * whenever the card above already links this person's profile. With no other action
   * to offer, the block would only point back at that card, so it is omitted.
   */
  const leadCardLinksProfile = actionLinks.leadCardLinksProfile;
  const offersOrgEngagementPage = actionLinks.offersOrgEngagementPage;
  const applyPageUrl = actionLinks.offersApplyPage ? applySource?.url : undefined;
  const joinPageLinkUrl = actionLinks.offersJoinLinkBesideWebsite ? applySource?.url : undefined;
  const showsProfileButton = actionLinks.showsProfileButton;
  /**
   * A generic official page beside a lead card that already links the profile is a
   * third door to the same person. The block offers one action, the research's own
   * homepage where it has one, so the generic page is offered only when no card links
   * a profile.
   */
  const offersOfficialPage =
    !wayInWithheld &&
    Boolean(officialSource) &&
    !showsWebsiteCta &&
    !offersOrgEngagementPage &&
    !applyPageUrl &&
    !leadCardLinksProfile;
  const getInvolvedHasOwnAction =
    showsWebsiteCta ||
    offersOrgEngagementPage ||
    Boolean(applyPageUrl) ||
    showsProfileButton ||
    offersOfficialPage;
  const directoryFallbackCandidate =
    !wayInWithheld && (Boolean(piMailtoHref) || !hasActionablePath);
  const needsDirectoryFallback = !leadCardLinksProfile && directoryFallbackCandidate;
  const showGetInvolvedBlock = getInvolvedHasOwnAction || needsDirectoryFallback;
  const pageListsContacts = getInvolvedHasOwnAction || directoryFallbackCandidate;
  const activityCheckUrl = actionLinks.activityCheckUrl;
  return (
    <section className="rounded-card border border-line bg-panel p-4 shadow-yr-raised sm:p-5">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_16rem] md:gap-5">
        <div>
          <SectionHeading>{summarySectionLabel(group)}</SectionHeading>
          {description ? (
            <>
              <h2 className="text-lg font-semibold text-ink">{decisionHeadingLabel(group)}</h2>
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
                This section normally explains what the research covers, in its own words. y/labs
                has not found a description it can publish for this one
                {pageListsContacts
                  ? ', so use the sources and contacts listed here to check the work directly before deciding fit.'
                  : '. Check the linked sources further down this page before deciding fit.'}
              </p>
            </>
          )}
          {topics.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted">Topics</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {topics.map((topic) => (
                  <span
                    key={topic}
                    className="rounded-card border border-line-brand bg-brand-soft px-2.5 py-1 text-xs font-medium text-brand"
                  >
                    {formatTopicChipLabel(topic)}
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

          {undergradQuote && (
            <figure className="mt-6 max-w-[68ch] border-t border-[var(--yr-line)] pt-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted">
                {UNDERGRAD_QUOTE_LABEL}
              </p>
              <blockquote
                cite={undergradQuote.sourceUrl}
                className="mt-2 border-l-2 border-line-brand pl-4 text-base leading-relaxed text-ink-soft"
              >
                <p>&ldquo;{undergradQuote.quote}&rdquo;</p>
              </blockquote>
              <figcaption className="mt-2 pl-4.5 text-sm text-muted">
                Quoted from{' '}
                <a
                  href={undergradQuote.sourceUrl}
                  aria-label={`${undergradQuote.sourceHost} (opens in a new tab)`}
                  target="_blank"
                  rel={EXTERNAL_LINK_REL}
                  className="yr-link yr-focus-ring -my-1.5 inline-block break-words rounded-control py-1.5"
                >
                  {undergradQuote.sourceHost}
                </a>
              </figcaption>
            </figure>
          )}
        </div>

        <div className="divide-y divide-[var(--yr-line)] self-start rounded-card border border-[var(--yr-line)] bg-[var(--yr-panel-muted)] p-4">
          {hasEvidenceList && (
            <div className="py-4 first:pt-0 last:pb-0" aria-label="Research activity evidence">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted">Evidence</p>
              <ul className="mt-3 space-y-1 text-xs text-muted">
                {grantSummary && <li>• {grantSummary}</li>}
                {honors.recent && <li>• {honors.recent}</li>}
                {honors.other && <li>• {honors.other}</li>}
                {pastAdvisees.map((line) => (
                  <li key={line}>• {line}</li>
                ))}
              </ul>
            </div>
          )}
          {principalInvestigator && (
            <div className="py-4 first:pt-0 last:pb-0">
              <LeadSectionHeading
                heading={leadSectionHeading(
                  [principalInvestigator],
                  leadRoleLabelForEntity(group, 'pi'),
                )}
              />
              <div>
                <LabMembersList
                  members={[principalInvestigator]}
                  singleColumn
                  entityDepartments={group.departments}
                  resolveMemberProfileUrl={() => leadCardProfileUrl}
                  resolveLeadRoleLabel={(role) => leadRoleLabelForEntity(group, role)}
                />
              </div>
            </div>
          )}
          {wayInWithheld && (
            <EmeritusCurrentActivityNotice
              group={group}
              activityCheckUrl={activityCheckUrl}
              leadCardLinksProfile={leadCardLinksProfile}
            />
          )}
          {!wayInWithheld && showGetInvolvedBlock && (
            <div className="py-4 first:pt-0 last:pb-0">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted">
                How to get involved
              </p>
              {showsWebsiteCta ? (
                <div className="mt-3 flex flex-col gap-2">
                  <a
                    href={websiteUrl}
                    target="_blank"
                    rel={EXTERNAL_LINK_REL}
                    className="yr-pressable inline-flex min-h-11 items-center justify-center rounded-control bg-brand px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-navy yr-focus-ring"
                  >
                    {researchWebsiteCtaLabel(group)}
                  </a>
                  {joinPageLinkUrl && (
                    <a
                      href={joinPageLinkUrl}
                      target="_blank"
                      rel={EXTERNAL_LINK_REL}
                      className="yr-focus-ring yr-pressable inline-flex min-h-11 items-center gap-1 self-start rounded-control text-sm font-semibold text-brand transition-colors hover:text-brand-navy"
                    >
                      {joinPageLinkLabel(joinPageLinkUrl)}
                      <ArrowRightIcon />
                    </a>
                  )}
                </div>
              ) : offersOrgEngagementPage && officialSource ? (
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
                  </div>
                </>
              ) : applyPageUrl ? (
                <div className="mt-3 flex flex-col gap-2">
                  <a
                    href={applyPageUrl}
                    target="_blank"
                    rel={EXTERNAL_LINK_REL}
                    className="yr-pressable inline-flex min-h-11 items-center justify-center rounded-control bg-brand px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-navy yr-focus-ring"
                  >
                    {joinPageLinkLabel(applyPageUrl, 'See how to get involved')}
                  </a>
                </div>
              ) : showsProfileButton ? (
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
              ) : offersOfficialPage && officialSource ? (
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
  describesCreativePractice = false,
}: {
  sources: ResearchDetailSource[];
  primaryProfileUrl?: string;
  describesCreativePractice?: boolean;
}) => {
  if (sources.length === 0) return null;
  /**
   * Only an access-signal context is action evidence. The previous test was "any context not
   * starting with Profile", which a per-field contribution label satisfies, so serving the
   * attribution for a row's topics or methods announced action evidence the page does not
   * have (#3341).
   */
  const hasActionContext = sources.some((source) =>
    source.contexts.some((context) => ACCESS_SIGNAL_SOURCE_CONTEXTS.has(context)),
  );

  return (
    <div className="rounded-card border border-[var(--yr-line)] bg-[var(--yr-panel)]">
      <div className="border-b border-[var(--yr-line)] px-4 py-3">
        <p className="text-sm text-muted">
          {hasActionContext
            ? 'These official pages support the profile details and the undergraduate information on this page.'
            : describesCreativePractice
              ? 'These official pages support the profile details shown above.'
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
                      <span className="inline-flex items-center rounded-card border border-line-brand bg-brand-soft px-1.5 py-0.5 text-xs font-medium text-ink-soft">
                        also linked above
                      </span>
                    )}
                    {source.isLikelyUnavailable && (
                      <span className="inline-flex items-center rounded-card border border-line bg-panel-muted px-1.5 py-0.5 text-xs font-medium text-muted">
                        may be unavailable
                      </span>
                    )}
                    {source.isPrivateNetworkOnly && (
                      <span className="inline-flex items-center rounded-card border border-line bg-panel-muted px-1.5 py-0.5 text-xs font-medium text-muted">
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

const PROFILE_NOT_FOUND_STATUSES = new Set([400, 404]);

const LabDetail = () => {
  const { isAuthenticated, isLoading: isAuthLoading } = useContext(UserContext);
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const locationStateRef = useRef<unknown>(location.state);
  useEffect(() => {
    locationStateRef.current = location.state;
  }, [location.state]);
  const [state, dispatch] = useReducer(labDetailReducer, undefined, () =>
    createInitialLabDetailState(),
  );
  const { payload, loading, error } = state;
  const requestIdRef = useRef(0);
  const payloadSlugRef = useRef<string | undefined>(undefined);
  const fetchAbortRef = useRef<AbortController | null>(null);
  const [showResearchPlanSavedCallout, setShowResearchPlanSavedCallout] = useState(false);
  const {
    undoableItem: undoableUnsave,
    offerUndo,
    undoRemoval,
    dismissUndo,
  } = useUndoableRemoval<{ entityId: string }>();
  useEffect(() => {
    dismissUndo();
  }, [slug, dismissUndo]);

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
        if (canonicalSlug && canonicalSlug !== slug) {
          void navigate(`/research/${safeRouteSegment(canonicalSlug)}`, {
            replace: true,
            state: locationStateRef.current,
          });
          return;
        }
        payloadSlugRef.current = slug;
        dispatch({
          type: 'FETCH_SUCCESS',
          payload: normalizeResearchEntityDetailPayload(res.data),
        });
      })
      .catch((err) => {
        if (isCancel(err) || requestId !== requestIdRef.current) return;
        if (PROFILE_NOT_FOUND_STATUSES.has(err?.response?.status)) {
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
    if (!entity?._id || payloadSlugRef.current !== slug) return;
    void trackResearchEventOnce(`profile:${location.key}:${entity._id}`, {
      eventType: 'research_profile_open',
      entityType: 'research_entity',
      entityId: entity._id,
      payload: { source: readResearchProfileOpenSource(location.state) },
    });
  }, [location.key, location.state, payload, slug]);

  if (loading && !payload) {
    return <ResearchProfileSkeleton leading={<ResearchResultsBackLink />} />;
  }

  if (error && !payload) {
    if (error === RESEARCH_PROFILE_NOT_FOUND_ERROR) {
      return <NotFound suggestedQuery={searchQueryFromResearchSlug(slug)} />;
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
    entityRelationships = [],
    relatedResearchEntities = [],
    affiliatedResearchEntities = [],
    similarResearchEntities = [],
    operatorPreview,
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
  const undergraduateMembers = undergraduateMemberEvidence({
    roster,
    accessSignals: accessSignals.filter(isCitableAccessSignal),
    currentUndergradCount: group.currentUndergradCount,
    pastUndergradAdvisees: group.pastUndergradAdvisees,
    fellowshipRecipients: group.fellowshipRecipients,
  });
  const sources = buildResearchDetailSources({
    group,
    accessSignals,
    sourceLinkHealth: group.sourceLinkHealth,
    sourceFieldContributions: group.sourceFieldContributions,
    undergraduateMembers,
  });
  const primaryWebsiteUrl =
    group.websiteUrl &&
    !isSuppressedResearchWebsiteCtaUrl(group.websiteUrl) &&
    !isUnreachableResearchWebsiteCtaUrl(group.websiteUrl, group.sourceLinkHealth)
      ? servedResearchWebsiteUrl(group.websiteUrl, group.sourceLinkHealth)
      : undefined;
  const primaryWebsiteHealth = findSourceLinkHealthEntry(group.sourceLinkHealth, primaryWebsiteUrl);
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
  const outreachApplySource = resolveOutreachApplySource(
    sources,
    [decisionProfileUrl, officialWebsiteUrl],
    leadIdentityUnderReview,
    group.entityType,
    { schools: [group.school, ...(Array.isArray(group.schools) ? group.schools : [])] },
    leadPersonNames,
    vettedJoinPageUrls(accessSignals),
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
    leadIdentityUnderReview || principalInvestigators.length > 1;
  const resolveLeadOfficialProfileUrl = (member: LabMember): string | undefined =>
    officialProfileUrlFromMemberUser(member.user as unknown as Record<string, unknown>);
  const leadProfilesLinkedInline =
    showDedicatedPrincipalInvestigatorSection &&
    !leadIdentityUnderReview &&
    principalInvestigators.some((member) => Boolean(resolveLeadOfficialProfileUrl(member)));
  // One composition, shared with `research-entity:audit-duplicate-action-links`. The
  // audit must not build this context a second way, or it stops measuring the page.
  const decisionSummaryActionLinks = resolveResearchDetailActionLinks(
    resolveResearchDetailActionLinkContext({ group, members, accessSignals }),
  );
  const headerWebsiteDedupeUrls = decisionSummaryActionLinks.showsWebsiteCta
    ? [decisionProfileUrl, officialWebsiteUrl]
    : [decisionProfileUrl, decisionSummaryActionLinks.activityCheckUrl];
  const isResearchEntitySaved = savedResearchPlanIds.includes(group._id);
  const relatedProfileOpenState = {
    ...researchProfileOpenState('related_research'),
    ...deeperResearchResultsReturnState(location.state),
  };
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

    const change = setSavedResearchPlanFavorite(entityId, shouldSave);
    if (shouldSave) {
      dismissUndo();
    } else {
      setShowResearchPlanSavedCallout(false);
      offerUndo({ entityId }, change);
    }
    const saved = await change;
    if (saved && shouldSave && !window.localStorage.getItem(FIRST_RESEARCH_PLAN_SAVE_KEY)) {
      window.localStorage.setItem(FIRST_RESEARCH_PLAN_SAVE_KEY, 'true');
      setShowResearchPlanSavedCallout(true);
    }
  };

  return (
    <div className={researchProfilePageClassName} onClickCapture={handleDetailLinkOpen}>
      <div className={researchProfileGridClassName}>
        <div className={researchProfileColumnClassName}>
          <ResearchResultsBackLink />
          {operatorPreview && <OperatorPreviewNotice preview={operatorPreview} />}
          {showResearchPlanSavedCallout && (
            <FirstSaveCallout
              kind="researchPlan"
              onDismiss={() => setShowResearchPlanSavedCallout(false)}
            />
          )}

          {undoableUnsave?.entityId === group._id && (
            <UndoRemovalBanner
              onUndo={() =>
                void undoRemoval(({ entityId }) => setSavedResearchPlanFavorite(entityId, true))
              }
            >
              Removed from your Dashboard. Undo brings back its notes and stage.
            </UndoRemovalBanner>
          )}

          <LabHeader
            group={group}
            dedupeWebsiteUrls={headerWebsiteDedupeUrls}
            actions={
              isAuthLoading ? (
                <PendingSaveActionSlot />
              ) : isAuthenticated ? (
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
            applySource={outreachApplySource}
            preferOrgEngagementOutreach={preferOrgEngagementOutreach}
            principalInvestigator={singlePrincipalInvestigator}
            leadProfilesLinkedInline={leadProfilesLinkedInline}
            rosterListsUndergraduates={(roster.undergraduates?.length ?? 0) > 0}
            teamSectionCountsPastUndergraduates={undergraduateMembers.countLines.some(
              (line) => line.status === 'past',
            )}
          />

          {showDedicatedPrincipalInvestigatorSection && (
            <section>
              <LeadSectionHeading
                heading={leadSectionHeading(
                  principalInvestigators,
                  leadRoleLabelForEntity(group, 'pi'),
                )}
              />
              {leadIdentityUnderReview ? (
                <div
                  className="rounded-card border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950"
                  role="status"
                >
                  <p className="font-semibold">Lead not confirmed yet</p>
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
                  resolveLeadRoleLabel={(role) => leadRoleLabelForEntity(group, role)}
                />
              )}
            </section>
          )}

          <ResearchTeamSection
            members={members}
            roster={roster}
            undergraduateCounts={undergraduateMembers.countLines}
          />

          <FellowshipRecipientsSection recipients={group.fellowshipRecipients} />

          {hasRelatedResearchEntities && (
            <RelatedResearchEntitiesSection
              relationships={entityRelationships}
              relatedResearchEntities={dedupedRelatedResearchEntities}
              relatedProfileOpenState={relatedProfileOpenState}
            />
          )}

          {hasAffiliatedResearchEntities && (
            <AffiliatedResearchEntitiesSection
              affiliatedResearchEntities={dedupedAffiliatedResearchEntities}
              relatedProfileOpenState={relatedProfileOpenState}
            />
          )}

          {hasSimilarResearchEntities && (
            <SimilarResearchEntitiesSection
              similarResearchEntities={dedupedSimilarResearchEntities}
              relatedProfileOpenState={relatedProfileOpenState}
            />
          )}

          {sources.length > 0 && (
            <section>
              <SectionHeading>Sources</SectionHeading>
              <SourcesSection
                sources={sources}
                describesCreativePractice={isCreativePracticeEntity(group)}
                primaryProfileUrl={
                  decisionSummaryActionLinks.profileOpenedAbove ? decisionProfileUrl : undefined
                }
              />
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

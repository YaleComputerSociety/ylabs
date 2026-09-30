import {
  buildResearchDetailSources,
  isLikelyUnavailableSourceLink,
  isSameActionDestination,
  isSuppressedResearchWebsiteCtaUrl,
  isUnreachableResearchWebsiteCtaUrl,
  prefersOrgEngagementOutreach,
  resolveDecisionProfileUrl,
  resolveOutreachApplySource,
  resolveOutreachOfficialSource,
  sourceLedgerKey,
} from './researchDetailSources';
import { safeHttpUrl } from './url';
import { dedupeLeadMembers, memberPersonName } from './leadMemberDedupe';
import { officialProfileUrlFromMemberUser } from './principalInvestigatorLinks';
import { leadRoleFamily } from './leadRoleDisplay';
import type { LabMember } from '../types/labDetail';
import type { ResearchGroup } from '../types/researchGroup';

/**
 * The two action slots a research detail page offers a student: the lead card's
 * profile link, and the "Open the official page" website call to action.
 *
 * Exported and shared with the page rather than left inline, because deciding the
 * pair from the stored row reports a different number: the row carries neither the
 * website suppressions nor the lead dedupe that choose the links. Measuring #3207
 * required transcribing these predicates into a throwaway probe, which is the
 * shortcut-past-the-route failure the repository already has a rule about (#3288).
 *
 * This module deliberately imports only `isSameActionDestination`. It cannot be
 * imported by a server script regardless: that helper's key closure reaches
 * `normalizeSourceUrl`, which calls `safeHttpUrl`, which lives in `./url` alongside
 * `window.open`, and `scripts/security-preflight.test.mjs` pins both symbols as text
 * inside that file. So the audit that consumes this resolver has to run client-side.
 */
export interface ResearchDetailActionLinkContext {
  websiteUrl?: string;
  profileUrl?: string;
  hasLeadCard: boolean;
  profileNeedsOwnButton: boolean;
  preferOrgEngagementOutreach: boolean;
  officialSource?: { url: string } | null;
  hasApplyPage: boolean;
}

export interface ResearchDetailActionLinks {
  leadCardProfileUrl?: string;
  websiteCtaUrl?: string;
  showsWebsiteCta: boolean;
  showsProfileButton: boolean;
  leadCardLinksProfile: boolean;
  profileOpenedAbove: boolean;
  /** Both slots resolved to a link, which is the population the duplicate audit walks. */
  offersBothLinks: boolean;
  /** Both slots resolved to the same destination, which is the defect lane. */
  slotsShareOneDestination: boolean;
}

export function resolveResearchDetailActionLinks(
  context: ResearchDetailActionLinkContext,
): ResearchDetailActionLinks {
  const {
    websiteUrl,
    profileUrl,
    hasLeadCard,
    profileNeedsOwnButton,
    preferOrgEngagementOutreach,
    officialSource,
    hasApplyPage,
  } = context;
  const leadCardProfileUrl = profileUrl;
  const repeatsLeadCardProfileLink =
    hasLeadCard && isSameActionDestination(websiteUrl, leadCardProfileUrl);
  const offersOrgEngagementPage = preferOrgEngagementOutreach && Boolean(officialSource);
  const getInvolvedSlotTaken = offersOrgEngagementPage || hasApplyPage;
  const websiteSlotOpen = Boolean(websiteUrl) && !getInvolvedSlotTaken;
  const showsProfileButton = profileNeedsOwnButton && !getInvolvedSlotTaken;

  const showsWebsiteCta = websiteSlotOpen && !profileNeedsOwnButton && !repeatsLeadCardProfileLink;

  const leadCardLinksProfile = hasLeadCard && Boolean(leadCardProfileUrl);
  return {
    leadCardProfileUrl,
    websiteCtaUrl: showsWebsiteCta ? websiteUrl : undefined,
    showsWebsiteCta,
    showsProfileButton,
    leadCardLinksProfile,
    profileOpenedAbove: !profileNeedsOwnButton || showsProfileButton,
    // Read before the CTA suppression, so the audit can separate "both slots would
    // link" from "the duplicate guard already collapsed them". A population measured
    // after the suppression cannot see the rows the suppression acted on.
    offersBothLinks: leadCardLinksProfile && websiteSlotOpen,
    slotsShareOneDestination: leadCardLinksProfile && websiteSlotOpen && repeatsLeadCardProfileLink,
  };
}

/**
 * The payload a research detail page decides its action links from.
 *
 * Named so the audit can dump exactly this and nothing else. Everything below is
 * derived here rather than in the page, which is the single-decision property #3207
 * asked for: the page and the audit must not compose the context two ways.
 */
export interface ResearchDetailActionLinkPayload {
  group: ResearchGroup;
  members: LabMember[];
  accessSignals?: unknown[];
}

export function resolveResearchDetailActionLinkContext({
  group,
  members,
  accessSignals = [],
}: ResearchDetailActionLinkPayload): ResearchDetailActionLinkContext {
  const sources = buildResearchDetailSources({
    group: group as never,
    accessSignals: accessSignals as never,
    sourceLinkHealth: group.sourceLinkHealth as never,
    sourceFieldContributions: group.sourceFieldContributions as never,
  });
  const primaryWebsiteUrl =
    group.websiteUrl &&
    !isSuppressedResearchWebsiteCtaUrl(group.websiteUrl) &&
    !isUnreachableResearchWebsiteCtaUrl(group.websiteUrl, group.sourceLinkHealth as never)
      ? group.websiteUrl
      : undefined;
  const primaryWebsiteHealthKey = sourceLedgerKey(primaryWebsiteUrl);
  const primaryWebsiteHealth = primaryWebsiteHealthKey
    ? (group.sourceLinkHealth as never[] | undefined)?.find(
        (entry: never) =>
          sourceLedgerKey((entry as { url?: string }).url) === primaryWebsiteHealthKey,
      )
    : undefined;
  const isPrimaryWebsiteLikelyUnavailable = isLikelyUnavailableSourceLink(
    primaryWebsiteHealth as never,
  );
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
  const leadPersonNames = principalInvestigators.map(memberPersonName).filter(Boolean);
  const decisionProfileUrl = resolveDecisionProfileUrl(
    fallbackSourceUrl,
    group as never,
    leadOfficialProfileUrl,
    leadPersonNames,
  );
  const officialWebsiteUrl = isPrimaryWebsiteLikelyUnavailable
    ? undefined
    : safeHttpUrl(primaryWebsiteUrl) || undefined;
  const outreachSchools = {
    schools: [group.school, ...(Array.isArray(group.schools) ? group.schools : [])],
  } as never;
  const outreachOfficialSource = resolveOutreachOfficialSource(
    sources,
    [decisionProfileUrl, officialWebsiteUrl],
    leadIdentityUnderReview,
    group.entityType,
    outreachSchools,
    leadPersonNames,
  );
  const outreachApplySource = resolveOutreachApplySource(
    sources,
    [decisionProfileUrl, officialWebsiteUrl],
    leadIdentityUnderReview,
    group.entityType,
    outreachSchools,
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
  const leadProfilesLinkedInline =
    showDedicatedPrincipalInvestigatorSection &&
    !leadIdentityUnderReview &&
    principalInvestigators.some((member) =>
      Boolean(officialProfileUrlFromMemberUser(member.user as unknown as Record<string, unknown>)),
    );
  return {
    websiteUrl: officialWebsiteUrl,
    profileUrl: decisionProfileUrl,
    hasLeadCard: Boolean(singlePrincipalInvestigator),
    profileNeedsOwnButton:
      Boolean(decisionProfileUrl) && !singlePrincipalInvestigator && !leadProfilesLinkedInline,
    preferOrgEngagementOutreach,
    officialSource: outreachOfficialSource,
    hasApplyPage: Boolean(outreachApplySource),
  };
}

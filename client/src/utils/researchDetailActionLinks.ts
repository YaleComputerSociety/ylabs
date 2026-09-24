import { isSameActionDestination } from './researchDetailSources';

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
  piEmail?: string;
  hasLeadCard: boolean;
  profileNeedsOwnButton: boolean;
  preferOrgEngagementOutreach: boolean;
  officialSource?: { url: string } | null;
}

export interface ResearchDetailActionLinks {
  leadCardProfileUrl?: string;
  websiteCtaUrl?: string;
  showsWebsiteCta: boolean;
  leadCardLinksProfile: boolean;
  /** Both slots resolved to a link, which is the population the duplicate audit walks. */
  offersBothLinks: boolean;
  /** Both slots resolved to the same destination, which is the defect lane. */
  slotsShareOneDestination: boolean;
}

export const resolveLeadCardProfileUrl = (
  profileUrl: string | undefined,
  preferOrgEngagementOutreach: boolean,
): string | undefined => (preferOrgEngagementOutreach ? undefined : profileUrl);

export function resolveResearchDetailActionLinks(
  context: ResearchDetailActionLinkContext,
): ResearchDetailActionLinks {
  const {
    websiteUrl,
    profileUrl,
    piEmail,
    hasLeadCard,
    profileNeedsOwnButton,
    preferOrgEngagementOutreach,
    officialSource,
  } = context;
  const leadCardProfileUrl = resolveLeadCardProfileUrl(profileUrl, preferOrgEngagementOutreach);
  const repeatsLeadCardProfileLink =
    hasLeadCard && isSameActionDestination(websiteUrl, leadCardProfileUrl);

  const showsWebsiteCta = (() => {
    if (!websiteUrl) return false;
    if (preferOrgEngagementOutreach && officialSource) return false;
    if (piEmail) return false;
    if (profileNeedsOwnButton) return false;
    return !repeatsLeadCardProfileLink;
  })();

  const leadCardLinksProfile = hasLeadCard && Boolean(leadCardProfileUrl);
  return {
    leadCardProfileUrl,
    websiteCtaUrl: showsWebsiteCta ? websiteUrl : undefined,
    showsWebsiteCta,
    leadCardLinksProfile,
    // Read before the CTA suppression, so the audit can separate "both slots would
    // link" from "the duplicate guard already collapsed them". A population measured
    // after the suppression cannot see the rows the suppression acted on.
    offersBothLinks: leadCardLinksProfile && Boolean(websiteUrl),
    slotsShareOneDestination: leadCardLinksProfile && repeatsLeadCardProfileLink,
  };
}

export const decisionSummaryShowsWebsiteCta = (context: ResearchDetailActionLinkContext): boolean =>
  resolveResearchDetailActionLinks(context).showsWebsiteCta;

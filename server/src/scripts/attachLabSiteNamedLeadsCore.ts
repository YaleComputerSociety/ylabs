/**
 * Pure planning core for recovering an eponymous research home's own lead from the
 * site that publishes it.
 *
 * `lab-site-lead-verification` already reads a research home's people pages to judge
 * an attached lead, but it is scoped to entities that ALREADY claim one, so the page
 * that names the lab's PI is read only where it can contradict an attachment and
 * never where it could supply the missing one (#1930). This core turns the same
 * reading into an attachment plan for the rows that have no lead at all.
 *
 * Every refusal is named and counted. The lane fails closed: the site must name
 * exactly one person whose surname is the one the row's own name and URL both claim,
 * that person must already exist in the corpus behind an official profile on the
 * research home's own host, and no prior lead edge for them may carry an operator or
 * retirement-lane judgement.
 */
import { corroboratedLabNameEponyms } from '../utils/researchHomeNameIdentityAuthority';
import {
  givenNameCore,
  personSlugsOnSite,
  profileSlugFromUrl,
  surnameCore,
} from '../scrapers/utils/labSiteLeadVerification';
import { leadWouldUnblock, type FraLeadCandidateEntity } from './attachFraNamedLeadsCore';

export const LAB_SITE_NAMED_LEAD_REFUSAL_REASONS = [
  'lead_is_not_the_only_blocker',
  'name_claims_no_eponym',
  'site_names_no_matching_person',
  'site_names_several_matching_people',
  'profile_owner_not_in_corpus',
  'profile_owner_is_ambiguous',
  'prior_edge_was_judged',
] as const;

export type LabSiteNamedLeadRefusalReason = (typeof LAB_SITE_NAMED_LEAD_REFUSAL_REASONS)[number];

export interface LabSiteNamedLeadEntity extends FraLeadCandidateEntity {
  websiteUrl?: unknown;
  website?: unknown;
}

/** A living researcher reachable through one official Yale profile URL. */
export interface OfficialProfileOwner {
  personId: string;
  displayName: string;
  profileUrl: string;
}

export interface LabSiteNamedLeadPlan {
  researchHomeUrl: string;
  eponym: string;
  personId: string;
  personDisplayName: string;
  profileUrl: string;
  evidenceUrl: string;
}

export interface LabSiteNamedLeadRefusal {
  reason: LabSiteNamedLeadRefusalReason;
  researchHomeUrl: string;
}

const textValue = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const hostnameOf = (url: string): string => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
};

/**
 * The URLs a row offers as its own research home, most specific first. `websiteUrl`
 * is the served one, so it leads; the cited sources follow because a row whose
 * website slot is empty still cites the microsite it was minted from.
 */
export function researchHomeUrlCandidates(entity: LabSiteNamedLeadEntity): string[] {
  const cited = Array.isArray(entity.sourceUrls) ? entity.sourceUrls.map(textValue) : [];
  return [
    ...new Set(
      [textValue(entity.websiteUrl), textValue(entity.website), ...cited].filter((url) =>
        /^https:\/\//i.test(url),
      ),
    ),
  ];
}

/**
 * The research home whose URL path corroborates the eponym the row's name claims,
 * with the surname spellings that corroboration admits. Corroboration by the row's
 * own URL is what keeps a topical name ("Belief Lab") and a borrowed citation out:
 * both the name and the address have to say the same surname.
 */
export function corroboratedResearchHome(
  entity: LabSiteNamedLeadEntity,
): { researchHomeUrl: string; eponym: string } | null {
  for (const url of researchHomeUrlCandidates(entity)) {
    const [eponym] = corroboratedLabNameEponyms(entity.name, url);
    if (eponym) return { researchHomeUrl: url, eponym };
  }
  return null;
}

export interface LabSitePage {
  url: string;
  html: string;
}

export function planLabSiteNamedLeadAttachment(input: {
  entity: LabSiteNamedLeadEntity;
  pages: readonly LabSitePage[];
  officialProfileOwners: readonly OfficialProfileOwner[];
  judgedPersonIds: ReadonlySet<string>;
}): { plan: LabSiteNamedLeadPlan } | { refusal: LabSiteNamedLeadRefusal } {
  const home = corroboratedResearchHome(input.entity);
  const researchHomeUrl = home?.researchHomeUrl ?? '';
  const refuse = (reason: LabSiteNamedLeadRefusalReason) => ({
    refusal: { reason, researchHomeUrl },
  });

  if (!leadWouldUnblock(input.entity)) return refuse('lead_is_not_the_only_blocker');
  if (!home) return refuse('name_claims_no_eponym');

  const homeHost = hostnameOf(home.researchHomeUrl);
  const slugPages = new Map<string, string>();
  for (const page of input.pages) {
    for (const slug of personSlugsOnSite(page.html)) {
      if (surnameCore(slug) !== home.eponym) continue;
      if (!slugPages.has(slug)) slugPages.set(slug, page.url);
    }
  }
  const matchingSlugs = [...slugPages.keys()];
  if (matchingSlugs.length === 0) return refuse('site_names_no_matching_person');
  if (matchingSlugs.length > 1) return refuse('site_names_several_matching_people');

  // Same host as the research home, which is this corpus's available stand-in for
  // "same school": a YSM lab microsite and a YSM profile share `medicine.yale.edu`,
  // and a same-surname stranger in another school does not.
  const owners = input.officialProfileOwners.filter(
    (owner) =>
      profileSlugFromUrl(owner.profileUrl) === matchingSlugs[0] &&
      hostnameOf(owner.profileUrl) === homeHost &&
      surnameCore(owner.displayName) === home.eponym &&
      givenNameCore(owner.displayName).length >= 2,
  );
  if (owners.length === 0) return refuse('profile_owner_not_in_corpus');
  if (owners.length > 1) return refuse('profile_owner_is_ambiguous');

  // A retirement lane and an operator both stamp their verdict on the edge they
  // retire (`reviewStatus: 'DISPUTED'`, plus a note). Re-minting over such a
  // judgement would undo it silently, so the site's evidence never overrides one.
  if (input.judgedPersonIds.has(owners[0].personId)) return refuse('prior_edge_was_judged');

  return {
    plan: {
      researchHomeUrl: home.researchHomeUrl,
      eponym: home.eponym,
      personId: owners[0].personId,
      personDisplayName: owners[0].displayName,
      profileUrl: owners[0].profileUrl,
      evidenceUrl: slugPages.get(matchingSlugs[0]) || home.researchHomeUrl,
    },
  };
}

export function summarizeLabSiteNamedLeadRefusals(
  refusals: readonly LabSiteNamedLeadRefusal[],
): Record<LabSiteNamedLeadRefusalReason, number> {
  const counts = Object.fromEntries(
    LAB_SITE_NAMED_LEAD_REFUSAL_REASONS.map((reason) => [reason, 0]),
  ) as Record<LabSiteNamedLeadRefusalReason, number>;
  for (const refusal of refusals) counts[refusal.reason] += 1;
  return counts;
}

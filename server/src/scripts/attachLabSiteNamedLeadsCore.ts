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
 * research home's own host, and no prior lead edge for them may exist at all.
 */
import {
  corroboratedLabNameEponyms,
  eponymousLabNameSurnameCandidates,
} from '../utils/researchHomeNameIdentityAuthority';
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
  'prior_lead_edge_was_retired',
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

/**
 * The host, with a `www.` prefix folded away, which is the comparison
 * `normalizeOfficialProfileDestination` already makes for the same purpose: a
 * research home stored as `www.medicine.yale.edu` and a profile stored as
 * `medicine.yale.edu` are the same school.
 */
const hostnameOf = (url: string): string => {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
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
): { researchHomeUrl: string; eponym: string; eponymSpellings: string[] } | null {
  for (const url of researchHomeUrlCandidates(entity)) {
    const [eponym] = corroboratedLabNameEponyms(entity.name, url);
    // Both spellings of the ONE corroborated surname, because a nobiliary particle
    // is spelled apart in a display name and joined in a URL path: "De Camilli Lab"
    // at `/lab/decamilli/` corroborates on `decamilli` while the person page's slug
    // reduces to `camilli`, and comparing the corroborated spelling alone refuses
    // exactly the names #2285 added the candidate list for.
    if (eponym) {
      return {
        researchHomeUrl: url,
        eponym,
        eponymSpellings: [...new Set([eponym, ...eponymousLabNameSurnameCandidates(entity.name)])],
      };
    }
  }
  return null;
}

export interface LabSitePage {
  url: string;
  html: string;
}

/**
 * Whether a page that was actually served still belongs to the research home. A
 * redirect off the subtree lands on a different site's page - a school landing page
 * after a CMS reorg, or a soft 404 wearing site chrome - and the people it names are
 * not this lab's evidence, so a same-surname stranger linked there would otherwise
 * pass every remaining condition. Confined to the subtree rather than the host for
 * the same reason `peopleSubpageUrls` is: a shared CMS hosts every lab on one host.
 */
export function isWithinResearchHomeSubtree(url: string, researchHomeUrl: string): boolean {
  let served: URL;
  let root: URL;
  try {
    served = new URL(url);
    root = new URL(researchHomeUrl);
  } catch {
    return false;
  }
  if (hostnameOf(served.href) !== hostnameOf(root.href)) return false;
  const directory = root.pathname
    .replace(/\/[^/]*\.(?:aspx|html?|php)$/i, '/')
    .replace(/\/+$/, '')
    .toLowerCase();
  if (!directory) return true;
  const path = served.pathname.replace(/\/+$/, '').toLowerCase();
  return path === directory || path.startsWith(`${directory}/`);
}

export function planLabSiteNamedLeadAttachment(input: {
  entity: LabSiteNamedLeadEntity;
  pages: readonly LabSitePage[];
  officialProfileOwners: readonly OfficialProfileOwner[];
  personIdsWithPriorLeadEdge: ReadonlySet<string>;
}): { plan: LabSiteNamedLeadPlan } | { refusal: LabSiteNamedLeadRefusal } {
  const home = corroboratedResearchHome(input.entity);
  const researchHomeUrl = home?.researchHomeUrl ?? '';
  const refuse = (reason: LabSiteNamedLeadRefusalReason) => ({
    refusal: { reason, researchHomeUrl },
  });

  if (!leadWouldUnblock(input.entity)) return refuse('lead_is_not_the_only_blocker');
  if (!home) return refuse('name_claims_no_eponym');

  const homeHost = hostnameOf(home.researchHomeUrl);
  const eponymSpellings = new Set(home.eponymSpellings);
  const slugPages = new Map<string, string>();
  for (const page of input.pages) {
    if (!isWithinResearchHomeSubtree(page.url, home.researchHomeUrl)) continue;
    for (const slug of personSlugsOnSite(page.html)) {
      if (!eponymSpellings.has(surnameCore(slug))) continue;
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
      eponymSpellings.has(surnameCore(owner.displayName)) &&
      givenNameCore(owner.displayName).length >= 2,
  );
  if (owners.length === 0) return refuse('profile_owner_not_in_corpus');
  if (owners.length > 1) return refuse('profile_owner_is_ambiguous');

  // The retired edge IS the record of the retirement, and no field records what
  // retired it: the operator lanes stamp `reviewStatus: 'DISPUTED'`, while an
  // official-roster departure (`archiveCanonicalRoleAssignmentsForPersons`) and a
  // duplicate merge (`dedupeResearchEntitiesByPi`) stamp nothing at all. An absent
  // stamp is therefore not evidence that reinstating is safe, and a lab site lags
  // departures, so a prior lead edge in any state refuses this row rather than
  // republishing a lead somebody already took down.
  if (input.personIdsWithPriorLeadEdge.has(owners[0].personId)) {
    return refuse('prior_lead_edge_was_retired');
  }

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

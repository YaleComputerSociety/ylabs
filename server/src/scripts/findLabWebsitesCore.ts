export interface LabSiteCandidateEntity {
  slug?: unknown;
  name?: unknown;
  studentVisibilityTier?: unknown;
  websiteUrl?: unknown;
  sourceUrls?: unknown;
}

export interface LabSiteSubject {
  entitySlug: string;
  entityName: string;
  displayName: string;
  nameTokenSets: string[][];
  eponymSurnames: string[];
  query: string;
}

const stringEntries = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];

const PROFILE_PATH = /\/(profile|people|person|directory)\//i;
const GRANT_OR_IDENTIFIER = /(nsf\.gov|api\.nsf\.gov|reporter\.nih\.gov|orcid\.org)/i;

export const isProfileCitation = (url: string): boolean => PROFILE_PATH.test(url);
export const isGrantCitation = (url: string): boolean => GRANT_OR_IDENTIFIER.test(url);

export function citedUrls(entity: LabSiteCandidateEntity): string[] {
  return [...stringEntries(entity.sourceUrls), entity.websiteUrl].filter(
    (url): url is string => typeof url === 'string' && /^https?:/i.test(url),
  );
}

/**
 * A served lab row that cites the professor but no lab site. This is the #2652
 * population: 301 rows on Development at the time of writing.
 */
export function needsLabWebsite(entity: LabSiteCandidateEntity): boolean {
  const urls = citedUrls(entity);
  if (!urls.some(isProfileCitation)) return false;
  return urls.filter((url) => !isProfileCitation(url) && !isGrantCitation(url)).length === 0;
}

export function piNameFromEntityName(name: unknown): string {
  if (typeof name !== 'string') return '';
  return name
    .replace(/\b(lab|laboratory|research|group|the)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function nameTokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

export function urlLeaf(url: string): string {
  try {
    return new URL(url).pathname.replace(/\/+$/, '').split('/').pop() || '';
  } catch {
    return '';
  }
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/**
 * Every full-name spelling this row supports, each as a token list.
 *
 * The entity name alone is not enough: a row named "Pomahac Lab" yields one token,
 * and a one-token subject cannot distinguish two people who share a surname. The
 * profile URL this row already cites carries the full name in its leaf
 * (`/profile/<forename>-<surname>/`), which restores a two-token subject for the
 * eponym-named rows. Measured over 78 known-correct pairs, the entity name matched
 * 38% of true lab pages and the profile leaf matched 78%.
 */
export function nameTokenSetsFor(entityName: unknown, profileUrls: string[]): string[][] {
  const sets: string[][] = [];
  const fromEntityName = nameTokens(piNameFromEntityName(entityName));
  if (fromEntityName.length >= 2) sets.push(fromEntityName);
  for (const profileUrl of profileUrls) {
    const fromLeaf = nameTokens(urlLeaf(profileUrl));
    if (fromLeaf.length >= 2) sets.push(fromLeaf);
  }
  return sets;
}

export function surnamesOf(nameTokenSets: string[][]): string[] {
  return [
    ...new Set(
      nameTokenSets.map((set) => set[set.length - 1]).filter((surname) => surname.length >= 4),
    ),
  ];
}

const EPONYM_SUFFIX = /^(.+?)(lab|labs|laboratory|group|research)$/;

/**
 * Whether the url is a Yale subdomain dedicated to one of these surnames, as
 * `holland.chem.yale.edu` and `vaccarogroup.yale.edu` are.
 *
 * This arm exists because a real lab homepage often spells the surname only and never
 * the forename, so the page text cannot identify the subject on its own. It is
 * restricted to a dedicated `yale.edu` subdomain because that is the only eponym
 * shape Yale itself allocates to one group. Two weaker shapes were measured and both
 * produced confirmed wrong-subject grafts on search-supplied candidates:
 *
 * - A self-registered domain. `bakhoumlab.org` is titled "Mathieu Bakhoum Lab" and
 *   was adopted for a different Bakhoum. Anyone can register a surname domain.
 * - A surname path on a host shared by a whole school. `medicine.yale.edu/lab/martin`
 *   is a cardiovascular lab and was adopted for a child-psychiatry PI. The path is
 *   allocated by surname alone, and a school has several people per common surname.
 *
 * Corpus surname ambiguity is NOT a sufficient guard for either shape: both grafts
 * passed it, because the corpus knew only one row by that surname while Yale has
 * several people with it. Corpus ambiguity is not world ambiguity.
 */
export function urlCarriesEponym(url: string, surnames: string[]): boolean {
  if (surnames.length === 0) return false;
  const host = hostnameOf(url).replace(/^www\./, '');
  if (!host || !/\.yale\.edu$/.test(host)) return false;
  const labels = host.replace(/\.yale\.edu$/, '').split('.');
  if (labels.length === 0) return false;
  return surnames.some((surname) =>
    labels.some((label) => {
      if (label === surname) return true;
      const eponym = label.match(EPONYM_SUFFIX);
      return Boolean(eponym) && eponym![1] === surname;
    }),
  );
}

export function buildLookupSubject(
  entity: LabSiteCandidateEntity,
  isUnambiguousSurname: (surname: string) => boolean,
): LabSiteSubject | null {
  const entitySlug = typeof entity.slug === 'string' ? entity.slug : '';
  const entityName = typeof entity.name === 'string' ? entity.name : '';
  if (!entitySlug) return null;
  const nameTokenSets = nameTokenSetsFor(entityName, citedUrls(entity).filter(isProfileCitation));
  if (nameTokenSets.length === 0) return null;
  const longest = nameTokenSets.reduce((best, set) => (set.length > best.length ? set : best));
  const displayName = longest.map((token) => token[0].toUpperCase() + token.slice(1)).join(' ');
  return {
    entitySlug,
    entityName,
    displayName,
    nameTokenSets,
    eponymSurnames: surnamesOf(nameTokenSets).filter(isUnambiguousSurname),
    query: `"${displayName}" Yale lab research group website`,
  };
}

const REJECT_HOST =
  /(linkedin|twitter|x\.com|bsky\.app|facebook|instagram|researchgate|scholar\.google|pubmed|ncbi\.nlm|doi\.org|semanticscholar|orcid\.org|wikipedia|loop\.frontiersin|expertscape|doximity|healthgrades|sciprofiles|europepmc)/i;

const CLINICAL_DIRECTORY_HOST =
  /(^|\.)(yalemedicine\.org|ynhh\.org|ynhhs\.org|clinicaltrials\.gov|castleconnolly\.com|vitals\.com|webmd\.com|zocdoc\.com|aan\.com|michaeljfox\.org|tracxn\.com)$/i;

const CLINICAL_DIRECTORY_PATH =
  /\/(specialists?|clinical-trials?|doctors?|providers?|physicians?|find-a-doctor|patient-care|abstractdetails|conditions)(\/|$)/i;

/**
 * A page that names this PI at Yale without being their lab: a patient-facing
 * clinician directory entry, a trial listing, a funder's grantee page, a conference
 * abstract.
 *
 * Measured: with search supplying candidates, this class was 9 of the 10 the gate
 * adopted on a 25-row pilot. Ground-truth measurement had not caught it, because a
 * corpus lab site paired with the wrong row tests the wrong SUBJECT, and these pages
 * have the right subject and the wrong KIND.
 */
export function isClinicalDirectoryUrl(url: string): boolean {
  const host = hostnameOf(url).replace(/^www\./, '');
  if (!host) return false;
  if (CLINICAL_DIRECTORY_HOST.test(host)) return true;
  try {
    return CLINICAL_DIRECTORY_PATH.test(new URL(url).pathname.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * A search result worth fetching. Rejects the social, bibliographic and
 * physician-rating hosts that dominate a name search, and rejects a Yale profile
 * page because the row already has one - the whole point is to find the OTHER link.
 */
export function isWorthFetching(url: unknown): boolean {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return false;
  const host = hostnameOf(url);
  if (!host) return false;
  if (REJECT_HOST.test(host)) return false;
  if (isProfileCitation(url)) return false;
  if (isGrantCitation(url)) return false;
  if (isClinicalDirectoryUrl(url)) return false;
  return true;
}

const RESEARCH_UNIT_WORD =
  /(\b|\w)(lab|labs|laboratory|laboratories)\b|\b(group|center|centre|consortium|institute|initiative|programme|collaboratory|collaborative|research|network|studio)\b/i;

const RESEARCH_UNIT_HOST_LABEL =
  /(^|[.\-])[a-z0-9-]*(lab|labs|laboratory|group|research)([.\-]|$)/i;

const RESEARCH_UNIT_PATH_SEGMENT = /\/(lab|labs|laboratory|group)(\/|$)/i;

/**
 * Whether the page presents itself as a research unit rather than a person or a
 * service. Satisfied by a unit word in the title, a lab-shaped host or `/lab/` path,
 * or an address built from the PI's own name, which is what a personal academic
 * homepage is.
 *
 * A bare `/research/` path segment is deliberately NOT enough: a division's
 * `/research/<disease-area>` and `/research/faculty` pages both satisfied it while
 * being umbrella pages listing many faculty.
 *
 * The lab arm deliberately allows a suffix inside a word, because `QuLab` and
 * `CANDLAB` are real corpus lab sites that a `\blab\b` match refuses.
 */
export function identifiesResearchUnit(
  url: string,
  title: string,
  nameTokenSets: string[][],
): boolean {
  if (RESEARCH_UNIT_WORD.test(title)) return true;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (RESEARCH_UNIT_HOST_LABEL.test(parsed.hostname)) return true;
  if (RESEARCH_UNIT_PATH_SEGMENT.test(parsed.pathname)) return true;
  const address = `${parsed.hostname}${parsed.pathname}`.toLowerCase().replace(/[^a-z]+/g, '');
  return nameTokenSets.some((set) => set.every((token) => address.includes(token)));
}

const MULTI_TENANT_YALE_HOST =
  /^(medicine|ysph|nursing|som|seas|eng|law|divinity|drama|music|environment|library\.medicine|publichealth)\.yale\.edu$/i;

/**
 * Whether a page on a host that serves a whole school is a departmental section
 * rather than one group's site.
 *
 * Yale publishes a group on a school host either as a `/lab/<slug>/` microsite or as
 * a single-segment project microsite. A deeper path is a division's own structure, so
 * `/internal-medicine/<division>/research/<disease-area>` and
 * `/<department>/research/faculty` are pages about a roster. Measured: those two
 * shapes were the entire wrong-grain cohort once the clinician class was refused,
 * while every true positive on a school host sat at depth one or two.
 *
 * There is deliberately no exemption for a deep path named after the subject. That
 * shape is how `medicine.yale.edu/lab/<surname>` was adopted for the wrong person, and
 * a school host allocates such a path by surname alone.
 */
export function isDepartmentalSectionUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (!MULTI_TENANT_YALE_HOST.test(parsed.hostname.replace(/^www\./, ''))) return false;
  const segments = parsed.pathname.split('/').filter(Boolean);
  if (segments[0]?.toLowerCase() === 'lab') return false;
  return segments.length > 2;
}

const GENERIC_SUBPAGE =
  /^\/(people|members|lab-members|team|staff|research|publications|contact|contact-us|about|about-us|home|welcome|news)\/?$/i;

/**
 * The site root for a candidate that landed on a generic subpage of its own site.
 *
 * Search returns whichever page ranked, so a lab's own `/people` can outrank its
 * homepage. Returns null when the candidate is already a root or sits on a path deep
 * enough that the root would be a different site, as a shared multi-lab host is.
 */
export function siteRootCandidate(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!GENERIC_SUBPAGE.test(parsed.pathname)) return null;
  return `${parsed.protocol}//${parsed.host}/`;
}

/**
 * Visible page text, with `<head>` and script bodies removed.
 *
 * Reading a fixed prefix of raw markup instead measured 21% recall against
 * known-correct lab pages, because a Yale CMS page spends its first 20kB on head
 * and navigation; the same regexes over extracted text scored 92%.
 */
export function extractVisibleText(html: string): string {
  return html
    .replace(/<head[\s\S]*?<\/head>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

export function titleOf(html: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return (match?.[1] || '').replace(/\s+/g, ' ').trim();
}

export interface LabSiteVerdict {
  url: string;
  status: number;
  title: string;
  namesPi: boolean;
  namedInTextOnly: boolean;
  namedByEponymUrlOnly: boolean;
  mentionsYale: boolean;
  looksLikeLabSite: boolean;
  identifiesResearchUnit: boolean;
}

const LAB_SITE_MARKERS =
  /\b(principal investigator|our lab|the lab|lab members|join the lab|research group|group members|positions available|our research|publications|lab news|research interests)\b/i;

export function judgePage(
  url: string,
  status: number,
  title: string,
  visibleText: string,
  subject: Pick<LabSiteSubject, 'nameTokenSets' | 'eponymSurnames'>,
): LabSiteVerdict {
  const haystack = `${title} ${visibleText}`.toLowerCase();
  const namedInText = subject.nameTokenSets.some((set) =>
    set.every((token) => haystack.includes(token)),
  );
  const namedByEponymUrl = urlCarriesEponym(url, subject.eponymSurnames);
  return {
    url,
    status,
    title,
    namesPi: namedInText || namedByEponymUrl,
    namedInTextOnly: namedInText && !namedByEponymUrl,
    namedByEponymUrlOnly: !namedInText && namedByEponymUrl,
    mentionsYale: /\byale\b/.test(haystack) || /(^|\.)yale\.edu$/i.test(hostnameOf(url)),
    looksLikeLabSite: LAB_SITE_MARKERS.test(haystack),
    identifiesResearchUnit:
      !isClinicalDirectoryUrl(url) &&
      !isDepartmentalSectionUrl(url) &&
      identifiesResearchUnit(url, title, subject.nameTokenSets),
  };
}

/**
 * Whether a fetched page is adoptable as this subject's lab site.
 *
 * Four requirements, each measured. Naming the PI and mentioning Yale come from
 * 90 known-correct (row, lab site) pairs and 270 adversarial pairings of a real Yale
 * lab site with a different row: 78.9% recall at 1.1% false positive on the
 * wrong-subject axis.
 *
 * Being a research unit is the fourth, and it exists because that measurement could
 * not see the wrong-KIND axis. With search supplying candidates, a 25-row pilot
 * adopted 10 pages of which 9 were clinician directory entries, trial listings or
 * conference abstracts that correctly named the PI at Yale. Requiring a research-unit
 * identity refused all of them and cost 2.1 points of ground-truth recall.
 */
export function isAdoptableLabSite(verdict: LabSiteVerdict): boolean {
  if (verdict.status < 200 || verdict.status >= 400) return false;
  return (
    verdict.namesPi &&
    verdict.mentionsYale &&
    verdict.looksLikeLabSite &&
    verdict.identifiesResearchUnit
  );
}

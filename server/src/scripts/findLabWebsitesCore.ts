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
 * Whether the url is named after one of these surnames, as `nandylab.org`,
 * `bradfordlab.yale.edu` or `medicine.yale.edu/lab/pomahac/` are.
 *
 * A surname-shaped host is only safe when the surname identifies one person, which
 * is why the caller supplies surnames already filtered for corpus ambiguity:
 * `bakhoumlab.org` matches two different Bakhoums at Yale, and adopting it for
 * either one is the wrong-subject graft #2652 measured.
 */
export function urlCarriesEponym(url: string, surnames: string[]): boolean {
  if (surnames.length === 0) return false;
  const host = hostnameOf(url).replace(/^www\./, '');
  if (!host) return false;
  let pathname = '';
  try {
    pathname = new URL(url).pathname.toLowerCase();
  } catch {
    return false;
  }
  const segments = [...host.split('.'), ...pathname.split('/').filter(Boolean)];
  return surnames.some((surname) =>
    segments.some((segment) => {
      if (segment === surname) return true;
      const eponym = segment.match(EPONYM_SUFFIX);
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
  return true;
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
  };
}

/**
 * Whether a fetched page is adoptable as this subject's lab site.
 *
 * Measured against 90 known-correct (row, lab site) pairs from the corpus and 270
 * adversarial pairings of a real Yale lab site with a different row: 78.9% recall
 * at 1.1% false positive. The false positives all came from the text arm, where a
 * page listing collaborators happens to spell another row's PI, so an adopted
 * candidate is a review queue entry rather than a write.
 */
export function isAdoptableLabSite(verdict: LabSiteVerdict): boolean {
  if (verdict.status < 200 || verdict.status >= 400) return false;
  return verdict.namesPi && verdict.mentionsYale && verdict.looksLikeLabSite;
}

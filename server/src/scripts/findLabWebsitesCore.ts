export interface LabSiteCandidateEntity {
  slug?: unknown;
  name?: unknown;
  studentVisibilityTier?: unknown;
  websiteUrl?: unknown;
  sourceUrls?: unknown;
  departments?: unknown;
  researchAreas?: unknown;
}

export interface LabSiteSubject {
  entitySlug: string;
  entityName: string;
  displayName: string;
  nameTokenSets: string[][];
  eponymSurnames: string[];
  queries: string[];
}

/**
 * A research home is not always a laboratory.
 *
 * The single query used previously was `"<name>" Yale lab research group website`.
 * Naming the artefact three times steers a semantic search engine toward lab pages,
 * so for a researcher whose research home is a personal academic homepage the engine
 * returned nearest-neighbour Yale lab sites instead. Measured: a humanities row's own
 * homepage was absent from its results entirely, while a run whose objective admitted
 * a personal homepage returned that site first.
 */
export const LAB_SITE_SEARCH_OBJECTIVE =
  'Find the personal or laboratory website of this researcher at Yale University. Return the lab, research group, or personal academic homepage if one exists, preferring a page the researcher or their group owns over a faculty profile, a directory listing, a news article, or a publication record.';

const stringEntries = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];

/**
 * A page about one person rather than a research home.
 *
 * The `faculty-directory` shapes are listed explicitly because the segment is
 * hyphen-compounded, so a `/directory/` match does not see it. Missing them made 19
 * served rows count a faculty-directory profile as their research site, which both
 * overstated coverage and kept those rows out of the population that needs a site.
 */
const PROFILE_PATH =
  /\/(profile|profiles|people|person|directory|faculty-directory|facultylist|faculty-profile)(\/|$)/i;
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

/**
 * Name tokens usable as a subject test.
 *
 * Diacritics are folded rather than stripped, because stripping them SPLITS a name:
 * `Colon` with an accent became two tokens and a name with an umlaut became a bare
 * initial plus a fragment. A single-character token is then dropped, because a bare
 * initial matches almost any page text and collapses the two-token requirement to a
 * surname-only match. That produced a real graft, where a row whose profile leaf is
 * `<initial>-<surname>` adopted a different person's lab of the same surname.
 *
 * Dropping a token can leave fewer than two, in which case the caller discards the
 * whole spelling and falls back to another, which is the intended outcome.
 *
 * Tokens are de-duplicated for the same reason: a profile leaf of `yang-yang` yielded
 * the same token twice, so the two-token subject test was satisfied by ONE name and
 * admitted an eponymous lab at another university.
 */
export function foldDiacritics(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

export function nameTokens(value: string): string[] {
  const tokens = foldDiacritics(value)
    .toLowerCase()
    .replace(/[^a-z ]+/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 1);
  return [...new Set(tokens)];
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

const PERSONAL_PUBLISHING_HOST = /^campuspress\.yale\.edu$/i;

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
 *
 * A single path segment on Yale's personal publishing platform counts for the same
 * reason a dedicated subdomain does: the university allocates that space to one
 * person, so the institution is doing the disambiguation. A deeper path there does not.
 */
export function urlCarriesEponym(url: string, surnames: string[]): boolean {
  if (surnames.length === 0) return false;
  const host = hostnameOf(url).replace(/^www\./, '');
  if (!host || !/\.yale\.edu$/.test(host)) return false;
  const matchesSurname = (token: string) =>
    surnames.some((surname) => {
      if (token === surname) return true;
      const eponym = token.match(EPONYM_SUFFIX);
      return Boolean(eponym) && eponym![1] === surname;
    });

  if (PERSONAL_PUBLISHING_HOST.test(host)) {
    let segments: string[] = [];
    try {
      segments = new URL(url).pathname.split('/').filter(Boolean);
    } catch {
      return false;
    }
    return (
      segments.length === 1 && matchesSurname(segments[0].toLowerCase().replace(/[^a-z]/g, ''))
    );
  }

  const labels = host.replace(/\.yale\.edu$/, '').split('.');
  return labels.some((label) => matchesSurname(label));
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
  const topic = topicalContext(entity);
  return {
    entitySlug,
    entityName,
    displayName,
    nameTokenSets,
    eponymSurnames: surnamesOf(nameTokenSets).filter(isUnambiguousSurname),
    queries: [
      `"${displayName}" Yale lab website`,
      `"${displayName}" laboratory Yale University`,
      `"${displayName}" Yale research group homepage`,
      `"${displayName}" Yale personal academic website`,
      ...(topic ? [`"${displayName}" Yale ${topic}`] : []),
    ],
  };
}

/**
 * Hosts that answer a person-name query without being anyone's research home.
 *
 * The bibliometric aggregators and contact-scraper hosts were added after they were
 * adopted by the gate on real runs: each names the researcher, mentions Yale, and
 * lists publications, so only the host can refuse them.
 */
const TOPIC_STOPWORD =
  /^(the|and|of|for|in|on|at|to|with|studies|study|research|lab|laboratory|group|using|our|new|role|effects?|based)$/i;

/**
 * A few subject words from the row itself, to disambiguate a common name.
 *
 * A name-only query cannot separate two researchers who share a surname, and the
 * measured grafts were all same-surname. The row already states its department and
 * research areas, so the query can say what this person actually works on.
 */
export function topicalContext(entity: LabSiteCandidateEntity): string {
  const departments = Array.isArray(entity.departments)
    ? entity.departments.filter((d): d is string => typeof d === 'string')
    : [];
  const areas = Array.isArray(entity.researchAreas)
    ? entity.researchAreas.filter((a): a is string => typeof a === 'string')
    : [];
  const words: string[] = [];
  for (const phrase of [...departments.slice(0, 1), ...areas.slice(0, 3)]) {
    for (const word of phrase.split(/[^A-Za-z]+/)) {
      if (word.length < 4 || TOPIC_STOPWORD.test(word)) continue;
      const lower = word.toLowerCase();
      if (!words.includes(lower)) words.push(lower);
      if (words.length >= 6) break;
    }
    if (words.length >= 6) break;
  }
  return words.join(' ');
}

const REJECT_HOST =
  /(linkedin|twitter|x\.com|bsky\.app|facebook|instagram|researchgate|scholar\.google|pubmed|ncbi\.nlm|doi\.org|semanticscholar|orcid\.org|wikipedia|loop\.frontiersin|expertscape|doximity|healthgrades|sciprofiles|europepmc|research\.com|grantome|rocketreach|contactout|zoominfo|rate?myprofessors|academia\.edu|philpeople|vivo\.|prabook|scilit|colab\.ws|x-mol|chemeurope|patents\.google|justia|bizapedia|crunchbase|sciencegate|typeset\.io|ouci\.dntb|peeref|scispace)/i;

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

const RESEARCH_UNIT_HOST_LABEL = /(^|[.-])[a-z0-9-]*(lab|labs|laboratory|group|research)([.-]|$)/i;

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
/**
 * Whether the title's leading segment is just this person's name, as
 * `Amity Doolittle | Tropical Resources Institute` is.
 *
 * That shape is a profile entry on an organisation's site, so a unit word later in
 * the title names the HOST, not this page. Measured: it was the last route by which
 * institute and centre profile pages were admitted as research homes. A genuine unit
 * title leads with the unit (`Emonet Lab - Laboratory of ...`) or with page chrome
 * (`Welcome | The Steitz Lab`).
 */
export function titleLeadsWithPersonName(title: string, nameTokenSets: string[][]): boolean {
  const lead = title.split(/[|\u2013\u2014\u00b7]|\s-\s/)[0] || '';
  if (RESEARCH_UNIT_WORD.test(lead)) return false;
  const tokens = nameTokens(lead);
  if (tokens.length === 0 || tokens.length > 4) return false;
  return nameTokenSets.some((set) => set.every((token) => tokens.includes(token)));
}

export function identifiesResearchUnit(
  url: string,
  title: string,
  nameTokenSets: string[][],
): boolean {
  if (RESEARCH_UNIT_WORD.test(title) && !titleLeadsWithPersonName(title, nameTokenSets))
    return true;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (RESEARCH_UNIT_HOST_LABEL.test(parsed.hostname)) return true;
  if (RESEARCH_UNIT_PATH_SEGMENT.test(parsed.pathname)) return true;
  if (isSelfOwnedAddress(parsed, nameTokenSets)) return true;
  return isPersonalHomepage(parsed, title, nameTokenSets);
}

const HOSTING_PREFIX = /^(view|site|sites|pages|home|~[a-z0-9]+|u)$/i;

const ORGANISATION_WORD =
  /\b(university|college|school|department|institute|institution|centre|center|hospital|foundation|association|society|academy|ventures|office|program|division|faculty of)\b/i;

/**
 * Whether the page is this person's own homepage rather than a profile about them.
 *
 * Both shapes put the name in the title, so the title alone cannot separate them. Two
 * further conditions do: the title must not go on to name an ORGANISATION (a profile
 * reads `<name> | <university>`), and the address must be shallow enough to be the
 * person's own space rather than an entry inside someone else's structure.
 *
 * A title of three or more separator-delimited parts is also refused: an organisation
 * site renders a breadcrumb (`<name> | <role> | <org>`), while a personal homepage
 * titles itself with one or two.
 *
 * Measured: this recovers personal homepages on a hosting platform, on an abbreviated
 * path, and on a domain built from initials, none of which spell the full name in the
 * address, while still refusing `<org>/team/<name>` and `<org>/faculty/<name>`.
 */
function isPersonalHomepage(parsed: URL, title: string, nameTokenSets: string[][]): boolean {
  if (!titleLeadsWithPersonName(title, nameTokenSets)) return false;
  if (ORGANISATION_WORD.test(title)) return false;
  if (title.split(/[|\u2013\u2014\u00b7]/).filter((part) => part.trim()).length > 2) return false;
  const segments = parsed.pathname.split('/').filter(Boolean);
  if (segments.length <= 1) return true;
  return segments.length === 2 && HOSTING_PREFIX.test(segments[0]);
}

/**
 * Whether the address itself belongs to this person, rather than merely mentioning
 * them somewhere in a path.
 *
 * A self-owned domain is the name: `<forename><surname>.com`. On Yale's personal
 * publishing platform the equivalent is the FIRST path segment, which is the space
 * allocated to that person.
 *
 * Matching the name anywhere in the path is what this replaces, and it was wrong in a
 * way that only showed once retrieval broadened: every profile entry, team listing and
 * news article about a person carries their name in its path, so the arm admitted
 * `<org>/team/<name>` and `<news>/<name>-wins-award` as research homes. The deciding
 * observation is that those pages render the ORGANISATION's navigation, while a
 * self-owned site renders the person's own.
 */
function isSelfOwnedAddress(parsed: URL, nameTokenSets: string[][]): boolean {
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  const hostLetters = host.replace(/[^a-z]+/g, '');
  const segments = parsed.pathname.split('/').filter(Boolean);
  const matchesAll = (haystack: string) =>
    nameTokenSets.some((set) => set.every((token) => haystack.includes(token)));
  if (matchesAll(hostLetters.replace(/(yale|edu|com|org|net)/g, ''))) return true;
  if (!PERSONAL_PUBLISHING_HOST.test(host)) return false;
  if (segments.length !== 1) return false;
  return matchesAll(segments[0].toLowerCase().replace(/[^a-z]+/g, ''));
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

const MEMBER_LISTING_SEGMENT =
  /^(people|members|lab-members|labmembers|personnel|team|our-team|ourteam|staff|faculty|faculty-staff|group-members|groupmembers|who-we-are|whoweare|alumni|current-members|members-old)$/i;

/**
 * Whether the page is a roster of a group's members.
 *
 * This is the dominant residual wrong-grain class: the row's person is a MEMBER of
 * somebody else's lab, so the lab's own `/people` names them and satisfies every
 * other requirement. It is safe to refuse outright because the caller already probes
 * the site root, so a page that really is this person's own group is adopted at its
 * root instead; falling back to the roster only happens when the root does NOT name
 * them, which is precisely the member case.
 */
export function isMemberListingUrl(url: string): boolean {
  try {
    const segments = new URL(url).pathname.split('/').filter(Boolean);
    if (segments.length === 0) return false;
    return MEMBER_LISTING_SEGMENT.test(segments[segments.length - 1]);
  } catch {
    return false;
  }
}

/**
 * Whether the address is named after a DIFFERENT person than the subject.
 *
 * `medicine.yale.edu/lab/<other-surname>/...` and `<other-surname>lab.org` are that
 * other person's research home whatever the page says, so a row that merely appears
 * on it must not adopt it. The caller supplies the corpus surnames, because a token
 * only counts as somebody else's name if the corpus knows a person by it.
 */
export function carriesForeignEponym(
  url: string,
  ownSurnames: string[],
  corpusSurnames: Set<string>,
): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const own = new Set(ownSurnames);
  const labels = parsed.hostname
    .replace(/^www\./, '')
    .replace(/\.yale\.edu$/, '')
    .split('.');
  const segments = parsed.pathname.split('/').filter(Boolean);
  for (const raw of [...labels, ...segments]) {
    const token = raw.toLowerCase().replace(/[^a-z]/g, '');
    for (const candidate of [token, token.match(EPONYM_SUFFIX)?.[1] || '']) {
      if (candidate.length < 4) continue;
      if (own.has(candidate)) return false;
      if (corpusSurnames.has(candidate)) return true;
    }
  }
  return false;
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
  memberListing: boolean;
  foreignEponym: boolean;
  namesPi: boolean;
  namedInTextOnly: boolean;
  namedByEponymUrlOnly: boolean;
  mentionsYale: boolean;
  looksLikeLabSite: boolean;
  identifiesResearchUnit: boolean;
}

const LAB_SITE_MARKERS =
  /\b(principal investigator|our lab|the lab|lab members|join the lab|research group|group members|positions available|our research|publications|lab news|research interests)\b/i;

/**
 * Whether the name token appears as a name, rather than as letters inside another word.
 *
 * A plain substring test matched `hong` inside `Hongyu` and admitted a different
 * person's centre. A plain word boundary is too strict in the other direction, because
 * a page writes its own name compounded, as `SteitzLab` or `warmacklab`, and requiring
 * a boundary there cost 18 points of measured recall. So a trailing continuation is
 * allowed only when it is a lab word or a plural.
 */
export const NAME_PROXIMITY_CHARS = 30;

/**
 * Whether all of a name's tokens appear CLOSE TOGETHER, rather than anywhere on the
 * page.
 *
 * A lab members page lists dozens of people, so requiring each token somewhere on the
 * page matches a forename from one entry against a surname from another. Measured
 * grafts: a row for one Zhao matched a former postdoc of a different Zhao, and a row
 * for one Wen matched a different Wen, because the remaining tokens appeared elsewhere
 * in the roster. Anchoring on the surname and requiring the rest within a short window
 * is what makes the match a NAME rather than a coincidence of vocabulary.
 */
export function containsNameTogether(haystack: string, tokens: string[]): boolean {
  if (tokens.length === 0) return false;
  const surname = tokens[tokens.length - 1];
  const rest = tokens.slice(0, -1);
  if (rest.length === 0) return containsWord(haystack, surname);
  const anchor = new RegExp(
    `\\b${surname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(lab|labs|laboratory|laboratories|group|s)?\\b`,
    'g',
  );
  let match: RegExpExecArray | null;
  while ((match = anchor.exec(haystack)) !== null) {
    const from = Math.max(0, match.index - NAME_PROXIMITY_CHARS);
    const to = Math.min(haystack.length, match.index + surname.length + NAME_PROXIMITY_CHARS);
    const window = haystack.slice(from, to);
    if (rest.every((token) => containsWord(window, token))) return true;
  }
  return false;
}

export function containsWord(haystack: string, token: string): boolean {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}(lab|labs|laboratory|laboratories|group|s)?\\b`).test(haystack);
}

export function judgePage(
  url: string,
  status: number,
  title: string,
  visibleText: string,
  subject: Pick<LabSiteSubject, 'nameTokenSets' | 'eponymSurnames'>,
  corpusSurnames: Set<string> = new Set(),
): LabSiteVerdict {
  const haystack = foldDiacritics(`${title} ${visibleText}`).toLowerCase();
  const namedInText = subject.nameTokenSets.some((set) => containsNameTogether(haystack, set));
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
    memberListing: isMemberListingUrl(url),
    foreignEponym: carriesForeignEponym(url, surnamesOf(subject.nameTokenSets), corpusSurnames),
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
 *
 * Reading like a bench laboratory is deliberately NOT required. That vocabulary
 * ("our lab", "principal investigator", "lab members") is a bench-science idiom, and
 * requiring it refused the research homes of humanities, social-science and computer-
 * science researchers, who are much of the remaining population. Measured on one
 * sample of 120 known-correct pairs: requiring it scored 65.8% recall against 69.2%
 * without, at 0 of 360 adversarial false positives either way. It cost recall and
 * bought nothing, so `looksLikeLabSite` is now reported but not required.
 *
 * A member roster and an address named after a different person are refused outright.
 * They are the residual wrong-GRAIN class, where the row's person appears on a real
 * lab's site because they work in it, and no amount of page reading makes that lab
 * their own research home.
 */
export function isAdoptableLabSite(verdict: LabSiteVerdict): boolean {
  if (verdict.status < 200 || verdict.status >= 400) return false;
  if (verdict.memberListing || verdict.foreignEponym) return false;
  return verdict.namesPi && verdict.mentionsYale && verdict.identifiesResearchUnit;
}

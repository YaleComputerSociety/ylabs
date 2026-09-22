import { isExternalScholarlyPlatformHost } from './externalScholarlyPlatforms';
import { isEphemeralDeployHostUrl, isSelfReferentialUrl } from './urlSafety';

const URL_MAXLENGTH = 2048;

const textValue = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

const parseHttpUrl = (value: unknown): URL | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > URL_MAXLENGTH) return undefined;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
  return url;
};

export function isProfileOrPeopleDirectoryPath(pathname: string): boolean {
  return (
    /\/profile\//i.test(pathname) ||
    /\/(?:people|person|faculty|faculty-directory)\//i.test(pathname) ||
    // A centre's team page entry renders one person's record exactly as
    // `/people/<person>` does, and was reachable as a research home because no
    // predicate covered the segment (#2708).
    /\/(?:team|our-team|staff)\/[^/]/i.test(pathname) ||
    /\/directory\/faculty\//i.test(pathname) ||
    /\/who-we-are\/faculty\//i.test(pathname)
  );
}

export function isPersonProfileOrDirectoryUrl(value: unknown): boolean {
  const url = parseHttpUrl(value);
  if (!url) return false;
  const pathname = url.pathname.endsWith('/') ? url.pathname : `${url.pathname}/`;
  return isProfileOrPeopleDirectoryPath(pathname);
}

/**
 * The narrow CMS-profile shape (`.../profile/<person>/`), as distinct from the
 * wider family of faculty-directory shapes. Kept separate because a page under
 * `/profile/` renders one person's record and nothing else, while a school's
 * faculty-directory page routinely also states that person's own lab name.
 */
export function isPersonCmsProfileUrl(value: unknown): boolean {
  const url = parseHttpUrl(value);
  if (!url) return false;
  return /\/profile\//i.test(url.pathname);
}

const PAGINATED_LISTING_QUERY = /(?:^|[?&])page=\d/i;

const INDEX_LISTING_PATH = /\/(?:a-to-z-index|a-z-index|az-index|lab-websites)\//i;

const DIRECTORY_ROOT_PATH = /\/(?:people|faculty|faculty-directory|directory)\/$/i;

const PEOPLE_ROSTER_PATH = /\/people\/(?:members|faculty-directory|faculty|directory)\/$/i;

const PEOPLE_INDEX_PATH = /\/people\/index(?:\.[a-z0-9]+)?\/$/i;

const PEOPLE_INDEX_FILE_PATH = /\/people\.(?:html?|aspx|php)(?:\/|$)/i;

const MEMBERS_ROOT_PATH = /\/(?:members|membership)\/$/i;

const DIRECTORY_ROSTER_ROOT_PATH =
  /\/directory\/(?:faculty(?:-fellows|-directory|-and-staff|-staff|-affiliates)?|staff|people|members|fellows|affiliates)\/$/i;

const DRUPAL_FACET_QUERY = /[?&]f(?:\[|%5b)\d+(?:\]|%5d)=/i;

const SECTION_INDEX_ROOT_PATH =
  /^\/(?:cores|centers|centers-institutes|centers-initiatives|research\/centers)$/i;

const BOILERPLATE_PLATFORM_HOSTS = new Set([
  'wordpress.org',
  'www.wordpress.org',
  'wordpress.com',
  'www.wordpress.com',
  'wp.com',
  'www.wp.com',
  'w.org',
  'automattic.com',
  'www.automattic.com',
  'jetpack.com',
  'www.jetpack.com',
  'gravatar.com',
  'www.gravatar.com',
  'drupal.org',
  'www.drupal.org',
  'joomla.org',
  'www.joomla.org',
  'squarespace.com',
  'www.squarespace.com',
  'wix.com',
  'www.wix.com',
  'weebly.com',
  'www.weebly.com',
  'godaddy.com',
  'www.godaddy.com',
]);

export function isBoilerplatePlatformHostUrl(value: unknown): boolean {
  const url = parseHttpUrl(value);
  if (!url) return false;
  return BOILERPLATE_PLATFORM_HOSTS.has(url.hostname.toLowerCase());
}

/**
 * Hosts that publish journalism ABOUT research rather than a research home. A media
 * mention is legitimate evidence that a person works on something, so it stays in
 * `sourceUrls` and keeps rendering as a source row; what it can never be is the
 * destination behind the entity's "Website" link, no matter which lane proposed it
 * (#2532, the #2300 category shape rather than its redirector shape).
 *
 * A host category and not a path vocabulary, because the article path carries no
 * signal: `news.yale.edu/2024/06/05/<headline>` is a dated slug, and the only
 * news-shaped path arm in `sourceUrlToResearchHomeWebsiteUrl` needs a literal
 * `/news/` segment. `isContentPageUrl` misses it for the same reason.
 *
 * Sized against the corpus before landing, per the repo's rule for a denylist: over
 * 1,760 live `websiteUrl` values and every active `websiteUrl`/`sourceUrls`
 * observation on Development this list matched 12 observation values on exactly four
 * hosts, all of them articles, and zero legitimate research homes. A registrable
 * domain that merely ENDS in a listed one (`elotroalex.com` against `x.com`) is why
 * the match is host-suffix anchored rather than a substring: the naive form flagged
 * two live personal sites.
 *
 * `client/src/utils/researchDetailSources.ts` carries the same list, because the
 * detail page must refuse the article as its headline outreach action once this side
 * clears the `websiteUrl`. Parity is pinned by
 * `contracts/pressAndNewsHosts.cases.json`, which both suites read: the two lists
 * drifted by six entries inside the pull request that introduced them, so add a host
 * to the contract rather than to one side alone.
 */
export const PRESS_AND_NEWS_HOSTS: readonly string[] = [
  'abcnews.go.com',
  'apnews.com',
  'axios.com',
  'bbc.co.uk',
  'bbc.com',
  'bloomberg.com',
  'bostonglobe.com',
  'businessinsider.com',
  'c-span.org',
  'cbsnews.com',
  'cnbc.com',
  'cnn.com',
  'courant.com',
  'ctinsider.com',
  'ctmirror.org',
  'ctpost.com',
  'dailymail.co.uk',
  'economist.com',
  'forbes.com',
  'foxnews.com',
  'ft.com',
  'huffpost.com',
  'independent.co.uk',
  'insidehighered.com',
  'latimes.com',
  'marketwatch.com',
  'medscape.com',
  'msnbc.com',
  'nbcnews.com',
  'newhavenindependent.org',
  'news.yale.edu',
  'newsweek.com',
  'newyorker.com',
  'nhregister.com',
  'npr.org',
  'nypost.com',
  'nytimes.com',
  'pbs.org',
  'politico.com',
  'propublica.org',
  'reuters.com',
  'salon.com',
  'scientificamerican.com',
  'slate.com',
  'statnews.com',
  'theatlantic.com',
  'theconversation.com',
  'theguardian.com',
  'thehill.com',
  'time.com',
  'usatoday.com',
  'vox.com',
  'washingtonpost.com',
  'wired.com',
  'wsj.com',
  'yalealumnimagazine.com',
  'yaledailynews.com',
];

const PRESS_AND_NEWS_HOST_SET = new Set(PRESS_AND_NEWS_HOSTS);

export function isPressOrNewsHostUrl(value: unknown): boolean {
  const url = parseHttpUrl(value);
  if (!url) return false;
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (PRESS_AND_NEWS_HOST_SET.has(host)) return true;
  return PRESS_AND_NEWS_HOSTS.some((press) => host.endsWith(`.${press}`));
}

const FILE_SHARE_HOSTS = new Set([
  'drive.google.com',
  'docs.google.com',
  'dropbox.com',
  'www.dropbox.com',
  'box.com',
  'www.box.com',
  'app.box.com',
  'onedrive.live.com',
  '1drv.ms',
]);

const DIRECT_DOCUMENT_PATH = /\.(?:pdf|docx?|pptx?|xlsx?)$/i;

export function isFileShareOrDocumentUrl(value: unknown): boolean {
  const url = parseHttpUrl(value);
  if (!url) return false;
  return (
    FILE_SHARE_HOSTS.has(url.hostname.toLowerCase()) || DIRECT_DOCUMENT_PATH.test(url.pathname)
  );
}

const DIRECTORY_LOADER_SEGMENT_PATH = /\/load_[a-z0-9_]+(?:\/|$)/i;

const DIRECTORY_NUMERIC_ID_SUBPATH =
  /\/(?:people|person|faculty|faculty-directory|directory)\/\d+(?:\/|$)/i;

// Drupal serves roster pagination from an internal endpoint that returns a JSON
// command envelope rather than a page. It is never readable by a student, so it is
// refused as a source as well as a research home. 11 `dept-law-*` rows served
// `law.yale.edu/views/ajax` before this arm existed (#2605).
const CMS_INTERNAL_ENDPOINT_PATH = /\/views\/ajax(?:\/|$)|\/ajax\/views\/|\/system\/ajax(?:\/|$)/i;

export function isDirectoryLoaderUrl(value: unknown): boolean {
  const url = parseHttpUrl(value);
  if (!url) return false;
  const pathname = url.pathname.toLowerCase();
  return (
    DIRECTORY_LOADER_SEGMENT_PATH.test(pathname) ||
    DIRECTORY_NUMERIC_ID_SUBPATH.test(pathname) ||
    CMS_INTERNAL_ENDPOINT_PATH.test(pathname)
  );
}

const DEPARTMENT_FACULTY_ROSTER_PATH = /^\/people\/faculty(?:-|\/|$)/i;

const FACULTY_DIRECTORY_ROOT_PATH = /^\/research-and-faculty\/faculty-directory$/i;

// Mirrors client/src/utils/researchDetailSources.ts `isDepartmentRosterProvenanceUrl`,
// whose collective-leaf arm lives here as `isSharedPeopleRosterUrl`; changing either
// arm requires updating the other, because the server only clears a cited link the
// detail page is willing to re-render.
export function isDepartmentRosterProvenanceUrl(value: unknown): boolean {
  const url = parseHttpUrl(value);
  if (!url) return false;
  const host = url.hostname.replace(/^www\./i, '').toLowerCase();
  if (!host.endsWith('yale.edu')) return false;
  const pathname = url.pathname.toLowerCase().replace(/\/+$/, '');
  return (
    DIRECTORY_LOADER_SEGMENT_PATH.test(pathname) ||
    DEPARTMENT_FACULTY_ROSTER_PATH.test(pathname) ||
    FACULTY_DIRECTORY_ROOT_PATH.test(pathname) ||
    isSharedPeopleRosterUrl(value)
  );
}

export function isFacetedOrSectionIndexUrl(value: unknown): boolean {
  const url = parseHttpUrl(value);
  if (!url) return false;
  if (DRUPAL_FACET_QUERY.test(url.search)) return true;
  const pathname = url.pathname.toLowerCase().replace(/\/+$/, '');
  return SECTION_INDEX_ROOT_PATH.test(pathname);
}

export function isListingOrIndexUrl(value: unknown): boolean {
  const url = parseHttpUrl(value);
  if (!url) return false;
  if (PAGINATED_LISTING_QUERY.test(url.search)) return true;
  if (isDirectoryLoaderUrl(value)) return true;
  if (isFacetedOrSectionIndexUrl(value)) return true;
  const pathname = (url.pathname.endsWith('/') ? url.pathname : `${url.pathname}/`).toLowerCase();
  return (
    INDEX_LISTING_PATH.test(pathname) ||
    DIRECTORY_ROOT_PATH.test(pathname) ||
    DIRECTORY_ROSTER_ROOT_PATH.test(pathname) ||
    PEOPLE_ROSTER_PATH.test(pathname) ||
    PEOPLE_INDEX_PATH.test(pathname) ||
    PEOPLE_INDEX_FILE_PATH.test(pathname) ||
    MEMBERS_ROOT_PATH.test(pathname)
  );
}

/**
 * Deliberately excludes the bare words `donor`, `donors`, `donation`, `endowment`
 * and `campaign`. Each is a real research subject - donor conception, organ
 * donation, the endowment effect, campaign finance - so matching them as a bare
 * path segment condemns genuine research homes. The fundraising sense is carried
 * by the unambiguous navigation words and by the compound donor phrases, which is
 * enough: the #2460 page is caught by `charitable`.
 */
const INSTITUTIONAL_ADVANCEMENT_PATH =
  /(^|[-/])(giving|give|donate|charitable|donors-make-a-difference|donor-relations|donor-recognition|fundraising|philanthropy|advancement-office|development-office|bequest|planned-giving|make-a-gift|ways-to-give|support-us|alumni-giving|capital-campaign)([-/]|$)/i;

/**
 * A fundraising, giving, or advancement page on an institution's own site. These
 * pages name a real person - the donor whose fund it commemorates - which is what
 * makes them dangerous: any lane that reads a declared lead off a cited page
 * attributes every citing row to that donor (#2460, the #2385 shape).
 *
 * Refused as a research home wherever a `websiteUrl` is chosen, not only at the
 * scraper that first mints one, because a donor page is never any researcher's
 * research home regardless of which lane proposed it.
 */
export function isInstitutionalAdvancementUrl(value: unknown): boolean {
  const url = parseHttpUrl(value);
  if (!url) return false;
  return INSTITUTIONAL_ADVANCEMENT_PATH.test(url.pathname);
}

const ROSTER_COLLECTIVE_LEAF_TOKEN =
  /^(?:faculty|faculties|staff|professor|professors|lecturer|lecturers|instructor|instructors|people|persons|humans|member|members|membership|fellow|fellows|affiliate|affiliates|associates|scholars|researchers|team|teams|directory|listing|roster|index|primary|emeriti|emeritus)$/i;

const MAX_ROSTER_LEAF_TOKEN_COUNT = 5;

/**
 * A page listing a whole group of people rather than one person's own profile.
 * Yale department sites name these leaves with a collective noun that is routinely
 * prefixed by the department or a rank - `/people/linguistics-faculty`,
 * `/people/core-faculty`, `/people/ladder-faculty`, `/people/professors`,
 * `/about/faculty-directory` - so the fixed `/people/faculty` shapes in
 * `PEOPLE_ROSTER_PATH` miss most of them. Person slugs are name-shaped and never
 * carry a collective noun, so keying on the leaf's token vocabulary separates the
 * two; the token-count bound keeps long article slugs
 * (`/news/professor-ian-ayres-aims-to-foster-...`) from reading as a roster.
 *
 * Deliberately NOT folded into `isListingOrIndexUrl`: that predicate also drives
 * `websiteUrl` clearing in `resolveBackfillWebsiteUrl`, where widening it would
 * strand small orgs whose only website is their own `/team` or `/people` page.
 */
export function isSharedPeopleRosterUrl(value: unknown): boolean {
  const url = parseHttpUrl(value);
  if (!url) return false;
  if (isListingOrIndexUrl(value)) return true;
  const segments = url.pathname.replace(/\/+$/, '').split('/').filter(Boolean);
  const leaf = segments[segments.length - 1]?.toLowerCase();
  if (!leaf || /\.[a-z0-9]{2,5}$/.test(leaf)) return false;
  const tokens = leaf.split('-');
  return (
    tokens.length <= MAX_ROSTER_LEAF_TOKEN_COUNT &&
    tokens.some((token) => ROSTER_COLLECTIVE_LEAF_TOKEN.test(token))
  );
}

const YALE_HOST = /(?:^|\.)yale\.edu$/i;

const PERSON_DIRECTORY_SEGMENT =
  /^(?:profile|profiles|people|person|persons|faculty|faculty-directory|directory|bio|bios)$/i;

const hasCollectiveRosterToken = (segment: string): boolean =>
  segment
    .split('-')
    .some((token) => ROSTER_COLLECTIVE_LEAF_TOKEN.test(token.replace(/\.[a-z0-9]+$/, '')));

/**
 * Another institution's person-profile or faculty-directory page: the right person
 * at the wrong employer. A Yale profile page routinely links the person's faculty
 * page at a previous institution, and adopting it as this entity's research home
 * scopes every harvested description and research area to an affiliation the entity
 * does not have. It also rots independently of Yale with nothing here able to
 * notice.
 *
 * Rejected on host plus path shape because an identity comparison cannot see it -
 * the person's name matches on both sides, so the #2437 identity guard passes. A
 * genuine personal or lab site on a non-Yale host is unaffected: it is not shaped
 * like a faculty directory.
 *
 * Requires a person to be NAMED after a directory segment. A bare
 * `somelab.com/people/` is that lab's own roster root, not an institutional
 * profile, and rejecting it would strand a lab whose only stored website is that
 * subpage - `isSharedPeopleRosterUrl` is the predicate for those. Institutional
 * directories nest their roster levels (`/faculty/directory/<person>`,
 * `/people/faculty/<person>`, `/people/members/<person>`), so every collective
 * noun below the directory segment is skipped as more directory chrome; taking
 * the segment straight after the directory as the person reads `directory` or
 * `faculty` as a name and lets the whole hierarchy through.
 */
export function isOffsiteInstitutionPersonProfileUrl(value: unknown): boolean {
  const url = parseHttpUrl(value);
  if (!url) return false;
  if (YALE_HOST.test(url.hostname)) return false;
  const segments = url.pathname
    .split('/')
    .filter(Boolean)
    .map((segment) => segment.toLowerCase());
  const directoryAt = segments.findIndex((segment) => PERSON_DIRECTORY_SEGMENT.test(segment));
  if (directoryAt === -1) return false;
  let personAt = directoryAt + 1;
  while (personAt < segments.length && hasCollectiveRosterToken(segments[personAt])) personAt += 1;
  return personAt < segments.length;
}

export interface ResearchEntityHostOwnerIdentity {
  name?: unknown;
  displayName?: unknown;
  entityType?: unknown;
  kind?: unknown;
}

// Entity shapes whose identity is a person or a person's lab. Restated here rather
// than imported from `researchHomeNameIdentityAuthority.ts`, the name-identity
// authority, because importing it back would make the two mutually dependent.
//
// Deliberately WIDER than that module's `PERSON_SCOPED_ENTITY_TYPES`, which omits
// `FACULTY_RESEARCH`: both retired types persist wherever
// `research-entity:consolidate-faculty-type` has not run, and omitting either leaves
// this refusal unreachable on exactly those stored rows. Widening the name-identity
// set instead would change served `displayName` on legacy rows, which is a different
// decision from this one and needs its own measurement (Development holds 0 rows of
// either retired type today, so neither set is load-bearing there).
const PERSON_SCOPED_HOST_TENANT_ENTITY_TYPES = new Set([
  'LAB',
  'FACULTY_RESEARCH_AREA',
  'FACULTY_RESEARCH',
  'INDIVIDUAL_RESEARCH',
  'FACULTY_PROJECT',
]);

const PERSON_SCOPED_HOST_TENANT_KINDS = new Set(['lab', 'individual', 'solo']);

/**
 * The single definition of "this row is one person's research rather than the
 * collective that publishes the page". Every refusal scoped by who cites a URL shares
 * it, because two definitions of person scope let the serve-time gate and the
 * promotion path disagree about the same stored field, and a row the DTO hides is then
 * re-promoted on the next materialization (#2579).
 */
export const isPersonScopedHostTenant = (entity?: ResearchEntityHostOwnerIdentity): boolean => {
  const entityType = textValue(entity?.entityType).toUpperCase();
  if (entityType) return PERSON_SCOPED_HOST_TENANT_ENTITY_TYPES.has(entityType);
  return PERSON_SCOPED_HOST_TENANT_KINDS.has(textValue(entity?.kind).toLowerCase());
};

/**
 * A departmental undergraduate-research page is plausible evidence for an
 * organizational row and for the fellowship records `department-undergrad-research`
 * mints, but it says nothing about an individual. 13 served `dept-physics-*` rows
 * cited one such page as evidence about a physicist (#2609), so the refusal is
 * scoped by who is citing rather than by the URL: condemning the shape outright
 * would break the lane that reads those pages as its source.
 */
export function isProgrammePageCitedByPerson(
  value: unknown,
  entity?: ResearchEntityHostOwnerIdentity,
): boolean {
  if (!isDepartmentProgrammePageUrl(value)) return false;
  return isPersonScopedHostTenant(entity);
}

export function isDisallowedResearchEntitySourceUrl(
  value: unknown,
  entity?: ResearchEntityHostOwnerIdentity,
): boolean {
  return (
    isSelfReferentialUrl(value) ||
    isEphemeralDeployHostUrl(value) ||
    isListingOrIndexUrl(value) ||
    isBoilerplatePlatformHostUrl(value) ||
    isMultiTenantAcademicHostRootUrl(value, entity) ||
    isProgrammePageCitedByPerson(value, entity)
  );
}

export function isBareDomainRootUrl(value: unknown): boolean {
  const url = parseHttpUrl(value);
  if (!url) return false;
  const hasPath = url.pathname.replace(/\/+$/, '').length > 0;
  const hasQuery = url.search.replace(/^\?/, '').trim().length > 0;
  return !hasPath && !hasQuery;
}

// Shared academic web hosts that publish one page per tenant under a `~user`
// path. Each was found serving `/~user/` member pages in the corpus, which is
// what makes the host organization rather than any one tenant the owner of its
// root. Listed without any `www.` alias, which the host lookup normalizes away.
export const MULTI_TENANT_ACADEMIC_HOSTS = [
  'csl.yale.edu',
  'stat.yale.edu',
  'ursula.chem.yale.edu',
  'gauss.math.yale.edu',
  'aida.econ.yale.edu',
  'aida.wss.yale.edu',
  'dido.econ.yale.edu',
  'pantheon.yale.edu',
  'math.mit.edu',
  'math.stanford.edu',
] as const;

const MULTI_TENANT_ACADEMIC_HOST_SET: ReadonlySet<string> = new Set(MULTI_TENANT_ACADEMIC_HOSTS);

const hostnameWithoutWwwAlias = (url: URL): string =>
  url.hostname.toLowerCase().replace(/^www\./, '');

const isMultiTenantAcademicHost = (url: URL): boolean =>
  MULTI_TENANT_ACADEMIC_HOST_SET.has(hostnameWithoutWwwAlias(url));

const BARE_INDEX_FILE_PATH = /^\/index\.(?:php|html?|aspx|cgi)$/i;

const TENANT_HOME_PATH = /^\/~[^/]+/;

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const MULTI_TENANT_ACADEMIC_HOST_ROOT_URL_PATTERN = new RegExp(
  `^https?://(?:www\\.)?(?:${MULTI_TENANT_ACADEMIC_HOSTS.map(escapeRegExp).join('|')})/*(?:index\\.(?:php|html?|aspx|cgi))?/*$`,
  'i',
);

/**
 * The stored-value form of `isPressOrNewsHostUrl`, for the candidate query that
 * decides which rows a repair pass even LOOKS at. Without it the refusal is
 * unreachable on stored data: the backfill selects candidates by URL shape, and an
 * article URL matches none of the profile, listing or multi-tenant shapes, so the
 * guard would never be consulted on the rows it exists for.
 */
export const PRESS_AND_NEWS_HOST_URL_PATTERN = new RegExp(
  `^https?://(?:[a-z0-9-]+\\.)*(?:${PRESS_AND_NEWS_HOSTS.map(escapeRegExp).join('|')})(?:[:/?#]|$)`,
  'i',
);

const HOST_OWNER_NAME_NOISE_WORDS = new Set([
  'a',
  'an',
  'and',
  'at',
  'for',
  'in',
  'of',
  'on',
  'the',
  'university',
  'yale',
]);

const hostOwnerNameWords = (value: unknown): string[] =>
  textValue(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/[\s-]+/)
    .filter((word) => word.length > 0 && !HOST_OWNER_NAME_NOISE_WORDS.has(word));

/**
 * Whether the entity being resolved is the host organization itself rather than
 * one of its tenants: `csl.yale.edu` is the Computer Systems Lab's own root, so
 * the CSL entity keeps it as its website while a member's entity does not.
 * Without this exception the umbrella's own entity would be stripped of the only
 * clickable route it has, unlike the sibling rejections (`wordpress.org`,
 * `drive.google.com`) which are never any entity's own home.
 *
 * Entity shape is checked BEFORE the name, and that ordering is the whole point.
 * Judging ownership on the name alone is self-defeating on exactly the corpus
 * this rule exists for, because a grafted affiliated-organization name (#2234,
 * #2360) is indistinguishable from real ownership: `nih-pi-rajit-manohar` is one
 * professor's grant-minted LAB row that a name graft renamed "Computer Systems
 * Lab at Yale", so a name-only check read it as owning `csl.yale.edu` and kept
 * the umbrella root on the one student-facing row this fix was written for.
 * A person-scoped entity can never own a shared host that publishes per-person
 * `~user` pages, whatever it happens to be named, so only an organization-shaped
 * entity is eligible for the name comparison at all.
 */
export function researchEntityOwnsMultiTenantAcademicHost(
  value: unknown,
  entity?: ResearchEntityHostOwnerIdentity,
): boolean {
  if (isPersonScopedHostTenant(entity)) return false;
  return [entity?.name, entity?.displayName].some((candidate) =>
    nameNamesMultiTenantAcademicHost(candidate, value),
  );
}

/**
 * How a candidate name names the shared academic host at `hostUrl`, or `null` when
 * it does not.
 *
 * `HOST_LABEL_WORD` - the host's label stands among the name's own words
 * ("Ursula Group" on `ursula.chem.yale.edu`). The name carries the label verbatim,
 * so on a distinctive label it is hard evidence.
 *
 * `NAME_INITIALS` - the name's initials spell the label ("Computer Systems Lab at
 * Yale" spells `csl`). A three-letter initialism is the weaker of the two, because
 * a member's own lab in the host's own field can spell the same letters ("Cell
 * Signaling Lab" also spells `csl`), so a reader that CONDEMNS a name on this match
 * needs the citation to be a claim on the host itself rather than the member's own
 * tenant page.
 *
 * The two are reported apart rather than collapsed because the same match carries
 * opposite meanings by reader: for an organization-shaped record it is ownership,
 * which is all `researchEntityOwnsMultiTenantAcademicHost` needs, while for a
 * person-scoped record it says the record has taken the host organization's
 * identity (#2360) and the cost of being wrong is a correct research home held off
 * every student surface.
 */
export type MultiTenantAcademicHostNameMatch = 'HOST_LABEL_WORD' | 'NAME_INITIALS' | null;

export function multiTenantAcademicHostNameMatch(
  candidateName: unknown,
  hostUrl: unknown,
): MultiTenantAcademicHostNameMatch {
  const url = parseHttpUrl(hostUrl);
  if (!url || !isMultiTenantAcademicHost(url)) return null;
  const hostLabel = hostnameWithoutWwwAlias(url).split('.')[0];
  if (!hostLabel) return null;
  const words = hostOwnerNameWords(candidateName);
  if (words.length === 0) return null;
  if (words.includes(hostLabel)) return 'HOST_LABEL_WORD';
  return words.map((word) => word[0]).join('') === hostLabel ? 'NAME_INITIALS' : null;
}

/**
 * Whether a candidate name is the name of the shared academic host at `hostUrl`, by
 * either match. A person can never be the host organization that publishes `~user`
 * pages for its members, so a person-scoped record whose name names a shared host it
 * cites has taken the host organization's identity (#2360). The name axis alone
 * cannot see that graft, because an umbrella that calls itself a Lab is a research
 * home by every naming rule the corpus has; the host it is the name OF is the
 * evidence. A reader that acts on the graft reads the match KIND, not this
 * predicate.
 */
export function nameNamesMultiTenantAcademicHost(
  candidateName: unknown,
  hostUrl: unknown,
): boolean {
  return multiTenantAcademicHostNameMatch(candidateName, hostUrl) !== null;
}

// Host labels that are also ordinary words a research name carries for its own
// reasons, so a name matching one is no evidence about who owns the host. Reading
// the label as ownership is harmless for an organization-shaped record, but the
// #2360 arm inverts the same match into a condemnation, where "Applied Math Lab" on
// `math.mit.edu/~atenant/` and a four-word topical name whose initials spell `stat`
// would both lose a correct name.
//
// Seeded by inspecting the current host list: `gauss`, `ursula`, `aida`, `dido`,
// `pantheon` and `csl` identify a host and nothing else, while `math` and `stat` are
// discipline words. Add a label here whenever a host whose first label is an
// ordinary word joins `MULTI_TENANT_ACADEMIC_HOSTS`.
const TOPICAL_MULTI_TENANT_ACADEMIC_HOST_LABELS: ReadonlySet<string> = new Set(['math', 'stat']);

/**
 * Whether a shared academic host's label identifies the host and nothing else, so
 * that a name matching it is evidence rather than coincidence. Read only where a
 * match CONDEMNS a name; ownership keeps reading every label.
 */
export function multiTenantAcademicHostLabelIsDistinctive(hostUrl: unknown): boolean {
  const url = parseHttpUrl(hostUrl);
  if (!url || !isMultiTenantAcademicHost(url)) return false;
  const hostLabel = hostnameWithoutWwwAlias(url).split('.')[0];
  if (!hostLabel) return false;
  return !TOPICAL_MULTI_TENANT_ACADEMIC_HOST_LABELS.has(hostLabel);
}

/**
 * The root of a shared academic host, which names the host organization and not
 * the tenant whose entity is being resolved. `csl.yale.edu` is the Computer
 * Systems Lab, a cross-department umbrella whose people page lists 13 faculty
 * and whose members publish at `csl.yale.edu/~user/`, so serving its root as one
 * professor's "Visit lab website" sends a student to the umbrella instead of the
 * person they clicked (#2359).
 *
 * Only the root is rejected, and only for an entity that is not the host
 * organization itself. A `~user` page under the same host is exactly the
 * tenant's own research home and stays promotable - including on the
 * multi-label hosts, where `isMultiTenantAcademicHostTenantPageUrl` is what
 * keeps `sourceUrlToResearchHomeWebsiteUrl` from discarding the evidence this
 * rule is meant to protect.
 */
export function isMultiTenantAcademicHostRootUrl(
  value: unknown,
  entity?: ResearchEntityHostOwnerIdentity,
): boolean {
  const url = parseHttpUrl(value);
  if (!url) return false;
  if (!isMultiTenantAcademicHost(url)) return false;
  const pathname = url.pathname.replace(/\/+$/, '');
  if (pathname.length > 0 && !BARE_INDEX_FILE_PATH.test(pathname)) return false;
  return !researchEntityOwnsMultiTenantAcademicHost(url.toString(), entity);
}

/**
 * A tenant's own page on a shared academic host (`csl.yale.edu/~arun/`). It is a
 * personal site in every sense that matters, so it must clear the Yale-subdomain
 * gate in `sourceUrlToResearchHomeWebsiteUrl`, which otherwise rejects every
 * multi-label Yale host (`gauss.math.yale.edu`) and would leave the tenant page
 * unpromotable exactly where the root has just been rejected.
 */
export function isMultiTenantAcademicHostTenantPageUrl(value: unknown): boolean {
  const url = parseHttpUrl(value);
  if (!url) return false;
  return isMultiTenantAcademicHost(url) && TENANT_HOME_PATH.test(url.pathname);
}

// Yale subdomain roots whose site is a multi-person research group rather than any
// one member's research home. Each earned its place by publishing a roster: the
// `/people` page of `het.yale.edu` ("Particle Theory Group") lists five faculty and
// links each one's departmental profile, which is what makes the group and not any
// member the owner of the root. Four served person-scoped rows offered that root as
// their own "Website" (#2579).
//
// A list rather than a shape, because there is nothing in `het.yale.edu` that tells
// it apart from `belieflab.yale.edu`. Refusing every custom Yale subdomain root to a
// person-scoped row was measured first and is not available: 139 of the 151 served
// rows on such a root are LAB or FACULTY_RESEARCH_AREA, and almost all of them are a
// real lab on its own host. Extend this list from evidence that a host publishes a
// multi-person roster, never from the bare fact that a root is shared.
export const RESEARCH_GROUP_HOST_ROOTS = ['het.yale.edu'] as const;

const RESEARCH_GROUP_HOST_ROOT_SET: ReadonlySet<string> = new Set(RESEARCH_GROUP_HOST_ROOTS);

export function isResearchGroupHostRootUrl(value: unknown): boolean {
  const url = parseHttpUrl(value);
  if (!url) return false;
  if (!RESEARCH_GROUP_HOST_ROOT_SET.has(hostnameWithoutWwwAlias(url))) return false;
  const pathname = url.pathname.replace(/\/+$/, '');
  return pathname.length === 0 || BARE_INDEX_FILE_PATH.test(pathname);
}

const DEPARTMENT_AUDIENCE_SCOPE_SEGMENT =
  /^(?:diversity|undergraduate|undergrad|graduate|academics|admissions|prospective(?:-students)?)$/i;

const DEPARTMENT_AUDIENCE_SUBJECT_SEGMENT =
  /^(?:(?:employment|jobs?|hiring|research|training|internship)-)?opportunit(?:y|ies)(?:-(?:undergraduates?|graduates?|students?))?$|^(?:employment|jobs?|hiring)$/i;

// A single research group's own host, which publishes its own pages: a page under
// `belieflab.yale.edu` or `hazarigroup.yale.edu` is that group advertising its own
// openings, so it is the group's to keep however it organizes the site.
const RESEARCH_GROUP_HOST_LABEL_TOKEN = /(?:lab|labs|group|project)/i;

/**
 * A department's audience-recruitment page: an opportunities, employment or jobs
 * listing published under an audience scope such as `/undergraduate/` or
 * `/diversity/`. `economics.yale.edu/undergraduate/employment-opportunities` is the
 * Economics department's jobs board and `psychology.yale.edu/diversity/
 * research-opportunities-undergraduates` is Psychology's undergraduate outreach page;
 * five served person-scoped rows offered one of the two as an individual's research
 * website (#2579).
 *
 * A lab's own audience page must survive all three arms, because clearing it takes a
 * link the lab really owns: the host arm leaves a research-group subdomain alone
 * however it organizes its site, the scope arm leaves
 * `hazarigroup.yale.edu/opportunities/` alone for having no audience segment, and the
 * anchored subject arm leaves `/undergraduate/job-openings` and
 * `/graduate/opportunities-for-students` alone, which a substring test on `job` or
 * `opportunit` had swept in.
 */
export function isDepartmentAudiencePageUrl(value: unknown): boolean {
  const url = parseHttpUrl(value);
  if (!url) return false;
  const host = hostnameWithoutWwwAlias(url);
  if (!/(^|\.)yale\.edu$/i.test(host)) return false;
  if (RESEARCH_GROUP_HOST_LABEL_TOKEN.test(host.split('.')[0])) return false;
  const segments = url.pathname.split('/').filter(Boolean);
  const scopeAt = segments.findIndex((segment) => DEPARTMENT_AUDIENCE_SCOPE_SEGMENT.test(segment));
  if (scopeAt < 0) return false;
  return segments
    .slice(scopeAt + 1)
    .some((segment) => DEPARTMENT_AUDIENCE_SUBJECT_SEGMENT.test(segment));
}

/**
 * A page about a collective offered as one person's research website: a research
 * group's own root, a department's audience-recruitment page, or a departmental
 * programme page. None of the three is condemned outright, because each is the real
 * home of the group, department or programme that publishes it and is legitimate
 * provenance for a person who appears on it. What none of them is, is the research
 * home of the individual (#2579).
 *
 * Entity shape is checked before anything else, and no name arm follows it. Judging
 * ownership on the entity's name is self-defeating on this corpus: a grafted
 * organization name (#2234, #2360) reads exactly like real ownership, and the name is
 * the field an umbrella graft has already overwritten. `entityType` comes from the
 * minting lane instead, so it survives the graft.
 */
export function isUmbrellaPageCitedByPerson(
  value: unknown,
  entity?: ResearchEntityHostOwnerIdentity,
): boolean {
  if (!isPersonScopedHostTenant(entity)) return false;
  return (
    isResearchGroupHostRootUrl(value) ||
    isDepartmentAudiencePageUrl(value) ||
    isDepartmentProgrammePageUrl(value)
  );
}

// Organization shapes whose identity is the collective that publishes a site rather
// than a tenant of it, so the site the collective's name designates is its own
// research home. Deliberately an ALLOWLIST and not the negation of
// `isPersonScopedHostTenant`: a negation would admit every unknown or absent
// `entityType`, which is exactly the person-scoped hole #2943 closed by refusing a
// research-group host root as an individual's website.
const ORGANIZATION_HOST_OWNER_ENTITY_TYPES = new Set(['CENTER', 'INSTITUTE', 'INITIATIVE']);

const ORGANIZATION_HOST_OWNER_KINDS = new Set(['center', 'institute', 'initiative']);

export function isOrganizationShapedHostOwner(entity?: ResearchEntityHostOwnerIdentity): boolean {
  const entityType = textValue(entity?.entityType).toUpperCase();
  if (entityType) return ORGANIZATION_HOST_OWNER_ENTITY_TYPES.has(entityType);
  return ORGANIZATION_HOST_OWNER_KINDS.has(textValue(entity?.kind).toLowerCase());
}

const ORGANIZATION_NAME_STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'at',
  'for',
  'in',
  'of',
  'on',
  'the',
]);

// Words naming the institution rather than the organization within it. Dropped from
// the single-word and concatenation anchors so `Yale Quantum Institute` designates
// `quantuminstitute` and not `yale`, and KEPT for one acronym variant so
// `Yale Center for Genome Analysis` still designates `ycga`.
const INSTITUTION_NAME_WORDS = new Set(['yale', 'university']);

// Words naming what kind of organization this is. Every organization in the corpus
// carries one, so none of them designates a site on its own: without this set
// `Center for X` would claim `center.yale.edu` and, worse, any `/center/` subtree.
// They also mark where a name stops designating and starts describing, because the
// words that QUALIFY the structure word are the organization's own designation while
// the ones after it name its mission: `Tobin Center for Economic Policy` is `tobin`
// and not `economic`. They stay inside the acronym anchors, where
// `Whitney Humanities Center` needs the trailing `center` to spell `whc`.
const ORGANIZATION_STRUCTURE_WORDS = new Set([
  'center',
  'centre',
  'centers',
  'institute',
  'institutes',
  'initiative',
  'initiatives',
  'program',
  'programme',
  'programs',
  'project',
  'projects',
  'lab',
  'labs',
  'laboratory',
  'group',
  'groups',
  'school',
  'college',
  'department',
  'division',
  'section',
  'office',
  'foundation',
  'research',
  'studies',
  'study',
  'council',
  'committee',
  'consortium',
  'network',
  'collaborative',
  'collaboration',
  'core',
  'cores',
  'facility',
  'society',
  'association',
  'academy',
  'academics',
  'education',
  'training',
  'news',
  'events',
  'about',
  'people',
]);

const MIN_ORGANIZATION_NAME_ANCHOR_LENGTH = 3;

const organizationNameWords = (value: unknown): string[] =>
  textValue(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/[\s-]+/)
    .filter((word) => word.length > 0 && !ORGANIZATION_NAME_STOPWORDS.has(word));

/**
 * The one word an organization's name designates a site with, when it has one: the
 * words qualifying its structure word, and only when they are a single word.
 *
 * Requiring the WHOLE designation is what keeps an incidental mission word from
 * claiming somebody else's site. `Tobin Center for Economic Policy` designates
 * `tobin`, but `Yale Center for Precision Medicine` designates nothing on its own, so
 * it cannot be handed the Yale School of Medicine's `medicine.yale.edu`, and
 * `Quantitative Biology Institute` cannot be handed the biology department's host.
 * A multi-word designation still reaches its own site through the run-together and
 * acronym anchors below.
 */
const organizationDesignationWord = (candidate: unknown): string => {
  const named = organizationNameWords(candidate).filter(
    (word) => !INSTITUTION_NAME_WORDS.has(word),
  );
  const structureAt = named.findIndex((word) => ORGANIZATION_STRUCTURE_WORDS.has(word));
  const designation = structureAt < 0 ? named : named.slice(0, structureAt);
  return designation.length === 1 ? designation[0] : '';
};

const isOrganizationDesignationWord = (
  label: string,
  entity?: ResearchEntityHostOwnerIdentity,
): boolean =>
  [entity?.name, entity?.displayName].some(
    (candidate) => organizationDesignationWord(candidate) === label,
  );

/**
 * The tokens an organization's own name designates: its sole designation word, the
 * initials of the whole name, and the words run together. Yale hosts a centre either
 * on a subdomain its name spells out (`tobin`, `isps`, `wti`, `quantuminstitute`) or
 * under a school's path segment that does the same (`medicine.yale.edu/cancer/`,
 * `.../genetics/research/ycga/`), so one token set serves both arms.
 *
 * Initials are taken twice, with and without the institution words, because a centre
 * spells its acronym either way: `Whitney Humanities Center` is `whc` and
 * `Yale Center for Genome Analysis` is `ycga`. The run-together form is taken twice
 * for the same reason, with and without the structure words, so `Yale Quantum
 * Institute` spells `quantuminstitute` and `Quantitative Biology Institute` still
 * spells `quantitativebiology`.
 */
export function organizationNameAnchors(entity?: ResearchEntityHostOwnerIdentity): Set<string> {
  const anchors = new Set<string>();
  for (const candidate of [entity?.name, entity?.displayName]) {
    const words = organizationNameWords(candidate);
    if (words.length === 0) continue;
    const named = words.filter((word) => !INSTITUTION_NAME_WORDS.has(word));
    if (named.length === 0) continue;
    const designation = organizationDesignationWord(candidate);
    if (designation) anchors.add(designation);
    const distinctive = named.filter((word) => !ORGANIZATION_STRUCTURE_WORDS.has(word));
    if (distinctive.length > 1) anchors.add(distinctive.join(''));
    if (named.length > 1) anchors.add(named.join(''));
    if (words.length > 1) anchors.add(words.map((word) => word[0]).join(''));
    if (named.length > 1) anchors.add(named.map((word) => word[0]).join(''));
  }
  return new Set(
    [...anchors].filter((anchor) => anchor.length >= MIN_ORGANIZATION_NAME_ANCHOR_LENGTH),
  );
}

const pathSegmentWithoutExtension = (segment: string): string =>
  segment.replace(/\.[a-z0-9]{2,5}$/, '');

/**
 * The organization's own site, derived from a page it cites on a host or subtree its
 * name designates. A centre whose only citation is its own roster page has no way in
 * at all, because every `websiteUrl` path refuses a roster page and none of them ever
 * looks one level up (#2534).
 *
 * Restricted to organization shapes and anchored on the entity's NAME, so this is
 * unavailable to the person-scoped rows #2943 exists for: an individual never
 * designates the host that publishes them, and serving a collective's root as one
 * person's research website is the #2359 defect.
 *
 * The deepest anchoring path segment wins, so a centre nested under a school keeps its
 * own subtree rather than the school's; when nothing in the path is the organization's
 * the host root is taken, and when neither is, nothing is returned. Refusing rather
 * than guessing is the point: a citation on a host the name does not designate is
 * evidence about somebody else's site.
 *
 * The emitted path is sliced from the citation's REAL segments rather than from the
 * normalized ones matched against, because a normalized segment names a URL that need
 * not exist: `/tobin.html` is a file and not a `/tobin/` directory, and a server may
 * hold `/Cancer/` and no `/cancer/`. A segment carrying an extension anchors its
 * parent for the same reason.
 *
 * A shared school or department subdomain (`genericYaleWebsiteSubdomains`) yields its
 * root only to the organization that subdomain is named after, so the MacMillan Center
 * still gets `macmillan.yale.edu` while a three-letter acronym colliding with `law` or
 * `som` gets nothing.
 */
export function organizationOwnedSiteUrlFromCitation(
  value: unknown,
  entity?: ResearchEntityHostOwnerIdentity,
): string {
  if (!isOrganizationShapedHostOwner(entity)) return '';
  const url = parseHttpUrl(value);
  if (!url) return '';
  const raw = url.toString();
  if (
    isSelfReferentialUrl(raw) ||
    isEphemeralDeployHostUrl(raw) ||
    isBoilerplatePlatformHostUrl(raw) ||
    isFileShareOrDocumentUrl(raw) ||
    isInstitutionalAdvancementUrl(raw) ||
    isProgramApplicationPortalUrl(raw) ||
    isExternalScholarlyPlatformHost(url.hostname)
  ) {
    return '';
  }
  const anchors = organizationNameAnchors(entity);
  if (anchors.size === 0) return '';
  const segments = url.pathname.split('/').filter(Boolean);
  const loweredSegments = segments.map((segment) => segment.toLowerCase());
  const matchSegments = loweredSegments.map(pathSegmentWithoutExtension);
  for (let index = matchSegments.length - 1; index >= 0; index -= 1) {
    if (!anchors.has(matchSegments[index])) continue;
    const depth = matchSegments[index] === loweredSegments[index] ? index + 1 : index;
    if (depth === 0) break;
    const owned = new URL(`${url.protocol}//${url.host}`);
    owned.pathname = `/${segments.slice(0, depth).join('/')}/`;
    return owned.toString();
  }
  const hostLabel = hostnameWithoutWwwAlias(url).split('.')[0];
  if (!hostLabel || !anchors.has(hostLabel)) return '';
  if (
    genericYaleWebsiteSubdomains.has(hostLabel) &&
    !isOrganizationDesignationWord(hostLabel, entity)
  ) {
    return '';
  }
  return new URL(`${url.protocol}//${url.host}/`).toString();
}

const PROGRAM_APPLICATION_PORTAL_HOST =
  /(?:^|\.)(?:communityforce\.com|studentgrants\.yale\.edu)$/i;

export function isProgramApplicationPortalUrl(value: unknown): boolean {
  const url = parseHttpUrl(value);
  if (!url) return false;
  return PROGRAM_APPLICATION_PORTAL_HOST.test(url.hostname);
}

/**
 * A record-specific application-portal URL points at one individual fund/record
 * (CommunityForce `/Funds/FundDetails.aspx?...` with a query string), not the
 * bare portal root. It is globally unique per fund, so it is a safe cross-source
 * identity key: a fund enumerated by the Student Grants Database source and the
 * same fund linked as an applicationLink from a public fellowship page share it,
 * and merge into one record rather than duplicating.
 */
export function isRecordSpecificApplicationPortalUrl(value: unknown): boolean {
  const url = parseHttpUrl(value);
  if (!url || !isProgramApplicationPortalUrl(url.toString())) return false;
  const hasPath = url.pathname.replace(/\/+$/, '').length > 0;
  const hasQuery = url.search.replace(/^\?/, '').trim().length > 0;
  return hasPath && hasQuery;
}

const PROGRAM_DETAIL_PATH_KEYWORD_PATTERN =
  /(?:fellowships?|grants?|scholars?|scholarships?|awards?|prizes?|internships?|assistantships?|research-internship-program|tobin-ra)/i;

function pathSegmentCount(url: URL): number {
  return url.pathname.split('/').filter(Boolean).length;
}

/**
 * A same-host link that is shallower than (or as shallow as) the program's own
 * source page, isn't the source page itself, and carries none of the
 * program-detail path keywords is almost always leaked site nav/footer chrome
 * (About Us, Apply, Give, Contact Us, academic section roots) rather than a
 * program-specific resource - regardless of which host the page happens to be
 * on (#633 residual).
 */
export function isSameHostShallowChromeUrl(value: unknown, sourceUrlValue: unknown): boolean {
  const url = parseHttpUrl(value);
  const sourceUrl = parseHttpUrl(sourceUrlValue);
  if (!url || !sourceUrl) return false;
  if (url.hostname.toLowerCase() !== sourceUrl.hostname.toLowerCase()) return false;
  if (url.pathname.replace(/\/+$/, '') === sourceUrl.pathname.replace(/\/+$/, '')) return false;
  if (PROGRAM_DETAIL_PATH_KEYWORD_PATTERN.test(url.pathname)) return false;
  const linkDepth = pathSegmentCount(url);
  if (linkDepth === 0) return false;
  return linkDepth <= 2 && linkDepth <= pathSegmentCount(sourceUrl);
}

const SITE_CHROME_PATH =
  /(?:^|\/)(?:privacy(?:-policy)?|accessibility(?:-statement)?|terms(?:-of-use|-of-service|-and-conditions)?|sitemap|site-map|contact(?:-us)?|give(?:-back|-now)?|giving|donate|make-a-gift|campus-life|faculty-(?:directory|openings|positions)|our-mantra|social-media|log-in|sign-in)(?:\/|$)/i;

export function isSiteNavigationOrFooterChromeUrl(value: unknown): boolean {
  const url = parseHttpUrl(value);
  if (!url) return false;
  return SITE_CHROME_PATH.test(url.pathname.toLowerCase());
}

export function isUnhelpfulProgramUrl(value: unknown, sourceUrlValue?: unknown): boolean {
  if (isProgramApplicationPortalUrl(value)) return false;
  return (
    isBareDomainRootUrl(value) ||
    isListingOrIndexUrl(value) ||
    isBoilerplatePlatformHostUrl(value) ||
    isSiteNavigationOrFooterChromeUrl(value) ||
    isSelfReferentialUrl(value) ||
    isSameHostShallowChromeUrl(value, sourceUrlValue)
  );
}

export const genericYaleWebsiteSubdomains = new Set([
  'african',
  'americanstudies',
  'art',
  'arthistory',
  'astronomy',
  'classics',
  'eall',
  'earth',
  'economics',
  'eeb',
  'engineering',
  'english',
  'environment',
  'erm',
  'filmstudies',
  'german',
  'gsp',
  'history',
  'jackson',
  'law',
  'macmillan',
  'medicine',
  'mba',
  'music',
  'nelc',
  'physics',
  'politicalscience',
  'russian-studies',
  'sociology',
  'som',
  'wgss',
  'yalemusic',
]);

export function canonicalLegacyResearchHomeUrl(url: URL): URL {
  const path = url.pathname.replace(/\/+$/, '/').toLowerCase();
  if (url.hostname === 'rjohnwilliams.wordpress.com') {
    return new URL('https://campuspress.yale.edu/rjohnwilliams/');
  }
  if (url.hostname === 'slavlab.yale.edu') {
    return new URL('https://campuspress.yale.edu/squirrel/people/the-bagriantsev-lab/');
  }
  if (url.hostname === 'squirrel.commons.yale.edu') {
    return new URL('https://campuspress.yale.edu/squirrel/people/elena-gracheva-lab/');
  }
  if (url.hostname === 'mrrc.yale.edu') {
    return new URL(
      'https://medicine.yale.edu/biomedical-imaging-institute/core-facilities/mr-core/',
    );
  }
  if (url.hostname === 'childstudycenter.yale.edu' && path === '/research/del/') {
    return new URL(
      'https://medicine.yale.edu/childstudy/research/collaborative-labs/developmental-electrophysiology-lab/',
    );
  }
  if (url.hostname === 'medicine.yale.edu' && path === '/cnrr/index.aspx') {
    return new URL('https://medicine.yale.edu/cnrr/');
  }
  return url;
}

// Yale hosts a lab site either on its own subdomain or under a blogging or
// site-builder platform, so `<lab>.sites.yale.edu` names a lab as distinctively
// as `<lab>.yale.edu` does. These labels carry no identity of their own.
const yaleSitePlatformSubdomains = new Set([
  'sites',
  'commons',
  'campuspress',
  'wordpress',
  'blogs',
]);

// A leftmost label naming a shared directory rather than one research home. A
// shared directory host treated as one home would let the PI dedupe merge
// unrelated people, which is far worse than declining to merge.
//
// `www` and `research` are deliberately NOT here. They are distinctive as a
// LEFTMOST label today (`research.yale.edu/<core>` is cited by 55 served rows),
// and `www.<dept>.yale.edu` is already refused by the trailing check, because a
// department label is not a shared trailing label.
const sharedYaleDirectoryHostLabels = new Set([
  'faculty',
  'people',
  'directory',
  'students',
  'about',
  'resources',
]);

// A trailing label many homes have in common, so it carries no identity of its
// own once a label to its left already names the home.
const sharedTrailingHostLabel = (label: string): boolean =>
  genericYaleWebsiteSubdomains.has(label) ||
  yaleSitePlatformSubdomains.has(label) ||
  sharedYaleDirectoryHostLabels.has(label) ||
  label === 'www' ||
  label === 'research' ||
  label === 'web';

/**
 * Whether the host names one specific research home rather than a shared Yale
 * site, which is what makes a shared URL evidence that two records are the same
 * home.
 *
 * The leftmost label carries the identity, and every label after it must be one
 * many homes have in common. Requiring a SINGLE label instead treated
 * `<lab>.<dept>.yale.edu` and `<lab>.sites.yale.edu` as non-distinctive, so the
 * PI dedupe refused to merge duplicate records sharing one lab site on those
 * hosts (#2581 residue).
 *
 * Strictly additive: no host that was distinctive before stops being so. That
 * matters because this predicate also gates whether a URL may be SERVED as a
 * research home, not only whether two rows are the same, and a bare platform
 * host such as `campuspress.yale.edu` is cited with a per-lab path by 90 rows.
 */
export function isCustomYaleResearchHomeSubdomain(url: URL): boolean {
  if (!/(^|\.)yale\.edu$/i.test(url.hostname)) return false;
  const prefix = url.hostname.toLowerCase().replace(/\.yale\.edu$/, '');
  if (!prefix) return false;
  const [distinctiveLabel, ...trailingLabels] = prefix.split('.');
  if (!distinctiveLabel) return false;
  if (genericYaleWebsiteSubdomains.has(distinctiveLabel)) return false;
  if (sharedYaleDirectoryHostLabels.has(distinctiveLabel)) return false;
  // A bare `www.yale.edu` stays distinctive, because it was before and rows cite
  // it with a path, but `www.<school>.yale.edu` names a school rather than one
  // home: `www` carries no identity, so it cannot be the label that supplies it.
  if (distinctiveLabel === 'www' && trailingLabels.length > 0) return false;
  return trailingLabels.every(sharedTrailingHostLabel);
}

const GOOGLE_SITES_NAMED_PATH = /^\/(?:view|site)\/[^/]+/i;

const GOOGLE_SITES_DOMAIN_SCOPED_PATH = /^\/[a-z0-9-]+(?:\.[a-z0-9-]+)+\/[^/]+/i;

export function isGoogleSitesResearchHome(url: URL): boolean {
  if (url.hostname !== 'sites.google.com') return false;
  return (
    GOOGLE_SITES_NAMED_PATH.test(url.pathname) || GOOGLE_SITES_DOMAIN_SCOPED_PATH.test(url.pathname)
  );
}

// `training-opportunities` and a bare `research-opportunities` name the same kind of
// page as the scoped forms below, and a school publishes them without an
// undergraduate/graduate prefix, so the prefixed pattern alone missed them (#2708).
const SCOPED_RESEARCH_PROGRAMME_SEGMENT =
  /^(?:(?:undergraduate|undergrad|graduate)-research(?:-opportunit(?:y|ies))?|(?:training|research|educational)-opportunit(?:y|ies))$/i;

const PROGRAMME_SCOPE_SEGMENT = /^(?:undergraduate|undergrad|graduate|academics|admissions)/i;

const PROGRAMME_SUBJECT_SEGMENT =
  /^(?:(?:undergraduate-|undergrad-|graduate-)?research(?:-opportunit(?:y|ies))?|thesis|senior-thesis|advising|courses|curriculum|programs?|study|opportunities)$/i;

/**
 * Refused as a research HOME only, never as a source. A departmental page such as
 * `physics.yale.edu/academics/undergraduate-studies/undergraduate-research` is a
 * legitimate input to `department-undergrad-research`, which reads exactly these
 * pages, so condemning the URL outright would kill that lane. What it is not is the
 * research home of an individual, and 8 `dept-physics-*` rows served this one page
 * as theirs (#2605).
 */
export function isDepartmentProgrammePageUrl(value: unknown): boolean {
  const url = parseHttpUrl(value);
  if (!url) return false;
  const host = url.hostname.replace(/^www\./i, '').toLowerCase();
  if (!host.endsWith('yale.edu')) return false;
  const segments = url.pathname.toLowerCase().split('/').filter(Boolean);
  if (segments.length < 2) return false;
  if (segments.some((segment) => SCOPED_RESEARCH_PROGRAMME_SEGMENT.test(segment))) return true;
  const scopeAt = segments.findIndex((segment) => PROGRAMME_SCOPE_SEGMENT.test(segment));
  if (scopeAt < 0) return false;
  return segments.slice(scopeAt + 1).some((segment) => PROGRAMME_SUBJECT_SEGMENT.test(segment));
}

export function sourceUrlToResearchHomeWebsiteUrl(
  value: unknown,
  entity?: ResearchEntityHostOwnerIdentity,
): string {
  const raw = textValue(value);
  if (!raw) return '';
  if (isListingOrIndexUrl(raw)) return '';
  if (isDepartmentProgrammePageUrl(raw)) return '';
  if (isBoilerplatePlatformHostUrl(raw)) return '';
  // Ordered ahead of the `isDirectPersonalSite` shortcut below, whose last disjunct
  // is `!isYale`: reached after it, every non-Yale press host would skip the
  // path-vocabulary checks entirely and be accepted.
  if (isPressOrNewsHostUrl(raw)) return '';
  if (isMultiTenantAcademicHostRootUrl(raw, entity)) return '';
  if (isUmbrellaPageCitedByPerson(raw, entity)) return '';
  try {
    const url = new URL(raw);
    url.hash = '';
    url.search = '';
    url.hostname = url.hostname.toLowerCase();
    if (!/^https?:$/i.test(url.protocol)) return '';
    if (isFileShareOrDocumentUrl(url.toString())) return '';
    if (/\/profile\//i.test(url.pathname)) return '';
    if (url.hostname === 'epilepsy.yale.edu') return '';
    if (url.hostname === 'sites.google.com' && !isGoogleSitesResearchHome(url)) return '';
    if (['alexandercoppock.com', 'www.alexandercoppock.com'].includes(url.hostname)) return '';
    if (
      url.hostname === 'www.yale.edu' &&
      /^\/macmillan\/shapiro\/index\.htm\/?$/i.test(url.pathname)
    ) {
      return '';
    }
    if (isExternalScholarlyPlatformHost(url.hostname)) {
      return '';
    }
    if (!url.pathname.endsWith('/') && !/\.[a-z0-9]{2,8}$/i.test(url.pathname)) {
      url.pathname = `${url.pathname}/`;
    }
    if (isProfileOrPeopleDirectoryPath(url.pathname)) {
      return '';
    }
    if (
      /\/(?:membership\/directory|research-opportunities-undergraduates?|diversity\/research-opportunities)\b/i.test(
        url.pathname,
      )
    ) {
      return '';
    }
    if (
      /\/(?:story|stories|news|search\/user)\b/i.test(url.pathname) ||
      /(?:^|[/-])people(?:[/-]|$)/i.test(url.pathname)
    ) {
      return '';
    }

    const hostPath = `${url.hostname}${url.pathname}`;
    const isYale = /(^|\.)yale\.edu$/i.test(url.hostname);
    if (
      isYale &&
      genericYaleWebsiteSubdomains.has(url.hostname.replace(/\.yale\.edu$/i, '')) &&
      /\/opportunities(?:-[0-9]+)?\//i.test(url.pathname)
    ) {
      return '';
    }
    const isDirectPersonalSite =
      /(?:^|\.)campuspress\.yale\.edu$/i.test(url.hostname) ||
      /github\.io$/i.test(url.hostname) ||
      isMultiTenantAcademicHostTenantPageUrl(url.toString()) ||
      !isYale;
    const isSpecificYaleResearchHomePath = /(?:lab|labs|project|group)/i.test(hostPath);
    if (
      !isDirectPersonalSite &&
      !isSpecificYaleResearchHomePath &&
      !isCustomYaleResearchHomeSubdomain(url)
    ) {
      return '';
    }
    return canonicalLegacyResearchHomeUrl(url).toString();
  } catch {
    return '';
  }
}

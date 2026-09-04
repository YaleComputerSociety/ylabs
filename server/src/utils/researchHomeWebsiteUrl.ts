import { isSelfReferentialUrl } from './urlSafety';

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

export function isDirectoryLoaderUrl(value: unknown): boolean {
  const url = parseHttpUrl(value);
  if (!url) return false;
  const pathname = url.pathname.toLowerCase();
  return (
    DIRECTORY_LOADER_SEGMENT_PATH.test(pathname) || DIRECTORY_NUMERIC_ID_SUBPATH.test(pathname)
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

export interface ResearchEntityHostOwnerIdentity {
  name?: unknown;
  displayName?: unknown;
  entityType?: unknown;
  kind?: unknown;
}

export function isDisallowedResearchEntitySourceUrl(
  value: unknown,
  entity?: ResearchEntityHostOwnerIdentity,
): boolean {
  return (
    isSelfReferentialUrl(value) ||
    isListingOrIndexUrl(value) ||
    isBoilerplatePlatformHostUrl(value) ||
    isMultiTenantAcademicHostRootUrl(value, entity)
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

// Entity shapes whose identity is a person or a person's lab. Mirrors
// `isPersonScopedResearchEntity` in `researchHomeNameIdentityAuthority.ts`,
// restated here rather than imported because that module is the name-identity
// authority and importing it back would make the two mutually dependent.
const PERSON_SCOPED_HOST_TENANT_ENTITY_TYPES = new Set([
  'LAB',
  'FACULTY_RESEARCH_AREA',
  'INDIVIDUAL_RESEARCH',
  'FACULTY_PROJECT',
]);

const PERSON_SCOPED_HOST_TENANT_KINDS = new Set(['lab', 'individual', 'solo']);

const isPersonScopedHostTenant = (entity?: ResearchEntityHostOwnerIdentity): boolean => {
  const entityType = textValue(entity?.entityType).toUpperCase();
  if (entityType) return PERSON_SCOPED_HOST_TENANT_ENTITY_TYPES.has(entityType);
  return PERSON_SCOPED_HOST_TENANT_KINDS.has(textValue(entity?.kind).toLowerCase());
};

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
  const url = parseHttpUrl(value);
  if (!url || !isMultiTenantAcademicHost(url)) return false;
  if (isPersonScopedHostTenant(entity)) return false;
  const hostLabel = hostnameWithoutWwwAlias(url).split('.')[0];
  if (!hostLabel) return false;
  return [entity?.name, entity?.displayName].some((candidate) => {
    const words = hostOwnerNameWords(candidate);
    if (words.length === 0) return false;
    return words.includes(hostLabel) || words.map((word) => word[0]).join('') === hostLabel;
  });
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

export function isCustomYaleResearchHomeSubdomain(url: URL): boolean {
  if (!/(^|\.)yale\.edu$/i.test(url.hostname)) return false;
  const prefix = url.hostname.replace(/\.yale\.edu$/i, '');
  return Boolean(prefix && !prefix.includes('.') && !genericYaleWebsiteSubdomains.has(prefix));
}

const GOOGLE_SITES_NAMED_PATH = /^\/(?:view|site)\/[^/]+/i;

const GOOGLE_SITES_DOMAIN_SCOPED_PATH = /^\/[a-z0-9-]+(?:\.[a-z0-9-]+)+\/[^/]+/i;

export function isGoogleSitesResearchHome(url: URL): boolean {
  if (url.hostname !== 'sites.google.com') return false;
  return (
    GOOGLE_SITES_NAMED_PATH.test(url.pathname) || GOOGLE_SITES_DOMAIN_SCOPED_PATH.test(url.pathname)
  );
}

export function sourceUrlToResearchHomeWebsiteUrl(
  value: unknown,
  entity?: ResearchEntityHostOwnerIdentity,
): string {
  const raw = textValue(value);
  if (!raw) return '';
  if (isListingOrIndexUrl(raw)) return '';
  if (isBoilerplatePlatformHostUrl(raw)) return '';
  if (isMultiTenantAcademicHostRootUrl(raw, entity)) return '';
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
    if (
      /\b(?:orcid\.org|pubmed\.ncbi\.nlm\.nih\.gov|ncbi\.nlm\.nih\.gov|doi\.org|linkedin\.com|researchgate\.net|scholar\.google\.com|reporter\.nih\.gov|nsf\.gov|academia\.edu|ispu\.org)$/i.test(
        url.hostname,
      )
    ) {
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

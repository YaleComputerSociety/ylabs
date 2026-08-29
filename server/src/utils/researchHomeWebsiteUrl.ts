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

export function isDisallowedResearchEntitySourceUrl(value: unknown): boolean {
  return (
    isSelfReferentialUrl(value) || isListingOrIndexUrl(value) || isBoilerplatePlatformHostUrl(value)
  );
}

export function isBareDomainRootUrl(value: unknown): boolean {
  const url = parseHttpUrl(value);
  if (!url) return false;
  const hasPath = url.pathname.replace(/\/+$/, '').length > 0;
  const hasQuery = url.search.replace(/^\?/, '').trim().length > 0;
  return !hasPath && !hasQuery;
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

export function sourceUrlToResearchHomeWebsiteUrl(value: unknown): string {
  const raw = textValue(value);
  if (!raw) return '';
  if (isListingOrIndexUrl(raw)) return '';
  if (isBoilerplatePlatformHostUrl(raw)) return '';
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

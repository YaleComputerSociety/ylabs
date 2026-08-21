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

export function sourceUrlToResearchHomeWebsiteUrl(value: unknown): string {
  const raw = textValue(value);
  if (!raw) return '';
  try {
    const url = new URL(raw);
    url.hash = '';
    url.search = '';
    url.hostname = url.hostname.toLowerCase();
    if (!/^https?:$/i.test(url.protocol)) return '';
    if (/\.(?:pdf|docx?|pptx?|xlsx?)$/i.test(url.pathname)) return '';
    if (/\/profile\//i.test(url.pathname)) return '';
    if (['epilepsy.yale.edu', 'sites.google.com'].includes(url.hostname)) return '';
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

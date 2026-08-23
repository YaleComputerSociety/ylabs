import { FellowshipLink } from '../types/types';
import { safeHttpUrl } from './url';

export interface SafeProgramLink extends FellowshipLink {
  href: string;
}

export const MAX_RENDERED_PROGRAM_LINKS = 6;

const GENERIC_ADMISSIONS_APPLY_PATH =
  /^\/(?:apply|apply-now|apply-today|admission|admissions|how-to-apply|prospective-students)$/i;

const PROGRAM_DETAIL_PATH_KEYWORD_PATTERN =
  /(?:fellowships?|grants?|scholars?|scholarships?|awards?|prizes?|internships?|assistantships?|research-internship-program|tobin-ra)/i;

const CHROME_LINK_LABELS = new Set([
  'home',
  'overview',
  'campus life',
  'stories',
  'new engineering campus',
  'student clubs & organizations',
  'student clubs and organizations',
  'departments',
  'undergraduate',
  'graduate',
  'study',
  'innovation & industry',
  'innovation and industry',
  'faculty directory',
  'faculty openings',
  'faculty resources',
  'school directory',
  'news',
  'events',
  'connect with us',
  "dean's message",
  'facts / figures',
  'facts and figures',
  'strategic vision',
  'give back',
  'contact us',
  'contact',
  'about us',
  'about',
  'services',
  'training',
  'successes',
  'instrumentation and libraries',
  'accessibility',
  'privacy policy',
  'privacy',
  'terms of use',
  'terms',
  'sitemap',
  'site map',
  'careers',
  'directions',
]);

const CHROME_LINK_LABEL_PATTERNS: RegExp[] = [
  /\boverview\b/,
  /\bprivacy\b/,
  /\baccessibility\b/,
  /\bcontact\s+us\b/,
  /\bgive\s+back\b/,
  /\bdean'?s\s+message\b/,
  /\bfaculty\s+(?:directory|openings|resources)\b/,
  /\bschool\s+directory\b/,
  /\bstrategic\s+vision\b/,
  /\bcampus\s+life\b/,
  /\bstudent\s+clubs\b/,
  /\bmagazine\b/,
  /\bsitemap\b/,
  /\bsite\s+map\b/,
  /\bterms\b/,
  /\bcareers\b/,
];

const GENERIC_APPLY_LABELS = new Set(['', 'apply', 'apply now', 'apply today', 'admissions']);

const normalizeLinkLabel = (label?: string): string =>
  (label || '')
    .replace(/[›»▸→>]+\s*$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

export const isChromeLinkLabel = (label?: string): boolean => {
  const normalized = normalizeLinkLabel(label);
  if (!normalized) return false;
  if (CHROME_LINK_LABELS.has(normalized)) return true;
  return CHROME_LINK_LABEL_PATTERNS.some((pattern) => pattern.test(normalized));
};

const parseHttpUrl = (value: unknown): URL | null => {
  const href = safeHttpUrl(value);
  if (!href) return null;
  try {
    return new URL(href);
  } catch {
    return null;
  }
};

const stripTrailingSlash = (path: string): string => path.replace(/\/+$/, '');

const pathSegmentCount = (url: URL): number => url.pathname.split('/').filter(Boolean).length;

export const isSameHostShallowChromeUrl = (value: unknown, sourceUrl: unknown): boolean => {
  const url = parseHttpUrl(value);
  const source = parseHttpUrl(sourceUrl);
  if (!url || !source) return false;
  if (url.hostname.toLowerCase() !== source.hostname.toLowerCase()) return false;
  if (stripTrailingSlash(url.pathname) === stripTrailingSlash(source.pathname)) return false;
  if (PROGRAM_DETAIL_PATH_KEYWORD_PATTERN.test(url.pathname)) return false;
  const linkDepth = pathSegmentCount(url);
  if (linkDepth === 0) return false;
  return linkDepth <= 2 && linkDepth <= pathSegmentCount(source);
};

export const isGenericAdmissionsApplyLink = (link: FellowshipLink): boolean => {
  const href = safeHttpUrl(link.url);
  if (!href) return false;

  try {
    const path = new URL(href).pathname.replace(/\/+$/, '') || '/';
    if (!GENERIC_ADMISSIONS_APPLY_PATH.test(path)) return false;
    return GENERIC_APPLY_LABELS.has(normalizeLinkLabel(link.label));
  } catch {
    return false;
  }
};

export const buildSafeProgramLinks = (
  links: FellowshipLink[] | undefined | null,
  sourceUrl?: string,
): SafeProgramLink[] => {
  const filtered = (links || [])
    .map((link) => ({ ...link, href: safeHttpUrl(link.url) }))
    .filter((link): link is SafeProgramLink => Boolean(link.href))
    .filter((link) => !isChromeLinkLabel(link.label))
    .filter((link) => !isGenericAdmissionsApplyLink(link))
    .filter((link) => !isSameHostShallowChromeUrl(link.href, sourceUrl));

  if (filtered.length > MAX_RENDERED_PROGRAM_LINKS) return [];
  return filtered;
};

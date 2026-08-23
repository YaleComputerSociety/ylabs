import { FellowshipLink } from '../types/types';
import { safeHttpUrl } from './url';

export interface SafeProgramLink extends FellowshipLink {
  href: string;
}

export const MAX_RENDERED_PROGRAM_LINKS = 6;

const GENERIC_ADMISSIONS_APPLY_PATH =
  /^\/(?:apply|apply-now|apply-today|admission|admissions|how-to-apply|prospective-students)$/i;

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
): SafeProgramLink[] => {
  const filtered = (links || [])
    .map((link) => ({ ...link, href: safeHttpUrl(link.url) }))
    .filter((link): link is SafeProgramLink => Boolean(link.href))
    .filter((link) => !isChromeLinkLabel(link.label))
    .filter((link) => !isGenericAdmissionsApplyLink(link));

  if (filtered.length > MAX_RENDERED_PROGRAM_LINKS) return [];
  return filtered;
};

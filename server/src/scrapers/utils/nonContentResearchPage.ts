export type NonContentResearchPageReason = 'bot-challenge' | 'sign-in-wall' | 'school-landing';

interface PageLike {
  url: string;
  text: string;
}

const INTERSTITIAL_MAX_CHARS = 2_000;

const BOT_CHALLENGE =
  /browser is being verified|Powered by CrowdSec|Checking (?:if the site connection is secure|your browser before accessing)|Attention Required! \| Cloudflare|Enable JavaScript and cookies to continue/i;

const SIGN_IN_WALL_TEXT = /Central Authentication Service[\s\S]{0,300}\bNetID and password\b/i;

const SIGN_IN_WALL_PATH = /^\/cas\/login\b/i;

const SCHOOL_HOSTS = new Set([
  'medicine.yale.edu',
  'ysph.yale.edu',
  'nursing.yale.edu',
  'environment.yale.edu',
  'law.yale.edu',
  'som.yale.edu',
  'divinity.yale.edu',
  'jackson.yale.edu',
  'engineering.yale.edu',
  'architecture.yale.edu',
  'art.yale.edu',
  'music.yale.edu',
  'drama.yale.edu',
  'gsas.yale.edu',
]);

const SCHOOL_INDEX_PATHS = new Set(['', '/research']);

const parsedUrl = (url: string): URL | null => {
  try {
    return new URL(url);
  } catch {
    return null;
  }
};

const normalizedPath = (url: URL): string => url.pathname.replace(/\/+$/, '').toLowerCase();

/**
 * Why a fetched or stored research page is not the row's content (#6460): a bot-challenge
 * interstitial, a sign-in wall, or a school's own front or research index that a cited page
 * redirected to. Such a page states nothing about the row, so it is never page-text evidence.
 */
export function nonContentResearchPageReason(page: PageLike): NonContentResearchPageReason | null {
  const url = parsedUrl(page.url);
  const text = page.text ?? '';
  const short = text.length <= INTERSTITIAL_MAX_CHARS;
  if (short && BOT_CHALLENGE.test(text)) return 'bot-challenge';
  if (url && SIGN_IN_WALL_PATH.test(url.pathname)) return 'sign-in-wall';
  if (short && SIGN_IN_WALL_TEXT.test(text)) return 'sign-in-wall';
  if (url && SCHOOL_HOSTS.has(url.host.toLowerCase()) && SCHOOL_INDEX_PATHS.has(normalizedPath(url))) {
    return 'school-landing';
  }
  return null;
}

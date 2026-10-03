import {
  isProgrammePageCitedByPerson,
  type ResearchEntityHostOwnerIdentity,
} from '../utils/researchHomeWebsiteUrl';

export type JoinPageEntity = ResearchEntityHostOwnerIdentity & { websiteUrl?: unknown };

export type JoinPageUrlRefusal =
  | 'not-an-http-url'
  | 'participant-recruitment-route'
  | 'non-undergraduate-audience-route'
  | 'site-root-is-not-a-join-page'
  | 'programme-page-offered-as-a-person-route';

type AudienceRefusal = 'participant-recruitment-route' | 'non-undergraduate-audience-route';

const PARTICIPANT_RECRUITMENT_TOKENS = new Set([
  'participate',
  'participating',
  'participation',
  'participant',
  'participants',
  'patient',
  'patients',
]);

const NON_UNDERGRADUATE_AUDIENCE_TOKENS = new Set([
  'phd',
  'doctoral',
  'predoctoral',
  'postdoc',
  'postdocs',
  'postdoctoral',
  'postgrad',
  'postgraduate',
  'postbac',
  'postbacc',
  'postbaccalaureate',
  'graduate',
  'grad',
  'admission',
  'admissions',
  'residency',
  'residents',
]);

// A phrase names its audience in its first words ("phd-opportunities", "for-graduate-students");
// a later word is usually a person's credential in a profile slug ("<name>-phd-aprn").
// Jobs, careers, staff and volunteer pages are deliberately absent: a hand-read found lab
// "Jobs" and "Volunteer" pages that recruit undergraduates, so only the page text can tell.
const AUDIENCE_LEAD_WORDS = 2;

const isUndergraduateToken = (token: string): boolean =>
  token.startsWith('undergrad') || token === 'college' || token.startsWith('bachelor');

function parseHttpUrl(value: unknown): URL | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    return /^https?:$/i.test(url.protocol) ? url : null;
  } catch {
    return null;
  }
}

function decodedPath(url: URL): string {
  try {
    return decodeURIComponent(url.pathname);
  } catch {
    return url.pathname;
  }
}

const phraseTokens = (phrase: string): string[] =>
  phrase
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

function audienceRefusal(
  phrases: readonly string[],
  leadWords: number = AUDIENCE_LEAD_WORDS,
): AudienceRefusal | null {
  const tokensByPhrase = phrases.map(phraseTokens).filter((tokens) => tokens.length > 0);
  const leadTokens = tokensByPhrase.flatMap((tokens) => tokens.slice(0, leadWords));
  if (leadTokens.some((token) => PARTICIPANT_RECRUITMENT_TOKENS.has(token))) {
    return 'participant-recruitment-route';
  }
  if (
    !tokensByPhrase.flat().some(isUndergraduateToken) &&
    leadTokens.some((token) => NON_UNDERGRADUATE_AUDIENCE_TOKENS.has(token))
  ) {
    return 'non-undergraduate-audience-route';
  }
  return null;
}

/** The audience rule read off a link's anchor text, for a lane that chooses among links. */
export function joinPageAnchorTextRefusal(text: string | undefined): AudienceRefusal | null {
  return audienceRefusal([text || ''], Number.POSITIVE_INFINITY);
}

function isUnderEntityWebsite(url: URL, websiteUrl: unknown): boolean {
  const website = parseHttpUrl(websiteUrl);
  if (!website) return false;
  const host = (value: URL) => value.hostname.toLowerCase().replace(/^www\./, '');
  if (host(url) !== host(website)) return false;
  const prefix = website.pathname.replace(/\/+$/, '');
  return url.pathname === prefix || url.pathname.startsWith(`${prefix}/`);
}

const isBareSiteRoot = (url: URL): boolean =>
  url.pathname.replace(/\/+$/, '').length === 0 && url.search.replace(/^\?/, '').length === 0;

/**
 * Why a URL a lane offers as an undergraduate join or application page is not one (#4430).
 * It reads the URL alone, so the access materializer applies it to stored evidence on every
 * resolve instead of waiting for the next scrape. Each arm is a class measured on served
 * signals: a study-recruitment page, a page whose path names a graduate, postdoctoral or
 * admissions audience and no undergraduate one, a bare site root, and a
 * department or center programme page offered as one person's route, which is the page the
 * detail route already refuses to cite for that row: a cancer center's training page
 * reached from faculty profiles' navigation backed 242 served signals.
 */
export function joinPageUrlRefusal(
  value: unknown,
  entity?: JoinPageEntity,
): JoinPageUrlRefusal | null {
  const url = parseHttpUrl(value);
  if (!url) return 'not-an-http-url';
  const audience = audienceRefusal(decodedPath(url).split('/'));
  if (audience) return audience;
  if (isBareSiteRoot(url)) return 'site-root-is-not-a-join-page';
  if (
    isProgrammePageCitedByPerson(url.toString(), entity) &&
    !isUnderEntityWebsite(url, entity?.websiteUrl)
  ) {
    return 'programme-page-offered-as-a-person-route';
  }
  return null;
}

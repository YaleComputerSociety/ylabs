import {
  isDepartmentProgrammePageUrl,
  type ResearchEntityHostOwnerIdentity,
} from '../utils/researchHomeWebsiteUrl';
import { orgUnitMatchKey } from './orgUnitCanonicalization';
import { DEFAULT_DEPT_CONFIGS } from './sources/departmentRosterScraper';

export type JoinPageEntity = ResearchEntityHostOwnerIdentity & {
  websiteUrl?: unknown;
  departments?: unknown;
};

export type JoinPageUrlRefusal =
  | 'not-an-http-url'
  | 'participant-recruitment-route'
  | 'non-undergraduate-audience-route'
  | 'site-root-is-not-a-join-page'
  | 'programme-page-of-another-entity';

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

const UNDERGRADUATE_RESEARCH_PROGRAMME_TOKENS = new Set([
  'research',
  'opportunity',
  'opportunities',
  'employment',
  'assistant',
  'assistants',
  'assistantship',
  'assistantships',
  'ra',
]);

const hostKey = (hostname: string): string => hostname.toLowerCase().replace(/^www\./, '');

let departmentByDedicatedHost: Map<string, string> | undefined;

// A host the department roster lane reads for exactly one department belongs to that
// department; a host it reads for several (a school or medical campus) names none.
function dedicatedDepartmentHosts(): Map<string, string> {
  if (departmentByDedicatedHost) return departmentByDedicatedHost;
  const departmentsByHost = new Map<string, Set<string>>();
  for (const config of DEFAULT_DEPT_CONFIGS) {
    try {
      const host = hostKey(new URL(config.url).hostname);
      const key = orgUnitMatchKey(config.deptName);
      if (key) departmentsByHost.set(host, new Set([...(departmentsByHost.get(host) || []), key]));
    } catch {
      continue;
    }
  }
  departmentByDedicatedHost = new Map(
    Array.from(departmentsByHost)
      .filter(([, keys]) => keys.size === 1)
      .map(([host, keys]) => [host, [...keys][0]]),
  );
  return departmentByDedicatedHost;
}

const entityDepartmentKeys = (entity?: JoinPageEntity): Set<string> =>
  new Set(
    (Array.isArray(entity?.departments) ? entity.departments : [])
      .map((department) => orgUnitMatchKey(department))
      .filter(Boolean),
  );

/**
 * A department's own undergraduate research or research-assistant programme page, offered
 * on a row of that same department (#4430). The owner keeps it as a way in for the
 * department's faculty: the economics research-assistant page names the route by which an
 * undergraduate works for one of them. The page must name undergraduates and research or
 * research-assistant work in its path, and sit on a host the department roster reads for
 * that one department, so a center's training page on a shared medical-campus host, and a
 * graduate or postdoctoral page, stay refused.
 */
export function isOwnDepartmentUndergraduateResearchProgramme(
  value: unknown,
  entity?: JoinPageEntity,
): boolean {
  const url = parseHttpUrl(value);
  if (!url) return false;
  const tokens = phraseTokens(decodedPath(url));
  if (!tokens.some(isUndergraduateToken)) return false;
  if (!tokens.some((token) => UNDERGRADUATE_RESEARCH_PROGRAMME_TOKENS.has(token))) return false;
  const department = dedicatedDepartmentHosts().get(hostKey(url.hostname));
  return Boolean(department) && entityDepartmentKeys(entity).has(department as string);
}

/**
 * A programme-shaped page the join admission keeps as one row's own way in: a page under the
 * row's own website, such as a lab's `/research-opportunities` page, or its own department's
 * undergraduate research programme. The detail route serves the same pages as the join
 * citation, so the page admitted and the page served cannot disagree (#4430).
 */
export function isProgrammePageAdmittedAsJoinRoute(
  value: unknown,
  entity?: JoinPageEntity,
): boolean {
  const url = parseHttpUrl(value);
  if (!url) return false;
  return (
    isOwnDepartmentUndergraduateResearchProgramme(url.toString(), entity) ||
    (isDepartmentProgrammePageUrl(url.toString()) && isUnderEntityWebsite(url, entity?.websiteUrl))
  );
}

const isBareSiteRoot = (url: URL): boolean =>
  url.pathname.replace(/\/+$/, '').length === 0 && url.search.replace(/^\?/, '').length === 0;

/**
 * Why a URL a lane offers as an undergraduate join or application page is not one (#4430).
 * It reads the URL alone, so the access materializer applies it to stored evidence on every
 * resolve instead of waiting for the next scrape. Each arm is a class measured on served
 * signals: a study-recruitment page, a page whose path names a graduate, postdoctoral or
 * admissions audience and no undergraduate one, a bare site root, and a department or center
 * programme page that is neither under the row's own website nor its own department's
 * undergraduate research programme: a cancer center's training page reached from faculty
 * profiles' navigation backed 242 served signals.
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
    isDepartmentProgrammePageUrl(url.toString()) &&
    !isProgrammePageAdmittedAsJoinRoute(url.toString(), entity)
  ) {
    return 'programme-page-of-another-entity';
  }
  return null;
}

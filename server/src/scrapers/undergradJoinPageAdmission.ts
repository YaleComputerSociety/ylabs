import { stripInvisibleFormatCharacters } from '../utils/invisibleFormatCharacters';
import {
  isDepartmentProgrammePageUrl,
  isPersonProfileOrDirectoryUrl,
  isPersonScopedHostTenant,
  type ResearchEntityHostOwnerIdentity,
} from '../utils/researchHomeWebsiteUrl';
import { orgUnitMatchKey } from './orgUnitCanonicalization';
import { DEFAULT_DEPT_CONFIGS } from './sources/departmentRosterScraper';

export type JoinPageEntity = ResearchEntityHostOwnerIdentity & {
  slug?: unknown;
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

export type JoinRouteRefusal = JoinPageUrlRefusal | 'department-jobs-page' | 'page-of-another-lab';

const MEMBER_LISTING_SEGMENT =
  /^(?:people|our-people|members|our-members|lab-members|labmembers|group-members|groupmembers|current-members|member-directory|personnel|team|our-team|ourteam|the-team|meet-the-team|staff|faculty|faculty-staff|who-we-are|whoweare|alumni)$/;

const JOBS_LISTING_TOKENS = new Set([
  'opportunities',
  'opportunity',
  'jobs',
  'job',
  'careers',
  'career',
  'employment',
  'positions',
  'openings',
  'vacancies',
]);

const LAB_SECTION_PATH = /^\/labs?\/([^/]+)\/?/i;

const NON_IDENTITY_TOKENS = new Set(['lab', 'labs', 'laboratory', 'group', 'the', 'and', 'yale']);

const pathSegments = (url: URL): string[] =>
  decodedPath(url)
    .toLowerCase()
    .split('/')
    .filter(Boolean)
    .map((segment) => segment.normalize('NFKD').replace(/[\u0300-\u036f]/g, ''));

const pageIdentity = (url: URL): string =>
  `${hostKey(url.hostname)}${url.pathname.replace(/\/+$/, '')}${url.search}`;

/** Two URLs name the same page once scheme, `www.` and a trailing slash are set aside. */
export function isSameJoinRoutePage(left: unknown, right: unknown): boolean {
  const a = parseHttpUrl(left);
  const b = parseHttpUrl(right);
  return Boolean(a && b && pageIdentity(a) === pageIdentity(b));
}

// The roster lane reads a host like `wlab.yale.edu` for one department too, but a host
// named for a lab or group publishes that unit's own pages, not the department's.
const isDepartmentWebsiteHost = (url: URL): boolean => {
  const host = hostKey(url.hostname);
  return dedicatedDepartmentHosts().has(host) && !/(?:lab|group|project)/.test(host.split('.')[0]);
};

const identityTokens = (entity?: JoinPageEntity): Set<string> =>
  new Set(
    [entity?.name, entity?.displayName, entity?.slug]
      .filter((value): value is string => typeof value === 'string')
      .flatMap(phraseTokens)
      .filter((token) => token.length >= 3 && !NON_IDENTITY_TOKENS.has(token)),
  );

function labSectionOf(url: URL): string | null {
  const match = LAB_SECTION_PATH.exec(url.pathname);
  return match ? `${hostKey(url.hostname)}/${match[1].toLowerCase()}` : null;
}

function isPageOfAnotherLab(url: URL, entity?: JoinPageEntity): boolean {
  const section = labSectionOf(url);
  if (!section || isUnderEntityWebsite(url, entity?.websiteUrl)) return false;
  const website = parseHttpUrl(entity?.websiteUrl);
  const ownSection = website ? labSectionOf(website) : null;
  if (ownSection) return ownSection !== section;
  if (!isPersonScopedHostTenant(entity)) return false;
  const rowTokens = identityTokens(entity);
  if (rowTokens.size === 0) return false;
  const labTokens = phraseTokens(section.split('/')[1]).filter(
    (token) => !NON_IDENTITY_TOKENS.has(token),
  );
  return labTokens.length > 0 && !labTokens.some((token) => rowTokens.has(token));
}

/**
 * `joinPageUrlRefusal` plus the URL shapes a hand-read of served application signals found
 * standing in for a join page (#4543): a department's job listings, and a page in another
 * lab's section of a shared host. Kept apart from `joinPageUrlRefusal`, which the
 * department undergraduate-research lane also applies to links with no row.
 */
export function joinRouteUrlRefusal(
  value: unknown,
  entity?: JoinPageEntity,
): JoinRouteRefusal | null {
  const refusal = joinPageUrlRefusal(value, entity);
  if (refusal) return refusal;
  const url = parseHttpUrl(value) as URL;
  const segments = pathSegments(url);
  if (
    isDepartmentWebsiteHost(url) &&
    !isUnderEntityWebsite(url, entity?.websiteUrl) &&
    !isPersonProfileOrDirectoryUrl(url.toString()) &&
    !isOwnDepartmentUndergraduateResearchProgramme(url.toString(), entity) &&
    segments.flatMap(phraseTokens).some((token) => JOBS_LISTING_TOKENS.has(token))
  ) {
    return 'department-jobs-page';
  }
  if (isPageOfAnotherLab(url, entity)) return 'page-of-another-lab';
  return null;
}

export type JoinRouteKind = 'home-or-profile' | 'member-listing' | 'join-page';

/**
 * What kind of page a join route is, which decides how much of an invitation it needs
 * (#4543). A person profile, the row's own website page or the root of a lab's section is
 * about someone, so it must invite undergraduates by name. A member listing must carry a
 * recruiting sentence whose audience can include undergraduates, since a roster heading
 * such as "Undergraduate Students" recruits no one. Any other page is a join page.
 */
export function joinRouteKind(value: unknown, entity?: JoinPageEntity): JoinRouteKind {
  const url = parseHttpUrl(value);
  if (!url) return 'join-page';
  const segments = pathSegments(url);
  if (MEMBER_LISTING_SEGMENT.test(segments[segments.length - 1] || '')) return 'member-listing';
  if (isPersonProfileOrDirectoryUrl(url.toString())) return 'home-or-profile';
  if (isSameJoinRoutePage(url.toString(), entity?.websiteUrl)) return 'home-or-profile';
  const labRoot = LAB_SECTION_PATH.exec(url.pathname)?.[0];
  if (labRoot && url.pathname.replace(/\/+$/, '') === labRoot.replace(/\/+$/, '')) {
    return 'home-or-profile';
  }
  return 'join-page';
}

const RECRUITING_SENTENCE = new RegExp(
  [
    'looking\\s+for',
    'on\\s+the\\s+lookout\\s+for',
    'seek(?:s|ing)?\\s+(?:a|an|new|motivated|talented|highly|undergrad\\w*|students?|post-?docs?|candidates?|applicants?|graduate)',
    'recruit(?:s|ing)?',
    'hiring',
    'accepting',
    'welcom(?:es|ing)',
    'are\\s+welcome',
    'welcome\\s+(?:to|applications|inquiries|students|undergrad\\w*|motivated|new|all)',
    'invit(?:e|es|ing)',
    'apply\\s+(?:to|for|by|online|here|now|through|via)',
    'applications?\\s+(?:are|will|should|must|from|for|to|deadline|form|process|materials)',
    'applicants?',
    'openings?',
    'positions?\\s+(?:(?:are|is)\\s+)?(?:available|open)',
    'opportunit(?:y|ies)\\s+(?:are|is)\\s+available',
    '(?<!(?:before|after|since)\\s)join(?:ing)?\\s+(?:us|our|the)',
    'interested\\s+in\\s+(?:joining|working|becoming|doing|research)',
    'get\\s+involved',
    'reach\\s+out',
    'prospective\\s+(?:students?|members?|applicants?|undergrad\\w*|graduate|ph\\.?d|post-?docs?|trainees?|lab\\s+members?)',
    'please\\s+(?:write|e-?mail|contact|send)',
    '(?:write|e-?mail|send)\\s+(?:to\\s+)?me',
    'feel\\s+free\\s+to\\s+(?:contact|reach|e-?mail|write)',
    '(?:are|is)\\s+encouraged\\s+to\\s+(?:contact|reach|apply|e-?mail|write|inquire)',
    'should\\s+(?:contact|e-?mail|write\\s+to|reach\\s+out)',
    'contact\\s+me',
  ]
    .map((cue) => `\\b${cue}\\b`)
    .join('|'),
  'i',
);

export const normalizeJoinRouteText = (text: string): string =>
  stripInvisibleFormatCharacters(text)
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();

const MAX_SENTENCE_CHARS = 400;
const SENTENCE_WINDOW_CHARS = 200;

// Page text arrives with its markup collapsed, so a navigation bar and the copy after it can
// read as one run-on sentence; a long one is read as a window around each cue instead.
function sentenceWindows(sentence: string, cue: RegExp): string[] {
  if (sentence.length <= MAX_SENTENCE_CHARS) return [sentence];
  return Array.from(sentence.matchAll(new RegExp(cue.source, 'gi')), (match) =>
    sentence
      .slice(
        Math.max(0, (match.index ?? 0) - SENTENCE_WINDOW_CHARS),
        (match.index ?? 0) + match[0].length + SENTENCE_WINDOW_CHARS,
      )
      .trim(),
  );
}

const textSentences = (text: string | undefined): string[] =>
  normalizeJoinRouteText(text || '')
    .split(/(?<=[.!?])\s+/)
    .filter(Boolean);

export const recruitingSentences = (text: string | undefined): string[] =>
  textSentences(text)
    .filter((sentence) => RECRUITING_SENTENCE.test(sentence))
    .flatMap((sentence) => sentenceWindows(sentence, RECRUITING_SENTENCE));

const UNDERGRADUATE_AUDIENCE =
  /\bundergrad|\byale\s+college\b|\bcollege\s+students?\b|\bbachelor(?:'?s)?\b(?!'?s?\s+degree)/i;

const EVERY_LEVEL_AUDIENCE = /\b(?:all|every)\s+levels?\b/i;

const QUALIFIED_STUDENT_AUDIENCE =
  /\b(?:graduate|grad|ph\.?\s?d\.?|doctoral|medical|master'?s|md|rotation|rotating|visiting)\s*$/i;

export function namesAnUnqualifiedStudentAudience(sentence: string): boolean {
  return Array.from(sentence.matchAll(/\bstudents?\b/gi)).some(
    (match) => !QUALIFIED_STUDENT_AUDIENCE.test(sentence.slice(0, match.index ?? 0)),
  );
}

export const textNamesUndergraduates = (text: string | undefined): boolean =>
  UNDERGRADUATE_AUDIENCE.test(normalizeJoinRouteText(text || ''));

/**
 * Whether text recruits undergraduates by name: a home page or profile is a join route only
 * on this, so a "we're hiring", "Positions Available" or "contact us if interested" line,
 * or a sentence that merely mentions mentoring undergraduates, is not one (#4543).
 */
export const textInvitesUndergraduates = (text: string | undefined): boolean =>
  recruitingSentences(text).some((sentence) => UNDERGRADUATE_AUDIENCE.test(sentence));

const recruitsAnUndergraduateAudience = (sentence: string): boolean =>
  UNDERGRADUATE_AUDIENCE.test(sentence) ||
  namesAnUnqualifiedStudentAudience(sentence) ||
  EVERY_LEVEL_AUDIENCE.test(sentence);

/** Whether a recruiting sentence in the text names an audience that can include undergraduates. */
export const textRecruitsAnUndergraduateAudience = (text: string | undefined): boolean =>
  recruitingSentences(text).some(recruitsAnUndergraduateAudience);

/**
 * Whether a join page's text names an audience that can include undergraduates: it names
 * undergraduates, or a recruiting sentence names students without a graduate, medical or
 * visiting qualifier, or members at every level. A page that recruits "enthusiastic
 * individuals", "interested personnel" or "people of all backgrounds" names no one a
 * student can count on (#4543).
 */
export const joinRouteNamesAnUndergraduateAudience = (text: string | undefined): boolean =>
  textNamesUndergraduates(text) || textRecruitsAnUndergraduateAudience(text);

/**
 * The sentence that makes a page of this kind an undergraduate join route, or null (#4543).
 * The lane records it beside its access verdict, so the materializer judges the join page on
 * the page's own words and not only on the one quote the model chose.
 */
export function joinRouteInvitation(kind: JoinRouteKind, text: string | undefined): string | null {
  const recruiting = recruitingSentences(text);
  if (kind === 'home-or-profile') {
    return recruiting.find((sentence) => UNDERGRADUATE_AUDIENCE.test(sentence)) ?? null;
  }
  const recruits = recruiting.find(recruitsAnUndergraduateAudience);
  if (recruits || kind === 'member-listing') return recruits ?? null;
  return (
    textSentences(text)
      .filter((sentence) => UNDERGRADUATE_AUDIENCE.test(sentence))
      .flatMap((sentence) => sentenceWindows(sentence, UNDERGRADUATE_AUDIENCE))[0] ?? null
  );
}

/** Whether the text a page of this kind carries makes it an undergraduate join route. */
export const joinRouteTextAdmits = (kind: JoinRouteKind, text: string | undefined): boolean =>
  joinRouteInvitation(kind, text) !== null;

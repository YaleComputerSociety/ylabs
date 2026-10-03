import {
  isDisallowedNonListingResearchEntitySourceUrl,
  type ResearchEntityHostOwnerIdentity,
} from '../utils/researchHomeWebsiteUrl';

/**
 * Which roster lines and pages may back an undergraduate count (#4430).
 *
 * A count is a statement about the people a page lists, so it is only as good as the page:
 * on Development 10 of 25 served current-undergraduate counts cited a join, opportunities,
 * contact or home page that lists no one. The microsite lane counts a line only when it names
 * a person on a page that lists people, and the access materializer refuses a stored count
 * that cites a recruiting or contact page, so both read the same rule.
 */

const ROSTER_LINE_VOCABULARY = new Set(
  [
    'undergrad',
    'undergrads',
    'undergraduate',
    'undergraduates',
    'student',
    'students',
    'researcher',
    'researchers',
    'research',
    'assistant',
    'assistants',
    'intern',
    'interns',
    'scholar',
    'scholars',
    'fellow',
    'fellows',
    'member',
    'members',
    'lab',
    'laboratory',
    'team',
    'group',
    'people',
    'current',
    'currently',
    'former',
    'past',
    'alumni',
    'alumnus',
    'alumna',
    'alumnae',
    'yale',
    'college',
    'university',
    'class',
    'of',
    'candidate',
    'view',
    'full',
    'profile',
    'read',
    'more',
    'contact',
    'email',
    'hometown',
    'summer',
    'surf',
    'stars',
    'new',
    'our',
    'meet',
    'the',
    'we',
    'a',
    'an',
    'this',
    'these',
    'there',
    'several',
    'many',
    'some',
    'all',
    'any',
    'each',
    'every',
    'most',
    'interested',
    'prospective',
    'please',
    'if',
    'join',
    'apply',
    'welcome',
    'opportunities',
    'positions',
  ].map((word) => word.toLowerCase()),
);

const REDACTION_TOKEN = /\[(?:email|phone)\s+redacted\]/gi;

/**
 * Whether a roster line names an individual. A roster lists people, so a counted line must
 * start with a name once the roster's own labels are set aside: a bare "Undergraduate
 * Students" heading, or a recruiting sentence the model copied from a join page, names no
 * one and counts no one.
 */
export function rosterSnippetNamesAPerson(snippet: string | undefined | null): boolean {
  const tokens = (snippet || '')
    .replace(REDACTION_TOKEN, ' ')
    .replace(/(\p{Ll})(\p{Lu})/gu, '$1 $2')
    .split(/[^\p{L}'’-]+/u)
    .map((token) => token.replace(/^['’-]+|['’-]+$/g, ''))
    .filter(Boolean);
  const first = tokens.find((token) => !ROSTER_LINE_VOCABULARY.has(token.toLowerCase()));
  return first !== undefined && /^\p{Lu}/u.test(first);
}

function lastPathSegment(url: unknown): string | null {
  try {
    const segments = new URL(String(url || '')).pathname.split('/').filter(Boolean);
    const last = segments[segments.length - 1] ?? '';
    return last.replace(/\.(?:html?|php|aspx?)$/i, '');
  } catch {
    return null;
  }
}

const RECRUITING_OR_CONTACT_SEGMENT =
  /^(?:join(?:ing)?(?:-?(?:us|the-?lab|our-?lab|the-?team|our-?team|the-?group))?|opportunit(?:y|ies)(?:-\d+)?|[\w-]+-opportunit(?:y|ies)|contact(?:-?us)?(?:-\d+)?|apply|application|positions?|open-positions|openings?|prospective(?:-[\w-]+)?|recruit(?:ing|ment)?|get-involved|work-with-us|careers?|jobs?)$/i;

export function isRecruitingOrContactPageUrl(url: unknown): boolean {
  const segment = lastPathSegment(url);
  return Boolean(segment && RECRUITING_OR_CONTACT_SEGMENT.test(segment));
}

const ROSTER_PAGE_SEGMENT =
  /^(?:people|members|(?:lab|group|team|current)-?members|(?:our|the|meet-the)-?team|team|[\w-]+-team(?:-\d+)?|personnel|who-we-are|alumni)$/i;

function isRosterPageUrl(url: unknown): boolean {
  const segment = lastPathSegment(url);
  return Boolean(segment && ROSTER_PAGE_SEGMENT.test(segment));
}

const ROSTER_HEADING =
  /\b(?:(?:lab|group|team|current)\s+members|members|people|our\s+team|meet\s+the\s+(?:team|lab)|principal\s+investigators?|post-?docs|post-?doctoral\s+(?:researchers|fellows|associates|scholars)|graduate\s+students|undergrad(?:uate)?\s+(?:students|researchers?|research\s+assistants|interns|members|fellows|scholars)|lab\s+alumni|alumni)\b/i;

/**
 * Whether a page is one that lists people: a roster page by its address, or a page that
 * carries a roster section heading. A recruiting or contact page is never one, because what
 * it says about undergraduates is an invitation rather than a list.
 */
export function pageListsPeople(url: unknown, text: string | undefined): boolean {
  if (isRecruitingOrContactPageUrl(url)) return false;
  return isRosterPageUrl(url) || ROSTER_HEADING.test(text || '');
}

function hostAndPath(value: unknown): { host: string; path: string } | null {
  try {
    const url = new URL(String(value || ''));
    return {
      host: url.hostname.toLowerCase().replace(/^www\./, ''),
      path: url.pathname.replace(/\/+$/, ''),
    };
  } catch {
    return null;
  }
}

function isUnderWebsite(value: unknown, websiteUrl: unknown): boolean {
  const page = hostAndPath(value);
  const site = hostAndPath(websiteUrl);
  return Boolean(
    page && site && page.host === site.host && `${page.path}/`.startsWith(`${site.path}/`),
  );
}

// A school or department host publishes many groups' rosters side by side, so only a page under
// the row's own section of it is the row's roster; a lab's own host is the lab's throughout,
// which keeps a roster page whose host the stored website only redirects to.
function isSharedYaleHost(value: unknown): boolean {
  const labels = hostAndPath(value)?.host.split('.') ?? [];
  return (
    labels.length === 3 &&
    labels[1] === 'yale' &&
    labels[2] === 'edu' &&
    !/(?:lab|labs|group|project)/i.test(labels[0])
  );
}

/**
 * Whether a roster page may be served as the citation of an undergraduate count: a people or
 * members page on the row's own site. Such a page is refused as the row's own citation
 * because it lists many people, which is exactly why it backs a count (#4430).
 */
export function isLabRosterCitationUrl(
  url: unknown,
  entity: (ResearchEntityHostOwnerIdentity & { websiteUrl?: unknown }) | null | undefined,
): boolean {
  return (
    isRosterPageUrl(url) &&
    !isRecruitingOrContactPageUrl(url) &&
    (isUnderWebsite(url, entity?.websiteUrl) || !isSharedYaleHost(url)) &&
    !isDisallowedNonListingResearchEntitySourceUrl(url, entity ?? undefined)
  );
}

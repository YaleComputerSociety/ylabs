import {
  comparableName,
  leadWouldUnblock,
  personNameFromEntityName,
} from './attachFraNamedLeadsCore';
import { canonicalProfileKey, isYaleProfileUrl } from './mintFraNamedResearchersCore';

export interface DirectoryLeadCandidateEntity {
  slug?: unknown;
  name?: unknown;
  entityType?: unknown;
  sourceUrls?: unknown;
  studentVisibilityReasons?: unknown;
}

export interface VerifiedDirectoryPage {
  status: number;
  headingName: string;
}

export interface DirectoryLeadPlan {
  personName: string;
  profileUrl: string;
}

/**
 * Yale publishes per-person faculty pages under paths that carry none of the segments
 * the shared profile predicate looks for, so an explicit host-and-path table is the
 * only way to reach them (#2651).
 */
const FACULTY_DIRECTORY_HOST_PATHS: ReadonlyArray<readonly [string, RegExp]> = [
  ['nursing.yale.edu', /^\/faculty-research\/faculty-directory\/[^/]+\/?$/],
  ['som.yale.edu', /^\/faculty-research\/faculty-directory\/[^/]+\/?$/],
  ['engineering.yale.edu', /^\/research-and-faculty\/faculty-directory\/[^/]+\/?$/],
  ['law.yale.edu', /^\/[^/]+\/?$/],
  ['jackson.yale.edu', /^\/[^/]+\/?$/],
];

/**
 * The two hosts whose person pages are a single path segment. `law.yale.edu/<person>`
 * and `jackson.yale.edu/<person>` are shaped exactly like every other page on those
 * hosts, so the path declares nothing and the url has to carry the person's name
 * before the page is worth fetching at all.
 */
const BARE_SEGMENT_DIRECTORY_HOSTS: ReadonlySet<string> = new Set([
  'law.yale.edu',
  'jackson.yale.edu',
]);

export function isFacultyDirectoryPersonPage(url: unknown): boolean {
  try {
    const parsed = new URL(String(url ?? ''));
    // The Researcher model validates a YALE_OFFICIAL link with parseHttpsUrl, so an
    // http citation is refused here rather than upgraded to a scheme nobody fetched.
    if (parsed.protocol !== 'https:') return false;
    return FACULTY_DIRECTORY_HOST_PATHS.some(
      ([host, pattern]) => parsed.hostname === host && pattern.test(parsed.pathname),
    );
  } catch {
    return false;
  }
}

export function pathDeclaresAPerson(url: string): boolean {
  try {
    return !BARE_SEGMENT_DIRECTORY_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

export function directoryPersonPageCandidates(entity: DirectoryLeadCandidateEntity): string[] {
  const citedUrls = Array.isArray(entity.sourceUrls)
    ? entity.sourceUrls.filter((url): url is string => typeof url === 'string')
    : [];
  return [
    ...new Set(
      citedUrls.filter((url) => isFacultyDirectoryPersonPage(url) || isYaleProfileUrl(url)),
    ),
  ];
}

function nameTokens(value: string): string[] {
  return value
    .split(/[\s,.]+/)
    .map(comparableName)
    .filter((token) => token.length > 2);
}

/**
 * Order-insensitive containment rather than equality. A directory heading carries
 * credential suffixes the row's name does not (`, PhD, APRN, PPCNP-BC, FAAN`) and can
 * spell a middle initial the row omits, so equality refuses correct pairs. Requiring
 * every token of the row's person name to appear among the heading's tokens keeps
 * both the forename and the surname mandatory, which is what makes the match a person
 * rather than a surname.
 */
export function headingNamesPerson(headingName: unknown, personName: string): boolean {
  const heading = new Set(nameTokens(String(headingName ?? '')));
  const tokens = nameTokens(personName);
  if (tokens.length < 2) return false;
  return tokens.every((token) => heading.has(token));
}

/**
 * The same two-token floor as `headingNamesPerson`, applied to the url. Both
 * corroborations enforce it independently so that neither is load bearing for the
 * other: a vacuous `every` over an empty token list would otherwise let a row with an
 * unusable name through whichever check ran first.
 */
export function urlNamesPerson(url: string, personName: string): boolean {
  const folded = comparableName(url);
  const tokens = nameTokens(personName);
  if (tokens.length < 2) return false;
  return tokens.every((token) => folded.includes(token));
}

export function planDirectoryLeadAttachment(
  entity: DirectoryLeadCandidateEntity,
  verifiedPages: ReadonlyMap<string, VerifiedDirectoryPage>,
  claimedProfileKeys: ReadonlySet<string>,
): DirectoryLeadPlan | null {
  const personName = personNameFromEntityName(entity.name);
  if (!leadWouldUnblock(entity)) return null;

  const candidates = directoryPersonPageCandidates(entity);
  if (candidates.length !== 1) return null;
  const profileUrl = candidates[0];

  // Where the path declares a person, the heading is the corroboration and the url
  // slug is not consulted: probing the 45 rows whose cited profile failed the slug
  // token test found 41 whose page heading names them exactly, the slug simply
  // spelling a nickname, a middle name or a married name. Requiring both refused
  // correct pairs on a guess about spelling (#2651).
  if (!pathDeclaresAPerson(profileUrl) && !urlNamesPerson(profileUrl, personName)) return null;

  const page = verifiedPages.get(profileUrl);
  if (!page || page.status !== 200) return null;
  if (!headingNamesPerson(page.headingName, personName)) return null;

  if (claimedProfileKeys.has(canonicalProfileKey(profileUrl))) return null;

  return { personName, profileUrl };
}

export function headingNameFromHtml(html: string): string {
  const match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (!match) return '';
  return match[1]
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

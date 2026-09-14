import { comparableName, leadWouldUnblock, personNameFromEntityName } from './attachFraNamedLeadsCore';
import { canonicalProfileKey } from './mintFraNamedResearchersCore';

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
 * only way to reach them. It stays a table rather than a general pattern because two
 * of the five shapes are a single path segment: on those hosts the path asserts
 * nothing about a person, and `planDirectoryLeadAttachment` compensates by requiring
 * the fetched page to name the person (#2651).
 */
const FACULTY_DIRECTORY_HOST_PATHS: ReadonlyArray<readonly [string, RegExp]> = [
  ['nursing.yale.edu', /^\/faculty-research\/faculty-directory\/[^/]+\/?$/],
  ['som.yale.edu', /^\/faculty-research\/faculty-directory\/[^/]+\/?$/],
  ['engineering.yale.edu', /^\/research-and-faculty\/faculty-directory\/[^/]+\/?$/],
  ['law.yale.edu', /^\/[^/]+\/?$/],
  ['jackson.yale.edu', /^\/[^/]+\/?$/],
];

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

export function directoryPersonPageCandidates(entity: DirectoryLeadCandidateEntity): string[] {
  const citedUrls = Array.isArray(entity.sourceUrls)
    ? entity.sourceUrls.filter((url): url is string => typeof url === 'string')
    : [];
  return [...new Set(citedUrls.filter(isFacultyDirectoryPersonPage))];
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

  if (!urlNamesPerson(profileUrl, personName)) return null;

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

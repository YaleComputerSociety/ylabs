import {
  comparableName,
  isHardBlockerOtherThanLead,
  personNameFromEntityName,
} from './attachFraNamedLeadsCore';

export interface MintCandidateEntity {
  slug?: unknown;
  name?: unknown;
  entityType?: unknown;
  sourceUrls?: unknown;
  studentVisibilityReasons?: unknown;
}

export interface MintPlan {
  personName: string;
  profileUrl: string;
}

const PROFILE_PATH = /\/(profile|people|faculty|bio)\//i;

/**
 * The profile must be on a Yale host. A first run refused to write because a candidate
 * cited `www.tse-fr.eu/people/<name>`, a Toulouse School of Economics page: it matched
 * the name tokens and the profile path, so path-and-name corroboration alone would
 * have minted a "Yale researcher" from a foreign institution's page. The Researcher
 * model's own validator caught it, and the check belongs here so the candidate is
 * refused rather than crashing the run (#2637).
 */
const YALE_HOST = /(^|\.)yale\.edu$/i;

export function isYaleProfileUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    // The Researcher model validates a YALE_OFFICIAL link with parseHttpsUrl, so a
    // stored `http://` citation is refused rather than silently upgraded: rewriting a
    // scheme we have not re-fetched would assert a url nobody verified (#2642).
    if (parsed.protocol !== 'https:') return false;
    return YALE_HOST.test(parsed.hostname) && PROFILE_PATH.test(url);
  } catch {
    return false;
  }
}

/**
 * Every token of every existing researcher name, with NO length floor. The floor is
 * the trap: a first version skipped tokens of two characters or fewer and reported
 * 222 safe rows where the looser last-word test reported 217. A superset exclusion
 * cannot leave more survivors, and that contradiction is what exposed short surnames
 * slipping through (#2637).
 *
 * Tokenising on whitespace, commas and full stops rather than taking the last word
 * keeps the check correct for the 17 of 5,588 names that are comma-formatted, carry a
 * degree suffix, or are a single word.
 */
export function buildExistingNameTokens(displayNames: readonly unknown[]): Set<string> {
  const tokens = new Set<string>();
  for (const displayName of displayNames) {
    for (const part of String(displayName ?? '').split(/[\s,.]+/)) {
      const folded = comparableName(part);
      if (folded) tokens.add(folded);
    }
  }
  return tokens;
}

/**
 * A surname shared with any existing researcher means the candidate could be a
 * spelling variant of a person already in the corpus, and minting would duplicate
 * them. A novel surname makes that impossible, because a variant would share it.
 */
/**
 * Canonical form of a profile url for identity comparison: host plus path, lowercased,
 * trailing slash stripped. Query and fragment are dropped because they never identify
 * a different person.
 */
export function canonicalProfileKey(url: unknown): string {
  try {
    const parsed = new URL(String(url ?? ''));
    return `${parsed.hostname}${parsed.pathname}`.toLowerCase().replace(/\/+$/, '');
  } catch {
    return '';
  }
}

export function surnameIsNovel(personName: string, existingTokens: ReadonlySet<string>): boolean {
  const words = personName.split(/\s+/).filter(Boolean);
  if (words.length < 2) return false;
  return !existingTokens.has(comparableName(words[words.length - 1]));
}

/**
 * A researcher is minted only with the profile URL that independently names the
 * person, recorded as its provenance. Minting from a name alone would create person
 * records with no evidence behind them, which is the unprovenanced-field problem
 * moved into the person collection.
 */
/**
 * A Yale profile url is an identifier; a surname is not. #2637 minted only when the
 * surname appeared in no existing researcher name, which refused 305 distinct people
 * merely for sharing a surname and would still have missed the genuine duplicates.
 * Keying on the url instead refuses exactly the 7 rows whose profile is already held
 * by an existing researcher, which are the same person under a different name form
 * (#2642).
 */
export function planResearcherMint(
  entity: MintCandidateEntity,
  existingExactNames: ReadonlySet<string>,
  claimedProfileKeys: ReadonlySet<string>,
): MintPlan | null {
  const personName = personNameFromEntityName(entity.name);
  if (!personName) return null;
  if (existingExactNames.has(comparableName(personName))) return null;

  const reasons = Array.isArray(entity.studentVisibilityReasons)
    ? entity.studentVisibilityReasons.filter((r): r is string => typeof r === 'string')
    : [];
  if (!reasons.includes('missing_lead')) return null;
  if (reasons.some(isHardBlockerOtherThanLead)) return null;

  const tokens = personName
    .split(/\s+/)
    .map(comparableName)
    .filter((token) => token.length > 2);
  if (tokens.length === 0) return null;

  const citedUrls = Array.isArray(entity.sourceUrls)
    ? entity.sourceUrls.filter((url): url is string => typeof url === 'string')
    : [];
  const profileUrl = citedUrls.find(
    (url) => isYaleProfileUrl(url) && tokens.every((token) => comparableName(url).includes(token)),
  );
  if (!profileUrl) return null;
  if (claimedProfileKeys.has(canonicalProfileKey(profileUrl))) return null;

  return { personName, profileUrl };
}

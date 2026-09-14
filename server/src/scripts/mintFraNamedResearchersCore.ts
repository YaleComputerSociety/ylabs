import { comparableName, personNameFromEntityName } from './attachFraNamedLeadsCore';

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
    return YALE_HOST.test(new URL(url).hostname) && PROFILE_PATH.test(url);
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
export function surnameIsNovel(personName: string, existingTokens: ReadonlySet<string>): boolean {
  const words = personName.split(/\s+/).filter(Boolean);
  if (words.length < 2) return false;
  return !existingTokens.has(comparableName(words[words.length - 1]));
}

const HARD_BLOCKERS_OTHER_THAN_LEAD = new Set([
  'missing_description',
  'missing_card_description',
  'thin_description',
  'blank_public_description',
  'unusable_name',
  'duplicate_name_risk',
  'duplicate_risk',
  'exact_url_duplicate_risk',
  'profile_identity_risk',
  'generic_directory_shell',
  'profile_biography_shell',
  'content_page_risk',
  'non_research_entity',
  'non_research_program',
  'research_infrastructure_only',
  'non_owner_grant_shell',
  'grant_only_no_current_yale_source',
  'permanently_closed',
  'lab_name_org_type_mismatch',
  'inactive_at_yale',
  'archive_review',
  'not_undergraduate_relevant',
]);

/**
 * A researcher is minted only with the profile URL that independently names the
 * person, recorded as its provenance. Minting from a name alone would create person
 * records with no evidence behind them, which is the unprovenanced-field problem
 * moved into the person collection.
 */
export function planResearcherMint(
  entity: MintCandidateEntity,
  existingExactNames: ReadonlySet<string>,
  existingTokens: ReadonlySet<string>,
): MintPlan | null {
  const personName = personNameFromEntityName(entity.name);
  if (!personName) return null;
  if (existingExactNames.has(comparableName(personName))) return null;
  if (!surnameIsNovel(personName, existingTokens)) return null;

  const reasons = Array.isArray(entity.studentVisibilityReasons)
    ? entity.studentVisibilityReasons.filter((r): r is string => typeof r === 'string')
    : [];
  if (!reasons.includes('missing_lead')) return null;
  if (reasons.some((reason) => HARD_BLOCKERS_OTHER_THAN_LEAD.has(reason))) return null;

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

  return { personName, profileUrl };
}

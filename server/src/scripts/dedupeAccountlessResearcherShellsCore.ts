import { orcidProfileLinksAgreeWithIdentifier } from '../models/researcher';
import type { FieldValueRefusal } from '../utils/researchEntityFieldValueRefusals';
import {
  refusalsToCopyOnFold,
  researcherRefusesValue,
  type ResearcherRefusableField,
} from '../utils/researcherFieldValueRefusals';
import { officialProfileIdentityUrlKey } from '../scrapers/utils/officialProfileIdentityUrlKey';
import { observedPersonNameAgreesWith } from '../scrapers/utils/personNameAgreement';
import { surnamesCompatible } from '../scrapers/utils/piNameMatch';
import { splitName } from '../scrapers/utils/scraperHelpers';
import { canonicalPersonName } from '../scrapers/utils/personNameCasing';
import { titleResearchOwnership } from '../scrapers/utils/titleResearchOwnership';
import { sanitizePersonName } from '../utils/personNameHygiene';
import { researcherHoldsDirectoryIdentity } from '../utils/researcherIdentity';
import { looksLikeYaleNetid } from '../utils/yaleNetid';

export function normalizeResearcherName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase().replace(/\s+/g, ' ');
  return normalized.length > 0 ? normalized : undefined;
}

const cleanOrcid = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const cleanNetid = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : undefined;
};

export const RESEARCHER_IDENTITY_TIERS = ['NAME_ONLY', 'NETID', 'DIRECTORY'] as const;
export type ResearcherIdentityTier = (typeof RESEARCHER_IDENTITY_TIERS)[number];

export interface ResearcherIdentityLike {
  email?: unknown;
  netid?: unknown;
}

export function researcherIdentityTier(researcher: ResearcherIdentityLike): ResearcherIdentityTier {
  if (researcherHoldsDirectoryIdentity({ identifiers: { email: researcher.email } })) {
    return 'DIRECTORY';
  }
  if (cleanNetid(researcher.netid)) return 'NETID';
  return 'NAME_ONLY';
}

const identityTierStrength = (tier: ResearcherIdentityTier): number =>
  RESEARCHER_IDENTITY_TIERS.indexOf(tier);

export interface CanonicalCandidate {
  id: string;
  orcid?: string;
  netid?: string;
  tier: ResearcherIdentityTier;
}

export interface CanonicalNameEntry {
  displayName?: unknown;
  id: string;
  orcid?: unknown;
  netid?: unknown;
  email?: unknown;
}

/**
 * Only a bare netid is a join key. Every `identifiers.netid` reader in the
 * codebase takes this shape, and #2864 records that a malformed value stored in
 * the same field is itself a live join key to a large observation population, so
 * matching on anything looser here would let a fake key decide a merge.
 */
const BARE_NETID_PATTERN = /^[a-z][a-z0-9]{1,15}$/;

export function bareNetid(value: unknown): string | undefined {
  const netid = cleanNetid(value);
  return netid && BARE_NETID_PATTERN.test(netid) ? netid : undefined;
}

export interface CanonicalNetidEntry {
  id: string;
  netid?: unknown;
  orcid?: unknown;
  email?: unknown;
}

/**
 * The index that sees a netid twin. A twin's display name is whatever the
 * observation said rather than whatever the holder stored, so on Development 0 of
 * the 5 pairs #3166 measured share a normalized name and the name index cannot
 * reach any of them. The netid is the identity that actually joins the two rows.
 */
export function buildCanonicalNetidIndex(
  canonical: ReadonlyArray<CanonicalNetidEntry>,
): Map<string, CanonicalCandidate[]> {
  const index = new Map<string, CanonicalCandidate[]>();
  for (const entry of canonical) {
    const netid = bareNetid(entry.netid);
    if (!netid) continue;
    const list = index.get(netid) ?? [];
    list.push({
      id: entry.id,
      orcid: cleanOrcid(entry.orcid),
      netid,
      tier: researcherIdentityTier({ email: entry.email, netid }),
    });
    index.set(netid, list);
  }
  return index;
}

export function buildCanonicalNameIndex(
  canonical: ReadonlyArray<CanonicalNameEntry>,
): Map<string, CanonicalCandidate[]> {
  const index = new Map<string, CanonicalCandidate[]>();
  for (const entry of canonical) {
    const name = normalizeResearcherName(entry.displayName);
    if (!name) continue;
    const list = index.get(name) ?? [];
    list.push({
      id: entry.id,
      orcid: cleanOrcid(entry.orcid),
      netid: cleanNetid(entry.netid),
      tier: researcherIdentityTier(entry),
    });
    index.set(name, list);
  }
  return index;
}

export type ShellMergeReason =
  | 'MERGEABLE'
  | 'NO_NAME'
  | 'NO_CANONICAL'
  | 'AMBIGUOUS_MULTIPLE_CANONICAL'
  | 'ORCID_CONFLICT'
  | 'NETID_CONFLICT'
  | 'NO_IDENTITY_WITNESS'
  | 'VARIANT_SHAPE_NOT_ALLOWED';

export const SHELL_FOLD_IDENTITIES = [
  'netid',
  'directory-email',
  'roster-identity',
  'verified-profile',
  'shared-row',
  'name-variant-shared-row',
  'name',
] as const;
export type ShellFoldIdentity = (typeof SHELL_FOLD_IDENTITIES)[number];

export interface ShellMergeDecision {
  merge: boolean;
  canonicalId?: string;
  reason: ShellMergeReason;
  /** Which identity decided the fold, so a netid fold cannot hide inside a name count. */
  matchedOn?: ShellFoldIdentity;
}

export interface ShellIdentity extends ResearcherIdentityLike {
  id?: string;
  displayName?: unknown;
  orcid?: unknown;
  profileLinks?: unknown;
  title?: unknown;
}

export interface VerifiedProfileCandidate extends CanonicalCandidate {
  displayName?: unknown;
  title?: unknown;
}

export interface VerifiedProfileEntry extends CanonicalNetidEntry {
  displayName?: unknown;
  profileLinks?: unknown;
  title?: unknown;
}

/**
 * The page key of every official primary-identity link a researcher holds that the
 * link-health lane last probed as HEALTHY. `verifiedAt` is stamped on every write and
 * every probe, dead or not, so only the health verdict separates a live page from one
 * nobody has confirmed. A live page proves the page exists, not who it is about, which
 * is why the fold still applies the surname, rank, ORCID, and netid vetoes.
 */
export function verifiedPrimaryProfileKeys(profileLinks: unknown): string[] {
  return primaryProfileKeysWithHealth(profileLinks, ['HEALTHY']);
}

/**
 * Health is a verdict about a URL, not about the record holding it, so a copy nobody has
 * probed yet is confirmed by another record's HEALTHY copy of the same page key. Only an
 * UNKNOWN copy borrows that verdict: a copy probed as anything else disagrees with it.
 */
export function confirmedPrimaryProfileKeys(
  profileLinks: unknown,
  healthyKeys: ReadonlySet<string>,
): string[] {
  return primaryProfileKeysWithHealth(profileLinks, ['HEALTHY', 'UNKNOWN']).filter((key) =>
    healthyKeys.has(key),
  );
}

function primaryProfileKeysWithHealth(
  profileLinks: unknown,
  acceptedHealth: ReadonlyArray<string>,
): string[] {
  if (!Array.isArray(profileLinks)) return [];
  const keys = new Set<string>();
  for (const link of profileLinks) {
    if (!link || typeof link !== 'object') continue;
    const { kind, purpose, healthStatus, url } = link as Record<string, unknown>;
    if (kind !== 'YALE_OFFICIAL' || purpose !== 'PRIMARY_IDENTITY') continue;
    if (typeof healthStatus !== 'string' || !acceptedHealth.includes(healthStatus)) continue;
    const key = officialProfileIdentityUrlKey(url);
    if (key) keys.add(key);
  }
  return [...keys];
}

export function buildVerifiedPrimaryProfileIndex(
  entries: ReadonlyArray<VerifiedProfileEntry>,
): Map<string, VerifiedProfileCandidate[]> {
  const index = new Map<string, VerifiedProfileCandidate[]>();
  for (const entry of entries) {
    for (const key of verifiedPrimaryProfileKeys(entry.profileLinks)) {
      const list = index.get(key) ?? [];
      list.push({
        id: entry.id,
        orcid: cleanOrcid(entry.orcid),
        netid: bareNetid(entry.netid),
        tier: researcherIdentityTier(entry),
        displayName: entry.displayName,
        title: entry.title,
      });
      index.set(key, list);
    }
  }
  return index;
}

/**
 * A netid names one human, so it decides the fold on its own and is tried before
 * the display name. Ordered first deliberately: the name arm below refuses a
 * shell with no name, and a netid twin is precisely the case where the two rows'
 * names disagree, so leaving the name gate in front would keep the population
 * this selection exists for unreachable (#3166).
 */
function decideNetidFold(
  shell: ShellIdentity,
  canonicalNetidIndex: Map<string, CanonicalCandidate[]>,
): ShellMergeDecision | undefined {
  const shellNetid = bareNetid(shell.netid);
  if (!shellNetid) return undefined;
  const shellStrength = identityTierStrength(researcherIdentityTier(shell));
  const outranking = (canonicalNetidIndex.get(shellNetid) ?? []).filter(
    (candidate) =>
      candidate.id !== shell.id && identityTierStrength(candidate.tier) > shellStrength,
  );
  if (outranking.length === 0) return undefined;
  if (outranking.length > 1) {
    return { merge: false, reason: 'AMBIGUOUS_MULTIPLE_CANONICAL', matchedOn: 'netid' };
  }
  const target = outranking[0];
  const shellOrcid = cleanOrcid(shell.orcid);
  if (shellOrcid && target.orcid && shellOrcid !== target.orcid) {
    return { merge: false, reason: 'ORCID_CONFLICT', matchedOn: 'netid' };
  }
  return { merge: true, canonicalId: target.id, reason: 'MERGEABLE', matchedOn: 'netid' };
}

export interface RosterIdentityCandidate extends CanonicalCandidate {
  displayName?: unknown;
}

export interface SharedRowCandidate extends CanonicalCandidate {
  displayName?: unknown;
  title?: unknown;
}

export interface NameVariantCandidate extends SharedRowCandidate {
  /**
   * Whether a listing on the shared row that names the shell links, on its own person page,
   * an official profile that resolves to this holder's profile.
   */
  witnessed: boolean;
}

const NAME_VARIANT_CREDENTIALS = new Set([
  'phd',
  'md',
  'mph',
  'msc',
  'ms',
  'ma',
  'mba',
  'jd',
  'jr',
  'sr',
  'ii',
  'iii',
  'iv',
  'dds',
  'dmd',
  'rn',
  'facs',
  'facp',
  'dr',
  'prof',
  'mfa',
  'dphil',
  'mbbs',
  'pharmd',
  'dvm',
  'np',
  'pa',
  'lcsw',
  'psyd',
  'edd',
  'scd',
  'drph',
]);

export type NameVariantShape =
  | 'credential residue'
  | 'hyphenation'
  | 'middle initial or name'
  | 'first initial only'
  | 'nickname or first-name variant'
  | 'other';

/**
 * The variant shapes the #5592 owner review graded as one person on a shared row with an
 * identity witness. A shape not listed here never folds, whatever else agrees.
 */
export const FOLDABLE_NAME_VARIANT_SHAPES: ReadonlySet<NameVariantShape> = new Set([
  'middle initial or name',
  'hyphenation',
  'nickname or first-name variant',
]);

const nameVariantTokens = (value: unknown): string[] =>
  (typeof value === 'string' ? value : '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[.,()'\u2019"]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

/** How two spellings of a name differ, classified as the #5592 census classified them. */
export function nameVariantShape(left: unknown, right: unknown): NameVariantShape {
  const leftTokens = nameVariantTokens(left);
  const rightTokens = nameVariantTokens(right);
  const joined = (tokens: string[]) => tokens.join(' ');
  const withoutCredentials = (tokens: string[]) =>
    tokens.filter((token) => !NAME_VARIANT_CREDENTIALS.has(token));
  const leftBare = withoutCredentials(leftTokens);
  const rightBare = withoutCredentials(rightTokens);
  if (joined(leftBare) === joined(rightBare) && joined(leftTokens) !== joined(rightTokens)) {
    return 'credential residue';
  }
  const unhyphenated = (tokens: string[]) => joined(tokens).replace(/-/g, ' ').split(/\s+/);
  if (joined(unhyphenated(leftBare)) === joined(unhyphenated(rightBare))) return 'hyphenation';
  const firstAndLast = (tokens: string[]) => `${tokens[0]} ${tokens[tokens.length - 1]}`;
  if (leftBare.length && rightBare.length && firstAndLast(leftBare) === firstAndLast(rightBare)) {
    return 'middle initial or name';
  }
  const leftLast = leftBare[leftBare.length - 1];
  const rightLast = rightBare[rightBare.length - 1];
  if (leftLast && leftLast === rightLast && leftBare[0] !== rightBare[0]) {
    const initialOnly =
      leftBare[0]?.[0] === rightBare[0]?.[0] &&
      (leftBare[0]?.length === 1 || rightBare[0]?.length === 1);
    return initialOnly ? 'first initial only' : 'nickname or first-name variant';
  }
  return 'other';
}

/**
 * A roster lane that proved who a listing names (its profile URL, or a Yale profile URL,
 * email or netid the listing's own page states) records that on the edge it writes as
 * `rosterProvenance.identityBasis`. A shell that holds an edge under the same source and
 * membership key on the same entity was minted for that same listing before the lane could
 * prove it, so the listing itself joins the two rows (#3802). The name only vetoes, as it
 * does for every identity join, and two agreeing holders resolve to nobody.
 */
function decideRosterIdentityFold(
  shell: ShellIdentity,
  rosterIdentityCandidates: ReadonlyArray<RosterIdentityCandidate>,
): ShellMergeDecision | undefined {
  const shellName = typeof shell.displayName === 'string' ? shell.displayName : '';
  if (!shellName) return undefined;
  const shellStrength = identityTierStrength(researcherIdentityTier(shell));
  const agreeing = new Map<string, RosterIdentityCandidate>();
  for (const candidate of rosterIdentityCandidates) {
    if (candidate.id === shell.id) continue;
    if (identityTierStrength(candidate.tier) <= shellStrength) continue;
    if (!observedPersonNameAgreesWith(candidate.displayName, shellName)) continue;
    agreeing.set(candidate.id, candidate);
  }
  if (agreeing.size === 0) return undefined;
  if (agreeing.size > 1) {
    return { merge: false, reason: 'AMBIGUOUS_MULTIPLE_CANONICAL', matchedOn: 'roster-identity' };
  }
  const [target] = agreeing.values();
  const shellOrcid = cleanOrcid(shell.orcid);
  if (shellOrcid && target.orcid && shellOrcid !== target.orcid) {
    return { merge: false, reason: 'ORCID_CONFLICT', matchedOn: 'roster-identity' };
  }
  const shellNetid = bareNetid(shell.netid);
  if (shellNetid && target.netid && shellNetid !== target.netid) {
    return { merge: false, reason: 'NETID_CONFLICT', matchedOn: 'roster-identity' };
  }
  return { merge: true, canonicalId: target.id, reason: 'MERGEABLE', matchedOn: 'roster-identity' };
}

/**
 * A shell and a directory-backed record that hold the same healthy official primary
 * profile are one person even when their given names differ, because a programme
 * roster mints under a nickname and the directory record under the legal name. The
 * page decides; the surname and rank only veto, and they veto per holder, so a holder
 * reached through a wrong-person link drops out instead of making the page ambiguous.
 * More than one surviving directory-backed holder resolves to nobody, because two
 * directory records are two humans the page cannot split.
 */
function decideVerifiedProfileFold(
  shell: ShellIdentity,
  verifiedProfileIndex: Map<string, VerifiedProfileCandidate[]>,
): ShellMergeDecision | undefined {
  const keys = confirmedPrimaryProfileKeys(
    shell.profileLinks,
    new Set(verifiedProfileIndex.keys()),
  );
  if (keys.length === 0) return undefined;
  const shellStrength = identityTierStrength(researcherIdentityTier(shell));
  const holders = new Map<string, VerifiedProfileCandidate>();
  for (const key of keys) {
    for (const candidate of verifiedProfileIndex.get(key) ?? []) {
      if (candidate.id === shell.id) continue;
      if (candidate.tier !== 'DIRECTORY') continue;
      if (identityTierStrength(candidate.tier) <= shellStrength) continue;
      if (!profileHolderSurnamesAgree(shell.displayName, candidate.displayName)) continue;
      if (titlesStateConflictingRanks(shell.title, candidate.title)) continue;
      holders.set(candidate.id, candidate);
    }
  }
  if (holders.size === 0) return undefined;
  if (holders.size > 1) {
    return { merge: false, reason: 'AMBIGUOUS_MULTIPLE_CANONICAL', matchedOn: 'verified-profile' };
  }
  const [target] = holders.values();
  const shellOrcid = cleanOrcid(shell.orcid);
  if (shellOrcid && target.orcid && shellOrcid !== target.orcid) {
    return { merge: false, reason: 'ORCID_CONFLICT', matchedOn: 'verified-profile' };
  }
  const shellNetid = bareNetid(shell.netid);
  if (shellNetid && target.netid && shellNetid !== target.netid) {
    return { merge: false, reason: 'NETID_CONFLICT', matchedOn: 'verified-profile' };
  }
  return {
    merge: true,
    canonicalId: target.id,
    reason: 'MERGEABLE',
    matchedOn: 'verified-profile',
  };
}

const GENERATIONAL_SUFFIX = /^(?:jr|sr|ii|iii|iv)$/i;

// Copies of one record differ only in roster noise after the name: a credential after a
// comma, a generational suffix, a trailing period.
function surnameReadPastRosterNoise(displayName: unknown): string {
  const beforeCredentials = (typeof displayName === 'string' ? displayName : '').split(',')[0];
  const tokens = beforeCredentials
    .split(/\s+/)
    .map((token) => token.replace(/\.+$/, ''))
    .filter(Boolean);
  while (tokens.length > 1 && GENERATIONAL_SUFFIX.test(tokens[tokens.length - 1])) tokens.pop();
  const joined = joinDetachedSurnamePrefixes(tokens);
  if (joined.length === 1 && joined.length < tokens.length) return joined[0];
  return splitName(joined.join(' ')).last;
}

const DETACHED_SURNAME_PREFIX = /^(?:Mc|Mac)$/;

// A label cleaner that split every case boundary stored "Mc Cormick" for McCormick, and
// that copy then reads as a different surname from the record it duplicates (#4879).
function joinDetachedSurnamePrefixes(tokens: ReadonlyArray<string>): string[] {
  const joined: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const next = tokens[index + 1];
    if (DETACHED_SURNAME_PREFIX.test(tokens[index]) && next && /^[A-Z]/.test(next)) {
      joined.push(`${tokens[index]}${next}`);
      index += 1;
    } else {
      joined.push(tokens[index]);
    }
  }
  return joined;
}

const foldNameToken = (token: string): string =>
  token
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z']/g, '');

function foldedNameTokens(displayName: unknown): string[] {
  const beforeCredentials = (typeof displayName === 'string' ? displayName : '').split(',')[0];
  return beforeCredentials
    .split(/[\s-]+/)
    .map(foldNameToken)
    .filter((token) => token.length > 1 && !GENERATIONAL_SUFFIX.test(token));
}

function givenNameAgrees(given: string, otherGivenTokens: ReadonlyArray<string>): boolean {
  const [otherFirst] = otherGivenTokens;
  if (!otherFirst) return false;
  if (given === otherFirst) return true;
  const [shorter, longer] =
    given.length <= otherFirst.length ? [given, otherFirst] : [otherFirst, given];
  if (shorter.length >= 3 && longer.startsWith(shorter)) return true;
  return otherGivenTokens.includes(given);
}

// One record carries the whole surname and the other carries part of it: a hyphenated or
// two-part surname, or a married name added to the birth name.
function surnameContainedInOtherName(name: unknown, otherName: unknown): boolean {
  const surnameTokens = foldedNameTokens(surnameReadPastRosterNoise(name));
  const tokens = foldedNameTokens(name);
  const otherTokens = foldedNameTokens(otherName);
  if (surnameTokens.length === 0 || tokens.length < 2 || otherTokens.length < 2) return false;
  const windowMayStopShortOfLastToken = tokens.length === 2;
  for (let start = 1; start + surnameTokens.length <= otherTokens.length; start += 1) {
    const end = start + surnameTokens.length;
    if (!windowMayStopShortOfLastToken && end !== otherTokens.length) continue;
    const window = otherTokens.slice(start, end);
    if (window.every((token, offset) => token === surnameTokens[offset])) {
      return givenNameAgrees(tokens[0], otherTokens.slice(0, start));
    }
  }
  return false;
}

/**
 * The surname veto for two records a shared page already joins. A compound surname reads
 * as a different last token from its own part, so the veto also accepts one record's
 * whole surname appearing in the other's name, but only together with an agreeing given
 * name (#4920). Only a two-token name may match a part before the other name's last
 * token, so two different compound surnames that share one part still disagree.
 */
export function profileHolderSurnamesAgree(left: unknown, right: unknown): boolean {
  return (
    surnamesCompatible(surnameReadPastRosterNoise(left), surnameReadPastRosterNoise(right)) ||
    surnameContainedInOtherName(left, right) ||
    surnameContainedInOtherName(right, left)
  );
}

// A healthy link can still point at the wrong person, and the one measured case was a
// postdoc holding a professor's page, so a professor and a trainee rank are never folded
// on a page alone.
function titlesStateConflictingRanks(left: unknown, right: unknown): boolean {
  const verdicts = new Set(
    [left, right].map((value) => titleResearchOwnership(typeof value === 'string' ? value : '')),
  );
  return verdicts.has('owns_research') && verdicts.has('works_in_another_group');
}

/**
 * A shell and a stronger record that both hold a role on the same live research row are
 * one person when their names agree, because a row lists its own lead twice only when two
 * lanes minted that lead under two spellings (a middle initial, a middle or short given
 * name). The row joins them; the name, rank and identifiers only veto, and two agreeing
 * candidates resolve to nobody (#4911).
 */
function decideSharedRowFold(
  shell: ShellIdentity,
  sharedRowCandidates: ReadonlyArray<SharedRowCandidate>,
): ShellMergeDecision | undefined {
  const shellName = typeof shell.displayName === 'string' ? shell.displayName : '';
  if (!shellName) return undefined;
  const shellStrength = identityTierStrength(researcherIdentityTier(shell));
  const agreeing = new Map<string, SharedRowCandidate>();
  for (const candidate of sharedRowCandidates) {
    if (candidate.id === shell.id) continue;
    if (identityTierStrength(candidate.tier) <= shellStrength) continue;
    if (!observedPersonNameAgreesWith(candidate.displayName, shellName)) continue;
    if (titlesStateConflictingRanks(shell.title, candidate.title)) continue;
    agreeing.set(candidate.id, candidate);
  }
  if (agreeing.size === 0) return undefined;
  const strongestStrength = Math.max(
    ...[...agreeing.values()].map((candidate) => identityTierStrength(candidate.tier)),
  );
  const strongest = [...agreeing.values()].filter(
    (candidate) => identityTierStrength(candidate.tier) === strongestStrength,
  );
  if (strongest.length > 1) {
    return { merge: false, reason: 'AMBIGUOUS_MULTIPLE_CANONICAL', matchedOn: 'shared-row' };
  }
  const [target] = strongest;
  const shellOrcid = cleanOrcid(shell.orcid);
  if (shellOrcid && target.orcid && shellOrcid !== target.orcid) {
    return { merge: false, reason: 'ORCID_CONFLICT', matchedOn: 'shared-row' };
  }
  const shellNetid = bareNetid(shell.netid);
  if (shellNetid && target.netid && shellNetid !== target.netid) {
    return { merge: false, reason: 'NETID_CONFLICT', matchedOn: 'shared-row' };
  }
  return { merge: true, canonicalId: target.id, reason: 'MERGEABLE', matchedOn: 'shared-row' };
}

/**
 * A `NAME_ONLY` shell whose name is a variant of a stronger record's (a middle initial, a
 * hyphenation, a first-name variant) and that shares a research row with it through any
 * unarchived edge, including a historical one, is that record's twin only when the shell's
 * own listing on that row links an official profile resolving to the holder's profile.
 * A shared row alone is not evidence of one person: a multi-member center lists namesakes
 * from other schools (#5592). The name, rank and identifiers only veto, the fold always goes
 * into the identity-stronger record, and two qualifying holders resolve to nobody.
 */
export function decideNameVariantSharedRowFold(
  shell: ShellIdentity,
  candidates: ReadonlyArray<NameVariantCandidate>,
): ShellMergeDecision | undefined {
  const shellName = typeof shell.displayName === 'string' ? shell.displayName : '';
  if (!shellName || researcherIdentityTier(shell) !== 'NAME_ONLY') return undefined;
  const shellNormalizedName = normalizeResearcherName(shellName);
  const agreeing = candidates.filter(
    (candidate) =>
      candidate.id !== shell.id &&
      identityTierStrength(candidate.tier) > identityTierStrength('NAME_ONLY') &&
      observedPersonNameAgreesWith(candidate.displayName, shellName) &&
      normalizeResearcherName(candidate.displayName) !== shellNormalizedName &&
      !titlesStateConflictingRanks(shell.title, candidate.title),
  );
  const holders = [...new Map(agreeing.map((candidate) => [candidate.id, candidate])).values()];
  if (holders.length === 0) return undefined;
  const matchedOn = 'name-variant-shared-row' as const;
  const strongestStrength = Math.max(
    ...holders.map((candidate) => identityTierStrength(candidate.tier)),
  );
  const strongest = holders.filter(
    (candidate) => identityTierStrength(candidate.tier) === strongestStrength,
  );
  if (strongest.length > 1)
    return { merge: false, reason: 'AMBIGUOUS_MULTIPLE_CANONICAL', matchedOn };
  const [target] = strongest;
  if (!FOLDABLE_NAME_VARIANT_SHAPES.has(nameVariantShape(shellName, target.displayName))) {
    return { merge: false, reason: 'VARIANT_SHAPE_NOT_ALLOWED', matchedOn };
  }
  const shellOrcid = cleanOrcid(shell.orcid);
  if (shellOrcid && target.orcid && shellOrcid !== target.orcid) {
    return { merge: false, reason: 'ORCID_CONFLICT', matchedOn };
  }
  const shellNetid = bareNetid(shell.netid);
  if (shellNetid && target.netid && shellNetid !== target.netid) {
    return { merge: false, reason: 'NETID_CONFLICT', matchedOn };
  }
  if (!target.witnessed) return { merge: false, reason: 'NO_IDENTITY_WITNESS', matchedOn };
  return { merge: true, canonicalId: target.id, reason: 'MERGEABLE', matchedOn };
}

export interface DirectoryEmailCandidate extends CanonicalCandidate {
  displayName?: unknown;
  title?: unknown;
}

/**
 * A `NAME_ONLY` shell is the record of the netid the Yale directory pairs with an address its
 * own roster listing states about its subject, because the directory, not the page or the
 * name, decides whose address it is (#5811). A nickname or a middle-position preferred name
 * does not agree under the name matcher, so this arm takes only the surname and rank as
 * vetoes. An address the directory does not pair is no witness, an address or a set of
 * addresses pairing with more than one netid resolves to nobody, and so does a netid more
 * than one live record holds. A directory record is never a shell here, so two directory
 * records stay two people.
 */
export function decideDirectoryEmailFold(
  shell: ShellIdentity,
  listingAddressNetids: ReadonlyArray<ReadonlySet<string>>,
  holdersByNetid: ReadonlyMap<string, ReadonlyArray<DirectoryEmailCandidate>>,
): ShellMergeDecision | undefined {
  if (researcherIdentityTier(shell) !== 'NAME_ONLY') return undefined;
  const pairedNetids = new Set(listingAddressNetids.flatMap((netids) => [...netids]));
  if (pairedNetids.size === 0) return undefined;
  const matchedOn = 'directory-email' as const;
  if (pairedNetids.size > 1) {
    return { merge: false, reason: 'AMBIGUOUS_MULTIPLE_CANONICAL', matchedOn };
  }
  const [netid] = pairedNetids;
  const holders = (holdersByNetid.get(netid) ?? []).filter(
    (candidate) =>
      candidate.id !== shell.id &&
      identityTierStrength(candidate.tier) > identityTierStrength('NAME_ONLY'),
  );
  if (holders.length === 0) return undefined;
  if (holders.length > 1) {
    return { merge: false, reason: 'AMBIGUOUS_MULTIPLE_CANONICAL', matchedOn };
  }
  const [target] = holders;
  if (!profileHolderSurnamesAgree(shell.displayName, target.displayName)) return undefined;
  if (titlesStateConflictingRanks(shell.title, target.title)) return undefined;
  const shellOrcid = cleanOrcid(shell.orcid);
  if (shellOrcid && target.orcid && shellOrcid !== target.orcid) {
    return { merge: false, reason: 'ORCID_CONFLICT', matchedOn };
  }
  return { merge: true, canonicalId: target.id, reason: 'MERGEABLE', matchedOn };
}

/** The unordered key of a pair an operator recorded as two different people. */
export const distinctPeoplePairKey = (left: string, right: string): string =>
  [left, right].sort().join('|');

/**
 * Drops every planned fold whose shell and final target an operator recorded as different
 * people, whichever arm planned it, so an unmerged pair is never folded again (#5592).
 */
export function withoutDistinctPeopleFolds(
  mergeTargetByShellId: ReadonlyMap<string, string>,
  distinctPeoplePairs: ReadonlySet<string>,
): { kept: Map<string, string>; refused: number } {
  const kept = new Map<string, string>();
  let refused = 0;
  for (const [shellId, targetId] of mergeTargetByShellId) {
    if (distinctPeoplePairs.has(distinctPeoplePairKey(shellId, targetId))) refused += 1;
    else kept.set(shellId, targetId);
  }
  return { kept, refused };
}

export function decideShellMerge(
  shell: ShellIdentity,
  canonicalNameIndex: Map<string, CanonicalCandidate[]>,
  canonicalNetidIndex: Map<string, CanonicalCandidate[]> = new Map(),
  rosterIdentityCandidates: ReadonlyArray<RosterIdentityCandidate> = [],
  verifiedProfileIndex: Map<string, VerifiedProfileCandidate[]> = new Map(),
  sharedRowCandidates: ReadonlyArray<SharedRowCandidate> = [],
  nameVariantCandidates: ReadonlyArray<NameVariantCandidate> = [],
  listingAddressNetids: ReadonlyArray<ReadonlySet<string>> = [],
  directoryEmailHolders: ReadonlyMap<string, ReadonlyArray<DirectoryEmailCandidate>> = new Map(),
): ShellMergeDecision {
  const byNetid = decideNetidFold(shell, canonicalNetidIndex);
  if (byNetid) return byNetid;
  const byDirectoryEmail = decideDirectoryEmailFold(
    shell,
    listingAddressNetids,
    directoryEmailHolders,
  );
  if (byDirectoryEmail) return byDirectoryEmail;
  const byRosterIdentity = decideRosterIdentityFold(shell, rosterIdentityCandidates);
  if (byRosterIdentity) return byRosterIdentity;
  const byVerifiedProfile = decideVerifiedProfileFold(shell, verifiedProfileIndex);
  if (byVerifiedProfile) return byVerifiedProfile;
  const bySharedRow = decideSharedRowFold(shell, sharedRowCandidates);
  if (bySharedRow) return bySharedRow;
  const byNameVariant = decideNameVariantSharedRowFold(shell, nameVariantCandidates);
  if (byNameVariant?.merge) return byNameVariant;
  const byName = decideExactNameFold(shell, canonicalNameIndex);
  return byName.reason === 'NO_CANONICAL' && byNameVariant ? byNameVariant : byName;
}

function decideExactNameFold(
  shell: ShellIdentity,
  canonicalNameIndex: Map<string, CanonicalCandidate[]>,
): ShellMergeDecision {
  const name = normalizeResearcherName(shell.displayName);
  if (!name) return { merge: false, reason: 'NO_NAME' };

  const shellStrength = identityTierStrength(researcherIdentityTier(shell));
  const outranking = (canonicalNameIndex.get(name) ?? []).filter(
    (candidate) =>
      candidate.id !== shell.id && identityTierStrength(candidate.tier) > shellStrength,
  );
  if (outranking.length === 0) return { merge: false, reason: 'NO_CANONICAL' };

  const strongestStrength = Math.max(
    ...outranking.map((candidate) => identityTierStrength(candidate.tier)),
  );
  const strongest = outranking.filter(
    (candidate) => identityTierStrength(candidate.tier) === strongestStrength,
  );
  if (strongest.length > 1) return { merge: false, reason: 'AMBIGUOUS_MULTIPLE_CANONICAL' };

  const target = strongest[0];
  const shellOrcid = cleanOrcid(shell.orcid);
  if (shellOrcid && target.orcid && shellOrcid !== target.orcid) {
    return { merge: false, reason: 'ORCID_CONFLICT' };
  }
  const shellNetid = cleanNetid(shell.netid);
  if (shellNetid && target.netid && shellNetid !== target.netid) {
    return { merge: false, reason: 'NETID_CONFLICT' };
  }

  return { merge: true, canonicalId: target.id, reason: 'MERGEABLE', matchedOn: 'name' };
}

export function resolveFinalMergeTargets(
  mergeTargetByShellId: ReadonlyMap<string, string>,
): Map<string, string> {
  const resolved = new Map<string, string>();
  for (const [shellId, firstTargetId] of mergeTargetByShellId) {
    const visited = new Set([shellId]);
    let targetId = firstTargetId;
    while (mergeTargetByShellId.has(targetId) && !visited.has(targetId)) {
      visited.add(targetId);
      targetId = mergeTargetByShellId.get(targetId)!;
    }
    if (targetId !== shellId) resolved.set(shellId, targetId);
  }
  return resolved;
}

export interface RoleAssignmentEdge {
  targetKind?: unknown;
  targetId?: unknown;
  role?: unknown;
}

export interface RosterMembershipEdge {
  personId?: unknown;
  targetKind?: unknown;
  targetId?: unknown;
  sourceName?: unknown;
  membershipKey?: unknown;
}

export function rosterMembershipEdgeKey(edge: RosterMembershipEdge): string | undefined {
  const kind = typeof edge.targetKind === 'string' ? edge.targetKind : '';
  const id = edge.targetId === undefined || edge.targetId === null ? '' : String(edge.targetId);
  const source = typeof edge.sourceName === 'string' ? edge.sourceName.trim() : '';
  const membershipKey = typeof edge.membershipKey === 'string' ? edge.membershipKey.trim() : '';
  if (!kind || !id || !source || !membershipKey) return undefined;
  return `${kind}::${id}::${source}::${membershipKey}`;
}

export function roleAssignmentEdgeKey(edge: RoleAssignmentEdge): string {
  const kind = typeof edge.targetKind === 'string' ? edge.targetKind : '';
  const id = edge.targetId === undefined || edge.targetId === null ? '' : String(edge.targetId);
  const role = typeof edge.role === 'string' ? edge.role : '';
  return `${kind}::${id}::${role}`;
}

export interface FoldRegateEdge {
  personId?: unknown;
  archived?: unknown;
  target?: { kind?: unknown; id?: unknown };
}

const liveResearchEntityTargetId = (edge: FoldRegateEdge): string | undefined => {
  if (edge.archived === true || edge.target?.kind !== 'RESEARCH_ENTITY') return undefined;
  const id = edge.target.id === undefined || edge.target.id === null ? '' : String(edge.target.id);
  return id || undefined;
};

/**
 * The research rows whose gate verdict a fold can change: every row the folded shell
 * held an edge on, and every row the surviving researcher holds a live edge on.
 */
export function researchEntityIdsToRegateAfterFold(args: {
  shellEdges: readonly FoldRegateEdge[];
  survivorEdges: readonly FoldRegateEdge[];
  mergeTargetByShellId: ReadonlyMap<string, string>;
}): Set<string> {
  const entityIds = new Set<string>();
  for (const edge of args.shellEdges) {
    if (!args.mergeTargetByShellId.has(String(edge.personId))) continue;
    const entityId = liveResearchEntityTargetId(edge);
    if (entityId) entityIds.add(entityId);
  }
  // A fold that makes one person PI of two rows turns the row it never touched into a
  // same-PI duplicate, so that row's verdict changes too (#5687).
  const survivorIds = new Set(args.mergeTargetByShellId.values());
  for (const edge of args.survivorEdges) {
    if (!survivorIds.has(String(edge.personId))) continue;
    const entityId = liveResearchEntityTargetId(edge);
    if (entityId) entityIds.add(entityId);
  }
  return entityIds;
}

export interface ResearcherProfileLinkLike {
  kind?: unknown;
  url?: unknown;
  [key: string]: unknown;
}

export interface ResearcherAttributeSnapshot {
  profileLinks?: ResearcherProfileLinkLike[];
  identifiers?: Record<string, unknown>;
  profile?: Record<string, unknown>;
  fieldValueRefusals?: unknown;
}

export const RESEARCHER_UNION_IDENTIFIER_FIELDS = ['orcid', 'googleScholarId', 'netid'] as const;
export const RESEARCHER_UNIQUE_IDENTIFIER_FIELDS: ReadonlySet<string> = new Set(['orcid', 'netid']);
export const RESEARCHER_UNION_PROFILE_FIELDS = [
  'title',
  'primaryDepartment',
  'imageUrl',
  'websiteUrl',
] as const;

const nonEmptyString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

function profileLinkKind(link: ResearcherProfileLinkLike): string | undefined {
  return typeof link.kind === 'string' ? link.kind : undefined;
}

function orcidLinkAgreesWith(link: ResearcherProfileLinkLike, orcid: string | undefined): boolean {
  const url = typeof link.url === 'string' ? link.url : '';
  return orcidProfileLinksAgreeWithIdentifier([{ kind: 'ORCID', url }], orcid);
}

export function shellProfileLinkKindsReleasedWith(
  plan: Pick<ResearcherAttributeUnionPlan, 'identifierGapFills'>,
): string[] {
  return plan.identifierGapFills.orcid ? ['ORCID'] : [];
}

export interface ResearcherAttributeUnionPlan {
  profileLinksToAppend: ResearcherProfileLinkLike[];
  identifierGapFills: Record<string, string>;
  profileGapFills: Record<string, string>;
  refusalsToCopy: Record<string, FieldValueRefusal[]>;
}

/** A shell's netid fills the canonical record's empty slot only when it is a Yale netid (#5740). */
export function planResearcherAttributeUnion(
  canonical: ResearcherAttributeSnapshot,
  shell: ResearcherAttributeSnapshot,
): ResearcherAttributeUnionPlan {
  const claimedKinds = new Set<string>();
  for (const link of canonical.profileLinks ?? []) {
    const kind = profileLinkKind(link);
    if (kind) claimedKinds.add(kind);
  }

  const identifierGapFills: Record<string, string> = {};
  for (const field of RESEARCHER_UNION_IDENTIFIER_FIELDS) {
    if (nonEmptyString(canonical.identifiers?.[field])) continue;
    const shellValue = nonEmptyString(shell.identifiers?.[field]);
    if (!shellValue) continue;
    if (field === 'netid' && !looksLikeYaleNetid(shellValue)) continue;
    if (
      field === 'orcid' &&
      (researcherRefusesValue(canonical.fieldValueRefusals, 'orcid', shellValue) ||
        researcherRefusesValue(shell.fieldValueRefusals, 'orcid', shellValue))
    ) {
      continue;
    }
    identifierGapFills[field] = shellValue;
  }

  const mergedOrcid = nonEmptyString(canonical.identifiers?.orcid) ?? identifierGapFills.orcid;
  const refusedByEither = (field: ResearcherRefusableField, value: unknown): boolean =>
    researcherRefusesValue(canonical.fieldValueRefusals, field, value) ||
    researcherRefusesValue(shell.fieldValueRefusals, field, value);
  const profileLinksToAppend: ResearcherProfileLinkLike[] = [];
  for (const link of shell.profileLinks ?? []) {
    const kind = profileLinkKind(link);
    if (!kind || claimedKinds.has(kind)) continue;
    if (refusedByEither('profileLink', link.url) || refusedByEither('orcid', link.url)) continue;
    if (kind === 'ORCID' && !orcidLinkAgreesWith(link, mergedOrcid)) continue;
    claimedKinds.add(kind);
    profileLinksToAppend.push(link);
  }

  const profileGapFills: Record<string, string> = {};
  for (const field of RESEARCHER_UNION_PROFILE_FIELDS) {
    if (nonEmptyString(canonical.profile?.[field])) continue;
    const shellValue = nonEmptyString(shell.profile?.[field]);
    if (shellValue && !refusedByEither(field, shellValue)) profileGapFills[field] = shellValue;
  }

  return {
    profileLinksToAppend,
    identifierGapFills,
    profileGapFills,
    refusalsToCopy: refusalsToCopyOnFold(canonical.fieldValueRefusals, shell.fieldValueRefusals),
  };
}

export function researcherAttributeUnionIsEmpty(plan: ResearcherAttributeUnionPlan): boolean {
  return (
    plan.profileLinksToAppend.length === 0 &&
    Object.keys(plan.identifierGapFills).length === 0 &&
    Object.keys(plan.profileGapFills).length === 0 &&
    Object.keys(plan.refusalsToCopy).length === 0
  );
}

export function applyUnionPlanToSnapshot(
  canonical: ResearcherAttributeSnapshot,
  plan: ResearcherAttributeUnionPlan,
): ResearcherAttributeSnapshot {
  return {
    profileLinks: [...(canonical.profileLinks ?? []), ...plan.profileLinksToAppend],
    identifiers: { ...(canonical.identifiers ?? {}), ...plan.identifierGapFills },
    profile: { ...(canonical.profile ?? {}), ...plan.profileGapFills },
    fieldValueRefusals: withCopiedRefusals(canonical.fieldValueRefusals, plan.refusalsToCopy),
  };
}

function refusalEntries(fieldValueRefusals: unknown): Array<[string, unknown]> {
  if (fieldValueRefusals instanceof Map) return [...fieldValueRefusals.entries()];
  if (fieldValueRefusals && typeof fieldValueRefusals === 'object') {
    return Object.entries(fieldValueRefusals as Record<string, unknown>);
  }
  return [];
}

/** The survivor's refusals with a shell's copied in, as a plain object a `$set` can store. */
export function withCopiedRefusals(
  survivorRefusals: unknown,
  copies: Record<string, FieldValueRefusal[]>,
): Record<string, unknown[]> {
  const merged: Record<string, unknown[]> = {};
  for (const [field, list] of refusalEntries(survivorRefusals)) {
    merged[field] = Array.isArray(list) ? [...list] : [];
  }
  for (const [field, list] of Object.entries(copies)) {
    merged[field] = [...(merged[field] ?? []), ...list];
  }
  return merged;
}

export interface AccountlessClusterMember {
  id: string;
  displayName?: unknown;
  netid?: unknown;
  orcid?: unknown;
  title?: unknown;
  primaryDepartment?: unknown;
  profileLinks?: unknown;
  liveRoleEdges: number;
  liveRowIds?: readonly string[];
}

export type AccountlessClusterRefusal =
  'NETID_CONFLICT' | 'ORCID_CONFLICT' | 'TITLE_CONFLICT' | 'SURNAME_CONFLICT';

export interface AccountlessClusterPlan {
  /** Each folding member mapped to the survivor of its group. */
  foldTargetById: Map<string, string>;
  groups: number;
  foldedGroups: number;
  refusedGroups: Record<AccountlessClusterRefusal, number>;
}

const departmentKey = (value: unknown): string =>
  typeof value === 'string'
    ? value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
    : '';

function clusterKeys(
  member: AccountlessClusterMember,
  heldElsewhere: { pages: ReadonlySet<string>; names: ReadonlySet<string> },
  healthyKeys: ReadonlySet<string>,
): string[] {
  const pageKeys = confirmedPrimaryProfileKeys(member.profileLinks, healthyKeys)
    .filter((key) => !heldElsewhere.pages.has(key))
    .map((key) => `page::${key}`);
  const name = normalizeResearcherName(member.displayName);
  if (!name || heldElsewhere.names.has(name)) return pageKeys;
  const department = departmentKey(member.primaryDepartment);
  const rowKeys = (member.liveRowIds ?? []).map((rowId) => `name-row::${name}::${rowId}`);
  return [...pageKeys, ...(department ? [`name::${name}::${department}`] : []), ...rowKeys];
}

const isNameOnlyMember = (member: AccountlessClusterMember): boolean =>
  !bareNetid(member.netid) && !cleanOrcid(member.orcid);

function sanitizedResearcherName(displayName: unknown): string | undefined {
  if (typeof displayName !== 'string') return undefined;
  return normalizeResearcherName(canonicalPersonName(sanitizePersonName(displayName) ?? ''));
}

/**
 * Pairs each name-only record whose stored name carries scraped furniture with the one
 * name-only record whose stored name is the cleaned form, the same equivalence the
 * membership materializer's adoption treats as one person (#2951, #5539). Records sharing an
 * identical clean name stay apart, because nothing tells two same-named people apart.
 */
function noisySpellingJoins(
  members: ReadonlyArray<AccountlessClusterMember>,
  namesHeldElsewhere: ReadonlySet<string>,
): Array<[string, string]> {
  const nameOnly = members.filter(isNameOnlyMember);
  const cleanHoldersByName = new Map<string, string[]>();
  for (const member of nameOnly) {
    const stored = normalizeResearcherName(member.displayName);
    if (!stored || sanitizedResearcherName(member.displayName) !== stored) continue;
    cleanHoldersByName.set(stored, [...(cleanHoldersByName.get(stored) ?? []), member.id]);
  }
  const joins: Array<[string, string]> = [];
  for (const member of nameOnly) {
    const stored = normalizeResearcherName(member.displayName);
    const cleaned = sanitizedResearcherName(member.displayName);
    if (!stored || !cleaned || cleaned === stored || namesHeldElsewhere.has(cleaned)) continue;
    const holders = cleanHoldersByName.get(cleaned) ?? [];
    if (holders.length === 1) joins.push([member.id, holders[0]]);
  }
  return joins;
}

function distinctNonEmpty(values: ReadonlyArray<string | undefined>): number {
  return new Set(values.filter((value): value is string => Boolean(value))).size;
}

function clusterRefusal(
  members: ReadonlyArray<AccountlessClusterMember>,
): AccountlessClusterRefusal | undefined {
  if (distinctNonEmpty(members.map((member) => bareNetid(member.netid))) > 1) {
    return 'NETID_CONFLICT';
  }
  if (distinctNonEmpty(members.map((member) => cleanOrcid(member.orcid))) > 1) {
    return 'ORCID_CONFLICT';
  }
  const verdicts = new Set(
    members
      .map((member) => (typeof member.title === 'string' ? member.title.trim() : ''))
      .filter(Boolean)
      .map((title) => titleResearchOwnership(title))
      .filter((verdict) => verdict !== 'states_no_rank'),
  );
  if (verdicts.size > 1) return 'TITLE_CONFLICT';
  const named = members
    .map((member) => member.displayName)
    .filter((displayName) => Boolean(surnameReadPastRosterNoise(displayName)));
  if (
    named.some((name, index) =>
      named.slice(index + 1).some((other) => !profileHolderSurnamesAgree(name, other)),
    )
  ) {
    return 'SURNAME_CONFLICT';
  }
  return undefined;
}

const objectIdSeconds = (id: string): number =>
  /^[0-9a-f]{24}$/i.test(id) ? parseInt(id.slice(0, 8), 16) : Number.MAX_SAFE_INTEGER;

/**
 * The survivor is the record the corpus already leans on: the most live role edges, then
 * the most healthy verified primary links, then the record an ORCID identifies, then the
 * oldest record, so the choice is reproducible and never alphabetical.
 */
export function accountlessClusterSurvivor(
  members: ReadonlyArray<AccountlessClusterMember>,
): AccountlessClusterMember {
  return [...members].sort(
    (left, right) =>
      right.liveRoleEdges - left.liveRoleEdges ||
      verifiedPrimaryProfileKeys(right.profileLinks).length -
        verifiedPrimaryProfileKeys(left.profileLinks).length ||
      Number(Boolean(cleanOrcid(right.orcid))) - Number(Boolean(cleanOrcid(left.orcid))) ||
      objectIdSeconds(left.id) - objectIdSeconds(right.id) ||
      left.id.localeCompare(right.id),
  )[0];
}

/**
 * Groups of shell records with no directory-backed member, which the outranking arms
 * cannot fold because nobody outranks anybody. A group is the records that share a
 * healthy verified primary profile, the same normalized full name together with the same
 * stated primary department, or the same normalized full name together with a
 * non-historical role on the same live research row. A whole group is refused on any netid, ORCID, title
 * rank or surname disagreement, because one wrong join merges two people for good. A page
 * or name that any record outside the group also holds joins nobody: the outranking arms
 * already found it unable to tell those records apart.
 */
export function planAccountlessClusterFolds(
  members: ReadonlyArray<AccountlessClusterMember>,
  nonMembers: ReadonlyArray<Pick<AccountlessClusterMember, 'displayName' | 'profileLinks'>>,
): AccountlessClusterPlan {
  const healthyKeys = new Set(
    [...members, ...nonMembers].flatMap((record) =>
      verifiedPrimaryProfileKeys(record.profileLinks),
    ),
  );
  const heldElsewhere = {
    pages: new Set(
      nonMembers.flatMap((record) => confirmedPrimaryProfileKeys(record.profileLinks, healthyKeys)),
    ),
    names: new Set(
      nonMembers
        .map((record) => normalizeResearcherName(record.displayName))
        .filter((name): name is string => Boolean(name)),
    ),
  };
  const parent = new Map<string, string>(members.map((member) => [member.id, member.id]));
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root) as string;
    parent.set(id, root);
    return root;
  };
  const firstByKey = new Map<string, string>();
  for (const member of members) {
    for (const key of clusterKeys(member, heldElsewhere, healthyKeys)) {
      const first = firstByKey.get(key);
      if (first) parent.set(find(member.id), find(first));
      else firstByKey.set(key, member.id);
    }
  }
  for (const [noisyId, cleanId] of noisySpellingJoins(members, heldElsewhere.names)) {
    parent.set(find(noisyId), find(cleanId));
  }

  const groupsByRoot = new Map<string, AccountlessClusterMember[]>();
  for (const member of members) {
    const root = find(member.id);
    groupsByRoot.set(root, [...(groupsByRoot.get(root) ?? []), member]);
  }

  const plan: AccountlessClusterPlan = {
    foldTargetById: new Map(),
    groups: 0,
    foldedGroups: 0,
    refusedGroups: { NETID_CONFLICT: 0, ORCID_CONFLICT: 0, TITLE_CONFLICT: 0, SURNAME_CONFLICT: 0 },
  };
  for (const group of groupsByRoot.values()) {
    if (group.length < 2) continue;
    plan.groups += 1;
    const refusal = clusterRefusal(group);
    if (refusal) {
      plan.refusedGroups[refusal] += 1;
      continue;
    }
    const survivor = accountlessClusterSurvivor(group);
    for (const member of group) {
      if (member.id !== survivor.id) plan.foldTargetById.set(member.id, survivor.id);
    }
    plan.foldedGroups += 1;
  }
  return plan;
}

/**
 * Whether two records' names are one person: the #4920 surname rule, plus a given name of
 * one record found among the other's given names, so an initial-led form ("P Mark") and a
 * middle-initial form ("Mark S.") of one name agree while two people sharing a surname do not.
 */
export function sameAddressHolderNamesAgree(left: unknown, right: unknown): boolean {
  if (!profileHolderSurnamesAgree(left, right)) return false;
  const leftTokens = foldedNameTokens(left);
  const rightTokens = foldedNameTokens(right);
  if (leftTokens.length < 2 || rightTokens.length < 2) return false;
  return (
    givenNameAgrees(leftTokens[0], rightTokens.slice(0, -1)) ||
    givenNameAgrees(rightTokens[0], leftTokens.slice(0, -1))
  );
}

export const ALIAS_TWIN_FOLD_REFUSALS = [
  'twin-netid-has-login',
  'alias-unresolved',
  'no-real-researcher',
  'names-disagree',
] as const;
export type AliasTwinFoldRefusal = (typeof ALIAS_TWIN_FOLD_REFUSALS)[number];

export interface AliasTwinResearcher {
  id: string;
  netid: string;
  displayName?: unknown;
}

export interface AliasTwinPlan {
  targetByTwinResearcherId: Map<string, string>;
  refusals: Record<AliasTwinFoldRefusal, number>;
}

/**
 * Which local-part twin researchers fold into the real-netid researcher (#4988).
 *
 * A twin holds an email local part as its `identifiers.netid`. The directory's alias map is
 * the evidence that the two netids are one address, but it reads every `email` observation,
 * including a lane that has attached one person's profile to a namesake, so it only
 * proposes: the names must also agree. A twin netid that has signed in to this environment
 * is refused, because a login is a person acting under that netid.
 */
export function planAliasTwinFolds(input: {
  twinResearchers: readonly AliasTwinResearcher[];
  researcherByNetid: ReadonlyMap<string, { id: string; displayName?: unknown }>;
  aliasNetidByTwinNetid: ReadonlyMap<string, string>;
  loginNetids: ReadonlySet<string>;
}): AliasTwinPlan {
  const plan: AliasTwinPlan = {
    targetByTwinResearcherId: new Map(),
    refusals: Object.fromEntries(ALIAS_TWIN_FOLD_REFUSALS.map((reason) => [reason, 0])) as Record<
      AliasTwinFoldRefusal,
      number
    >,
  };
  for (const twin of input.twinResearchers) {
    if (input.loginNetids.has(twin.netid)) {
      plan.refusals['twin-netid-has-login'] += 1;
      continue;
    }
    const realNetid = input.aliasNetidByTwinNetid.get(twin.netid);
    if (!realNetid || realNetid === twin.netid) {
      plan.refusals['alias-unresolved'] += 1;
      continue;
    }
    const realResearcher = input.researcherByNetid.get(realNetid);
    if (!realResearcher || realResearcher.id === twin.id) {
      plan.refusals['no-real-researcher'] += 1;
      continue;
    }
    if (!sameAddressHolderNamesAgree(twin.displayName, realResearcher.displayName)) {
      plan.refusals['names-disagree'] += 1;
      continue;
    }
    plan.targetByTwinResearcherId.set(twin.id, realResearcher.id);
  }
  return plan;
}

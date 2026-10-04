import { orcidProfileLinksAgreeWithIdentifier } from '../models/researcher';
import { officialProfileIdentityUrlKey } from '../scrapers/utils/officialProfileIdentityUrlKey';
import { observedPersonNameAgreesWith } from '../scrapers/utils/personNameAgreement';
import { surnamesCompatible } from '../scrapers/utils/piNameMatch';
import { splitName } from '../scrapers/utils/scraperHelpers';
import { titleResearchOwnership } from '../scrapers/utils/titleResearchOwnership';

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

export const RESEARCHER_IDENTITY_TIERS = ['NAME_ONLY', 'NETID', 'ACCOUNT'] as const;
export type ResearcherIdentityTier = (typeof RESEARCHER_IDENTITY_TIERS)[number];

export interface ResearcherIdentityLike {
  accountId?: unknown;
  netid?: unknown;
}

export function researcherIdentityTier(researcher: ResearcherIdentityLike): ResearcherIdentityTier {
  if (researcher.accountId !== undefined && researcher.accountId !== null) return 'ACCOUNT';
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
  accountId?: unknown;
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
  accountId?: unknown;
}

/**
 * The index that sees a netid twin. A twin minted by the pre-#3164 resolver is
 * keyed on `accountId` and carries no `identifiers.netid` at all, and its
 * display name is whatever the observation said rather than whatever the holder
 * stored, so on Development 0 of the 5 pairs share a normalized name and the
 * name index cannot reach any of them. The netid is the identity that actually
 * joins the two rows, and it reaches the twin through its account.
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
      tier: researcherIdentityTier({ accountId: entry.accountId, netid }),
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
  | 'NETID_CONFLICT';

export const SHELL_FOLD_IDENTITIES = [
  'netid',
  'roster-identity',
  'verified-profile',
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
  if (!Array.isArray(profileLinks)) return [];
  const keys = new Set<string>();
  for (const link of profileLinks) {
    if (!link || typeof link !== 'object') continue;
    const { kind, purpose, healthStatus, url } = link as Record<string, unknown>;
    if (kind !== 'YALE_OFFICIAL' || purpose !== 'PRIMARY_IDENTITY' || healthStatus !== 'HEALTHY') {
      continue;
    }
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
 * A shell and an account-backed record that hold the same healthy official primary
 * profile are one person even when their given names differ, because a programme
 * roster mints under a nickname and the directory account under the legal name. The
 * page decides; the surname and rank only veto, and they veto per holder, so a holder
 * reached through a wrong-person link drops out instead of making the page ambiguous.
 * More than one surviving account-backed holder resolves to nobody, because two accounts
 * are two humans the page cannot split.
 */
function decideVerifiedProfileFold(
  shell: ShellIdentity,
  verifiedProfileIndex: Map<string, VerifiedProfileCandidate[]>,
): ShellMergeDecision | undefined {
  const keys = verifiedPrimaryProfileKeys(shell.profileLinks);
  if (keys.length === 0) return undefined;
  const shellStrength = identityTierStrength(researcherIdentityTier(shell));
  const shellSurname = displayNameSurname(shell.displayName);
  const holders = new Map<string, VerifiedProfileCandidate>();
  for (const key of keys) {
    for (const candidate of verifiedProfileIndex.get(key) ?? []) {
      if (candidate.id === shell.id) continue;
      if (candidate.tier !== 'ACCOUNT') continue;
      if (identityTierStrength(candidate.tier) <= shellStrength) continue;
      if (!surnamesCompatible(shellSurname, displayNameSurname(candidate.displayName))) continue;
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

function displayNameSurname(displayName: unknown): string {
  return splitName(typeof displayName === 'string' ? displayName : '').last;
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

export function decideShellMerge(
  shell: ShellIdentity,
  canonicalNameIndex: Map<string, CanonicalCandidate[]>,
  canonicalNetidIndex: Map<string, CanonicalCandidate[]> = new Map(),
  rosterIdentityCandidates: ReadonlyArray<RosterIdentityCandidate> = [],
  verifiedProfileIndex: Map<string, VerifiedProfileCandidate[]> = new Map(),
): ShellMergeDecision {
  const byNetid = decideNetidFold(shell, canonicalNetidIndex);
  if (byNetid) return byNetid;
  const byRosterIdentity = decideRosterIdentityFold(shell, rosterIdentityCandidates);
  if (byRosterIdentity) return byRosterIdentity;
  const byVerifiedProfile = decideVerifiedProfileFold(shell, verifiedProfileIndex);
  if (byVerifiedProfile) return byVerifiedProfile;

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

export interface ResearcherProfileLinkLike {
  kind?: unknown;
  url?: unknown;
  [key: string]: unknown;
}

export interface ResearcherAttributeSnapshot {
  profileLinks?: ResearcherProfileLinkLike[];
  identifiers?: Record<string, unknown>;
  profile?: Record<string, unknown>;
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
}

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
    if (shellValue) identifierGapFills[field] = shellValue;
  }

  const mergedOrcid = nonEmptyString(canonical.identifiers?.orcid) ?? identifierGapFills.orcid;
  const profileLinksToAppend: ResearcherProfileLinkLike[] = [];
  for (const link of shell.profileLinks ?? []) {
    const kind = profileLinkKind(link);
    if (!kind || claimedKinds.has(kind)) continue;
    if (kind === 'ORCID' && !orcidLinkAgreesWith(link, mergedOrcid)) continue;
    claimedKinds.add(kind);
    profileLinksToAppend.push(link);
  }

  const profileGapFills: Record<string, string> = {};
  for (const field of RESEARCHER_UNION_PROFILE_FIELDS) {
    if (nonEmptyString(canonical.profile?.[field])) continue;
    const shellValue = nonEmptyString(shell.profile?.[field]);
    if (shellValue) profileGapFills[field] = shellValue;
  }

  return { profileLinksToAppend, identifierGapFills, profileGapFills };
}

export function researcherAttributeUnionIsEmpty(plan: ResearcherAttributeUnionPlan): boolean {
  return (
    plan.profileLinksToAppend.length === 0 &&
    Object.keys(plan.identifierGapFills).length === 0 &&
    Object.keys(plan.profileGapFills).length === 0
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
  };
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
): string[] {
  const pageKeys = verifiedPrimaryProfileKeys(member.profileLinks)
    .filter((key) => !heldElsewhere.pages.has(key))
    .map((key) => `page::${key}`);
  const name = normalizeResearcherName(member.displayName);
  const department = departmentKey(member.primaryDepartment);
  return name && department && !heldElsewhere.names.has(name)
    ? [...pageKeys, `name::${name}::${department}`]
    : pageKeys;
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
  const surnames = members.map((member) => clusterSurname(member.displayName)).filter(Boolean);
  if (
    surnames.some((surname, index) =>
      surnames.slice(index + 1).some((other) => !surnamesCompatible(surname, other)),
    )
  ) {
    return 'SURNAME_CONFLICT';
  }
  return undefined;
}

const GENERATIONAL_SUFFIX = /^(?:jr|sr|ii|iii|iv)$/i;

// Copies of one record differ only in roster noise after the name: a credential after a
// comma, a generational suffix, a trailing period.
function clusterSurname(displayName: unknown): string {
  const beforeCredentials = (typeof displayName === 'string' ? displayName : '').split(',')[0];
  const tokens = beforeCredentials
    .split(/\s+/)
    .map((token) => token.replace(/\.+$/, ''))
    .filter(Boolean);
  while (tokens.length > 1 && GENERATIONAL_SUFFIX.test(tokens[tokens.length - 1])) tokens.pop();
  return splitName(tokens.join(' ')).last;
}

const objectIdSeconds = (id: string): number =>
  /^[0-9a-f]{24}$/i.test(id) ? parseInt(id.slice(0, 8), 16) : Number.MAX_SAFE_INTEGER;

/**
 * The survivor is the record the corpus already leans on: the most live role edges, then
 * the most healthy verified primary links, then the oldest record, so the choice is
 * reproducible and never alphabetical.
 */
export function accountlessClusterSurvivor(
  members: ReadonlyArray<AccountlessClusterMember>,
): AccountlessClusterMember {
  return [...members].sort(
    (left, right) =>
      right.liveRoleEdges - left.liveRoleEdges ||
      verifiedPrimaryProfileKeys(right.profileLinks).length -
        verifiedPrimaryProfileKeys(left.profileLinks).length ||
      objectIdSeconds(left.id) - objectIdSeconds(right.id) ||
      left.id.localeCompare(right.id),
  )[0];
}

/**
 * Groups of accountless records with no account-backed member, which the outranking arms
 * cannot fold because nobody outranks anybody. A group is the records that share a
 * healthy verified primary profile, or the same normalized full name together with the
 * same stated primary department. A whole group is refused on any netid, ORCID, title
 * rank or surname disagreement, because one wrong join merges two people for good. A page
 * or name that any record outside the group also holds joins nobody: the outranking arms
 * already found it unable to tell those records apart.
 */
export function planAccountlessClusterFolds(
  members: ReadonlyArray<AccountlessClusterMember>,
  nonMembers: ReadonlyArray<Pick<AccountlessClusterMember, 'displayName' | 'profileLinks'>>,
): AccountlessClusterPlan {
  const heldElsewhere = {
    pages: new Set(nonMembers.flatMap((record) => verifiedPrimaryProfileKeys(record.profileLinks))),
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
    for (const key of clusterKeys(member, heldElsewhere)) {
      const first = firstByKey.get(key);
      if (first) parent.set(find(member.id), find(first));
      else firstByKey.set(key, member.id);
    }
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

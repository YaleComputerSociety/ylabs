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

export interface ShellMergeDecision {
  merge: boolean;
  canonicalId?: string;
  reason: ShellMergeReason;
  /** Which identity decided the fold, so a netid fold cannot hide inside a name count. */
  matchedOn?: 'netid' | 'name';
}

export interface ShellIdentity extends ResearcherIdentityLike {
  id?: string;
  displayName?: unknown;
  orcid?: unknown;
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

export function decideShellMerge(
  shell: ShellIdentity,
  canonicalNameIndex: Map<string, CanonicalCandidate[]>,
  canonicalNetidIndex: Map<string, CanonicalCandidate[]> = new Map(),
): ShellMergeDecision {
  const byNetid = decideNetidFold(shell, canonicalNetidIndex);
  if (byNetid) return byNetid;

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

  const profileLinksToAppend: ResearcherProfileLinkLike[] = [];
  for (const link of shell.profileLinks ?? []) {
    const kind = profileLinkKind(link);
    if (!kind || claimedKinds.has(kind)) continue;
    claimedKinds.add(kind);
    profileLinksToAppend.push(link);
  }

  const identifierGapFills: Record<string, string> = {};
  for (const field of RESEARCHER_UNION_IDENTIFIER_FIELDS) {
    if (nonEmptyString(canonical.identifiers?.[field])) continue;
    const shellValue = nonEmptyString(shell.identifiers?.[field]);
    if (shellValue) identifierGapFills[field] = shellValue;
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

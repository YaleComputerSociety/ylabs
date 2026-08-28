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

export interface CanonicalCandidate {
  id: string;
  orcid?: string;
  netid?: string;
}

export interface CanonicalNameEntry {
  displayName?: unknown;
  id: string;
  orcid?: unknown;
  netid?: unknown;
}

export function buildCanonicalNameIndex(
  canonical: ReadonlyArray<CanonicalNameEntry>,
): Map<string, CanonicalCandidate[]> {
  const index = new Map<string, CanonicalCandidate[]>();
  for (const entry of canonical) {
    const name = normalizeResearcherName(entry.displayName);
    if (!name) continue;
    const list = index.get(name) ?? [];
    list.push({ id: entry.id, orcid: cleanOrcid(entry.orcid), netid: cleanNetid(entry.netid) });
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
}

export function decideShellMerge(
  shell: { displayName?: unknown; orcid?: unknown; netid?: unknown },
  canonicalNameIndex: Map<string, CanonicalCandidate[]>,
): ShellMergeDecision {
  const name = normalizeResearcherName(shell.displayName);
  if (!name) return { merge: false, reason: 'NO_NAME' };

  const canonical = canonicalNameIndex.get(name);
  if (!canonical || canonical.length === 0) return { merge: false, reason: 'NO_CANONICAL' };
  if (canonical.length > 1) return { merge: false, reason: 'AMBIGUOUS_MULTIPLE_CANONICAL' };

  const target = canonical[0];
  const shellOrcid = cleanOrcid(shell.orcid);
  if (shellOrcid && target.orcid && shellOrcid !== target.orcid) {
    return { merge: false, reason: 'ORCID_CONFLICT' };
  }
  const shellNetid = cleanNetid(shell.netid);
  if (shellNetid && target.netid && shellNetid !== target.netid) {
    return { merge: false, reason: 'NETID_CONFLICT' };
  }

  return { merge: true, canonicalId: target.id, reason: 'MERGEABLE' };
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

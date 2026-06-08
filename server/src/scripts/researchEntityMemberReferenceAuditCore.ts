import { assertScriptApplyAllowed } from './scriptWriteGuards';

export interface ResearchEntityMemberReferenceAuditArgs {
  apply: boolean;
  confirmExactRelink: boolean;
  limit: number;
  limitProvided: boolean;
  maxApply: number;
  output?: string;
}

export interface MemberReferenceAuditUser {
  id: string;
  netid?: string;
  name: string;
  userType?: string;
}

export interface ExistingMemberMatch {
  id: string;
  userId: string;
  role?: string;
}

export interface MemberReferenceAuditRow {
  member: {
    id: string;
    userId: string;
    researchEntityId?: string;
    researchGroupId?: string;
    name?: string;
    role?: string;
    sourceUrl?: string;
  };
  entity?: {
    id?: string;
    name?: string;
    slug?: string;
    archived?: boolean;
    canonicalGroupId?: string;
  };
  candidateUsers: MemberReferenceAuditUser[];
  existingMemberMatches?: ExistingMemberMatch[];
  existingCanonicalMemberMatches?: ExistingMemberMatch[];
}

export interface MemberReferenceAuditPlanItem {
  action:
    | 'relink_user_id_to_exact_name_match'
    | 'archive_orphan_duplicate_member'
    | 'relink_member_to_canonical_entity'
    | 'archive_current_member_on_archived_entity'
    | 'manual_review';
  memberId: string;
  currentUserId: string;
  researchEntityId?: string;
  entityName?: string;
  entitySlug?: string;
  role?: string;
  sourceUrl?: string;
  inferredNames: string[];
  candidateUsers: MemberReferenceAuditUser[];
  replacementUserId?: string;
  replacementNetid?: string;
  replacementResearchEntityId?: string;
  existingMemberId?: string;
  reason: string;
}

export interface ResearchEntityMemberReferenceAuditSummary {
  mode: 'dry-run' | 'apply';
  orphanedMemberUserRefs: number;
  plannedExactRelinks: number;
  plannedDuplicateArchives: number;
  currentMembersOnArchivedEntities: number;
  plannedCanonicalEntityRelinks: number;
  plannedArchivedEntityMemberArchives: number;
  manualReviewCount: number;
  applyBlocked: boolean;
  nextAction: string;
  plan: MemberReferenceAuditPlanItem[];
  applied: Array<{
    action:
      | 'relink_user_id_to_exact_name_match'
      | 'archive_orphan_duplicate_member'
      | 'relink_member_to_canonical_entity'
      | 'archive_current_member_on_archived_entity';
    memberId: string;
    previousUserId: string;
    replacementUserId?: string;
    replacementNetid?: string;
    replacementResearchEntityId?: string;
    existingMemberId?: string;
  }>;
}

function consumeValue(
  argv: string[],
  index: number,
  flag: string,
  noun: 'number' | 'path',
): { value: string; nextIndex: number } {
  const value = argv[index + 1];
  if (value === undefined || value.trim() === '' || value.startsWith('--')) {
    throw new Error(`${flag} requires a ${noun}`);
  }
  return { value, nextIndex: index + 1 };
}

function consumeInlineValue(arg: string, flag: string, noun: 'number' | 'path'): string {
  const value = arg.slice(`${flag}=`.length);
  if (value.trim() === '' || value.startsWith('--')) {
    throw new Error(`${flag} requires a ${noun}`);
  }
  return value;
}

export function parseResearchEntityMemberReferenceAuditArgs(
  argv: string[],
): ResearchEntityMemberReferenceAuditArgs {
  const args: ResearchEntityMemberReferenceAuditArgs = {
    apply: false,
    confirmExactRelink: false,
    limit: 1000,
    limitProvided: false,
    maxApply: 10,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply') {
      args.apply = true;
      continue;
    }
    if (arg === '--confirm-exact-relink') {
      args.confirmExactRelink = true;
      continue;
    }
    if (arg.startsWith('--limit=')) {
      args.limit = parsePositiveIntegerValue(consumeInlineValue(arg, '--limit', 'number'), '--limit');
      args.limitProvided = true;
      continue;
    }
    if (arg === '--limit') {
      const { value, nextIndex } = consumeValue(argv, index, '--limit', 'number');
      args.limit = parsePositiveIntegerValue(value, '--limit');
      args.limitProvided = true;
      index = nextIndex;
      continue;
    }
    if (arg.startsWith('--max-apply=')) {
      args.maxApply = parsePositiveIntegerValue(
        consumeInlineValue(arg, '--max-apply', 'number'),
        '--max-apply',
      );
      continue;
    }
    if (arg === '--max-apply') {
      const { value, nextIndex } = consumeValue(argv, index, '--max-apply', 'number');
      args.maxApply = parsePositiveIntegerValue(value, '--max-apply');
      index = nextIndex;
      continue;
    }
    if (arg === '--output') {
      const { value, nextIndex } = consumeValue(argv, index, '--output', 'path');
      args.output = value;
      index = nextIndex;
      continue;
    }
    if (arg.startsWith('--output=')) {
      args.output = consumeInlineValue(arg, '--output', 'path');
      continue;
    }
    throw new Error(`Unknown research-entity-members:audit-user-refs option: ${arg}`);
  }

  return args;
}

export function inferMemberReferenceNames(row: MemberReferenceAuditRow): string[] {
  return uniqueStrings([
    row.member.name,
    inferPersonNameFromEntityName(row.entity?.name),
    inferPersonNameFromSlug(row.entity?.slug),
  ]);
}

export function buildResearchEntityMemberReferenceAuditSummary(input: {
  mode?: 'dry-run' | 'apply';
  totalOrphanedRefs: number;
  rows: MemberReferenceAuditRow[];
  applied?: ResearchEntityMemberReferenceAuditSummary['applied'];
}): ResearchEntityMemberReferenceAuditSummary {
  const plan = input.rows.map((row) => {
    if (row.entity?.archived && row.entity.canonicalGroupId) {
      const existingCanonicalMemberMatch = row.existingCanonicalMemberMatches?.find((match) => {
        if (match.userId !== row.member.userId) return false;
        if (!row.member.role || !match.role) return true;
        return match.role === row.member.role;
      });
      return {
        action: existingCanonicalMemberMatch
          ? 'archive_current_member_on_archived_entity'
          : 'relink_member_to_canonical_entity',
        memberId: row.member.id,
        currentUserId: row.member.userId,
        researchEntityId: row.member.researchEntityId,
        entityName: row.entity?.name,
        entitySlug: row.entity?.slug,
        role: row.member.role,
        sourceUrl: row.member.sourceUrl,
        inferredNames: inferMemberReferenceNames(row),
        candidateUsers: row.candidateUsers,
        replacementResearchEntityId: row.entity.canonicalGroupId,
        ...(existingCanonicalMemberMatch ? { existingMemberId: existingCanonicalMemberMatch.id } : {}),
        reason: existingCanonicalMemberMatch
          ? 'Canonical entity already has this current member; archive the stale member row on the archived entity.'
          : 'Current member points at an archived entity; relink to canonicalGroupId.',
      } satisfies MemberReferenceAuditPlanItem;
    }

    const inferredNames = inferMemberReferenceNames(row);
    const exactCandidates = row.candidateUsers.filter((user) =>
      inferredNames.some((name) => normalizePersonName(user.name) === normalizePersonName(name)),
    );
    const exactCandidate = exactCandidates.length === 1 ? exactCandidates[0] : undefined;
    const existingMemberMatch = exactCandidate
      ? findExistingMemberMatch(row, exactCandidate.id)
      : undefined;

    return {
      action: existingMemberMatch
        ? 'archive_orphan_duplicate_member'
        : exactCandidate
          ? 'relink_user_id_to_exact_name_match'
          : 'manual_review',
      memberId: row.member.id,
      currentUserId: row.member.userId,
      researchEntityId: row.member.researchEntityId,
      entityName: row.entity?.name,
      entitySlug: row.entity?.slug,
      role: row.member.role,
      sourceUrl: row.member.sourceUrl,
      inferredNames,
      candidateUsers: row.candidateUsers,
      ...(exactCandidate
        ? {
            replacementUserId: exactCandidate.id,
            replacementNetid: exactCandidate.netid,
            ...(existingMemberMatch ? { existingMemberId: existingMemberMatch.id } : {}),
            reason: existingMemberMatch
              ? 'Exact target member already exists; archive orphan duplicate row.'
              : 'Exactly one existing user matches an inferred member/entity person name.',
          }
        : {
            reason:
              exactCandidates.length > 1
                ? 'Multiple existing users match inferred names; manual review required.'
                : 'No exact existing user match was found; manual review required.',
          }),
    } satisfies MemberReferenceAuditPlanItem;
  });

  const plannedExactRelinks = plan.filter(
    (item) => item.action === 'relink_user_id_to_exact_name_match',
  ).length;
  const plannedDuplicateArchives = plan.filter(
    (item) => item.action === 'archive_orphan_duplicate_member',
  ).length;
  const currentMembersOnArchivedEntities = plan.filter(
    (item) =>
      item.action === 'relink_member_to_canonical_entity' ||
      item.action === 'archive_current_member_on_archived_entity',
  ).length;
  const plannedCanonicalEntityRelinks = plan.filter(
    (item) => item.action === 'relink_member_to_canonical_entity',
  ).length;
  const plannedArchivedEntityMemberArchives = plan.filter(
    (item) => item.action === 'archive_current_member_on_archived_entity',
  ).length;
  const plannedRepairs =
    plannedExactRelinks +
    plannedDuplicateArchives +
    plannedCanonicalEntityRelinks +
    plannedArchivedEntityMemberArchives;

  return {
    mode: input.mode || 'dry-run',
    orphanedMemberUserRefs: Math.max(0, input.totalOrphanedRefs),
    plannedExactRelinks,
    plannedDuplicateArchives,
    currentMembersOnArchivedEntities,
    plannedCanonicalEntityRelinks,
    plannedArchivedEntityMemberArchives,
    manualReviewCount: plan.length - plannedRepairs,
    applyBlocked: input.mode !== 'apply',
    nextAction:
      input.mode === 'apply'
        ? 'Applied member-reference repairs; rerun data-quality and launch gates.'
        : 'Review exact relink and duplicate-archive proposals before any non-production repair; this command does not modify members or users.',
    plan,
    applied: input.applied || [],
  };
}

export function assertResearchEntityMemberReferenceApplyAllowed(
  args: ResearchEntityMemberReferenceAuditArgs,
  summary: ResearchEntityMemberReferenceAuditSummary,
): void {
  assertResearchEntityMemberReferenceApplyPreflightAllowed(args);
  assertResearchEntityMemberReferenceTargetAllowed(args);
  if (!args.apply) return;
  if (summary.manualReviewCount > 0) {
    throw new Error('Apply is blocked while manual-review member reference rows remain.');
  }
  const plannedRepairs =
    summary.plannedExactRelinks +
    summary.plannedDuplicateArchives +
    summary.plannedCanonicalEntityRelinks +
    summary.plannedArchivedEntityMemberArchives;
  if (plannedRepairs <= 0) {
    throw new Error('Apply requires at least one exact relink or duplicate archive proposal.');
  }
  if (plannedRepairs > args.maxApply) {
    throw new Error(`Apply would modify ${plannedRepairs} rows, above --max-apply.`);
  }
}

export function assertResearchEntityMemberReferenceApplyPreflightAllowed(
  args: ResearchEntityMemberReferenceAuditArgs,
): void {
  if (!args.apply) return;
  if (!args.confirmExactRelink) {
    throw new Error('Apply requires --confirm-exact-relink.');
  }
  if (!args.limitProvided) {
    throw new Error('--limit is required when --apply is set for research-entity-members:audit-user-refs.');
  }
}

export function assertResearchEntityMemberReferenceTargetAllowed(
  args: ResearchEntityMemberReferenceAuditArgs,
  env: NodeJS.ProcessEnv = process.env,
  mongoUrl?: string,
) {
  return assertScriptApplyAllowed({
    apply: args.apply,
    scriptName: 'research-entity-members:audit-user-refs',
    mongoUrl,
    env,
  });
}

export function buildResearchEntityMemberReferenceAuditOutput<T extends object>(
  summary: T,
  metadata: {
    environment?: string;
    db?: string;
    options: ResearchEntityMemberReferenceAuditArgs;
  },
): T & {
  environment?: string;
  db?: string;
  options: ResearchEntityMemberReferenceAuditArgs;
} {
  return {
    ...summary,
    ...(metadata.environment ? { environment: metadata.environment } : {}),
    ...(metadata.db ? { db: metadata.db } : {}),
    options: metadata.options,
  };
}

function findExistingMemberMatch(
  row: MemberReferenceAuditRow,
  replacementUserId: string,
): ExistingMemberMatch | undefined {
  return row.existingMemberMatches?.find((match) => {
    if (match.userId !== replacementUserId) return false;
    if (!row.member.role || !match.role) return true;
    return match.role === row.member.role;
  });
}

function inferPersonNameFromEntityName(name?: string): string | undefined {
  const trimmed = cleanName(name);
  if (!trimmed) return undefined;
  const match = trimmed.match(
    /^(.+?)\s+(?:lab|faculty research|research area|research group|group)$/i,
  );
  return match ? cleanName(match[1]) : undefined;
}

function inferPersonNameFromSlug(slug?: string): string | undefined {
  const cleaned = cleanName(slug?.replace(/^dept-[a-z0-9]+-/i, '').replace(/^nih-pi-/i, ' '));
  if (!cleaned) return undefined;
  if (!/^[a-z]+(?:\s+[a-z]+)+$/i.test(cleaned)) return undefined;
  return cleaned
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

function normalizePersonName(value: string): string {
  return cleanName(value).toLowerCase();
}

function cleanName(value?: string): string {
  return String(value || '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const cleaned = cleanName(value);
    const key = cleaned.toLowerCase();
    if (!cleaned || seen.has(key)) continue;
    seen.add(key);
    result.push(cleaned);
  }
  return result;
}

function parsePositiveIntegerValue(raw: string, flagName: string): number {
  if (!/^[1-9]\d*$/.test(raw)) {
    throw new Error(`${flagName} must be a positive integer`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${flagName} must be a positive integer`);
  }
  return value;
}

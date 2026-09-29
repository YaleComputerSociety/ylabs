import { facultyResearchAreaSlugForPersonName } from '../utils/researchEntityShellSlug';
import { GRANT_SHELL_ENTITY_TYPE } from '../scrapers/utils/grantShellIdentity';

export const GRANT_SHELL_PORT_SLUG_RE = /^(?:nih|nsf|federal|doe|neh)-pi-/i;

const OBJECT_ID_TAIL_RE = /^[0-9a-f]{24}$/i;

/**
 * A grant row's stored document is copied onto a created or revived survivor except for
 * the fields that name the row itself or record its lifecycle, so the survivor carries
 * every value, lock, refusal and provenance entry the grant row held.
 */
export const GRANT_SHELL_PORT_NON_PORTABLE_FIELDS: ReadonlySet<string> = new Set([
  '_id',
  'slug',
  '__v',
  'createdAt',
  'updatedAt',
  'archived',
  'archivedReason',
  'archivedAt',
  'canonicalGroupId',
]);

export interface GrantShellPortRow {
  id: string;
  slug: string;
  entityType: string;
  studentVisibilityTier?: string;
  archived?: boolean;
}

export interface GrantShellPortInput {
  shells: GrantShellPortRow[];
  leadPersonIdsByEntityId: ReadonlyMap<string, readonly string[]>;
  personNameById: ReadonlyMap<string, string>;
  liveFacultyRowsByPersonId: ReadonlyMap<string, readonly GrantShellPortRow[]>;
  rowsHoldingSlug: ReadonlyMap<string, GrantShellPortRow>;
  tombstoneTerminusIdByArchivedRowId: ReadonlyMap<string, string>;
}

export type GrantShellPortSurvivor =
  | { kind: 'existing-faculty-row'; survivorId: string; survivorSlug: string }
  | { kind: 'revived-faculty-row'; survivorId: string; survivorSlug: string }
  | { kind: 'created-faculty-row'; survivorSlug: string; templateShellId: string };

export type GrantShellPortPlan = GrantShellPortSurvivor & { shellIds: string[] };

export type GrantShellPortRefusalReason =
  | 'labTyped'
  | 'severalLeads'
  | 'noPersonName'
  | 'severalFacultyRowsForPerson'
  | 'targetSlugHeldByAnotherRow'
  | 'targetSlugHeldByUnrelatedArchivedRow';

export interface GrantShellPortRefusal {
  shellId: string;
  reason: GrantShellPortRefusalReason;
}

export interface GrantShellPortOutcome {
  plans: GrantShellPortPlan[];
  refused: GrantShellPortRefusal[];
}

type ShellTarget =
  | { status: 'target'; survivor: GrantShellPortSurvivor }
  | { status: 'refused'; reason: GrantShellPortRefusalReason };

const TIER_RANK: Record<string, number> = {
  student_ready: 3,
  operator_review: 2,
  suppressed: 1,
};

export function isGrantShellSlug(slug: string): boolean {
  return GRANT_SHELL_PORT_SLUG_RE.test(slug);
}

export function personNameForFacultySlug(displayName: string): string {
  return displayName
    .replace(/\([^)]*\)/g, ' ')
    .split(',')[0]
    .replace(/\s+/g, ' ')
    .trim();
}

function personSlugSourceForUnledShell(shellSlug: string): string {
  const tail = shellSlug.replace(GRANT_SHELL_PORT_SLUG_RE, '');
  return OBJECT_ID_TAIL_RE.test(tail) ? '' : tail;
}

function targetForShell(shell: GrantShellPortRow, input: GrantShellPortInput): ShellTarget {
  if (shell.entityType !== GRANT_SHELL_ENTITY_TYPE)
    return { status: 'refused', reason: 'labTyped' };
  const leadPersonIds = [...new Set(input.leadPersonIdsByEntityId.get(shell.id) ?? [])];
  if (leadPersonIds.length > 1) return { status: 'refused', reason: 'severalLeads' };
  const [leadPersonId] = leadPersonIds;

  if (leadPersonId) {
    const facultyRows = input.liveFacultyRowsByPersonId.get(leadPersonId) ?? [];
    if (facultyRows.length > 1) return { status: 'refused', reason: 'severalFacultyRowsForPerson' };
    if (facultyRows.length === 1) {
      const [row] = facultyRows;
      return {
        status: 'target',
        survivor: { kind: 'existing-faculty-row', survivorId: row.id, survivorSlug: row.slug },
      };
    }
  }

  const nameSource = leadPersonId
    ? personNameForFacultySlug(input.personNameById.get(leadPersonId) ?? '')
    : personSlugSourceForUnledShell(shell.slug);
  const survivorSlug = facultyResearchAreaSlugForPersonName(nameSource);
  if (!survivorSlug) return { status: 'refused', reason: 'noPersonName' };

  const holder = input.rowsHoldingSlug.get(survivorSlug);
  if (!holder) {
    return {
      status: 'target',
      survivor: { kind: 'created-faculty-row', survivorSlug, templateShellId: shell.id },
    };
  }
  if (holder.archived !== true) return { status: 'refused', reason: 'targetSlugHeldByAnotherRow' };
  if (input.tombstoneTerminusIdByArchivedRowId.get(holder.id) !== shell.id) {
    return { status: 'refused', reason: 'targetSlugHeldByUnrelatedArchivedRow' };
  }
  return {
    status: 'target',
    survivor: { kind: 'revived-faculty-row', survivorId: holder.id, survivorSlug },
  };
}

function tierRank(row: GrantShellPortRow): number {
  return TIER_RANK[row.studentVisibilityTier ?? ''] ?? 0;
}

function bestTemplateShell(shells: GrantShellPortRow[]): GrantShellPortRow {
  return [...shells].sort((a, b) => tierRank(b) - tierRank(a) || a.slug.localeCompare(b.slug))[0];
}

/**
 * Every grant row that names a person moves onto that person's faculty research
 * profile: the one live faculty row they already lead, else an archived faculty row
 * whose tombstone already points at the grant row, else a new
 * `faculty-research-area-<person>` row. Lab-typed grant rows are left in place,
 * because the faculty prefix is itself read as "profile shell" by the duplicate-risk,
 * eponymous-merge and relationship-typing paths regardless of `entityType`.
 */
export function planGrantShellPort(input: GrantShellPortInput): GrantShellPortOutcome {
  const refused: GrantShellPortRefusal[] = [];
  const groups = new Map<
    string,
    { survivor: GrantShellPortSurvivor; shells: GrantShellPortRow[] }
  >();

  for (const shell of [...input.shells].sort((a, b) => a.slug.localeCompare(b.slug))) {
    const target = targetForShell(shell, input);
    if (target.status === 'refused') {
      refused.push({ shellId: shell.id, reason: target.reason });
      continue;
    }
    const groupKey = target.survivor.survivorSlug;
    const group = groups.get(groupKey);
    if (group) group.shells.push(shell);
    else groups.set(groupKey, { survivor: target.survivor, shells: [shell] });
  }

  const plans = [...groups.values()].map(({ survivor, shells }): GrantShellPortPlan => {
    const shellIds = shells.map((shell) => shell.id);
    if (survivor.kind === 'created-faculty-row') {
      return { ...survivor, templateShellId: bestTemplateShell(shells).id, shellIds };
    }
    return { ...survivor, shellIds };
  });
  return { plans, refused };
}

export function summarizeGrantShellPort(outcome: GrantShellPortOutcome): {
  plansBySurvivorKind: Record<GrantShellPortSurvivor['kind'], number>;
  shellsBySurvivorKind: Record<GrantShellPortSurvivor['kind'], number>;
  refusedByReason: Partial<Record<GrantShellPortRefusalReason, number>>;
} {
  const plansBySurvivorKind = {
    'existing-faculty-row': 0,
    'revived-faculty-row': 0,
    'created-faculty-row': 0,
  };
  const shellsBySurvivorKind = { ...plansBySurvivorKind };
  for (const plan of outcome.plans) {
    plansBySurvivorKind[plan.kind] += 1;
    shellsBySurvivorKind[plan.kind] += plan.shellIds.length;
  }
  const refusedByReason: Partial<Record<GrantShellPortRefusalReason, number>> = {};
  for (const refusal of outcome.refused) {
    refusedByReason[refusal.reason] = (refusedByReason[refusal.reason] ?? 0) + 1;
  }
  return { plansBySurvivorKind, shellsBySurvivorKind, refusedByReason };
}

export function portableGrantShellFields(
  shellDocument: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(shellDocument).filter(
      ([field]) => !GRANT_SHELL_PORT_NON_PORTABLE_FIELDS.has(field),
    ),
  );
}

export function fundingEvidenceKey(grant: unknown): string {
  if (typeof grant === 'string') return grant;
  const id = (grant as { id?: unknown } | null)?.id;
  return typeof id === 'string' && id.trim() ? id.trim() : JSON.stringify(grant);
}

export function unionRecentGrants(rows: Array<Record<string, unknown>>): unknown[] {
  const byKey = new Map<string, unknown>();
  for (const row of rows) {
    for (const grant of Array.isArray(row.recentGrants) ? row.recentGrants : []) {
      const key = fundingEvidenceKey(grant);
      if (!byKey.has(key)) byKey.set(key, grant);
    }
  }
  return [...byKey.values()];
}

export function unionStringField(rows: Array<Record<string, unknown>>, field: string): string[] {
  const values = new Set<string>();
  for (const row of rows) {
    for (const value of Array.isArray(row[field]) ? (row[field] as unknown[]) : []) {
      if (typeof value === 'string' && value.trim()) values.add(value);
    }
  }
  return [...values];
}

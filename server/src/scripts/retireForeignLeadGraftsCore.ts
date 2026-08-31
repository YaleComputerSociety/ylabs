import {
  detectProfileIdentityRisk,
  officialProfileUrlFromRosterEntry,
  type LeadProfileIdentityLead,
} from '../services/leadProfileIdentity';
import type { ResearchEntityRosterEntry } from '../services/researchEntityMembershipAccessor';

export const FOREIGN_LEAD_GRAFT_LEAD_ROLES = new Set(['pi', 'co-pi', 'director', 'co-director']);

/**
 * A roster lead built in exactly the shape the student-visibility gate feeds to
 * `detectProfileIdentityRisk`, so this cleanup's foreign-identity verdict is the
 * gate's own verdict rather than a re-derivation that could drift from it.
 */
export interface GateLeadRow extends LeadProfileIdentityLead {
  roleAssignmentId: string;
  personId: string;
  role: string;
  state: string;
  reviewStatus: string;
  confidence: number;
  user: Record<string, unknown>;
}

export function buildGateLeadRow(entry: ResearchEntityRosterEntry): GateLeadRow {
  const [fname = '', ...rest] = String(entry.name || '')
    .trim()
    .split(/\s+/);
  const lname = rest.join(' ');
  const officialProfileUrl = officialProfileUrlFromRosterEntry(entry);
  return {
    roleAssignmentId: String(entry.roleAssignmentId),
    personId: String(entry.personId),
    role: entry.role,
    state: entry.state,
    reviewStatus: entry.reviewStatus,
    confidence: typeof entry.confidence === 'number' ? entry.confidence : 0,
    name: entry.name,
    user: {
      _id: entry.personId,
      netid: entry.netid,
      displayName: entry.name,
      fname,
      lname,
      ...(entry.title ? { title: entry.title } : {}),
      ...(entry.websiteUrl ? { websiteUrl: entry.websiteUrl } : {}),
      ...(officialProfileUrl ? { profileUrls: { official: officialProfileUrl } } : {}),
    },
  };
}

const isGateLead = (row: GateLeadRow): boolean =>
  row.state !== 'HISTORICAL' && FOREIGN_LEAD_GRAFT_LEAD_ROLES.has(row.role);

/**
 * The lead rows on this entity that fail identity corroboration against its own
 * official person-profile home - the candidates for retirement. A row qualifies
 * only when every gate precondition holds: the entity is currently contested
 * (no gate lead corroborates its person-profile home), the row is an unreviewed
 * gate lead (an operator APPROVED assignment is never touched), and the row is
 * itself non-corroborating by the gate's own `detectProfileIdentityRisk` verdict
 * when tested in isolation. This is the gate's "unverified", not a proof of a
 * foreign identity: an opaque netid profile slug (`.../profile/EV59`) or a
 * preferred-vs-legal name (`Elsa` vs `E. Chui-Ying`) also fails corroboration,
 * so the runner only mutates operator-verified entities named explicitly on the
 * command line. Fails closed: an organizational entity, one with no
 * person-profile home, or an uncontested one yields no candidates.
 */
export function selectForeignLeadGrafts(input: {
  entity: Record<string, unknown>;
  leadRows: GateLeadRow[];
}): GateLeadRow[] {
  const gateLeads = input.leadRows.filter(isGateLead);
  if (gateLeads.length === 0) return [];
  if (!detectProfileIdentityRisk({ entity: input.entity, leadMembers: gateLeads })) return [];

  return gateLeads.filter(
    (row) =>
      row.reviewStatus !== 'APPROVED' &&
      detectProfileIdentityRisk({ entity: input.entity, leadMembers: [row] }),
  );
}

export interface ForeignLeadGraftPlanRow {
  entityId: string;
  slug?: string;
  entityName?: string;
  entityType?: string;
  roleAssignmentIds: string[];
  personIds: string[];
  graftedLeadNames: string[];
  remainingGateLeadCount: number;
}

export function planForeignLeadGraftRetirement(input: {
  entity: Record<string, unknown> & {
    _id: unknown;
    slug?: string;
    name?: string;
    entityType?: string;
  };
  leadRows: GateLeadRow[];
}): ForeignLeadGraftPlanRow | null {
  const grafts = selectForeignLeadGrafts({ entity: input.entity, leadRows: input.leadRows });
  if (grafts.length === 0) return null;

  const graftedRoleAssignmentIds = new Set(grafts.map((row) => row.roleAssignmentId));
  const remainingGateLeadCount = input.leadRows.filter(
    (row) => isGateLead(row) && !graftedRoleAssignmentIds.has(row.roleAssignmentId),
  ).length;

  return {
    entityId: String(input.entity._id),
    slug: input.entity.slug,
    entityName: input.entity.name,
    entityType: input.entity.entityType,
    roleAssignmentIds: [...graftedRoleAssignmentIds],
    personIds: [...new Set(grafts.map((row) => row.personId))],
    graftedLeadNames: [...new Set(grafts.map((row) => String(row.name || '')).filter(Boolean))],
    remainingGateLeadCount,
  };
}

export interface ForeignLeadGraftSummary {
  entitiesScanned: number;
  entitiesChanged: number;
  roleAssignmentsRetired: number;
  entitiesLeftWithoutGateLead: number;
}

export function summarizeForeignLeadGraftRetirement(
  rows: Array<ForeignLeadGraftPlanRow | null>,
): ForeignLeadGraftSummary {
  let entitiesChanged = 0;
  let roleAssignmentsRetired = 0;
  let entitiesLeftWithoutGateLead = 0;
  for (const row of rows) {
    if (!row) continue;
    entitiesChanged += 1;
    roleAssignmentsRetired += row.roleAssignmentIds.length;
    if (row.remainingGateLeadCount === 0) entitiesLeftWithoutGateLead += 1;
  }
  return {
    entitiesScanned: rows.length,
    entitiesChanged,
    roleAssignmentsRetired,
    entitiesLeftWithoutGateLead,
  };
}

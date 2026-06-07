export type DepartmentLeadRepairStatus =
  | 'planned'
  | 'skipped_existing'
  | 'ambiguous'
  | 'no_evidence';

export interface DepartmentLeadRepairEntity {
  id: string;
  slug: string;
  name?: string;
}

export interface DepartmentLeadRepairObservation {
  entityId?: string;
  entityKey?: string;
  field: string;
  value?: unknown;
  sourceName?: string;
  sourceUrl?: string;
  confidence?: number;
  observedAt?: Date | string;
}

export interface DepartmentLeadRepairUser {
  id: string;
  netid?: string;
  email?: string;
  fname?: string;
  lname?: string;
  entityKeys?: string[];
}

export interface DepartmentLeadRepairExistingMember {
  researchEntityId: string;
  userId?: string;
  role: string;
  isCurrentMember?: boolean;
}

export interface DepartmentLeadRepairPlanRow {
  recordId: string;
  slug: string;
  label?: string;
  status: DepartmentLeadRepairStatus;
  role: 'pi';
  userId?: string;
  netid?: string;
  email?: string;
  displayName?: string;
  sourceName?: string;
  sourceUrl?: string;
  confidence?: number;
  evidenceKind?: 'inferred_pi_user_key' | 'faculty_pi_contact';
  existingMemberUserId?: string;
  reason?: string;
  candidateUserIds?: string[];
}

export interface DepartmentLeadRepairPlanReport {
  generatedAt: string;
  scanned: number;
  summary: {
    planned: number;
    skippedExisting: number;
    ambiguous: number;
    noEvidence: number;
  };
  rows: DepartmentLeadRepairPlanRow[];
}

export interface DepartmentLeadRepairApplyOperation {
  updateOne: {
    filter: {
      researchEntityId: string;
      userId: string;
      role: 'pi';
    };
    update: {
      $set: {
        researchEntityId: string;
        userId: string;
        role: 'pi';
        isCurrentMember: true;
        name: string;
        email: string;
        confidence: number;
        sourceUrl: string;
        lastObservedAt: Date;
        'confidenceByField.role': number;
        'confidenceByField.userId': number;
        'fieldProvenance.role.sourceName'?: string;
        'fieldProvenance.role.sourceUrl'?: string;
        'fieldProvenance.role.observedAt': Date;
        'fieldProvenance.userId.sourceName'?: string;
        'fieldProvenance.userId.sourceUrl'?: string;
        'fieldProvenance.userId.observedAt': Date;
      };
      $setOnInsert: {
        joinedAt: Date;
      };
    };
    upsert: true;
  };
}

export interface DepartmentLeadRepairPlanComparison {
  matches: boolean;
  reasons: string[];
}

const LEAD_ROLES = new Set(['pi', 'co-pi', 'director', 'co-director']);

const text = (value: unknown): string => String(value || '').trim();

const normalize = (value: unknown): string => text(value).toLowerCase();

const displayName = (user: DepartmentLeadRepairUser): string =>
  [user.fname, user.lname].map(text).filter(Boolean).join(' ');

function entityObservations(
  entity: DepartmentLeadRepairEntity,
  observations: DepartmentLeadRepairObservation[],
): DepartmentLeadRepairObservation[] {
  return observations.filter((observation) => {
    return text(observation.entityId) === entity.id || text(observation.entityKey) === entity.slug;
  });
}

function currentLeadMember(
  entity: DepartmentLeadRepairEntity,
  members: DepartmentLeadRepairExistingMember[],
): DepartmentLeadRepairExistingMember | undefined {
  return members.find((member) => {
    return (
      member.researchEntityId === entity.id &&
      member.isCurrentMember !== false &&
      LEAD_ROLES.has(normalize(member.role))
    );
  });
}

function findUserByNetid(users: DepartmentLeadRepairUser[], rawValue: unknown) {
  const value = text(rawValue);
  const netid = value.startsWith('netid:') ? value.slice('netid:'.length) : value;
  if (!netid) return [];
  return users.filter(
    (user) =>
      normalize(user.netid) === normalize(netid) ||
      (user.entityKeys || []).some((entityKey) => normalize(entityKey) === normalize(value)),
  );
}

function findUserByEmail(users: DepartmentLeadRepairUser[], rawValue: unknown) {
  const email = normalize(rawValue);
  if (!email) return [];
  return users.filter((user) => normalize(user.email) === email);
}

function findUserByName(users: DepartmentLeadRepairUser[], rawValue: unknown) {
  const name = normalize(rawValue).replace(/\s+/g, ' ');
  if (!name) return [];
  return users.filter((user) => normalize(displayName(user)).replace(/\s+/g, ' ') === name);
}

function rowForUser(args: {
  entity: DepartmentLeadRepairEntity;
  observation: DepartmentLeadRepairObservation;
  user: DepartmentLeadRepairUser;
  evidenceKind: DepartmentLeadRepairPlanRow['evidenceKind'];
}): DepartmentLeadRepairPlanRow {
  return {
    recordId: args.entity.id,
    slug: args.entity.slug,
    label: args.entity.name,
    status: 'planned',
    role: 'pi',
    userId: args.user.id,
    netid: args.user.netid,
    email: args.user.email,
    displayName: displayName(args.user),
    sourceName: args.observation.sourceName,
    sourceUrl: args.observation.sourceUrl,
    confidence: args.observation.confidence,
    evidenceKind: args.evidenceKind,
  };
}

function planFromInferredPiKey(args: {
  entity: DepartmentLeadRepairEntity;
  observations: DepartmentLeadRepairObservation[];
  users: DepartmentLeadRepairUser[];
}): DepartmentLeadRepairPlanRow | null {
  const observation = args.observations.find((row) => row.field === 'inferredPiUserKey');
  if (!observation) return null;
  const matches = findUserByNetid(args.users, observation.value);
  if (matches.length === 1) {
    return rowForUser({
      entity: args.entity,
      observation,
      user: matches[0],
      evidenceKind: 'inferred_pi_user_key',
    });
  }
  return {
    recordId: args.entity.id,
    slug: args.entity.slug,
    label: args.entity.name,
    status: matches.length > 1 ? 'ambiguous' : 'no_evidence',
    role: 'pi',
    sourceName: observation.sourceName,
    sourceUrl: observation.sourceUrl,
    evidenceKind: 'inferred_pi_user_key',
    candidateUserIds: matches.map((user) => user.id),
    reason: matches.length > 1 ? 'inferred PI key matched multiple users' : 'inferred PI key did not match a user',
  };
}

function planFromFacultyPiContact(args: {
  entity: DepartmentLeadRepairEntity;
  observations: DepartmentLeadRepairObservation[];
  users: DepartmentLeadRepairUser[];
}): DepartmentLeadRepairPlanRow | null {
  const roleObservation = args.observations.find(
    (row) => row.field === 'contactRole' && /faculty\s*pi/i.test(text(row.value)),
  );
  if (!roleObservation) return null;
  const emailObservation = args.observations.find((row) => row.field === 'contactEmail');
  const nameObservation = args.observations.find((row) => row.field === 'contactName');
  const matches = emailObservation
    ? findUserByEmail(args.users, emailObservation.value)
    : findUserByName(args.users, nameObservation?.value);
  if (matches.length === 1) {
    return rowForUser({
      entity: args.entity,
      observation: emailObservation || nameObservation || roleObservation,
      user: matches[0],
      evidenceKind: 'faculty_pi_contact',
    });
  }
  return {
    recordId: args.entity.id,
    slug: args.entity.slug,
    label: args.entity.name,
    status: matches.length > 1 ? 'ambiguous' : 'no_evidence',
    role: 'pi',
    sourceName: roleObservation.sourceName,
    sourceUrl: roleObservation.sourceUrl,
    evidenceKind: 'faculty_pi_contact',
    candidateUserIds: matches.map((user) => user.id),
    reason: matches.length > 1 ? 'Faculty PI contact matched multiple users' : 'Faculty PI contact did not match a user',
  };
}

function incrementSummary(
  summary: DepartmentLeadRepairPlanReport['summary'],
  status: DepartmentLeadRepairStatus,
) {
  if (status === 'skipped_existing') summary.skippedExisting += 1;
  else if (status === 'no_evidence') summary.noEvidence += 1;
  else summary[status] += 1;
}

export function buildDepartmentLeadRepairPlan(input: {
  entities: DepartmentLeadRepairEntity[];
  observations: DepartmentLeadRepairObservation[];
  users: DepartmentLeadRepairUser[];
  existingMembers: DepartmentLeadRepairExistingMember[];
  generatedAt?: string;
}): DepartmentLeadRepairPlanReport {
  const summary: DepartmentLeadRepairPlanReport['summary'] = {
    planned: 0,
    skippedExisting: 0,
    ambiguous: 0,
    noEvidence: 0,
  };

  const rows = input.entities.map((entity) => {
    const existing = currentLeadMember(entity, input.existingMembers);
    if (existing) {
      const row: DepartmentLeadRepairPlanRow = {
        recordId: entity.id,
        slug: entity.slug,
        label: entity.name,
        status: 'skipped_existing',
        role: 'pi',
        existingMemberUserId: existing.userId,
        reason: 'entity already has a current lead member',
      };
      incrementSummary(summary, row.status);
      return row;
    }

    const observations = entityObservations(entity, input.observations);
    const row =
      planFromInferredPiKey({ entity, observations, users: input.users }) ||
      planFromFacultyPiContact({ entity, observations, users: input.users }) || {
        recordId: entity.id,
        slug: entity.slug,
        label: entity.name,
        status: 'no_evidence' as const,
        role: 'pi' as const,
        reason: 'no inferred PI key or Faculty PI contact evidence found',
      };
    incrementSummary(summary, row.status);
    return row;
  });

  return {
    generatedAt: input.generatedAt || new Date().toISOString(),
    scanned: input.entities.length,
    summary,
    rows,
  };
}

export function buildDepartmentLeadRepairApplyOperations(
  report: DepartmentLeadRepairPlanReport,
  options: { now?: Date } = {},
): DepartmentLeadRepairApplyOperation[] {
  const now = options.now || new Date();
  return report.rows
    .filter((row) => row.status === 'planned' && row.userId)
    .map((row) => {
      const confidence = typeof row.confidence === 'number' ? row.confidence : 0.7;
      const sourceName = row.sourceName || row.evidenceKind || 'department-lead-repair';
      const sourceUrl = row.sourceUrl || '';
      return {
        updateOne: {
          filter: {
            researchEntityId: row.recordId,
            userId: row.userId as string,
            role: 'pi',
          },
          update: {
            $set: {
              researchEntityId: row.recordId,
              userId: row.userId as string,
              role: 'pi',
              isCurrentMember: true,
              name: row.displayName || '',
              email: row.email || '',
              confidence,
              sourceUrl,
              lastObservedAt: now,
              'confidenceByField.role': confidence,
              'confidenceByField.userId': confidence,
              'fieldProvenance.role.sourceName': sourceName,
              'fieldProvenance.role.sourceUrl': sourceUrl,
              'fieldProvenance.role.observedAt': now,
              'fieldProvenance.userId.sourceName': sourceName,
              'fieldProvenance.userId.sourceUrl': sourceUrl,
              'fieldProvenance.userId.observedAt': now,
            },
            $setOnInsert: {
              joinedAt: now,
            },
          },
          upsert: true,
        },
      };
    });
}

function plannedRowSignature(row: DepartmentLeadRepairPlanRow): string {
  return JSON.stringify({
    recordId: row.recordId,
    slug: row.slug,
    role: row.role,
    userId: row.userId,
    sourceName: row.sourceName || '',
    sourceUrl: row.sourceUrl || '',
    confidence: row.confidence ?? null,
    evidenceKind: row.evidenceKind || '',
  });
}

export function compareDepartmentLeadRepairPlans(
  live: DepartmentLeadRepairPlanReport,
  expected: DepartmentLeadRepairPlanReport,
): DepartmentLeadRepairPlanComparison {
  const reasons: string[] = [];
  if (live.summary.planned !== expected.summary.planned) {
    reasons.push(`planned count changed from ${expected.summary.planned} to ${live.summary.planned}`);
  }
  if (live.summary.ambiguous !== expected.summary.ambiguous) {
    reasons.push(`ambiguous count changed from ${expected.summary.ambiguous} to ${live.summary.ambiguous}`);
  }
  if (live.summary.noEvidence !== expected.summary.noEvidence) {
    reasons.push(`no-evidence count changed from ${expected.summary.noEvidence} to ${live.summary.noEvidence}`);
  }

  const liveRows = live.rows
    .filter((row) => row.status === 'planned')
    .map(plannedRowSignature)
    .sort();
  const expectedRows = expected.rows
    .filter((row) => row.status === 'planned')
    .map(plannedRowSignature)
    .sort();
  if (JSON.stringify(liveRows) !== JSON.stringify(expectedRows)) {
    reasons.push('planned row set changed');
  }

  return { matches: reasons.length === 0, reasons };
}

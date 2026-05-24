import {
  classifyDirectoryCsvRow,
  type DirectoryCsvDecision,
  type DirectoryCsvRow,
} from '../scrapers/sources/yaleDirectoryCsvClassifier';

export interface AuditFacultyMember {
  id: string;
  netid?: string;
  name?: string;
  primaryDepartment?: string;
}

export interface AuditUser {
  id: string;
  netid?: string;
}

export interface AuditResearchEntityMember {
  id: string;
  facultyMemberId?: string;
  userId?: string;
  researchEntityId?: string;
}

export interface AuditResearchEntity {
  id: string;
  name?: string;
  departments?: string[];
}

export interface AuditEntityLinkedRecord {
  id: string;
  researchEntityId?: string;
  researchEntityIds?: string[];
}

export interface YaleDirectoryCoverageAuditInput {
  rows: DirectoryCsvRow[];
  facultyMembers: AuditFacultyMember[];
  users: AuditUser[];
  researchEntityMembers: AuditResearchEntityMember[];
  researchEntities: AuditResearchEntity[];
  paperEntityLinks: AuditEntityLinkedRecord[];
  grants: AuditEntityLinkedRecord[];
  entryPathways: AuditEntityLinkedRecord[];
  accessSignals: AuditEntityLinkedRecord[];
  contactRoutes: AuditEntityLinkedRecord[];
  limitUnits?: number;
}

export interface YaleDirectoryUnitCoverage {
  unit: string;
  school: string;
  counts: {
    denominator: number;
    identity: number;
    membership: number;
    entity: number;
    publications: number;
    grants: number;
    studentActions: number;
  };
  coverage: {
    identityCoverage: number;
    membershipCoverage: number;
    entityCoverage: number;
    publicationCoverage: number;
    grantCoverage: number;
    studentActionCoverage: number;
  };
  missingPeople: number;
  unlinkedPeople: number;
  issueScore: number;
}

export interface YaleDirectoryCoverageAuditResult {
  summary: {
    totalRows: number;
    denominatorRows: number;
    suppressedRows: number;
    decisions: Record<DirectoryCsvDecision, number>;
  };
  topUnitGaps: YaleDirectoryUnitCoverage[];
  missingPeopleUnits: Array<{ unit: string; missingPeople: number; denominator: number }>;
  unlinkedMemberUnits: Array<{ unit: string; unlinkedPeople: number; denominator: number }>;
  sourcePriorityQueues: {
    identityBackfill: YaleDirectoryUnitCoverage[];
    membershipBackfill: YaleDirectoryUnitCoverage[];
    entityBackfill: YaleDirectoryUnitCoverage[];
    studentActionBackfill: YaleDirectoryUnitCoverage[];
  };
}

function rowUnit(row: DirectoryCsvRow): string {
  return row.departmentUnit.trim() || row.department.trim() || row.school.trim() || 'Unknown unit';
}

function pct(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function entityIds(records: AuditEntityLinkedRecord[]): Set<string> {
  const ids = new Set<string>();
  for (const record of records) {
    if (record.researchEntityId) ids.add(String(record.researchEntityId));
    for (const id of record.researchEntityIds || []) ids.add(String(id));
  }
  return ids;
}

function scoreUnit(unit: YaleDirectoryUnitCoverage): number {
  const { denominator } = unit.counts;
  let score = denominator;
  if (unit.coverage.identityCoverage < 0.5) score += 4;
  if (unit.coverage.membershipCoverage < 0.5) score += 4;
  if (unit.coverage.entityCoverage === 0) score += 3;
  if (unit.coverage.studentActionCoverage === 0) score += 3;
  if (unit.coverage.publicationCoverage === 0) score += 1;
  if (unit.coverage.grantCoverage === 0) score += 1;
  return score;
}

export function buildYaleDirectoryCoverageAudit(
  input: YaleDirectoryCoverageAuditInput,
): YaleDirectoryCoverageAuditResult {
  const decisions: Record<DirectoryCsvDecision, number> = {
    AUTO_RESEARCH_PERSON: 0,
    REVIEW_RESEARCH_ADJACENT: 0,
    IDENTITY_ONLY: 0,
    SUPPRESS_NOISE: 0,
  };
  const denominatorRows: DirectoryCsvRow[] = [];
  for (const row of input.rows) {
    const decision = classifyDirectoryCsvRow(row).decision;
    decisions[decision]++;
    if (decision !== 'SUPPRESS_NOISE') denominatorRows.push(row);
  }

  const facultyByNetid = new Map(
    input.facultyMembers
      .filter((member) => member.netid)
      .map((member) => [String(member.netid).toLowerCase(), member]),
  );
  const usersByNetid = new Map(
    input.users.filter((user) => user.netid).map((user) => [String(user.netid).toLowerCase(), user]),
  );
  const membershipsByFaculty = new Map<string, AuditResearchEntityMember[]>();
  const membershipsByUser = new Map<string, AuditResearchEntityMember[]>();
  for (const member of input.researchEntityMembers) {
    if (member.facultyMemberId) {
      const key = String(member.facultyMemberId);
      membershipsByFaculty.set(key, [...(membershipsByFaculty.get(key) || []), member]);
    }
    if (member.userId) {
      const key = String(member.userId);
      membershipsByUser.set(key, [...(membershipsByUser.get(key) || []), member]);
    }
  }
  const entitiesByUnit = new Map<string, AuditResearchEntity[]>();
  for (const entity of input.researchEntities) {
    for (const dept of entity.departments || []) {
      const unit = dept.trim();
      if (!unit) continue;
      entitiesByUnit.set(unit, [...(entitiesByUnit.get(unit) || []), entity]);
    }
  }
  const publicationEntityIds = entityIds(input.paperEntityLinks);
  const grantEntityIds = entityIds(input.grants);
  const studentActionEntityIds = new Set([
    ...entityIds(input.entryPathways),
    ...entityIds(input.accessSignals),
    ...entityIds(input.contactRoutes),
  ]);

  const byUnit = new Map<string, DirectoryCsvRow[]>();
  for (const row of denominatorRows) {
    const unit = rowUnit(row);
    byUnit.set(unit, [...(byUnit.get(unit) || []), row]);
  }

  const units = Array.from(byUnit.entries()).map(([unit, rows]) => {
    const matchedEntityIds = new Set<string>();
    let identity = 0;
    let membership = 0;
    for (const row of rows) {
      const netid = row.netid.toLowerCase();
      const faculty = facultyByNetid.get(netid);
      const user = usersByNetid.get(netid);
      if (faculty || user) identity++;
      const memberRows = [
        ...(faculty?.id ? membershipsByFaculty.get(String(faculty.id)) || [] : []),
        ...(user?.id ? membershipsByUser.get(String(user.id)) || [] : []),
      ];
      if (memberRows.length > 0) membership++;
      for (const member of memberRows) {
        if (member.researchEntityId) matchedEntityIds.add(String(member.researchEntityId));
      }
    }
    for (const entity of entitiesByUnit.get(unit) || []) matchedEntityIds.add(String(entity.id));
    const matchedEntityIdList = Array.from(matchedEntityIds);
    const publications = matchedEntityIdList.filter((id) => publicationEntityIds.has(id)).length;
    const grants = matchedEntityIdList.filter((id) => grantEntityIds.has(id)).length;
    const studentActions = matchedEntityIdList.filter((id) => studentActionEntityIds.has(id)).length;
    const denominator = rows.length;
    const entity = matchedEntityIds.size;
    const result: YaleDirectoryUnitCoverage = {
      unit,
      school: rows.find((row) => row.school.trim())?.school || '',
      counts: {
        denominator,
        identity,
        membership,
        entity,
        publications,
        grants,
        studentActions,
      },
      coverage: {
        identityCoverage: pct(identity, denominator),
        membershipCoverage: pct(membership, denominator),
        entityCoverage: pct(entity, denominator),
        publicationCoverage: pct(publications, Math.max(entity, 1)),
        grantCoverage: pct(grants, Math.max(entity, 1)),
        studentActionCoverage: pct(studentActions, Math.max(entity, 1)),
      },
      missingPeople: denominator - identity,
      unlinkedPeople: denominator - membership,
      issueScore: 0,
    };
    result.issueScore = scoreUnit(result);
    return result;
  });

  units.sort((a, b) => b.issueScore - a.issueScore || b.counts.denominator - a.counts.denominator);
  const limit = input.limitUnits && input.limitUnits > 0 ? input.limitUnits : 25;
  const topUnitGaps = units.slice(0, limit);

  return {
    summary: {
      totalRows: input.rows.length,
      denominatorRows: denominatorRows.length,
      suppressedRows: decisions.SUPPRESS_NOISE,
      decisions,
    },
    topUnitGaps,
    missingPeopleUnits: units
      .filter((unit) => unit.missingPeople > 0)
      .sort((a, b) => b.missingPeople - a.missingPeople)
      .slice(0, limit)
      .map((unit) => ({
        unit: unit.unit,
        missingPeople: unit.missingPeople,
        denominator: unit.counts.denominator,
      })),
    unlinkedMemberUnits: units
      .filter((unit) => unit.unlinkedPeople > 0)
      .sort((a, b) => b.unlinkedPeople - a.unlinkedPeople)
      .slice(0, limit)
      .map((unit) => ({
        unit: unit.unit,
        unlinkedPeople: unit.unlinkedPeople,
        denominator: unit.counts.denominator,
      })),
    sourcePriorityQueues: {
      identityBackfill: units
        .filter((unit) => unit.coverage.identityCoverage < 1)
        .slice(0, limit),
      membershipBackfill: units
        .filter((unit) => unit.coverage.membershipCoverage < 1)
        .slice(0, limit),
      entityBackfill: units.filter((unit) => unit.coverage.entityCoverage === 0).slice(0, limit),
      studentActionBackfill: units
        .filter((unit) => unit.coverage.studentActionCoverage === 0)
        .slice(0, limit),
    },
  };
}

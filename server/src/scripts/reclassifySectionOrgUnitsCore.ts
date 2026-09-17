import type { OrgUnitKind } from '../models/orgUnit';

export interface SectionCandidateRow {
  id: string;
  name: string;
  slug: string;
  kind: OrgUnitKind;
  parentOrgUnitId?: string;
}

export interface SectionReclassificationRow {
  id: string;
  slug: string;
  name: string;
  fromKind: OrgUnitKind;
  parentName: string;
  schoolName: string;
}

export interface SectionReclassificationPlan {
  scanned: number;
  reclassified: SectionReclassificationRow[];
  alreadySection: number;
  cycles: string[];
}

const SCHOOL_ALTITUDE: OrgUnitKind[] = ['SCHOOL', 'DIVISION'];
const DEPARTMENT_ALTITUDE: OrgUnitKind[] = ['DEPARTMENT', 'SECTION'];

/**
 * Plans the one-time correction of the missing section altitude: a `DEPARTMENT`
 * whose parent chain reaches another department before it reaches a school is a
 * section of that department, not a peer of it. Yale's School of Medicine states
 * appointments this way ("Section of Digestive Diseases, Department of Internal
 * Medicine"), and storing both at one kind is what let the department facet list
 * a section as a peer of its own parent.
 *
 * Idempotent: a row already stored as `SECTION` is counted, never re-planned. A
 * parent cycle is reported rather than followed, so a malformed catalog row
 * cannot hang the walk.
 */
export function planSectionReclassification(
  rows: SectionCandidateRow[],
): SectionReclassificationPlan {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const cycles: string[] = [];

  const nearestDepartmentAncestor = (
    row: SectionCandidateRow,
  ): { parent: SectionCandidateRow; school: string } | null => {
    const seen = new Set<string>([row.id]);
    let nearestDepartment: SectionCandidateRow | null = null;
    let parentId = row.parentOrgUnitId;
    while (parentId) {
      if (seen.has(parentId)) {
        cycles.push(row.slug);
        return null;
      }
      seen.add(parentId);
      const parent = byId.get(parentId);
      if (!parent) return null;
      if (SCHOOL_ALTITUDE.includes(parent.kind)) {
        return nearestDepartment ? { parent: nearestDepartment, school: parent.name } : null;
      }
      if (DEPARTMENT_ALTITUDE.includes(parent.kind) && !nearestDepartment)
        nearestDepartment = parent;
      parentId = parent.parentOrgUnitId;
    }
    return nearestDepartment ? { parent: nearestDepartment, school: '' } : null;
  };

  const reclassified: SectionReclassificationRow[] = [];
  let alreadySection = 0;
  for (const row of rows) {
    if (row.kind === 'SECTION') {
      alreadySection += 1;
      continue;
    }
    if (row.kind !== 'DEPARTMENT') continue;
    const ancestor = nearestDepartmentAncestor(row);
    if (!ancestor) continue;
    reclassified.push({
      id: row.id,
      slug: row.slug,
      name: row.name,
      fromKind: row.kind,
      parentName: ancestor.parent.name,
      schoolName: ancestor.school,
    });
  }

  return { scanned: rows.length, reclassified, alreadySection, cycles };
}

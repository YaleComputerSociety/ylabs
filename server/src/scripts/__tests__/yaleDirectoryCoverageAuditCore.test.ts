import { describe, expect, it } from 'vitest';
import { buildYaleDirectoryCoverageAudit } from '../yaleDirectoryCoverageAuditCore';
import type { DirectoryCsvRow } from '../../scrapers/sources/yaleDirectoryCsvClassifier';

const rows: DirectoryCsvRow[] = [
  {
    netid: 'hist01',
    name: 'One, History',
    firstName: 'History',
    lastName: 'One',
    title: 'Professor of History',
    department: 'FASHIS History',
    departmentUnit: 'FASHIS History',
    school: 'Faculty of Arts and Sciences',
    schoolCode: 'FAS',
    physicalLocation: '',
  },
  {
    netid: 'hist02',
    name: 'Two, History',
    firstName: 'History',
    lastName: 'Two',
    title: 'Assistant Professor of History',
    department: 'FASHIS History',
    departmentUnit: 'FASHIS History',
    school: 'Faculty of Arts and Sciences',
    schoolCode: 'FAS',
    physicalLocation: '',
  },
  {
    netid: 'hist03',
    name: 'Three, History',
    firstName: 'History',
    lastName: 'Three',
    title: 'Associate Professor of History',
    department: 'FASHIS History',
    departmentUnit: 'FASHIS History',
    school: 'Faculty of Arts and Sciences',
    schoolCode: 'FAS',
    physicalLocation: '',
  },
  {
    netid: 'ops01',
    name: 'Worker, Facilities',
    firstName: 'Facilities',
    lastName: 'Worker',
    title: 'Custodian',
    department: 'Facilities',
    departmentUnit: 'Facilities Operations',
    school: '',
    schoolCode: '',
    physicalLocation: '',
  },
];

describe('buildYaleDirectoryCoverageAudit', () => {
  it('excludes suppressed rows from denominators and computes unit coverage', () => {
    const result = buildYaleDirectoryCoverageAudit({
      rows,
      facultyMembers: [{ id: 'fm1', netid: 'hist01', name: 'History One', primaryDepartment: 'FASHIS History' }],
      users: [{ id: 'u1', netid: 'hist01' }],
      researchEntityMembers: [{ id: 'm1', facultyMemberId: 'fm1', researchEntityId: 're1' }],
      researchEntities: [{ id: 're1', name: 'History Lab', departments: ['FASHIS History'] }],
      paperEntityLinks: [],
      grants: [],
      entryPathways: [],
      accessSignals: [],
      contactRoutes: [],
      limitUnits: 10,
    });

    expect(result.summary.denominatorRows).toBe(3);
    expect(result.summary.suppressedRows).toBe(1);

    const history = result.topUnitGaps.find((unit) => unit.unit === 'FASHIS History');
    expect(history).toBeTruthy();
    expect(history?.counts.denominator).toBe(3);
    expect(history?.coverage.identityCoverage).toBeCloseTo(1 / 3);
    expect(history?.coverage.membershipCoverage).toBeCloseTo(1 / 3);
    expect(history?.coverage.entityCoverage).toBeGreaterThan(0);
    expect(history?.coverage.studentActionCoverage).toBe(0);
    expect(history?.issueScore).toBeGreaterThanOrEqual(10);
    expect(result.missingPeopleUnits[0].missingPeople).toBe(2);
    expect(result.unlinkedMemberUnits[0].unlinkedPeople).toBe(2);
  });
});

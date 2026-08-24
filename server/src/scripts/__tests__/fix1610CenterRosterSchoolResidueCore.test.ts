import { afterEach, describe, expect, it } from 'vitest';
import {
  buildDepartmentToSchoolMap,
  buildOrgUnitResolverIndex,
  createOrgUnitCanonicalizer,
  resetOrgUnitCanonicalizerCache,
  setOrgUnitCanonicalizerForTesting,
} from '../../scrapers/orgUnitCanonicalization';
import {
  planCenterRosterSchoolResidueRow,
  summarizeCenterRosterSchoolResidue,
} from '../fix1610CenterRosterSchoolResidueCore';

const orgUnitRows = [
  { _id: 'som', slug: 'school-of-medicine', name: 'School of Medicine', kind: 'SCHOOL' as const },
  {
    _id: 'fas',
    slug: 'faculty-of-arts-and-sciences',
    name: 'Faculty of Arts and Sciences',
    kind: 'DIVISION' as const,
  },
  {
    _id: 'neuro',
    slug: 'neuroscience',
    name: 'Neuroscience',
    kind: 'DEPARTMENT' as const,
    parentOrgUnitId: 'som',
  },
  {
    _id: 'phil',
    slug: 'philosophy',
    name: 'Philosophy',
    kind: 'DEPARTMENT' as const,
    parentOrgUnitId: 'fas',
  },
];

function useCanonicalizer(): void {
  setOrgUnitCanonicalizerForTesting(
    createOrgUnitCanonicalizer(
      buildOrgUnitResolverIndex(orgUnitRows),
      buildDepartmentToSchoolMap(orgUnitRows as any),
    ),
  );
}

afterEach(() => {
  setOrgUnitCanonicalizerForTesting(null);
  resetOrgUnitCanonicalizerCache();
});

describe('planCenterRosterSchoolResidueRow', () => {
  it('clears a school/schools value that was never independently asserted and has no corroborating evidence', async () => {
    useCanonicalizer();
    const row = await planCenterRosterSchoolResidueRow({
      id: 'yaffe',
      name: 'Gideon Yaffe - Research',
      school: 'School of Medicine',
      schools: ['School of Medicine'],
      departments: [],
      sourceUrls: ['https://wti.yale.edu/humans/faculty'],
    });
    expect(row).not.toBeNull();
    expect(row?.afterSchool).toBe('');
    expect(row?.afterSchools).toEqual([]);
    expect(row?.update).toEqual({ school: '', schools: [] });
  });

  it('keeps a school derived from the person\'s own current department', async () => {
    useCanonicalizer();
    const row = await planCenterRosterSchoolResidueRow({
      id: 'neuro-person',
      name: 'Someone Real',
      school: 'School of Medicine',
      schools: ['School of Medicine'],
      departments: ['Neuroscience'],
      sourceUrls: ['https://wti.yale.edu/humans/faculty'],
    });
    expect(row).toBeNull();
  });

  it('recovers the correct school when a real profile host corroborates it', async () => {
    useCanonicalizer();
    const row = await planCenterRosterSchoolResidueRow({
      id: 'nandy',
      name: 'Nandy Lab',
      school: 'School of Medicine',
      schools: ['School of Medicine'],
      departments: [],
      sourceUrls: [
        'https://wti.yale.edu/humans/faculty',
        'https://medicine.yale.edu/profile/anirvan-nandy/',
      ],
    });
    expect(row).toBeNull();
  });

  it('never touches an entity with an independently asserted school', async () => {
    useCanonicalizer();
    const row = await planCenterRosterSchoolResidueRow({
      id: 'asserted',
      name: 'Someone Else',
      school: 'School of Medicine',
      schools: ['School of Medicine'],
      departments: [],
      sourceUrls: ['https://wti.yale.edu/humans/faculty'],
      fieldProvenance: {
        school: { sourceName: 'dept-faculty-roster', sourceUrl: 'https://medicine.yale.edu/x' },
      },
    });
    expect(row).toBeNull();
  });

  it('returns null when the recorded school already matches the recomputed value', async () => {
    useCanonicalizer();
    const row = await planCenterRosterSchoolResidueRow({
      id: 'empty-already',
      name: 'Already Fine',
      school: '',
      schools: [],
      departments: [],
      sourceUrls: ['https://wti.yale.edu/humans/faculty'],
    });
    expect(row).toBeNull();
  });
});

describe('summarizeCenterRosterSchoolResidue', () => {
  it('counts changed rows and how many cleared to unset', () => {
    const summary = summarizeCenterRosterSchoolResidue([
      null,
      {
        id: 'a',
        beforeSchool: 'School of Medicine',
        afterSchool: '',
        beforeSchools: ['School of Medicine'],
        afterSchools: [],
        update: { school: '', schools: [] },
      },
      {
        id: 'b',
        beforeSchool: 'School of Medicine',
        afterSchool: 'Faculty of Arts and Sciences',
        beforeSchools: ['School of Medicine'],
        afterSchools: ['Faculty of Arts and Sciences'],
        update: { school: 'Faculty of Arts and Sciences', schools: ['Faculty of Arts and Sciences'] },
      },
    ]);
    expect(summary).toEqual({ scanned: 3, changed: 2, clearedToUnset: 1 });
  });
});

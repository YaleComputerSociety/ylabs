import { afterEach, describe, expect, it } from 'vitest';
import {
  buildOrgUnitResolverIndex,
  createOrgUnitCanonicalizer,
  resetOrgUnitCanonicalizerCache,
  setOrgUnitCanonicalizerForTesting,
} from '../../scrapers/orgUnitCanonicalization';
import {
  SCHOOL_PROFILE_HOST_BACKFILL_SOURCE,
  planSchoolProfileHostRow,
  summarizeSchoolProfileHost,
  type SchoolProfileHostPlanRow,
} from '../backfillSchoolFromProfileHostCore';

const orgUnitRows = [
  { slug: 'school-of-medicine', name: 'School of Medicine', kind: 'SCHOOL' as const },
  { slug: 'school-of-nursing', name: 'School of Nursing', kind: 'SCHOOL' as const },
  {
    slug: 'faculty-of-arts-and-sciences',
    name: 'Faculty of Arts and Sciences',
    kind: 'DIVISION' as const,
  },
  { slug: 'neuroscience', name: 'Neuroscience', kind: 'DEPARTMENT' as const, aliases: ['NSCI'] },
];

const deptToSchool = new Map([['Neuroscience', 'Faculty of Arts and Sciences']]);

function useCanonicalizer(): void {
  setOrgUnitCanonicalizerForTesting(
    createOrgUnitCanonicalizer(buildOrgUnitResolverIndex(orgUnitRows), deptToSchool),
  );
}

const observedAt = new Date('2026-08-23T00:00:00.000Z');

afterEach(() => {
  setOrgUnitCanonicalizerForTesting(null);
  resetOrgUnitCanonicalizerCache();
});

describe('planSchoolProfileHostRow', () => {
  it('resolves the school from a school-subdomain profile host with fresh provenance', async () => {
    useCanonicalizer();
    const row = await planSchoolProfileHostRow(
      {
        id: 'vinetz-lab',
        slug: 'nih-pi-joseph-vinetz',
        name: 'Joseph Vinetz Lab',
        entityType: 'LAB',
        school: '',
        schools: [],
        departments: [],
        websiteUrl: 'https://medicine.yale.edu/profile/joseph-vinetz/',
        sourceUrls: [
          'https://reporter.nih.gov/project-details/11492146',
          'https://medicine.yale.edu/profile/joseph-vinetz/',
        ],
      },
      observedAt,
    );
    expect(row).not.toBeNull();
    expect(row?.afterSchool).toBe('School of Medicine');
    expect(row?.afterSchools).toEqual(['School of Medicine']);
    expect(row?.evidenceUrl).toBe('https://medicine.yale.edu/profile/joseph-vinetz/');
    expect(row?.update.school).toBe('School of Medicine');
    expect(row?.update.schools).toEqual(['School of Medicine']);
    expect((row?.update['fieldProvenance.school'] as { sourceName: string }).sourceName).toBe(
      SCHOOL_PROFILE_HOST_BACKFILL_SOURCE,
    );
    expect(row?.update['confidenceByField.school']).toBe(0.9);
  });

  it('reads the school host from sourceUrls when websiteUrl is not a school subdomain', async () => {
    useCanonicalizer();
    const row = await planSchoolProfileHostRow(
      {
        id: 'feder-lab',
        slug: 'nih-pi-shelli-feder',
        school: '',
        schools: [],
        websiteUrl: 'https://reporter.nih.gov/project-details/11187114',
        sourceUrls: ['https://nursing.yale.edu/faculty-research/faculty-directory/shelli-feder'],
      },
      observedAt,
    );
    expect(row?.afterSchool).toBe('School of Nursing');
    expect(row?.evidenceUrl).toBe(
      'https://nursing.yale.edu/faculty-research/faculty-directory/shelli-feder',
    );
  });

  it('returns null when the entity already carries a school', async () => {
    useCanonicalizer();
    const row = await planSchoolProfileHostRow(
      {
        id: 'has-school',
        school: 'School of Medicine',
        schools: ['School of Medicine'],
        websiteUrl: 'https://medicine.yale.edu/profile/someone/',
      },
      observedAt,
    );
    expect(row).toBeNull();
  });

  it('fails closed when no profile host names a school', async () => {
    useCanonicalizer();
    const row = await planSchoolProfileHostRow(
      {
        id: 'generic-host',
        school: '',
        schools: [],
        websiteUrl: 'https://research.yale.edu/people/someone',
        sourceUrls: ['https://westcampus.yale.edu/someone'],
      },
      observedAt,
    );
    expect(row).toBeNull();
  });
});

describe('summarizeSchoolProfileHost', () => {
  it('counts non-null rows and tallies them by school', () => {
    const rows = [
      { afterSchool: 'School of Medicine' } as SchoolProfileHostPlanRow,
      null,
      { afterSchool: 'School of Medicine' } as SchoolProfileHostPlanRow,
      { afterSchool: 'School of Nursing' } as SchoolProfileHostPlanRow,
    ];
    expect(summarizeSchoolProfileHost(rows)).toEqual({
      scanned: 4,
      changed: 3,
      bySchool: { 'School of Medicine': 2, 'School of Nursing': 1 },
    });
  });
});

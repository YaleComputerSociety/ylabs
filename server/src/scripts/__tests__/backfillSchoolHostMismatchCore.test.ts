import { afterEach, describe, expect, it } from 'vitest';
import {
  buildOrgUnitResolverIndex,
  createOrgUnitCanonicalizer,
  resetOrgUnitCanonicalizerCache,
  setOrgUnitCanonicalizerForTesting,
} from '../../scrapers/orgUnitCanonicalization';
import {
  findMismatchedHostSchool,
  planSchoolHostMismatchRow,
  summarizeSchoolHostMismatch,
} from '../backfillSchoolHostMismatchCore';

const orgUnitRows = [
  { slug: 'law-school', name: 'Law School', kind: 'SCHOOL' as const },
  { slug: 'school-of-medicine', name: 'School of Medicine', kind: 'SCHOOL' as const },
];

function useCanonicalizer(): void {
  setOrgUnitCanonicalizerForTesting(
    createOrgUnitCanonicalizer(buildOrgUnitResolverIndex(orgUnitRows)),
  );
}

afterEach(() => {
  setOrgUnitCanonicalizerForTesting(null);
  resetOrgUnitCanonicalizerCache();
});

describe('findMismatchedHostSchool', () => {
  it('flags a disjoint school with medicine.yale.edu evidence and biomedical content', () => {
    const school = findMismatchedHostSchool({
      id: 'roach-lab',
      school: 'Law School',
      websiteUrl: 'https://medicine.yale.edu/profile/stephen-roach/',
      researchAreas: ['Metabolic Diseases', 'Obesity', 'Diabetes'],
    });
    expect(school).toBe('School of Medicine');
  });

  it('does not flag when the recorded school is not in the disjoint set', () => {
    const school = findMismatchedHostSchool({
      id: 'fas-entity',
      school: 'Faculty of Arts and Sciences',
      websiteUrl: 'https://medicine.yale.edu/cancer/profile/someone/',
      researchAreas: ['Cancer Biology'],
    });
    expect(school).toBeNull();
  });

  it('does not flag when there is no biomedical content on record', () => {
    const school = findMismatchedHostSchool({
      id: 'wrong-website-only',
      school: 'David Geffen School of Drama',
      websiteUrl: 'https://medicine.yale.edu/profile/someone-else/',
      researchAreas: ['Acting', 'Directing'],
    });
    expect(school).toBeNull();
  });

  it('does not flag when the host is not a recognized medical/public-health host', () => {
    const school = findMismatchedHostSchool({
      id: 'unrelated-host',
      school: 'Law School',
      websiteUrl: 'https://law.yale.edu/some-professor',
      researchAreas: ['Metabolic Diseases'],
    });
    expect(school).toBeNull();
  });
});

describe('planSchoolHostMismatchRow', () => {
  it('produces a canonicalized update with fresh provenance', async () => {
    useCanonicalizer();
    const row = await planSchoolHostMismatchRow({
      id: 'roach-lab',
      name: 'Roach Lab',
      school: 'Law School',
      schools: ['Law School'],
      websiteUrl: 'https://medicine.yale.edu/profile/stephen-roach/',
      researchAreas: ['Metabolic Diseases', 'Obesity', 'Diabetes'],
    });
    expect(row).not.toBeNull();
    expect(row?.afterSchool).toBe('School of Medicine');
    expect(row?.afterSchools).toEqual(['School of Medicine']);
    expect(row?.evidenceUrl).toBe('https://medicine.yale.edu/profile/stephen-roach/');
    expect(row?.update.school).toBe('School of Medicine');
    expect((row?.update['fieldProvenance.school'] as { sourceName: string }).sourceName).toBe(
      'school-host-mismatch-backfill',
    );
  });

  it('returns null when nothing is mismatched', async () => {
    useCanonicalizer();
    const row = await planSchoolHostMismatchRow({
      id: 'fine',
      school: 'School of Medicine',
      websiteUrl: 'https://medicine.yale.edu/profile/someone/',
      researchAreas: ['Cardiology'],
    });
    expect(row).toBeNull();
  });
});

describe('summarizeSchoolHostMismatch', () => {
  it('counts only non-null rows as changed', () => {
    const summary = summarizeSchoolHostMismatch([null, { id: 'x' } as any, null]);
    expect(summary).toEqual({ scanned: 3, changed: 1 });
  });
});

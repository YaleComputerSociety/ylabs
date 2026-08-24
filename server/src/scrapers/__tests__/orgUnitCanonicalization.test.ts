import { afterEach, describe, expect, it } from 'vitest';
import {
  applyResearchEntityOrgUnitCanonicalization,
  buildDepartmentToSchoolMap,
  buildOrgUnitResolverIndex,
  createOrgUnitCanonicalizer,
  denoiseOrgUnitValue,
  isDroppedAdministrativeOrgUnit,
  orgUnitMatchKey,
  resetOrgUnitCanonicalizerCache,
  resolveOrgUnitCanonical,
  schoolNameFromProfileHosts,
  setOrgUnitCanonicalizerForTesting,
} from '../orgUnitCanonicalization';

const rows = [
  { slug: 'yale-school-of-medicine', name: 'Yale School of Medicine', kind: 'SCHOOL' as const, aliases: ['YSM', 'School of Medicine'] },
  { slug: 'neuroscience', name: 'Neuroscience', kind: 'DEPARTMENT' as const, aliases: ['NSCI', 'YSM Neuro'] },
  { slug: 'molecular-biophysics-and-biochemistry', name: 'Molecular Biophysics and Biochemistry', kind: 'DEPARTMENT' as const, aliases: ['MB&B', 'Molecular Biophysics & Biochemistry'] },
];

const index = buildOrgUnitResolverIndex(rows);

afterEach(() => {
  resetOrgUnitCanonicalizerCache();
});

describe('orgUnitMatchKey', () => {
  it('normalizes case, punctuation, and ampersands deterministically', () => {
    expect(orgUnitMatchKey('Molecular Biophysics & Biochemistry')).toBe(
      orgUnitMatchKey('molecular biophysics and biochemistry'),
    );
    expect(orgUnitMatchKey('  Neuroscience  ')).toBe('neuroscience');
    expect(orgUnitMatchKey(null)).toBe('');
    expect(orgUnitMatchKey(42)).toBe('');
  });
});

describe('resolveOrgUnitCanonical', () => {
  it('matches name, slug, and aliases to the canonical row', () => {
    expect(resolveOrgUnitCanonical(index, 'Neuroscience')?.name).toBe('Neuroscience');
    expect(resolveOrgUnitCanonical(index, 'NSCI')?.name).toBe('Neuroscience');
    expect(resolveOrgUnitCanonical(index, 'YSM Neuro')?.slug).toBe('neuroscience');
    expect(resolveOrgUnitCanonical(index, 'YSM')?.name).toBe('Yale School of Medicine');
  });

  it('collapses department qualifiers to the canonical department', () => {
    expect(resolveOrgUnitCanonical(index, 'Dept. of Neuroscience')?.name).toBe('Neuroscience');
    expect(resolveOrgUnitCanonical(index, 'Department of Neuroscience')?.name).toBe('Neuroscience');
    expect(resolveOrgUnitCanonical(index, 'Neuroscience Department')?.name).toBe('Neuroscience');
  });

  it('fails closed with null when nothing resolves', () => {
    expect(resolveOrgUnitCanonical(index, 'Department of Wizardry')).toBeNull();
    expect(resolveOrgUnitCanonical(index, '')).toBeNull();
  });

  it('respects the kind filter', () => {
    expect(resolveOrgUnitCanonical(index, 'Neuroscience', ['SCHOOL'])).toBeNull();
    expect(resolveOrgUnitCanonical(index, 'YSM', ['DEPARTMENT'])).toBeNull();
    expect(resolveOrgUnitCanonical(index, 'Neuroscience', ['DEPARTMENT'])?.name).toBe('Neuroscience');
  });
});

describe('createOrgUnitCanonicalizer', () => {
  const canonicalizer = createOrgUnitCanonicalizer(index);

  it('canonicalizes a matched school and keeps an unmatched one raw', () => {
    expect(canonicalizer.canonicalizeSchool('School of Medicine')).toEqual({
      value: 'Yale School of Medicine',
      matched: true,
    });
    expect(canonicalizer.canonicalizeSchool('School of Wizardry')).toEqual({
      value: 'School of Wizardry',
      matched: false,
    });
    expect(canonicalizer.canonicalizeSchool('')).toEqual({ value: '', matched: false });
  });

  it('canonicalizes matched departments, keeps unmatched raw, and dedupes', () => {
    const result = canonicalizer.canonicalizeDepartments([
      'NSCI',
      'YSM Neuro',
      'Molecular Biophysics & Biochemistry',
      'Underwater Basket Weaving',
    ]);
    expect(result.values).toEqual([
      'Neuroscience',
      'Molecular Biophysics and Biochemistry',
      'Underwater Basket Weaving',
    ]);
    expect(result.unmatched).toEqual(['Underwater Basket Weaving']);
    expect(result.dropped).toEqual([]);
  });

  it('drops administrative org units from the department facet', () => {
    const result = canonicalizer.canonicalizeDepartments([
      'NSCI',
      'PRV Provost Administration',
      'PRVAIT Institution for Social and Policy Studies (ISPS)',
      'ADMINISTRATION',
      'SOCIAL SCIENCES',
    ]);
    expect(result.values).toEqual(['Neuroscience']);
    expect(result.dropped).toEqual([
      'PRV Provost Administration',
      'PRVAIT Institution for Social and Policy Studies (ISPS)',
      'ADMINISTRATION',
      'SOCIAL SCIENCES',
    ]);
  });

  it('drops school-name values that leaked into the department array', () => {
    const result = canonicalizer.canonicalizeDepartments([
      'Psychiatry',
      'Yale School of Medicine',
      'YSM',
      'School of Medicine',
      'NSCI',
    ]);
    expect(result.values).toEqual(['Psychiatry', 'Neuroscience']);
    expect(result.unmatched).toEqual(['Psychiatry']);
    expect(result.dropped).toEqual(['Yale School of Medicine', 'YSM', 'School of Medicine']);
  });

  it('keeps a solo school-name department value instead of dropping it to empty', () => {
    const result = canonicalizer.canonicalizeDepartments(['Yale School of Medicine']);
    expect(result.values).toEqual(['Yale School of Medicine']);
    expect(result.dropped).toEqual([]);
  });

  it('strips an HR org-code prefix from an unresolved department instead of showing raw', () => {
    const result = canonicalizer.canonicalizeDepartments(['MEDCCC Medical Oncology']);
    expect(result.values).toEqual(['Medical Oncology']);
    expect(result.unmatched).toEqual(['Medical Oncology']);
    expect(result.dropped).toEqual([]);
  });
});

describe('denoiseOrgUnitValue', () => {
  it('strips a leading all-caps org code when a human name follows', () => {
    expect(denoiseOrgUnitValue('PRVAIT Henry Koerner Center')).toBe('Henry Koerner Center');
    expect(denoiseOrgUnitValue('EASBME BME Faculty')).toBe('BME Faculty');
  });

  it('leaves fully upper-case names and plain hyphenated names untouched', () => {
    expect(denoiseOrgUnitValue('SOCIAL SCIENCES')).toBe('SOCIAL SCIENCES');
    expect(denoiseOrgUnitValue('VETERINARY SCIENCES')).toBe('VETERINARY SCIENCES');
    expect(denoiseOrgUnitValue('RADIATION-DIAGNOSTIC/ONCOLOGY')).toBe(
      'RADIATION-DIAGNOSTIC/ONCOLOGY',
    );
    expect(denoiseOrgUnitValue('PHYSIOLOGY')).toBe('PHYSIOLOGY');
  });
});

describe('isDroppedAdministrativeOrgUnit', () => {
  it('matches administrative units regardless of casing or code prefix', () => {
    expect(isDroppedAdministrativeOrgUnit('PRV Provost Administration')).toBe(true);
    expect(isDroppedAdministrativeOrgUnit('administration')).toBe(true);
    expect(isDroppedAdministrativeOrgUnit('VETERINARY SCIENCES')).toBe(true);
    expect(isDroppedAdministrativeOrgUnit('Neuroscience')).toBe(false);
    expect(isDroppedAdministrativeOrgUnit('Cellular & Molecular Physiology')).toBe(false);
  });
});

describe('applyResearchEntityOrgUnitCanonicalization', () => {
  it('rewrites school and departments in the set and reports unmatched values', async () => {
    setOrgUnitCanonicalizerForTesting(createOrgUnitCanonicalizer(index));
    const set: Record<string, unknown> = {
      school: 'YSM',
      departments: ['Dept. of Neuroscience', 'NSCI', 'Ghost Studies'],
      name: 'Some Lab',
    };
    const result = await applyResearchEntityOrgUnitCanonicalization(set);
    expect(set.school).toBe('Yale School of Medicine');
    expect(set.departments).toEqual(['Neuroscience', 'Ghost Studies']);
    expect(set.name).toBe('Some Lab');
    expect(result.unmatchedSchool).toBeUndefined();
    expect(result.unmatchedDepartments).toEqual(['Ghost Studies']);
  });

  it('leaves the set untouched when neither field is present', async () => {
    setOrgUnitCanonicalizerForTesting(createOrgUnitCanonicalizer(index));
    const set: Record<string, unknown> = { name: 'Some Lab' };
    const result = await applyResearchEntityOrgUnitCanonicalization(set);
    expect(set).toEqual({ name: 'Some Lab' });
    expect(result.unmatchedDepartments).toEqual([]);
  });

  it('derives multi-school schools[] from the merged school + department parents', async () => {
    const deptToSchool = new Map([
      ['Neuroscience', 'Yale School of Medicine'],
      ['Molecular Biophysics and Biochemistry', 'Faculty of Arts and Sciences'],
    ]);
    setOrgUnitCanonicalizerForTesting(createOrgUnitCanonicalizer(index, deptToSchool));
    const set: Record<string, unknown> = { departments: ['NSCI', 'MB&B'] };
    await applyResearchEntityOrgUnitCanonicalization(set, { school: 'School of Medicine' });
    expect(set.departments).toEqual(['Neuroscience', 'Molecular Biophysics and Biochemistry']);
    expect(set.schools).toEqual(['Yale School of Medicine', 'Faculty of Arts and Sciences']);
  });

  it('backfills the empty scalar school from the primary derived school when only departments are set', async () => {
    const deptToSchool = new Map([['Neuroscience', 'Yale School of Medicine']]);
    setOrgUnitCanonicalizerForTesting(createOrgUnitCanonicalizer(index, deptToSchool));
    const set: Record<string, unknown> = { departments: ['NSCI'] };
    await applyResearchEntityOrgUnitCanonicalization(set, { school: '' });
    expect(set.schools).toEqual(['Yale School of Medicine']);
    expect(set.school).toBe('Yale School of Medicine');
  });

  it('does not overwrite an existing scalar school when departments derive a different primary', async () => {
    const deptToSchool = new Map([['Neuroscience', 'Yale School of Medicine']]);
    setOrgUnitCanonicalizerForTesting(createOrgUnitCanonicalizer(index, deptToSchool));
    const set: Record<string, unknown> = { departments: ['NSCI'] };
    await applyResearchEntityOrgUnitCanonicalization(set, { school: 'Faculty of Arts and Sciences' });
    expect(set.school).toBeUndefined();
    expect(set.schools).toEqual(['Faculty of Arts and Sciences', 'Yale School of Medicine']);
  });

  it('derives school and schools[] from a profile host when no school or department resolves', async () => {
    setOrgUnitCanonicalizerForTesting(createOrgUnitCanonicalizer(index));
    const set: Record<string, unknown> = { school: '' };
    await applyResearchEntityOrgUnitCanonicalization(set, { school: '' }, [
      'https://medicine.yale.edu/profile/jane-doe/',
    ]);
    expect(set.school).toBe('Yale School of Medicine');
    expect(set.schools).toEqual(['Yale School of Medicine']);
  });

  it('prefers a department-derived school over the profile host', async () => {
    const deptToSchool = new Map([['Neuroscience', 'Yale School of Medicine']]);
    setOrgUnitCanonicalizerForTesting(createOrgUnitCanonicalizer(index, deptToSchool));
    const set: Record<string, unknown> = { departments: ['NSCI'] };
    await applyResearchEntityOrgUnitCanonicalization(set, { school: '' }, [
      'https://divinity.yale.edu/profile/jane-doe/',
    ]);
    expect(set.school).toBe('Yale School of Medicine');
    expect(set.schools).toEqual(['Yale School of Medicine']);
  });

  it('fails closed when the profile host does not name a school', async () => {
    setOrgUnitCanonicalizerForTesting(createOrgUnitCanonicalizer(index));
    const set: Record<string, unknown> = { school: '' };
    await applyResearchEntityOrgUnitCanonicalization(set, { school: '' }, [
      'https://research.yale.edu/people/jane-doe',
      'https://westcampus.yale.edu/jane-doe',
    ]);
    expect(set.school).toBe('');
    expect(set.schools).toBeUndefined();
  });

  it('defaults departments to the school name when no department resolves for a known school', async () => {
    const rowsWithLawSchool = [
      ...rows,
      { slug: 'law-school', name: 'Law School', kind: 'SCHOOL' as const },
    ];
    setOrgUnitCanonicalizerForTesting(
      createOrgUnitCanonicalizer(buildOrgUnitResolverIndex(rowsWithLawSchool)),
    );
    const set: Record<string, unknown> = { school: 'Law School', departments: [] };
    await applyResearchEntityOrgUnitCanonicalization(set);
    expect(set.school).toBe('Law School');
    expect(set.departments).toEqual(['Law School']);
  });

  it('defaults departments to the host-derived school when the entity carries no department data at all', async () => {
    setOrgUnitCanonicalizerForTesting(createOrgUnitCanonicalizer(index));
    const set: Record<string, unknown> = { school: '' };
    await applyResearchEntityOrgUnitCanonicalization(set, { school: '', departments: [] }, [
      'https://medicine.yale.edu/profile/jane-doe/',
    ]);
    expect(set.school).toBe('Yale School of Medicine');
    expect(set.departments).toEqual(['Yale School of Medicine']);
  });

  it('does not touch departments when a real department already resolved', async () => {
    setOrgUnitCanonicalizerForTesting(createOrgUnitCanonicalizer(index));
    const set: Record<string, unknown> = { school: 'YSM', departments: ['NSCI'] };
    await applyResearchEntityOrgUnitCanonicalization(set);
    expect(set.departments).toEqual(['Neuroscience']);
  });

  it('is idempotent when re-canonicalizing its own school-fallback department on a later pass', async () => {
    setOrgUnitCanonicalizerForTesting(createOrgUnitCanonicalizer(index));
    const first: Record<string, unknown> = { school: 'YSM', departments: [] };
    await applyResearchEntityOrgUnitCanonicalization(first);
    expect(first.departments).toEqual(['Yale School of Medicine']);

    const second: Record<string, unknown> = {
      school: first.school,
      departments: first.departments,
    };
    await applyResearchEntityOrgUnitCanonicalization(second);
    expect(second.departments).toEqual(['Yale School of Medicine']);
  });
});

describe('schoolNameFromProfileHosts', () => {
  it('maps a school subdomain to its school name and ignores generic hosts', () => {
    expect(schoolNameFromProfileHosts(['https://medicine.yale.edu/profile/x/'])).toBe(
      'School of Medicine',
    );
    expect(schoolNameFromProfileHosts(['https://nursing.yale.edu/faculty/x'])).toBe(
      'School of Nursing',
    );
    expect(
      schoolNameFromProfileHosts([
        'https://research.yale.edu/x',
        'https://westcampus.yale.edu/x',
      ]),
    ).toBeNull();
    expect(schoolNameFromProfileHosts([])).toBeNull();
    expect(schoolNameFromProfileHosts(['not a url'])).toBeNull();
  });
});

describe('buildDepartmentToSchoolMap', () => {
  it('walks parentOrgUnitId up to the nearest school, including nested sections', () => {
    const map = buildDepartmentToSchoolMap([
      { _id: 's', slug: 'school-of-medicine', name: 'School of Medicine', kind: 'SCHOOL' },
      { _id: 'd', slug: 'internal-medicine', name: 'Internal Medicine', kind: 'DEPARTMENT', parentOrgUnitId: 's' },
      { _id: 'sec', slug: 'cardiovascular-medicine', name: 'Cardiovascular Medicine', kind: 'DEPARTMENT', parentOrgUnitId: 'd' },
      { _id: 'orphan', slug: 'mystery', name: 'Mystery', kind: 'DEPARTMENT' },
    ]);
    expect(map.get('Internal Medicine')).toBe('School of Medicine');
    expect(map.get('Cardiovascular Medicine')).toBe('School of Medicine');
    expect(map.has('Mystery')).toBe(false);
  });
});

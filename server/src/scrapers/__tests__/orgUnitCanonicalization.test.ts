import { afterEach, describe, expect, it } from 'vitest';
import {
  applyResearchEntityOrgUnitCanonicalization,
  buildOrgUnitResolverIndex,
  createOrgUnitCanonicalizer,
  orgUnitMatchKey,
  resetOrgUnitCanonicalizerCache,
  resolveOrgUnitCanonical,
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
});

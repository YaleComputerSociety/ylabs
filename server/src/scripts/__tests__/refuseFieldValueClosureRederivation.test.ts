import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildOrgUnitResolverIndex,
  createOrgUnitCanonicalizer,
  resetOrgUnitCanonicalizerCache,
  setOrgUnitCanonicalizerForTesting,
} from '../../scrapers/orgUnitCanonicalization';
import { disambiguatorLabels } from '../../utils/researchEntityDisplayNameDisambiguation';
import { planRefuseFieldValueWrite } from '../refuseResearchEntityFieldValue';

const REFUSED_SCHOOL = 'Fixture School of Alpha';
const OTHER_SCHOOL = 'Fixture School of Beta';
const ALPHA_DEPARTMENT = 'Fixture Alpha Studies';
const BETA_DEPARTMENT = 'Fixture Beta Studies';

const orgUnits = [
  { slug: 'fixture-alpha-school', name: REFUSED_SCHOOL, kind: 'SCHOOL' as const, aliases: [] },
  { slug: 'fixture-beta-school', name: OTHER_SCHOOL, kind: 'SCHOOL' as const, aliases: [] },
  { slug: 'fixture-alpha-dept', name: ALPHA_DEPARTMENT, kind: 'DEPARTMENT' as const, aliases: [] },
  { slug: 'fixture-beta-dept', name: BETA_DEPARTMENT, kind: 'DEPARTMENT' as const, aliases: [] },
];

beforeEach(() => {
  setOrgUnitCanonicalizerForTesting(
    createOrgUnitCanonicalizer(
      buildOrgUnitResolverIndex(orgUnits),
      new Map([
        [ALPHA_DEPARTMENT, REFUSED_SCHOOL],
        [BETA_DEPARTMENT, OTHER_SCHOOL],
      ]),
    ),
  );
});

afterEach(() => {
  setOrgUnitCanonicalizerForTesting(null);
  resetOrgUnitCanonicalizerCache();
});

const refuse = (field: string, value: unknown) => ({
  field,
  value,
  rule: 'operator_judgement' as const,
  note: 'synthetic refusal',
  decidedBy: 'synthetic reviewer',
  withdraw: false,
});

function rowAfterWrite(
  row: Record<string, unknown>,
  write: { $set: Record<string, unknown>; $unset?: Record<string, ''> },
): Record<string, unknown> {
  const after: Record<string, unknown> = { ...row };
  for (const field of Object.keys(write.$unset ?? {})) delete after[field];
  for (const [path, value] of Object.entries(write.$set)) {
    if (!path.includes('.')) after[path] = value;
  }
  return after;
}

const cardSchool = (row: Record<string, unknown>): string => disambiguatorLabels(row)[1];

describe('refusing a member of the org-unit closure (#6155)', () => {
  it('removes a refused school from schools so the card stops serving it', async () => {
    const row = {
      _id: 'synthetic-row',
      school: REFUSED_SCHOOL,
      schools: [REFUSED_SCHOOL, OTHER_SCHOOL],
      departments: [BETA_DEPARTMENT],
    };
    expect(cardSchool({ ...row, school: undefined })).toBe(REFUSED_SCHOOL);

    const plan = await planRefuseFieldValueWrite(row, refuse('school', REFUSED_SCHOOL));
    const after = rowAfterWrite(row, plan.write);

    expect(after.school).toBeUndefined();
    expect(after.schools).toEqual([OTHER_SCHOOL]);
    expect(cardSchool(after)).toBe(OTHER_SCHOOL);
    expect(plan.regates).toBe(true);
  });

  it('clears schools when nothing left on the row derives a school', async () => {
    const row = {
      _id: 'synthetic-row',
      school: REFUSED_SCHOOL,
      schools: [REFUSED_SCHOOL],
      departments: [],
    };

    const after = rowAfterWrite(
      row,
      (await planRefuseFieldValueWrite(row, refuse('school', REFUSED_SCHOOL))).write,
    );

    expect(after.schools).toEqual([]);
    expect(cardSchool(after)).toBe('');
  });

  it('repairs a refusal recorded before the fix, whose school is already clear', async () => {
    const row = {
      _id: 'synthetic-row',
      schools: [REFUSED_SCHOOL, OTHER_SCHOOL],
      departments: [BETA_DEPARTMENT],
    };

    const plan = await planRefuseFieldValueWrite(row, refuse('school', REFUSED_SCHOOL));

    expect(plan.clearsStoredValue).toBe(false);
    expect(rowAfterWrite(row, plan.write).schools).toEqual([OTHER_SCHOOL]);
    expect(plan.regates).toBe(true);
  });

  it('leaves the other closure members as stored when the derivation does not change them', async () => {
    const row = {
      _id: 'synthetic-row',
      school: REFUSED_SCHOOL,
      schools: [REFUSED_SCHOOL, OTHER_SCHOOL],
      departments: [BETA_DEPARTMENT],
      orgAffiliationLabels: ['Fixture Center for Synthetic Work'],
    };

    const plan = await planRefuseFieldValueWrite(row, refuse('school', REFUSED_SCHOOL));

    expect(Object.keys(plan.write.$set)).not.toContain('departments');
    expect(Object.keys(plan.write.$set)).not.toContain('orgAffiliationLabels');
    const after = rowAfterWrite(row, plan.write);
    expect(after.departments).toEqual([BETA_DEPARTMENT]);
    expect(after.orgAffiliationLabels).toEqual(['Fixture Center for Synthetic Work']);
  });

  it('keeps a locked closure member as stored', async () => {
    const row = {
      _id: 'synthetic-row',
      school: REFUSED_SCHOOL,
      schools: [REFUSED_SCHOOL, OTHER_SCHOOL],
      departments: [BETA_DEPARTMENT],
      manuallyLockedFields: ['schools'],
    };

    const plan = await planRefuseFieldValueWrite(row, refuse('school', REFUSED_SCHOOL));

    expect(Object.keys(plan.write.$set)).not.toContain('schools');
    expect(plan.closureRederivation).toMatchObject({ lockedFieldsLeftAsStored: ['schools'] });
  });

  it('still derives the refused school from a department the row is appointed in', async () => {
    const row = {
      _id: 'synthetic-row',
      school: REFUSED_SCHOOL,
      schools: [REFUSED_SCHOOL],
      departments: [ALPHA_DEPARTMENT],
    };

    const plan = await planRefuseFieldValueWrite(row, refuse('school', REFUSED_SCHOOL));
    const after = rowAfterWrite(row, plan.write);

    expect(after.school).toBeUndefined();
    expect(after.schools).toEqual([REFUSED_SCHOOL]);
    expect(plan.closureRederivation).toMatchObject({ siblingsCarryingAfter: ['schools'] });
  });

  it('writes nothing to the closure when the refused value is in no member', async () => {
    const row = {
      _id: 'synthetic-row',
      school: OTHER_SCHOOL,
      schools: [OTHER_SCHOOL],
      departments: [BETA_DEPARTMENT],
    };

    const plan = await planRefuseFieldValueWrite(row, refuse('school', REFUSED_SCHOOL));

    expect(plan.closureRederivation.outcome).toBe('closure-does-not-carry-the-value');
    expect(plan.write.$unset).toBeUndefined();
    expect(Object.keys(plan.write.$set)).toEqual(['fieldValueRefusals.school']);
    expect(plan.regates).toBe(false);
  });
});

describe('refusing a field outside the org-unit closure', () => {
  it('clears only the refused field, as before', async () => {
    const row = {
      _id: 'synthetic-row',
      websiteUrl: 'https://fixture.example.org/lab',
      school: OTHER_SCHOOL,
      schools: [OTHER_SCHOOL],
    };

    const plan = await planRefuseFieldValueWrite(
      row,
      refuse('websiteUrl', 'https://fixture.example.org/lab'),
    );

    expect(plan.closureRederivation.outcome).toBe('not-a-closure-member');
    expect(plan.write.$unset).toEqual({ websiteUrl: '' });
    expect(Object.keys(plan.write.$set)).toEqual(['fieldValueRefusals.websiteUrl']);
    expect(plan.regates).toBe(true);
  });

  it('reports a closure it cannot derive from stored fields and writes only the clear', async () => {
    const row = { _id: 'synthetic-row', recentGrantCount: 3, recentGrants: [{ title: 'x' }] };

    const plan = await planRefuseFieldValueWrite(row, refuse('recentGrantCount', 3));

    expect(plan.closureRederivation.outcome).toBe('no-stored-state-derivation');
    expect(plan.write.$unset).toEqual({ recentGrantCount: '' });
    expect(Object.keys(plan.write.$set)).toEqual(['fieldValueRefusals.recentGrantCount']);
  });
});

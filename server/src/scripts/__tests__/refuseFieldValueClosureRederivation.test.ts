import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildOrgUnitResolverIndex,
  createOrgUnitCanonicalizer,
  resetOrgUnitCanonicalizerCache,
  setOrgUnitCanonicalizerForTesting,
} from '../../scrapers/orgUnitCanonicalization';
import {
  NO_RESEARCH_ENTITY_NAME_IDENTITY_AUTHORITY,
  projectFromLog,
  type ProjectFromLogInput,
} from '../../scrapers/entityMaterializer';
import { disambiguatorLabels } from '../../utils/researchEntityDisplayNameDisambiguation';
import { planOrgUnitBackfillRow } from '../backfillResearchEntityOrgUnitsCore';
import { planSchoolProfileHostRow } from '../backfillSchoolFromProfileHostCore';
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
  const refusals: Record<string, unknown> = {};
  for (const [path, value] of Object.entries(write.$set)) {
    if (path.startsWith('fieldValueRefusals.'))
      refusals[path.slice('fieldValueRefusals.'.length)] = value;
    else if (!path.includes('.')) after[path] = value;
  }
  if (Object.keys(refusals).length > 0) after.fieldValueRefusals = refusals;
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

  it('drops a refused school that a department derives, so the card serves the next school', async () => {
    const row = {
      _id: 'synthetic-row',
      school: REFUSED_SCHOOL,
      schools: [REFUSED_SCHOOL, OTHER_SCHOOL],
      departments: [ALPHA_DEPARTMENT, BETA_DEPARTMENT],
    };

    const plan = await planRefuseFieldValueWrite(row, refuse('school', REFUSED_SCHOOL));
    const after = rowAfterWrite(row, plan.write);

    expect(after.school).toBeUndefined();
    expect(after.schools).toEqual([OTHER_SCHOOL]);
    expect(cardSchool(after)).toBe(OTHER_SCHOOL);
    expect(plan.closureRederivation).toMatchObject({ siblingsCarryingAfter: [] });
  });

  it('does not re-fill a refused schools value from the school the row still stores', async () => {
    const row = {
      _id: 'synthetic-row',
      school: REFUSED_SCHOOL,
      schools: [REFUSED_SCHOOL],
      departments: [],
    };

    const plan = await planRefuseFieldValueWrite(row, refuse('schools', [REFUSED_SCHOOL]));
    const after = rowAfterWrite(row, plan.write);

    expect(plan.clearsStoredValue).toBe(true);
    expect(plan.write.$unset).toEqual({ schools: '' });
    expect(after.schools).toBeUndefined();
  });

  it('removes a school refused as one schools entry from school and schools alike', async () => {
    const row = {
      _id: 'synthetic-row',
      school: REFUSED_SCHOOL,
      schools: [REFUSED_SCHOOL],
      departments: [],
    };

    const plan = await planRefuseFieldValueWrite(row, refuse('schools', REFUSED_SCHOOL));
    const after = rowAfterWrite(row, plan.write);

    expect(plan.clearsStoredValue).toBe(false);
    expect(after.school).toBe('');
    expect(after.schools).toEqual([]);
    expect(cardSchool(after)).toBeFalsy();
    expect(plan.regates).toBe(true);
    expect(plan.closureRederivation).toMatchObject({
      outcome: 'rederived',
      siblingsCarryingBefore: ['school', 'schools'],
      siblingsCarryingAfter: [],
    });
  });

  it('removes a school refused as one schools entry when school stores another', async () => {
    const row = {
      _id: 'synthetic-row',
      school: OTHER_SCHOOL,
      schools: [OTHER_SCHOOL, REFUSED_SCHOOL],
      departments: [BETA_DEPARTMENT, ALPHA_DEPARTMENT],
    };

    const plan = await planRefuseFieldValueWrite(row, refuse('schools', REFUSED_SCHOOL));
    const after = rowAfterWrite(row, plan.write);

    expect(after.school).toBe(OTHER_SCHOOL);
    expect(after.schools).toEqual([OTHER_SCHOOL]);
  });

  it('does not re-fill refused organization labels from a department it cannot match', async () => {
    const unmatched = 'Fixture Unmatched Program';
    const row = {
      _id: 'synthetic-row',
      school: OTHER_SCHOOL,
      schools: [OTHER_SCHOOL],
      departments: [BETA_DEPARTMENT, unmatched],
      orgAffiliationLabels: [unmatched],
    };

    const plan = await planRefuseFieldValueWrite(row, refuse('orgAffiliationLabels', [unmatched]));
    const after = rowAfterWrite(row, plan.write);

    expect(plan.write.$unset).toEqual({ orgAffiliationLabels: '' });
    expect(after.orgAffiliationLabels).toBeUndefined();
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

describe('a refused school stays out on the next derivation pass (#6155)', () => {
  const refusedRow = async () => {
    const row = {
      _id: 'a'.repeat(24),
      entityType: 'LAB',
      kind: 'lab',
      school: REFUSED_SCHOOL,
      schools: [REFUSED_SCHOOL, OTHER_SCHOOL],
      departments: [ALPHA_DEPARTMENT, BETA_DEPARTMENT],
    };
    const plan = await planRefuseFieldValueWrite(row, refuse('school', REFUSED_SCHOOL));
    return rowAfterWrite(row, plan.write);
  };

  it('the org-unit backfill does not re-add it from the department', async () => {
    const after = await refusedRow();

    const second = await planOrgUnitBackfillRow({
      id: String(after._id),
      departments: after.departments,
      schools: after.schools,
      fieldValueRefusals: after.fieldValueRefusals,
    });

    expect(second.afterSchools).toEqual([OTHER_SCHOOL]);
    expect(second.update.schools).toBeUndefined();
  });

  it('the org-unit backfill clears a stored school refused as a schools entry', async () => {
    const row = {
      _id: 'synthetic-row',
      school: REFUSED_SCHOOL,
      schools: [REFUSED_SCHOOL],
      departments: [],
    };
    const recorded = await planRefuseFieldValueWrite(row, refuse('schools', REFUSED_SCHOOL));
    const refusals = rowAfterWrite(row, recorded.write).fieldValueRefusals;

    const pass = await planOrgUnitBackfillRow({
      id: String(row._id),
      school: row.school,
      schools: row.schools,
      departments: row.departments,
      fieldValueRefusals: refusals,
    });

    expect(pass.update).toMatchObject({ school: '', schools: [] });
  });

  it('the profile-host school backfill does not re-add it from the host', async () => {
    const hostSchool = 'School of Medicine';
    setOrgUnitCanonicalizerForTesting(
      createOrgUnitCanonicalizer(
        buildOrgUnitResolverIndex([
          { slug: 'fixture-host-school', name: hostSchool, kind: 'SCHOOL' as const, aliases: [] },
        ]),
        new Map(),
      ),
    );
    const row = {
      _id: 'synthetic-row',
      school: hostSchool,
      schools: [hostSchool],
      departments: [],
      websiteUrl: 'https://medicine.yale.edu/profile/synthetic-profile/',
    };
    const after = rowAfterWrite(
      row,
      (await planRefuseFieldValueWrite(row, refuse('school', hostSchool))).write,
    );

    const pass = await planSchoolProfileHostRow(
      {
        id: String(after._id),
        school: after.school,
        schools: after.schools,
        departments: after.departments,
        websiteUrl: after.websiteUrl,
        fieldValueRefusals: after.fieldValueRefusals,
      },
      new Date('2026-01-01T00:00:00.000Z'),
    );

    expect(after.schools).toEqual([]);
    expect(pass).toBeNull();
  });

  it('a materialize resolving the same departments does not re-add it', async () => {
    const after = await refusedRow();
    const departments = [ALPHA_DEPARTMENT, BETA_DEPARTMENT];
    const noop = (async () => undefined) as unknown;

    const result = await projectFromLog('researchEntity', {
      resolved: {
        departments: {
          value: departments,
          confidence: 0.9,
          contributingSources: ['synthetic-roster-source'],
          hasConflict: false,
        },
      },
      nameIdentityAuthority: NO_RESEARCH_ENTITY_NAME_IDENTITY_AUTHORITY,
      manuallyLockedFields: [],
      manualValues: {},
      entityDoc: after,
      materializationObs: [],
      resolverObs: [],
      fullDescriptionShellGated: false,
      now: new Date('2020-01-01T00:00:00.000Z'),
      synthesizeCardDescription: async () => '',
      applyDescriptionResearchAreaDerivation:
        noop as ProjectFromLogInput['applyDescriptionResearchAreaDerivation'],
      applyResearchEntityResearchAreaCanonicalization:
        noop as ProjectFromLogInput['applyResearchEntityResearchAreaCanonicalization'],
    });

    expect(result.set.schools).toEqual([OTHER_SCHOOL]);
    expect(result.set.school ?? '').not.toBe(REFUSED_SCHOOL);
    expect(cardSchool({ ...after, ...result.set })).toBe(OTHER_SCHOOL);
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

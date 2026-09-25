import { describe, expect, it } from 'vitest';
import { ACTIVE_SOURCE_NAMES } from '../../scrapers/seedSources';
import {
  assertInferredSchoolObservation,
  INFERRED_SCHOOL_CONFIDENCE,
} from '../orgUnitSchoolAssertion';

const source = async () => ({ _id: 'src', name: 'x', defaultWeight: 0.9 });

describe('assertInferredSchoolObservation', () => {
  it('asserts school alone, citing the host it read', async () => {
    const batches: unknown[][] = [];
    const result = await assertInferredSchoolObservation(
      {
        sourceName: 'school-profile-host-backfill',
        entityId: '000000000000000000000001',
        entityKey: 'a-lab',
        school: 'School of Medicine',
        evidenceUrl: 'https://medicine.example.edu/profile/someone/',
        confidence: INFERRED_SCHOOL_CONFIDENCE,
      },
      {
        getSource: source,
        append: async (inputs) => {
          batches.push([...inputs]);
          return { inserted: inputs.length, skipped: 0, superseded: 0 };
        },
      },
    );
    expect(result).toEqual({ observed: ['school'] });
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(1);
    expect(batches[0][0]).toMatchObject({
      entityType: 'researchEntity',
      entityKey: 'a-lab',
      field: 'school',
      value: 'School of Medicine',
      sourceUrl: 'https://medicine.example.edu/profile/someone/',
    });
  });

  // `schools` and `orgAffiliationLabels` are computed from `school` and `departments`, so
  // asserting them would record a derived value as though a source had stated it. 1,135 of
  // 1,135 served rows carry `orgAffiliationLabels` with no observation, which is correct.
  it('never asserts the fields canonicalization derives', async () => {
    const batches: Array<Array<{ field: string }>> = [];
    await assertInferredSchoolObservation(
      {
        sourceName: 'school-host-mismatch-backfill',
        entityKey: 'a-lab',
        school: 'School of Medicine',
        evidenceUrl: 'https://medicine.example.edu/profile/someone/',
        confidence: INFERRED_SCHOOL_CONFIDENCE,
      },
      {
        getSource: source,
        append: async (inputs) => {
          batches.push(inputs as Array<{ field: string }>);
          return { inserted: inputs.length, skipped: 0, superseded: 0 };
        },
      },
    );
    const fields = batches.flat().map((observation) => observation.field);
    expect(fields).toEqual(['school']);
    expect(fields).not.toContain('schools');
    expect(fields).not.toContain('orgAffiliationLabels');
  });

  it('asserts nothing without a school, a key, or a citation', async () => {
    const base = {
      sourceName: 'school-profile-host-backfill',
      entityKey: 'a-lab',
      school: 'School of Medicine',
      evidenceUrl: 'https://x.example.edu/p/',
      confidence: INFERRED_SCHOOL_CONFIDENCE,
    };
    for (const override of [{ school: ' ' }, { entityKey: ' ' }, { evidenceUrl: '' }]) {
      expect(await assertInferredSchoolObservation({ ...base, ...override })).toEqual({
        observed: [],
        skipped: 'nothing-to-assert',
      });
    }
  });

  it('reports an unseeded source instead of throwing, so a lane cannot break on it', async () => {
    expect(
      await assertInferredSchoolObservation(
        {
          sourceName: 'not-a-source',
          entityKey: 'a-lab',
          school: 'School of Medicine',
          evidenceUrl: 'https://x.example.edu/p/',
          confidence: INFERRED_SCHOOL_CONFIDENCE,
        },
        { getSource: async () => null },
      ),
    ).toEqual({ observed: [], skipped: 'source-not-registered' });
  });

  it('uses source names the seed actually carries', () => {
    expect(ACTIVE_SOURCE_NAMES).toContain('school-profile-host-backfill');
    expect(ACTIVE_SOURCE_NAMES).toContain('school-host-mismatch-backfill');
  });
});

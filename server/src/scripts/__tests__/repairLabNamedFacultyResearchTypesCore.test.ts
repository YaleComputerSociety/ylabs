import { describe, expect, it } from 'vitest';

import {
  LAB_TYPE_CORRECTIONS,
  LAB_TYPE_CORRECTION_LOCK_FIELD,
  planLabTypeCorrections,
  summarizeLabTypeCorrections,
  type LabTypeCorrectionEntity,
} from '../repairLabNamedFacultyResearchTypesCore';

const correction = LAB_TYPE_CORRECTIONS[0];

const entity = (overrides: Partial<LabTypeCorrectionEntity> = {}): LabTypeCorrectionEntity => ({
  slug: correction.slug,
  name: correction.expectedName,
  entityType: 'FACULTY_RESEARCH_AREA',
  kind: 'individual',
  archived: false,
  manuallyLockedFields: [],
  studentVisibilityTier: 'student_ready',
  ...overrides,
});

const planOne = (overrides: Partial<LabTypeCorrectionEntity> = {}) =>
  planLabTypeCorrections([entity(overrides)], [correction])[0];

describe('planLabTypeCorrections', () => {
  it('plans the type and kind together, since kind is derived from entityType', () => {
    expect(planOne()).toMatchObject({
      outcome: 'plan',
      beforeEntityType: 'FACULTY_RESEARCH_AREA',
      afterEntityType: 'LAB',
      afterKind: 'lab',
      update: { entityType: 'LAB', kind: 'lab' },
    });
  });

  it('locks entityType, without which the next materialization reverts the correction', () => {
    expect(planOne().update?.manuallyLockedFields).toEqual([LAB_TYPE_CORRECTION_LOCK_FIELD]);
  });

  it('preserves any lock the row already carries rather than replacing the array', () => {
    const plan = planOne({ manuallyLockedFields: ['name'] });
    expect(plan.update?.manuallyLockedFields).toEqual(['name', LAB_TYPE_CORRECTION_LOCK_FIELD]);
  });

  it('refuses a row whose name no longer matches, because it is no longer the row that was judged', () => {
    const plan = planOne({ name: 'Ronald Breaker Faculty Research' });
    expect(plan.outcome).toBe('name-changed');
    expect(plan.update).toBeUndefined();
    expect(plan.note).toContain('Ronald Breaker Faculty Research');
  });

  it('refuses a row whose entityType an operator has locked', () => {
    expect(planOne({ manuallyLockedFields: [LAB_TYPE_CORRECTION_LOCK_FIELD] }).outcome).toBe(
      'locked',
    );
  });

  it('reports an already-corrected row rather than rewriting it', () => {
    expect(planOne({ entityType: 'LAB' }).outcome).toBe('already-lab');
  });

  it('refuses an archived row', () => {
    expect(planOne({ archived: true }).outcome).toBe('archived');
  });

  it('reports a slug that no longer exists', () => {
    expect(planLabTypeCorrections([], [correction])[0]).toEqual({
      slug: correction.slug,
      outcome: 'missing',
    });
  });

  it('carries only rows judged individually, and none of the outcomes that are not type corrections', () => {
    const slugs = LAB_TYPE_CORRECTIONS.map((entry) => entry.slug);
    // The three rows with a separate LAB row for the same lab must never appear
    // here: a type flip would mint the duplicate this is meant to repair.
    expect(slugs).not.toContain('dept-eeb-martina-dal-bello');
    expect(slugs).not.toContain('dept-eeb-adalgisa-caccone');
    expect(slugs).not.toContain('dept-nursing-shelli-feder');
    // And the row named after a centre it does not own is a name defect, not a type one.
    expect(slugs).not.toContain('dept-law-natasha-sarin');
    expect(slugs).toHaveLength(8);
  });
});

describe('summarizeLabTypeCorrections', () => {
  it('counts every outcome, so a run that plans nothing is legible rather than silent', () => {
    const rows = planLabTypeCorrections(
      [entity(), entity({ slug: 'other', name: 'Other Lab' })],
      [correction, { slug: 'other', expectedName: 'Different Lab', evidence: 'https://x.test/' }],
    );
    expect(summarizeLabTypeCorrections(rows)).toEqual({
      plan: 1,
      'already-lab': 0,
      missing: 0,
      archived: 0,
      'name-changed': 1,
      locked: 0,
    });
  });
});

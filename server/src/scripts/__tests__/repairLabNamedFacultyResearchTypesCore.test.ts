import { describe, expect, it } from 'vitest';

import {
  LAB_TYPE_CORRECTIONS,
  LAB_TYPE_CORRECTION_REFUSAL_NOTE,
  LAB_TYPE_CORRECTION_REFUSED_BY,
  LAB_TYPE_CORRECTION_REFUSED_FIELD,
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
  // `kind` is no longer written: it is derived from `entityType` and an observed `kind`
  // is refused at ingest since #3380, so asserting it set nothing.
  it('plans the type alone, because kind is derived from it', () => {
    expect(planOne()).toMatchObject({
      outcome: 'plan',
      beforeEntityType: 'FACULTY_RESEARCH_AREA',
      afterEntityType: 'LAB',
      update: { entityType: 'LAB' },
    });
    expect(planOne().update).not.toHaveProperty('kind');
  });

  // Replaces the lock this repair used to take. The lock held `entityType` against every
  // future source including a better one; a refusal rejects one value and stays
  // withdrawable. 8 of the 10 rows carry a live roster assertion of the refused value,
  // so this is what keeps the correction standing (#3362).
  it('refuses the roster value rather than locking the field', () => {
    const update = planOne().update ?? {};
    expect(Object.keys(update)).not.toContain('manuallyLockedFields');
    expect(Object.keys(update)).not.toContain(
      `fieldLockProvenance.${LAB_TYPE_CORRECTION_REFUSED_FIELD}`,
    );
    const refusals = update[`fieldValueRefusals.${LAB_TYPE_CORRECTION_REFUSED_FIELD}`] as Array<
      Record<string, unknown>
    >;
    expect(refusals).toHaveLength(1);
    expect(refusals[0]).toMatchObject({
      rule: 'superseded_by_better_source',
      refusedBy: LAB_TYPE_CORRECTION_REFUSED_BY,
      note: LAB_TYPE_CORRECTION_REFUSAL_NOTE,
      evidenceUrl: correction.evidence,
    });
    expect(refusals[0].refusedAt).toBeInstanceOf(Date);
  });

  // The evidence URL was always recorded in this file and discarded at write time. It is
  // the whole reason the refusal is auditable rather than an assertion of taste.
  it('cites the lab site the correction was judged from', () => {
    const refusals = (planOne().update ?? {})[
      `fieldValueRefusals.${LAB_TYPE_CORRECTION_REFUSED_FIELD}`
    ] as Array<Record<string, unknown>>;
    expect(refusals[0].evidenceUrl).toBe(correction.evidence);
    expect(String(refusals[0].valueKey).toUpperCase()).toContain('FACULTY_RESEARCH_AREA');
  });

  it('keeps a refusal the row already carries at another value', () => {
    const existing = {
      entityType: [
        {
          valueKey: 'entityType:CENTER',
          rule: 'operator_judgement',
          refusedBy: 'someone',
          refusedAt: new Date('2026-01-01'),
          note: '',
        },
      ],
    };
    const refusals = (planOne({ fieldValueRefusals: existing }).update ?? {})[
      `fieldValueRefusals.${LAB_TYPE_CORRECTION_REFUSED_FIELD}`
    ] as Array<Record<string, unknown>>;
    expect(refusals).toHaveLength(2);
    expect(refusals.map((r) => r.valueKey)).toContain('entityType:CENTER');
  });

  it('refuses a row whose name no longer matches, because it is no longer the row that was judged', () => {
    const plan = planOne({ name: 'Ronald Breaker Faculty Research' });
    expect(plan.outcome).toBe('name-changed');
    expect(plan.update).toBeUndefined();
    expect(plan.note).toContain('Ronald Breaker Faculty Research');
  });

  // A pre-existing operator lock still stops the repair: this change removes the lock the
  // repair TAKES, not the repair's respect for one an operator already holds.
  it('refuses a row whose entityType an operator has locked', () => {
    expect(planOne({ manuallyLockedFields: [LAB_TYPE_CORRECTION_REFUSED_FIELD] }).outcome).toBe(
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
    // And the two name defects must never appear here either: one row is named
    // after a centre it co-founded but does not own, and the other's own cited
    // source never calls it a lab, so both need the name repaired, not the type.
    expect(slugs).not.toContain('dept-law-natasha-sarin');
    expect(slugs).not.toContain('yse-faculty-nyeema-harris');
    expect(slugs).toHaveLength(10);
  });

  it('backfills a website only when the row has none, so a real site is never overwritten', () => {
    const withSite = {
      slug: 'x',
      expectedName: 'X Lab',
      evidence: 'https://e.test/',
      websiteUrl: 'https://lab.test/',
    };
    const planned = planLabTypeCorrections([entity({ slug: 'x', name: 'X Lab' })], [withSite])[0];
    expect(planned.update?.websiteUrl).toBe('https://lab.test/');

    const alreadySet = planLabTypeCorrections(
      [entity({ slug: 'x', name: 'X Lab', websiteUrl: 'https://existing.test/' })],
      [withSite],
    )[0];
    expect(alreadySet.update).not.toHaveProperty('websiteUrl');
  });

  it('plans no website write for a correction that supplies none', () => {
    expect(planLabTypeCorrections([entity()], [correction])[0].update).not.toHaveProperty(
      'websiteUrl',
    );
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

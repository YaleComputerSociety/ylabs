import { describe, expect, it } from 'vitest';
import {
  planAreaGraftRemoval,
  planNamesakeGraftCleanup,
  summarizeNamesakeGraftPlans,
} from '../purgeNamesakeGraftResidualsCore';

describe('planAreaGraftRemoval', () => {
  it('removes only the verified graft strings, case-insensitively', () => {
    const result = planAreaGraftRemoval({
      current: ['Algebraic Geometry', 'Fuel Cells', 'Cohomology'],
      removeAreas: ['fuel cells'],
    });
    expect(result.cleaned).toEqual(['Algebraic Geometry', 'Cohomology']);
    expect(result.removed).toEqual(['Fuel Cells']);
    expect(result.changed).toBe(true);
  });

  it('is a no-op when the graft string is no longer present', () => {
    const result = planAreaGraftRemoval({
      current: ['Algebraic Geometry'],
      removeAreas: ['Fuel Cells'],
    });
    expect(result.cleaned).toEqual(['Algebraic Geometry']);
    expect(result.changed).toBe(false);
  });
});

describe('planNamesakeGraftCleanup', () => {
  it('removes grafted areas while leaving the entity own areas untouched', () => {
    const plan = planNamesakeGraftCleanup(
      {
        researchAreas: ['Early Medieval Chinese Literature and Art', 'Hearing Loss and Rehabilitation'],
        fullDescription: "Pauline Lin's research focuses on Early Medieval Chinese Literature and Art.",
      },
      {
        entityId: '000000000000000000000001',
        slug: 'lin-pl98',
        removeAreas: ['Hearing Loss and Rehabilitation'],
      },
    );
    expect(plan.areasAfter).toEqual(['Early Medieval Chinese Literature and Art']);
    expect(plan.removedAreas).toEqual(['Hearing Loss and Rehabilitation']);
    expect(plan.fullDescriptionCleared).toBe(false);
    expect(plan.changed).toBe(true);
  });

  it('clears fullDescription and shortDescription only on an exact match', () => {
    const plan = planNamesakeGraftCleanup(
      {
        researchAreas: ['Internal Medicine'],
        fullDescription: 'The Pei-Yu Chen Lab focuses on research in semiconductor lasers.',
        shortDescription: 'The Pei-Yu Chen Lab investigates semiconductor lasers.',
      },
      {
        entityId: '000000000000000000000002',
        slug: 'nih-pi-pei-yu-chen',
        clearFullDescriptionIfEquals:
          'The Pei-Yu Chen Lab focuses on research in semiconductor lasers.',
        clearShortDescriptionIfEquals: 'The Pei-Yu Chen Lab investigates semiconductor lasers.',
      },
    );
    expect(plan.fullDescriptionCleared).toBe(true);
    expect(plan.shortDescriptionCleared).toBe(true);
    expect(plan.changed).toBe(true);
  });

  it('does not clear a description that already self-corrected (drift)', () => {
    const plan = planNamesakeGraftCleanup(
      {
        fullDescription: 'A since-corrected, different description.',
      },
      {
        entityId: '000000000000000000000003',
        slug: 'some-entity',
        clearFullDescriptionIfEquals: 'The stale grafted description text.',
      },
    );
    expect(plan.fullDescriptionCleared).toBe(false);
    expect(plan.changed).toBe(false);
  });

  it('clears studentDecisionExplanation only on an exact explanation match', () => {
    const plan = planNamesakeGraftCleanup(
      {
        studentDecisionExplanation: {
          explanation: 'Consider reaching out to explore potential opportunities in immunotherapy.',
        },
      },
      {
        entityId: '000000000000000000000005',
        slug: 'faculty-research-area-rex-ying',
        clearStudentDecisionExplanationIfExplanationEquals:
          'Consider reaching out to explore potential opportunities in immunotherapy.',
      },
    );
    expect(plan.studentDecisionExplanationCleared).toBe(true);
    expect(plan.changed).toBe(true);
  });

  it('does not clear studentDecisionExplanation when the explanation no longer matches', () => {
    const plan = planNamesakeGraftCleanup(
      {
        studentDecisionExplanation: { explanation: 'A since-corrected explanation.' },
      },
      {
        entityId: '000000000000000000000006',
        slug: 'faculty-research-area-rex-ying',
        clearStudentDecisionExplanationIfExplanationEquals:
          'Consider reaching out to explore potential opportunities in immunotherapy.',
      },
    );
    expect(plan.studentDecisionExplanationCleared).toBe(false);
    expect(plan.changed).toBe(false);
  });

  it('flags drift when a directive area is no longer present', () => {
    const plan = planNamesakeGraftCleanup(
      { researchAreas: ['Algebraic Geometry'] },
      {
        entityId: '000000000000000000000004',
        slug: 'nsf-pi-junliang-shen',
        removeAreas: ['Fuel Cells'],
      },
    );
    expect(plan.missingRemoveAreas).toEqual(['Fuel Cells']);
    expect(plan.changed).toBe(false);
  });

  it('passes supersedeObservationIds through to the plan for the caller to act on', () => {
    const plan = planNamesakeGraftCleanup(
      { fullDescription: 'The wrong-person text.' },
      {
        entityId: '000000000000000000000007',
        slug: 'fixture-lab-abc12',
        clearFullDescriptionIfEquals: 'The wrong-person text.',
        supersedeObservationIds: ['aaaaaaaaaaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbbbbbbbbbb'],
      },
    );
    expect(plan.supersedeObservationIds).toEqual([
      'aaaaaaaaaaaaaaaaaaaaaaaa',
      'bbbbbbbbbbbbbbbbbbbbbbbb',
    ]);
  });

  it('defaults supersedeObservationIds to an empty array when not directed', () => {
    const plan = planNamesakeGraftCleanup(
      { researchAreas: ['Algebraic Geometry'] },
      { entityId: '000000000000000000000008', slug: 'some-entity' },
    );
    expect(plan.supersedeObservationIds).toEqual([]);
  });
});

describe('summarizeNamesakeGraftPlans', () => {
  it('aggregates counts and drift slugs across plans', () => {
    const plans = [
      planNamesakeGraftCleanup(
        { researchAreas: ['Fuel Cells', 'Algebraic Geometry'] },
        { entityId: '1', slug: 'a', removeAreas: ['Fuel Cells'] },
      ),
      planNamesakeGraftCleanup(
        { researchAreas: ['Algebraic Geometry'] },
        { entityId: '2', slug: 'b', removeAreas: ['Fuel Cells'] },
      ),
    ];
    const summary = summarizeNamesakeGraftPlans(plans);
    expect(summary.considered).toBe(2);
    expect(summary.changed).toBe(1);
    expect(summary.areasRemoved).toBe(1);
    expect(summary.driftSlugs).toEqual(['b']);
  });
});

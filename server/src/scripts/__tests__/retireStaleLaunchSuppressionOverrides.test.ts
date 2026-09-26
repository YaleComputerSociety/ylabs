import { describe, expect, it } from 'vitest';
import {
  isStaleLaunchOverrideObservationField,
  isStaleLaunchOverrideRefusal,
  planStaleLaunchSuppressionOverrideRetirement,
  STALE_LAUNCH_SUPPRESSION_PROSE_PREFIX,
  recordsARouteIn,
} from '../retireStaleLaunchSuppressionOverridesCore';
import {
  assertRetireStaleLaunchSuppressionOverridesApplyAllowed,
  parseRetireStaleLaunchSuppressionOverridesArgs,
} from '../retireStaleLaunchSuppressionOverrides';

const LAUNCH_PROSE = `${STALE_LAUNCH_SUPPRESSION_PROSE_PREFIX} source-backed description exists, but no official student action route, pathway, contact route, posted role, or access signal has been verified.`;

const staleRow = (overrides: Record<string, unknown> = {}) => ({
  archived: false,
  entityType: 'LAB',
  studentVisibilityOverrideTier: 'suppressed',
  studentVisibilityComputedTier: 'student_ready',
  studentVisibilityTier: 'suppressed',
  studentVisibilityReasons: [
    'source_backed_description',
    'concrete_next_step',
    'operator_override',
  ],
  studentVisibilitySuppressionReason: LAUNCH_PROSE,
  ...overrides,
});

describe('planStaleLaunchSuppressionOverrideRetirement', () => {
  it('retires an override whose recorded reasons are all soft enrichment signals', () => {
    const plan = planStaleLaunchSuppressionOverrideRetirement(staleRow());
    expect(isStaleLaunchOverrideRefusal(plan)).toBe(false);
    expect(plan).toMatchObject({
      computedTier: 'student_ready',
      softReasons: ['concrete_next_step', 'source_backed_description'],
    });
  });

  it('reads the computed reasons array as well as the served one', () => {
    const plan = planStaleLaunchSuppressionOverrideRetirement(
      staleRow({
        studentVisibilityReasons: [],
        studentVisibilityComputedReasons: [
          'source_backed_description',
          'concrete_next_step',
          'operator_override',
        ],
      }),
    );
    expect(isStaleLaunchOverrideRefusal(plan)).toBe(false);
  });

  it('is not this cohort when no override is stored', () => {
    expect(
      planStaleLaunchSuppressionOverrideRetirement(
        staleRow({ studentVisibilityOverrideTier: undefined }),
      ),
    ).toBeNull();
    expect(planStaleLaunchSuppressionOverrideRetirement(staleRow({ archived: true }))).toBeNull();
  });

  it('keeps an override the gate would not compute as public anyway', () => {
    const plan = planStaleLaunchSuppressionOverrideRetirement(
      staleRow({ studentVisibilityComputedTier: 'operator_review' }),
    );
    expect(isStaleLaunchOverrideRefusal(plan)).toBe(true);
  });

  it('keeps an override it cannot attribute to the pre-#1802 launch pass', () => {
    const empty = planStaleLaunchSuppressionOverrideRetirement(
      staleRow({ studentVisibilitySuppressionReason: '' }),
    );
    expect(isStaleLaunchOverrideRefusal(empty)).toBe(true);
    const considered = planStaleLaunchSuppressionOverrideRetirement(
      staleRow({
        studentVisibilitySuppressionReason: 'Operator confirmed this group closed in 2024.',
      }),
    );
    expect(isStaleLaunchOverrideRefusal(considered)).toBe(true);
  });

  it('keeps an override backed by a hard blocker', () => {
    const plan = planStaleLaunchSuppressionOverrideRetirement(
      staleRow({
        studentVisibilityReasons: ['source_backed_description', 'missing_lead'],
      }),
    );
    expect(plan).toMatchObject({ refusedBecause: expect.stringContaining('missing_lead') });
  });

  it('keeps an override the repair queue may re-apply on its own', () => {
    const plan = planStaleLaunchSuppressionOverrideRetirement(
      staleRow({
        studentVisibilityReasons: ['source_backed_description', 'research_infrastructure_only'],
      }),
    );
    expect(plan).toMatchObject({
      refusedBecause: expect.stringContaining('research_infrastructure_only'),
    });
  });
});

describe('isStaleLaunchOverrideObservationField', () => {
  it('names the two fields the launch pass wrote', () => {
    expect(isStaleLaunchOverrideObservationField('studentVisibilityOverrideTier')).toBe(true);
    expect(isStaleLaunchOverrideObservationField('studentVisibilitySuppressionReason')).toBe(true);
    expect(isStaleLaunchOverrideObservationField('studentVisibilityTier')).toBe(false);
    expect(isStaleLaunchOverrideObservationField(undefined)).toBe(false);
  });
});

describe('retire-stale-launch-overrides apply guard', () => {
  it('refuses an unscoped apply, because an override is a per-row decision', () => {
    expect(() =>
      assertRetireStaleLaunchSuppressionOverridesApplyAllowed({
        apply: true,
        confirm: true,
        slugs: [],
        selectedCount: 8,
      }),
    ).toThrow(/--slug is required/);
  });

  it('refuses an apply whose confirmation flag is absent', () => {
    expect(() =>
      assertRetireStaleLaunchSuppressionOverridesApplyAllowed({
        apply: true,
        confirm: false,
        slugs: ['ysm-example'],
        selectedCount: 1,
      }),
    ).toThrow(/--confirm-retire-stale-launch-overrides/);
  });

  it('refuses an apply naming a slug the cohort read did not select', () => {
    expect(() =>
      assertRetireStaleLaunchSuppressionOverridesApplyAllowed({
        apply: true,
        confirm: true,
        slugs: ['ysm-example', 'ysm-not-in-cohort'],
        selectedCount: 1,
      }),
    ).toThrow(/Every named slug must be in the retirable cohort/);
  });

  it('allows a confirmed, fully selected apply, and never gates a dry-run', () => {
    expect(() =>
      assertRetireStaleLaunchSuppressionOverridesApplyAllowed({
        apply: true,
        confirm: true,
        slugs: ['ysm-example'],
        selectedCount: 1,
      }),
    ).not.toThrow();
    expect(() =>
      assertRetireStaleLaunchSuppressionOverridesApplyAllowed({
        apply: false,
        confirm: false,
        slugs: [],
        selectedCount: 8,
      }),
    ).not.toThrow();
  });
});

describe('an override is stale only when the row records a route in', () => {
  /**
   * The override claims a student has no way in, so a row that records none is a
   * row the override still describes correctly, whatever its entityType.
   */
  it('refuses a row with no route in, for every entity type', () => {
    for (const entityType of ['CORE_FACILITY', 'INITIATIVE', 'LAB', 'FACULTY_RESEARCH_AREA']) {
      const plan = planStaleLaunchSuppressionOverrideRetirement(
        staleRow({
          entityType,
          studentVisibilityReasons: [
            'source_backed_description',
            'missing_action_evidence',
            'operator_override',
          ],
        }),
      );
      expect(plan).toMatchObject({ refusedBecause: expect.stringContaining('no route in') });
    }
  });

  it('retires a row that records one, for every entity type', () => {
    for (const entityType of ['CORE_FACILITY', 'INITIATIVE', 'LAB', 'FACULTY_RESEARCH_AREA']) {
      const plan = planStaleLaunchSuppressionOverrideRetirement(staleRow({ entityType }));
      expect(isStaleLaunchOverrideRefusal(plan)).toBe(false);
    }
  });

  it('reads a route in positively, so silent reasons hold the override', () => {
    expect(recordsARouteIn(staleRow())).toBe(true);
    expect(
      recordsARouteIn(
        staleRow({ studentVisibilityReasons: [], studentVisibilityComputedReasons: [] }),
      ),
    ).toBe(false);
    expect(
      planStaleLaunchSuppressionOverrideRetirement(
        staleRow({ studentVisibilityReasons: [], studentVisibilityComputedReasons: [] }),
      ),
    ).toMatchObject({ refusedBecause: expect.stringContaining('no route in') });
  });
});

describe('parseRetireStaleLaunchSuppressionOverridesArgs', () => {
  it('defaults to a dry-run and collects repeated slugs', () => {
    expect(
      parseRetireStaleLaunchSuppressionOverridesArgs(['--slug=one', '--slug', 'two', '--slug=one']),
    ).toMatchObject({
      apply: false,
      confirm: false,
      slugs: ['one', 'two'],
    });
  });

  it('refuses an argument it does not recognise rather than ignoring it', () => {
    expect(() => parseRetireStaleLaunchSuppressionOverridesArgs(['--slugs=one'])).toThrow(
      /Unknown/,
    );
  });
});

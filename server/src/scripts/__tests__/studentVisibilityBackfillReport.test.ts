import { describe, expect, it } from 'vitest';

import {
  buildChangedTierSummary,
  buildCollectionReport,
  nextRepairActionForReasons,
  type StudentVisibilityPlannedUpdate,
} from '../studentVisibilityBackfillReport';

const update = (
  overrides: Partial<StudentVisibilityPlannedUpdate>,
): StudentVisibilityPlannedUpdate => ({
  id: 'entity-1',
  label: 'Example Lab',
  currentTier: undefined,
  tier: 'operator_review',
  computedTier: 'operator_review',
  reasons: ['missing_lead'],
  ...overrides,
});

describe('studentVisibilityBackfillReport', () => {
  it('blocks research applies when computed public tiers collapse to zero', () => {
    const report = buildCollectionReport(
      [
        update({ id: 'entity-1', reasons: ['missing_lead', 'missing_action_evidence'] }),
        update({ id: 'entity-2', reasons: ['missing_description'] }),
      ],
      { collectionName: 'research' },
    );

    expect(report.publicCount).toBe(0);
    expect(report.applySafety.safeToApply).toBe(false);
    expect(report.applySafety.recommendation).toBe('repair_source_materialization_first');
    expect(report.applySafety.blockers[0]).toContain('computed public tier count 0');
    expect(report.reasonCounts).toMatchObject({
      missing_lead: 1,
      missing_description: 1,
      missing_action_evidence: 1,
    });
  });

  it('allows credible public-tier distributions', () => {
    const report = buildCollectionReport(
      [
        update({
          id: 'entity-1',
          tier: 'student_ready',
          computedTier: 'student_ready',
          reasons: ['source_backed_description', 'concrete_next_step'],
        }),
        update({
          id: 'entity-2',
          tier: 'limited_but_safe',
          computedTier: 'limited_but_safe',
          reasons: ['source_backed_description', 'missing_action_evidence'],
        }),
      ],
      { collectionName: 'research' },
    );

    expect(report.publicCount).toBe(2);
    expect(report.applySafety).toMatchObject({
      safeToApply: true,
      recommendation: 'apply',
      blockers: [],
    });
  });

  it('flags large current-public collapses even when public count is nonzero', () => {
    const report = buildCollectionReport(
      [
        update({
          id: 'entity-1',
          currentTier: 'student_ready',
          tier: 'operator_review',
          computedTier: 'operator_review',
        }),
        update({
          id: 'entity-2',
          currentTier: 'limited_but_safe',
          tier: 'operator_review',
          computedTier: 'operator_review',
        }),
        update({
          id: 'entity-3',
          currentTier: 'student_ready',
          tier: 'limited_but_safe',
          computedTier: 'limited_but_safe',
        }),
      ],
      { collectionName: 'research', maxPublicCollapseRatio: 0.5 },
    );

    expect(report.currentPublicCount).toBe(3);
    expect(report.publicCount).toBe(1);
    expect(report.applySafety.safeToApply).toBe(false);
    expect(report.applySafety.blockers.join(' ')).toContain('would collapse current public count');
  });

  it('maps reason sets to the highest-leverage repair action', () => {
    expect(nextRepairActionForReasons(['missing_lead', 'missing_description'])).toBe(
      'Attach a source-backed PI, director, or lead member.',
    );
    expect(nextRepairActionForReasons(['missing_action_evidence'])).toBe(
      'Add source-backed access or pathway evidence only if it exists.',
    );
  });

  it('summarizes changed tiers by transition, type, blocker, and repair sample', () => {
    const report = buildCollectionReport(
      [
        update({
          id: 'faculty-1',
          label: 'Avery Stone Research',
          slug: 'faculty-avery-stone',
          entityType: 'FACULTY_RESEARCH_AREA',
          currentTier: 'limited_but_safe',
          tier: 'operator_review',
          computedTier: 'operator_review',
          reasons: ['missing_exploratory_framing'],
        }),
        update({
          id: 'center-1',
          label: 'Synthetic Center',
          slug: 'center-synthetic',
          entityType: 'CENTER',
          currentTier: undefined,
          tier: 'limited_but_safe',
          computedTier: 'limited_but_safe',
          reasons: ['center_affiliation_index'],
        }),
        update({
          id: 'lab-1',
          entityType: 'LAB',
          currentTier: 'student_ready',
          tier: 'student_ready',
          computedTier: 'student_ready',
          reasons: ['source_backed_description'],
        }),
      ],
      { collectionName: 'research', minimumPublicCount: 0 },
    );

    expect(report.changedTierSummary.changedCount).toBe(2);
    expect(report.changedTierSummary.byTransition).toMatchObject({
      'limited_but_safe->operator_review': 1,
      'unset->limited_but_safe': 1,
    });
    expect(report.changedTierSummary.byEntityType).toMatchObject({
      FACULTY_RESEARCH_AREA: 1,
      CENTER: 1,
    });
    expect(report.changedTierSummary.byReason).toMatchObject({
      missing_exploratory_framing: 1,
      center_affiliation_index: 1,
    });
    expect(report.changedTierSummary.samples).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'faculty-1',
          slug: 'faculty-avery-stone',
          label: 'Avery Stone Research',
          entityType: 'FACULTY_RESEARCH_AREA',
          currentTier: 'limited_but_safe',
          tier: 'operator_review',
          computedTier: 'operator_review',
          reasons: ['missing_exploratory_framing'],
          nextRepairAction:
            'Add explicit exploratory contact, faculty supervision, or access evidence before public release.',
        }),
      ]),
    );
    expect(report.changedTierSummary.samples.find((sample) => sample.id === 'lab-1')).toBeUndefined();
  });

  it('limits changed tier samples deterministically', () => {
    const summary = buildChangedTierSummary(
      [
        update({ id: 'b', label: 'B Lab', currentTier: undefined, tier: 'operator_review' }),
        update({
          id: 'a',
          label: 'A Lab',
          currentTier: 'student_ready',
          tier: 'operator_review',
        }),
      ],
      1,
    );

    expect(summary.samples).toHaveLength(1);
    expect(summary.samples[0]).toMatchObject({ id: 'a' });
  });
});

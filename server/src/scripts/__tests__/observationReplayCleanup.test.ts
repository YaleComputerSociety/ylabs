import { describe, expect, it } from 'vitest';
import {
  buildStaleFieldCleanupUpdate,
  buildObservationReplayCandidateFilter,
  normalizeRematerializeTarget,
  parseObservationReplayCleanupArgs,
  validateAcceptedReviewRows,
} from '../observationReplayCleanup';
import { observationSchema } from '../../models/observation';

describe('observationReplayCleanup CLI helpers', () => {
  it('parses dry-run filters', () => {
    expect(
      parseObservationReplayCleanupArgs([
        '--source',
        'lab-microsite-description-llm',
        '--entity-type',
        'researchEntity',
        '--field',
        'fullDescription',
        '--older-than-days',
        '14',
        '--limit',
        '25',
        '--only',
        'faculty-research-area-daniel-prober,faculty-research-area-reina-maruyama',
        '--output',
        '/tmp/review.json',
      ]),
    ).toMatchObject({
      apply: false,
      sourceName: 'lab-microsite-description-llm',
      entityType: 'researchEntity',
      field: 'fullDescription',
      olderThanDays: 14,
      limit: 25,
      only: ['faculty-research-area-daniel-prober', 'faculty-research-area-reina-maruyama'],
      output: '/tmp/review.json',
    });
  });

  it('builds an active-observation candidate filter', () => {
    const filter = buildObservationReplayCandidateFilter({
      sourceName: 'lab-microsite-description-llm',
      entityType: 'researchEntity',
      field: 'fullDescription',
      olderThanDays: 14,
      limit: 25,
      apply: false,
      only: ['faculty-research-area-daniel-prober'],
    });

    expect(filter).toMatchObject({
      sourceName: 'lab-microsite-description-llm',
      entityType: 'researchEntity',
      field: 'fullDescription',
      superseded: { $ne: true },
      entityKey: { $in: ['faculty-research-area-daniel-prober'] },
    });
    expect(filter.observedAt).toBeDefined();
  });

  it('rejects apply files with unaccepted rows', () => {
    expect(() =>
      validateAcceptedReviewRows([
        {
          observationId: 'obs-1',
          status: 'SCRAPER_ALREADY_FIXED',
          acceptedForApply: false,
        },
      ]),
    ).toThrow('No accepted rows found');
  });

  it('parses reviewer metadata for apply runs', () => {
    expect(
      parseObservationReplayCleanupArgs([
        '--apply',
        '--accepted-input',
        '/tmp/accepted.json',
        '--reviewed-by',
        'codex',
      ]),
    ).toMatchObject({
      apply: true,
      acceptedInput: '/tmp/accepted.json',
      reviewedBy: 'codex',
    });
  });

  it('accepts only applyable reviewed rows', () => {
    expect(() =>
      validateAcceptedReviewRows([
        {
          observationId: 'obs-1',
          status: 'SCRAPER_ALREADY_FIXED',
          acceptedForApply: true,
          supersedeObservationIds: ['obs-1'],
          rematerializeTargets: [{ entityType: 'researchEntity', entityKey: 'example-lab' }],
        },
      ]),
    ).not.toThrow();
  });

  it('rejects accepted still-bad scraper rows', () => {
    expect(() =>
      validateAcceptedReviewRows([
        {
          observationId: 'obs-1',
          status: 'SCRAPER_STILL_BAD',
          acceptedForApply: true,
        },
      ]),
    ).toThrow('non-applyable status');
  });

  it('rejects accepted rows with no cleanup or rematerialization work', () => {
    expect(() =>
      validateAcceptedReviewRows([
        {
          observationId: 'obs-1',
          status: 'SCRAPER_ALREADY_FIXED',
          acceptedForApply: true,
          supersedeObservationIds: [],
          rematerializeTargets: [],
        },
      ]),
    ).toThrow('does not include cleanup work');
  });

  it('exposes cleanup audit fields on the Observation schema', () => {
    expect(observationSchema.path('cleanupReason')).toBeTruthy();
    expect(observationSchema.path('cleanupAppliedAt')).toBeTruthy();
    expect(observationSchema.path('cleanupReviewedBy')).toBeTruthy();
  });

  it('builds an unset update only when the materialized field still equals the stale value', () => {
    expect(
      buildStaleFieldCleanupUpdate({
        entity: {
          fullDescription: 'Professor Example is a Professor of Economics at Yale.',
          confidenceByField: { fullDescription: 0.7 },
        },
        field: 'fullDescription',
        staleValue: 'Professor Example is a Professor of Economics at Yale.',
      }),
    ).toEqual({
      $unset: {
        fullDescription: '',
        'confidenceByField.fullDescription': '',
      },
    });
  });

  it('clears stale confidence metadata when the materialized field is already absent', () => {
    expect(
      buildStaleFieldCleanupUpdate({
        entity: {
          confidenceByField: { undergradAccessEvidence: 1 },
        },
        field: 'undergradAccessEvidence',
        staleValue: {
          openToUndergrads: 'yes',
          evidenceQuote: 'Postgraduate Associate',
        },
      }),
    ).toEqual({
      $unset: {
        undergradAccessEvidence: '',
        'confidenceByField.undergradAccessEvidence': '',
      },
    });
  });

  it('does not clear materialized fields that changed or are manually locked', () => {
    expect(
      buildStaleFieldCleanupUpdate({
        entity: {
          fullDescription: 'A clean lab description.',
          confidenceByField: { fullDescription: 0.7 },
        },
        field: 'fullDescription',
        staleValue: 'Professor Example is a Professor of Economics at Yale.',
      }),
    ).toBeNull();

    expect(
      buildStaleFieldCleanupUpdate({
        entity: {
          fullDescription: 'Professor Example is a Professor of Economics at Yale.',
          manuallyLockedFields: ['fullDescription'],
        },
        field: 'fullDescription',
        staleValue: 'Professor Example is a Professor of Economics at Yale.',
      }),
    ).toBeNull();
  });

  it('normalizes rematerialization targets by dropping field-cleanup-only keys', () => {
    expect(
      normalizeRematerializeTarget({
        entityType: 'researchEntity',
        entityKey: 'example-lab',
        field: 'fullDescription',
        staleValue: 'Old value',
      }),
    ).toEqual({
      entityType: 'researchEntity',
      entityKey: 'example-lab',
    });
  });
});

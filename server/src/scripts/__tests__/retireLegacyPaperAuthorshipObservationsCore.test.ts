import { describe, expect, it } from 'vitest';
import {
  buildLegacyPaperAuthorshipObservationRetirementFilter,
  buildLegacyPaperAuthorshipObservationRetirementUpdate,
  summarizeLegacyPaperAuthorshipObservationRetirement,
} from '../retireLegacyPaperAuthorshipObservationsCore';

describe('retireLegacyPaperAuthorshipObservationsCore', () => {
  it('builds the exact legacy paper authorship observation filter', () => {
    expect(buildLegacyPaperAuthorshipObservationRetirementFilter()).toEqual({
      entityType: 'paper',
      field: { $in: ['yaleAuthorIds', 'yaleAuthorNetIds'] },
      superseded: { $ne: true },
      sourceName: { $ne: 'manual' },
    });
  });

  it('summarizes dry-run counts and samples without apply output', () => {
    const summary = summarizeLegacyPaperAuthorshipObservationRetirement({
      apply: false,
      now: new Date('2026-05-25T12:00:00.000Z'),
      compactScholarlyLinkCount: 12,
      targetCount: 2,
      samples: [
        {
          _id: 'obs-1',
          entityId: 'paper-1',
          entityKey: 'doi:10.0000/example',
          field: 'yaleAuthorIds',
          value: ['user-1'],
          sourceName: 'openalex',
          sourceUrl: 'https://example.test/source',
          observedAt: new Date('2026-01-01T00:00:00.000Z'),
        },
      ],
    });

    expect(summary).toEqual({
      generatedAt: '2026-05-25T12:00:00.000Z',
      mode: 'dry-run',
      cleanupReason: 'compact_scholarly_links_materialized_v1',
      compactScholarlyLinkCount: 12,
      targetCount: 2,
      samples: [
        {
          observationId: 'obs-1',
          entityId: 'paper-1',
          entityKey: 'doi:10.0000/example',
          field: 'yaleAuthorIds',
          value: ['user-1'],
          sourceName: 'openalex',
          sourceUrl: 'https://example.test/source',
          observedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      applied: undefined,
      nextStep:
        'Review the target count and samples, then rerun with --apply after confirming compact scholarly links are materialized.',
    });
  });

  it('builds an apply update that only marks cleanup fields', () => {
    const appliedAt = new Date('2026-05-25T12:30:00.000Z');

    expect(buildLegacyPaperAuthorshipObservationRetirementUpdate(appliedAt)).toEqual({
      $set: {
        superseded: true,
        cleanupReason: 'compact_scholarly_links_materialized_v1',
        cleanupAppliedAt: appliedAt,
      },
    });
  });
});

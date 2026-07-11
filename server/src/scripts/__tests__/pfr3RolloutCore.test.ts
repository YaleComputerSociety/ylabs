import { describe, expect, it } from 'vitest';
import {
  assertPathwayIndexRolloutTarget,
  buildContactRouteReviewQueue,
  buildStudentOutreachCountReport,
} from '../pfr3RolloutCore';

describe('PFR-3 rollout core', () => {
  it('builds a deterministic safe review queue without auto-approval or identifiers', () => {
    const queue = buildContactRouteReviewQueue([
      {
        routeType: 'OFFICIAL_APPLICATION',
        url: 'https://example.edu/apply',
        sourceUrl: 'https://example.edu/source',
        contactPolicy: 'OFFICIAL_ROUTE',
        confidence: 0.8,
        priority: 20,
        review: { status: 'pending' },
      },
      {
        routeType: 'FACULTY_EMAIL',
        url: 'mailto:person@example.edu',
        sourceUrl: 'https://example.edu/source',
        contactPolicy: 'FACULTY_CONTACT',
        confidence: 0.99,
      },
      {
        routeType: 'OFFICIAL_APPLICATION',
        url: 'https://example.edu/approved',
        sourceUrl: 'https://example.edu/source',
        contactPolicy: 'OFFICIAL_ROUTE',
        confidence: 1,
        review: { status: 'approved' },
      },
      {
        routeType: 'OFFICIAL_APPLICATION',
        url: 'https://example.edu/apply-2',
        sourceUrl: 'https://example.edu/source-2',
        contactPolicy: 'OFFICIAL_ROUTE',
        confidence: 0.9,
        priority: 50,
      },
    ]);
    expect(queue).toHaveLength(2);
    expect(queue.map((item) => item.destination)).toEqual([
      'https://example.edu/apply-2',
      'https://example.edu/apply',
    ]);
    expect(JSON.stringify(queue)).not.toMatch(/email|personName|researchEntityId|approved/i);
  });

  it('counts official-route attempts separately from reported outcomes', () => {
    expect(
      buildStudentOutreachCountReport([
        {
          deliveryMethod: 'official-route',
          outcome: 'unknown',
          outcomeReportedAt: false,
          count: 4,
        },
        {
          deliveryMethod: 'official-route',
          outcome: 'responded-interested',
          outcomeReportedAt: true,
          count: 2,
        },
        {
          deliveryMethod: 'external-self-reported',
          outcome: 'joined-lab',
          outcomeReportedAt: true,
          count: 1,
        },
      ]),
    ).toEqual({
      totalAttempts: 7,
      officialRouteAttempts: 6,
      confirmedOutcomes: 3,
      selfReportedOutcomes: 1,
      outcomes: { 'responded-interested': 2, 'joined-lab': 1 },
    });
  });

  it('requires an unambiguous remote target and restore point', () => {
    expect(() =>
      assertPathwayIndexRolloutTarget({
        environment: 'beta',
        meiliHost: 'http://localhost:7700',
        indexPrefix: 'beta_',
        restorePoint: 'snapshot-123',
      }),
    ).toThrow(/localhost/);
    expect(() =>
      assertPathwayIndexRolloutTarget({
        environment: 'beta',
        meiliHost: 'https://search.example.test',
        indexPrefix: 'production_',
        restorePoint: 'snapshot-123',
      }),
    ).toThrow(/match/);
    expect(() =>
      assertPathwayIndexRolloutTarget({
        environment: 'production',
        meiliHost: 'https://search.example.test',
        indexPrefix: 'production_',
      }),
    ).toThrow(/RESTORE_POINT/);
    expect(
      assertPathwayIndexRolloutTarget({
        environment: 'beta',
        meiliHost: 'https://search.example.test',
        indexPrefix: 'beta_',
        restorePoint: 'snapshot-2026-07-10',
      }),
    ).toEqual({ environment: 'beta', indexPrefix: 'beta_', restorePoint: 'snapshot-2026-07-10' });
  });
});

import { describe, expect, it } from 'vitest';
import {
  hasRecordEvidence,
  isOfficialApplicationRoute,
  matchesRecordFilter,
  orderContactRoutesForReview,
  reviewProgress,
} from '../AdminAccessReview';
type ContactRoute = Parameters<typeof orderContactRoutesForReview>[0][number];

describe('AdminAccessReview record filters', () => {
  it('detects source evidence through evidence items, ids, source URLs, or source URL', () => {
    expect(hasRecordEvidence({})).toBe(false);
    expect(hasRecordEvidence({ evidenceItems: [{ observationId: 'obs-1' }] })).toBe(true);
    expect(hasRecordEvidence({ sourceEvidenceIds: ['obs-1'] })).toBe(true);
    expect(hasRecordEvidence({ sourceUrl: 'https://example.yale.edu' })).toBe(true);
    expect(hasRecordEvidence({ sourceUrls: [''] })).toBe(false);
  });

  it('does not let unsafe source URLs satisfy evidence completeness filters', () => {
    expect(hasRecordEvidence({ sourceUrl: 'javascript:alert(document.cookie)' })).toBe(false);
    expect(
      hasRecordEvidence({
        sourceUrls: ['data:text/html,<script>alert(1)</script>', 'ftp://example.edu/source'],
      }),
    ).toBe(false);
    expect(
      matchesRecordFilter(
        { sourceUrls: ['javascript:alert(document.cookie)'] },
        'accessSignal',
        'missing-evidence',
      ),
    ).toBe(true);
  });

  it('matches review, evidence, guarded-contact, and archived gaps', () => {
    expect(
      matchesRecordFilter({ review: { status: 'unreviewed' } }, 'entryPathway', 'unreviewed'),
    ).toBe(true);
    expect(matchesRecordFilter({ sourceUrls: [] }, 'accessSignal', 'missing-evidence')).toBe(true);
    expect(
      matchesRecordFilter(
        { visibility: 'AUTHENTICATED', contactPolicy: 'DIRECT_CONTACT_OK' },
        'contactRoute',
        'guarded-contact',
      ),
    ).toBe(true);
    expect(matchesRecordFilter({ archived: true }, 'postedOpportunity', 'archived')).toBe(true);
    expect(matchesRecordFilter({ visibility: 'PUBLIC' }, 'entryPathway', 'guarded-contact')).toBe(
      false,
    );
  });

  it('identifies and prioritizes official application routes without approving them', () => {
    const general: ContactRoute = {
      _id: 'general',
      routeType: 'GENERAL_CONTACT',
      review: { status: 'unreviewed' },
    };
    const official: ContactRoute = {
      _id: 'official',
      routeType: 'OFFICIAL_APPLICATION',
      review: { status: 'unreviewed' },
    };

    expect(isOfficialApplicationRoute(general)).toBe(false);
    expect(isOfficialApplicationRoute(official)).toBe(true);
    expect(matchesRecordFilter(official, 'contactRoute', 'official-application')).toBe(true);
    expect(orderContactRoutesForReview([general, official]).map((route) => route._id)).toEqual([
      'official',
      'general',
    ]);
    expect(official.review?.status).toBe('unreviewed');
  });

  it('reports explicit review progress and excludes untouched records', () => {
    expect(
      reviewProgress([
        { _id: '1', review: { status: 'approved' } },
        { _id: '2', review: { status: 'needs_source' } },
        { _id: '3', review: { status: 'unreviewed' } },
        { _id: '4' },
      ]),
    ).toEqual({ reviewed: 2, total: 4 });
  });
});

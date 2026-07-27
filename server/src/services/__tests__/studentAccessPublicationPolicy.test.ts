import { describe, expect, it } from 'vitest';
import {
  isApprovedPublicContactRoute,
  isStudentPublishablePathway,
  publicPostedOpportunityMongoMatch,
  studentPathwayMongoMatch,
} from '../studentAccessPublicationPolicy';

describe('student access publication policy', () => {
  it('publishes legacy pathways without requiring retroactive review approval', () => {
    expect(
      isStudentPublishablePathway({
        status: 'ACTIVE',
        evidenceStrength: 'MODERATE',
        confidence: 0.7,
        sourceUrls: ['https://research.yale.edu/pathway'],
        review: { status: 'approved' },
      }),
    ).toBe(true);
    expect(
      isStudentPublishablePathway({
        status: 'ACTIVE',
        evidenceStrength: 'MODERATE',
        confidence: 0.7,
        sourceUrls: ['https://research.yale.edu/pathway'],
        review: { status: 'unreviewed' },
      }),
    ).toBe(true);
    expect(
      isStudentPublishablePathway({
        derivationKey: 'faculty-opportunity:64f111111111111111111111',
        status: 'ACTIVE',
        evidenceStrength: 'DIRECT',
        confidence: 1,
        sourceUrls: ['https://research.yale.edu/pathway'],
        review: { status: 'unreviewed' },
      }),
    ).toBe(false);
    expect(
      isStudentPublishablePathway({
        status: 'PLAUSIBLE',
        evidenceStrength: 'WEAK',
        confidence: 0.5,
        sourceUrls: ['https://research.yale.edu/pathway'],
      }),
    ).toBe(false);
    expect(
      isStudentPublishablePathway({
        status: 'ACTIVE',
        evidenceStrength: 'STRONG',
        confidence: 0.9,
        sourceUrls: ['javascript:alert(1)'],
      }),
    ).toBe(false);
  });

  it('keeps opportunity-managed pathways out of generic public pathway queries', () => {
    expect(studentPathwayMongoMatch()).toMatchObject({
      derivationKey: { $not: /^faculty-opportunity:/ },
    });
    expect(studentPathwayMongoMatch()).not.toHaveProperty('review.status');
  });

  it('admits only approved faculty pathways to opportunity-aware Mongo queries', () => {
    expect(studentPathwayMongoMatch({ includeApprovedFacultyOpportunities: true })).toMatchObject({
      $or: [
        { derivationKey: { $not: /^faculty-opportunity:/ } },
        {
          derivationKey: /^faculty-opportunity:/,
          'review.status': 'approved',
        },
      ],
    });
  });

  it('preserves legacy opportunity visibility while gating faculty submissions', () => {
    const now = new Date('2026-07-21T12:00:00.000Z');

    expect(publicPostedOpportunityMongoMatch({ archived: false }, now)).toEqual({
      $or: [
        {
          origin: { $ne: 'FACULTY_SUBMITTED' },
          archived: false,
        },
        {
          origin: 'FACULTY_SUBMITTED',
          archived: false,
          status: { $in: ['OPEN', 'ROLLING'] },
          'review.status': 'approved',
          $or: [{ deadline: { $exists: false } }, { deadline: null }, { deadline: { $gte: now } }],
        },
      ],
    });
  });

  it('requires an admin-approved public route and safe independent source', () => {
    const route = {
      visibility: 'PUBLIC',
      contactPolicy: 'OFFICIAL_ROUTE_PREFERRED',
      url: 'https://research.yale.edu/contact',
      sourceUrl: 'https://research.yale.edu/about',
      review: { status: 'approved' },
    };
    expect(isApprovedPublicContactRoute(route)).toBe(true);
    expect(isApprovedPublicContactRoute({ ...route, review: { status: 'unreviewed' } })).toBe(
      false,
    );
    expect(isApprovedPublicContactRoute({ ...route, url: 'mailto:private@yale.edu' })).toBe(false);
    expect(isApprovedPublicContactRoute({ ...route, sourceUrl: 'http://127.0.0.1/admin' })).toBe(
      false,
    );
  });
});

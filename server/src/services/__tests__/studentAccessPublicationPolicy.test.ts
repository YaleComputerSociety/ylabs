import { describe, expect, it } from 'vitest';
import {
  isApprovedPublicContactRoute,
  isStudentPublishablePathway,
  studentPathwayMongoMatch,
} from '../studentAccessPublicationPolicy';

describe('student access publication policy', () => {
  it('publishes only current, sufficiently evidenced pathways with a public source', () => {
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
      'review.status': 'approved',
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

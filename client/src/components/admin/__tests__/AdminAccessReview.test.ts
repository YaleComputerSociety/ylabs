import { describe, expect, it } from 'vitest';
import { hasRecordEvidence, matchesRecordFilter } from '../AdminAccessReview';

describe('AdminAccessReview record filters', () => {
  it('detects source evidence through evidence items, ids, source URLs, or source URL', () => {
    expect(hasRecordEvidence({})).toBe(false);
    expect(hasRecordEvidence({ evidenceItems: [{ observationId: 'obs-1' }] })).toBe(true);
    expect(hasRecordEvidence({ sourceEvidenceIds: ['obs-1'] })).toBe(true);
    expect(hasRecordEvidence({ sourceUrl: 'https://example.yale.edu' })).toBe(true);
    expect(hasRecordEvidence({ sourceUrls: [''] })).toBe(false);
  });

  it('matches review, evidence, guarded-contact, and archived gaps', () => {
    expect(matchesRecordFilter({ review: { status: 'unreviewed' } }, 'entryPathway', 'unreviewed'))
      .toBe(true);
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
});

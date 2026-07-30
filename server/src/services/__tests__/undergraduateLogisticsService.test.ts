import { describe, expect, it } from 'vitest';
import { toPublicUndergraduateLogistics } from '../undergraduateLogisticsService';

const NOW = new Date('2026-07-14T12:00:00.000Z');

describe('undergraduateLogisticsService public projection', () => {
  it('exposes known source-backed facts without confidence or private provenance', () => {
    const result = toPublicUndergraduateLogistics(
      [
        {
          claimType: 'COMPENSATION',
          status: 'KNOWN',
          value: { modes: ['STIPEND'] },
          sourceName: 'private-scraper-name',
          confidence: 0.51,
          sourceEvidenceIds: ['private-observation-id'],
          sourceUrl: 'https://example.yale.edu/program',
          evidenceExcerpt: 'The program provides a stipend. Contact hidden@yale.edu.',
          observedAt: '2026-07-01T00:00:00.000Z',
          expiresAt: '2027-07-01T00:00:00.000Z',
        } as any,
      ],
      NOW,
    );

    const known = result.claims.find((claim) => claim.claimType === 'COMPENSATION');
    expect(known).toEqual({
      claimType: 'COMPENSATION',
      state: 'known',
      value: { modes: ['STIPEND'] },
      evidence: {
        sourceUrl: 'https://example.yale.edu/program',
        excerpt: 'The program provides a stipend. Contact [email redacted].',
        observedAt: '2026-07-01T00:00:00.000Z',
        expiresAt: '2027-07-01T00:00:00.000Z',
      },
    });
    expect(JSON.stringify(result)).not.toContain('private-scraper-name');
    expect(JSON.stringify(result)).not.toContain('confidence');
    expect(JSON.stringify(result)).not.toContain('private-observation-id');
  });

  it('turns expired known claims into a withheld stale state at read time', () => {
    const result = toPublicUndergraduateLogistics(
      [
        {
          claimType: 'CURRENT_AVAILABILITY',
          status: 'KNOWN',
          value: { status: 'OPEN' },
          sourceUrl: 'https://example.yale.edu/join',
          evidenceExcerpt: 'Applications are currently open.',
          observedAt: '2026-01-01T00:00:00.000Z',
          expiresAt: '2026-03-01T00:00:00.000Z',
        },
      ],
      NOW,
    );

    expect(result.claims.find((claim) => claim.claimType === 'CURRENT_AVAILABILITY')).toEqual({
      claimType: 'CURRENT_AVAILABILITY',
      state: 'stale_under_review',
    });
  });

  it('returns explicit unknown states for every absent claim', () => {
    const result = toPublicUndergraduateLogistics([], NOW);
    expect(result.claims).toHaveLength(5);
    expect(result.claims.every((claim) => claim.state === 'unknown')).toBe(true);
  });

  it('withholds conflicting values and evidence', () => {
    const result = toPublicUndergraduateLogistics(
      [
        {
          claimType: 'MODALITY',
          status: 'CONFLICTING_WITHHELD',
          value: { modes: ['REMOTE'] },
          sourceUrl: 'https://example.yale.edu/join',
          evidenceExcerpt: 'Remote work is possible.',
          observedAt: '2026-07-01T00:00:00.000Z',
          expiresAt: '2027-07-01T00:00:00.000Z',
        },
      ],
      NOW,
    );

    expect(result.claims.find((claim) => claim.claimType === 'MODALITY')).toEqual({
      claimType: 'MODALITY',
      state: 'conflicting_withheld',
    });
  });
});

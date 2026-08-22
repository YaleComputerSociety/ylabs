import { describe, expect, it } from 'vitest';
import { toPublicUndergraduateLogistics } from '../undergraduateLogisticsService';

const NOW = new Date('2026-07-14T12:00:00.000Z');

describe('undergraduateLogisticsService public projection', () => {
  it('exposes known source-backed facts without confidence or private provenance', () => {
    const result = toPublicUndergraduateLogistics(
      [
        {
          type: 'COMPENSATION',
          status: 'KNOWN',
          value: { modes: ['STIPEND'] },
          confidence: 0.51,
          source: {
            name: 'private-scraper-name',
            evidenceIds: ['private-observation-id'],
            url: 'https://example.yale.edu/program',
            excerpt: 'The program provides a stipend. Contact hidden@yale.edu.',
          },
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

  it('withholds a claim whose only evidence is our own site or an index page', () => {
    const result = toPublicUndergraduateLogistics(
      [
        {
          type: 'COMPENSATION',
          status: 'KNOWN',
          value: { modes: ['STIPEND'] },
          source: {
            url: 'https://yalelabs.io/api/research',
            excerpt: 'The program provides a stipend.',
          },
          observedAt: '2026-07-01T00:00:00.000Z',
          expiresAt: '2027-07-01T00:00:00.000Z',
        } as any,
        {
          type: 'CURRENT_AVAILABILITY',
          status: 'KNOWN',
          value: { status: 'OPEN' },
          source: {
            url: 'https://medicine.yale.edu/about/a-to-z-index/lab-websites/',
            excerpt: 'Applications are currently open.',
          },
          observedAt: '2026-07-01T00:00:00.000Z',
          expiresAt: '2027-07-01T00:00:00.000Z',
        } as any,
      ],
      NOW,
    );

    expect(result.claims.find((claim) => claim.claimType === 'COMPENSATION')).toEqual({
      claimType: 'COMPENSATION',
      state: 'unknown',
    });
    expect(result.claims.find((claim) => claim.claimType === 'CURRENT_AVAILABILITY')).toEqual({
      claimType: 'CURRENT_AVAILABILITY',
      state: 'unknown',
    });
  });

  it('turns expired known claims into a withheld stale state at read time', () => {
    const result = toPublicUndergraduateLogistics(
      [
        {
          type: 'CURRENT_AVAILABILITY',
          status: 'KNOWN',
          value: { status: 'OPEN' },
          source: {
            url: 'https://example.yale.edu/join',
            excerpt: 'Applications are currently open.',
          },
          observedAt: '2026-01-01T00:00:00.000Z',
          expiresAt: '2026-03-01T00:00:00.000Z',
        } as any,
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
          type: 'MODALITY',
          status: 'CONFLICTING_WITHHELD',
          value: { modes: ['REMOTE'] },
          source: {
            url: 'https://example.yale.edu/join',
            excerpt: 'Remote work is possible.',
          },
          observedAt: '2026-07-01T00:00:00.000Z',
          expiresAt: '2027-07-01T00:00:00.000Z',
        } as any,
      ],
      NOW,
    );

    expect(result.claims.find((claim) => claim.claimType === 'MODALITY')).toEqual({
      claimType: 'MODALITY',
      state: 'conflicting_withheld',
    });
  });
});

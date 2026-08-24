import { describe, expect, it } from 'vitest';
import {
  publiclyFindableResearcherDisplayName,
  researcherHasPrimaryIdentityLink,
  researcherIsPubliclyFindable,
} from '../researcherFindability';

const primaryLink = {
  kind: 'YALE_OFFICIAL' as const,
  purpose: 'PRIMARY_IDENTITY' as const,
  url: 'https://medicine.yale.edu/profile/ada',
  verifiedAt: new Date('2025-01-01T00:00:00Z'),
  healthStatus: 'HEALTHY' as const,
};

const scholarLink = {
  kind: 'GOOGLE_SCHOLAR' as const,
  purpose: 'SCHOLARLY' as const,
  url: 'https://scholar.google.com/citations?user=abc123',
  verifiedAt: new Date('2025-01-01T00:00:00Z'),
  healthStatus: 'HEALTHY' as const,
};

describe('researcherHasPrimaryIdentityLink', () => {
  it('is true only for a verified primary-identity link', () => {
    expect(researcherHasPrimaryIdentityLink([primaryLink])).toBe(true);
    expect(researcherHasPrimaryIdentityLink([{ ...primaryLink, kind: 'LAB_ABOUT' }])).toBe(true);
  });

  it('does not count scholarly-only links as a primary identity', () => {
    expect(researcherHasPrimaryIdentityLink([scholarLink])).toBe(false);
    expect(researcherHasPrimaryIdentityLink([])).toBe(false);
    expect(researcherHasPrimaryIdentityLink(undefined)).toBe(false);
  });
});

describe('publiclyFindableResearcherDisplayName', () => {
  it('strips a trailing lifespan and rejects names that carry one', () => {
    expect(publiclyFindableResearcherDisplayName('Dr Ada Researcher')).toBe('Dr Ada Researcher');
    expect(publiclyFindableResearcherDisplayName('Jane Doe (1901-1980)')).toBeUndefined();
    expect(publiclyFindableResearcherDisplayName('   ')).toBeUndefined();
    expect(publiclyFindableResearcherDisplayName(undefined)).toBeUndefined();
  });
});

describe('researcherIsPubliclyFindable', () => {
  const base = {
    status: 'ACTIVE' as const,
    displayName: 'Dr Ada Researcher',
    servableHomeCount: 0,
    hasPrimaryIdentityLink: false,
  };

  it('is findable with at least one servable home', () => {
    expect(researcherIsPubliclyFindable({ ...base, servableHomeCount: 1 })).toBe(true);
  });

  it('is findable with no home when a primary identity link exists', () => {
    expect(researcherIsPubliclyFindable({ ...base, hasPrimaryIdentityLink: true })).toBe(true);
  });

  it('is not findable with no home and no primary link', () => {
    expect(researcherIsPubliclyFindable(base)).toBe(false);
  });

  it('excludes DEPARTED and archived researchers even with evidence', () => {
    expect(
      researcherIsPubliclyFindable({ ...base, servableHomeCount: 2, status: 'DEPARTED' }),
    ).toBe(false);
    expect(
      researcherIsPubliclyFindable({ ...base, servableHomeCount: 2, archived: true }),
    ).toBe(false);
  });

  it('excludes lifespan-carrying display names', () => {
    expect(
      researcherIsPubliclyFindable({
        ...base,
        servableHomeCount: 2,
        displayName: 'Jane Doe (1901-1980)',
      }),
    ).toBe(false);
  });
});

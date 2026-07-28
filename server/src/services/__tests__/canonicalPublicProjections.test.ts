import mongoose from 'mongoose';
import { describe, expect, it } from 'vitest';
import {
  MAX_PUBLIC_DISCOVERY_LEADS,
  MAX_PUBLIC_DISCOVERY_OPPORTUNITY_COUNT,
  MAX_PUBLIC_EVIDENCE_ITEMS,
  MAX_PUBLIC_PERSON_NAME_LENGTH,
  RESEARCH_ENTITY_DISCOVERY_RECONCILIATION_INTERVAL_MS,
  RESEARCH_ENTITY_DISCOVERY_STALENESS_BOUND_MS,
  buildResearchEntityDiscoveryProjection,
  researchEntityDiscoveryFreshness,
  researchEntityDiscoveryRecomputeTriggers,
  shouldRecomputeResearchEntityDiscovery,
  toPublicEvidenceClaimDtos,
  toPublicPersonDto,
} from '../canonicalPublicProjections';

const now = new Date('2026-07-27T12:00:00.000Z');
const personId = new mongoose.Types.ObjectId('507f191e810c19729de86101');

function healthyProfileLink(kind: string, purpose: string, url: string): Record<string, unknown> {
  return {
    kind,
    purpose,
    url,
    verifiedAt: new Date('2026-07-20T12:00:00.000Z'),
    healthStatus: 'HEALTHY',
  };
}

describe('canonical public projections', () => {
  it('selects one primary profile and a bounded researcher-profile array by precedence', () => {
    const dto = toPublicPersonDto(
      {
        _id: personId,
        displayName: 'Grace Hopper',
        status: 'ACTIVE',
        archived: false,
        accountId: new mongoose.Types.ObjectId(),
        identifiers: { orcid: '9999-9999-9999-9994' },
        email: 'private@yale.edu',
        profileLinks: [
          healthyProfileLink(
            'LAB_ABOUT',
            'PRIMARY_IDENTITY',
            'https://example.edu/lab/people/grace',
          ),
          healthyProfileLink(
            'YALE_OFFICIAL',
            'PRIMARY_IDENTITY',
            'https://engineering.yale.edu/profile/grace',
          ),
          healthyProfileLink('ORCID', 'SCHOLARLY', 'https://orcid.org/9999-9999-9999-9994/'),
          healthyProfileLink(
            'GOOGLE_SCHOLAR',
            'SCHOLARLY',
            'https://scholar.google.com/citations?hl=en&user=abcdefghijkl',
          ),
        ],
      },
      { now },
    );

    expect(dto).toEqual({
      id: personId.toHexString(),
      displayName: 'Grace Hopper',
      primaryProfile: {
        kind: 'YALE_OFFICIAL',
        label: 'Yale profile',
        url: 'https://engineering.yale.edu/profile/grace',
      },
      researchProfiles: [
        {
          kind: 'GOOGLE_SCHOLAR',
          label: 'Google Scholar',
          url: 'https://scholar.google.com/citations?user=abcdefghijkl',
        },
        {
          kind: 'ORCID',
          label: 'ORCID',
          url: 'https://orcid.org/9999-9999-9999-9994',
        },
      ],
    });
    expect(dto).not.toHaveProperty('accountId');
    expect(dto).not.toHaveProperty('identifiers');
    expect(dto).not.toHaveProperty('email');
  });

  it('fails closed for departed people and corroborates unknown people with a current role', () => {
    const unknown = {
      _id: personId,
      displayName: 'Unknown Status',
      status: 'UNKNOWN',
      archived: false,
      profileLinks: [],
    };

    expect(toPublicPersonDto(unknown, { now })).toBeUndefined();
    expect(toPublicPersonDto(unknown, { now, hasCurrentApprovedRole: true })).toMatchObject({
      id: personId.toHexString(),
      displayName: 'Unknown Status',
    });
    expect(
      toPublicPersonDto({ ...unknown, status: 'DEPARTED' }, { now, hasCurrentApprovedRole: true }),
    ).toBeUndefined();
    expect(
      toPublicPersonDto(
        { ...unknown, status: 'ACTIVE', archived: true },
        { now, hasCurrentApprovedRole: true },
      ),
    ).toBeUndefined();
  });

  it('omits unavailable, future-verified, malformed, and private-host profile links', () => {
    const dto = toPublicPersonDto(
      {
        _id: personId,
        displayName: 'Safe Person',
        status: 'ACTIVE',
        archived: false,
        profileLinks: [
          {
            ...healthyProfileLink(
              'YALE_OFFICIAL',
              'PRIMARY_IDENTITY',
              'https://medicine.yale.edu/profile/safe',
            ),
            healthStatus: 'UNAVAILABLE',
          },
          {
            ...healthyProfileLink(
              'GOOGLE_SCHOLAR',
              'SCHOLARLY',
              'https://scholar.google.com/citations?user=abcdefghijkl',
            ),
            verifiedAt: new Date('2026-08-01T00:00:00.000Z'),
          },
          healthyProfileLink('ORCID', 'SCHOLARLY', 'https://localhost/orcid'),
        ],
      },
      { now },
    );

    expect(dto).toEqual({
      id: personId.toHexString(),
      displayName: 'Safe Person',
      researchProfiles: [],
    });
  });

  it('bounds and redacts public person text', () => {
    const dto = toPublicPersonDto(
      {
        _id: personId,
        displayName: `Reach me at private@yale.edu ${'x'.repeat(400)}`,
        status: 'ACTIVE',
        archived: false,
        profileLinks: [],
      },
      { now },
    );

    expect(dto?.displayName).not.toContain('private@yale.edu');
    expect(dto?.displayName.length).toBeLessThanOrEqual(MAX_PUBLIC_PERSON_NAME_LENGTH);
  });

  it('projects only active public evidence metadata within the item bound', () => {
    const safeClaim = {
      predicate: 'ENTITY_HAS_DESCRIPTION',
      observedAt: new Date('2026-07-26T00:00:00.000Z'),
      confidence: 0.9,
      sensitivity: 'PUBLIC',
      status: 'ACTIVE',
      value: { private: 'raw claim value' },
      excerpt: 'private@yale.edu',
      sourceDocumentId: new mongoose.Types.ObjectId(),
      diagnostics: { reviewNote: 'private' },
    };
    const claims = [
      { ...safeClaim, sensitivity: 'ADMIN_ONLY' },
      { ...safeClaim, status: 'REJECTED' },
      ...Array.from({ length: MAX_PUBLIC_EVIDENCE_ITEMS + 5 }, () => ({ ...safeClaim })),
    ];

    const result = toPublicEvidenceClaimDtos(claims, now);

    expect(result).toHaveLength(MAX_PUBLIC_EVIDENCE_ITEMS);
    expect(result[0]).toEqual({
      predicate: 'ENTITY_HAS_DESCRIPTION',
      observedAt: '2026-07-26T00:00:00.000Z',
      confidence: 0.9,
    });
    expect(result[0]).not.toHaveProperty('value');
    expect(result[0]).not.toHaveProperty('excerpt');
    expect(result[0]).not.toHaveProperty('sourceDocumentId');
    expect(result[0]).not.toHaveProperty('diagnostics');
  });

  it('builds a bounded discovery projection and strips unsafe lead data', () => {
    const leads = Array.from({ length: MAX_PUBLIC_DISCOVERY_LEADS + 4 }, (_, index) => ({
      personId: new mongoose.Types.ObjectId(
        `507f191e810c19729de86${String(200 + index).slice(-3)}`,
      ),
      displayName: `Lead ${index} lead${index}@yale.edu`,
      role: 'PI',
      officialProfileUrl:
        index === 0
          ? 'https://medicine.yale.edu/profile/lead-zero'
          : 'https://example.org/not-an-official-yale-profile',
      accountId: new mongoose.Types.ObjectId(),
      reviewNotes: 'private',
    }));
    leads.push({ ...leads[0] });

    const discovery = buildResearchEntityDiscoveryProjection(
      {
        leads,
        accessState: `${'actionable '.repeat(30)}private@yale.edu`,
        bestNextStepCategory: 'apply',
        openOpportunityCount: Number.MAX_SAFE_INTEGER,
        browseRankScore: Number.MAX_SAFE_INTEGER,
        visibilityState: 'student_ready',
        computedAt: now,
      },
      { now },
    );

    expect(discovery?.leads).toHaveLength(MAX_PUBLIC_DISCOVERY_LEADS);
    expect(discovery?.leads[0]).toEqual({
      personId: leads[0].personId.toHexString(),
      displayName: 'Lead 0 [email redacted]',
      role: 'PI',
      officialProfileUrl: 'https://medicine.yale.edu/profile/lead-zero',
    });
    expect(discovery?.leads[1]).not.toHaveProperty('officialProfileUrl');
    expect(discovery?.leads[0]).not.toHaveProperty('accountId');
    expect(discovery?.leads[0]).not.toHaveProperty('reviewNotes');
    expect(discovery?.accessState).not.toContain('private@yale.edu');
    expect(discovery?.openOpportunityCount).toBe(MAX_PUBLIC_DISCOVERY_OPPORTUNITY_COUNT);
    expect(discovery?.browseRankScore).toBe(1_000);
  });

  it('keeps accessState bounded text while rejecting invalid governed fields and dates', () => {
    const base = {
      leads: [],
      accessState: 'NO_EVIDENCE',
      openOpportunityCount: 0,
      browseRankScore: 0,
      visibilityState: 'student_ready',
      computedAt: now,
    };

    expect(
      buildResearchEntityDiscoveryProjection(
        {
          ...base,
          bestNextStepCategory: 'email-the-professor',
        },
        { now },
      ),
    ).toBeUndefined();
    expect(
      buildResearchEntityDiscoveryProjection(
        {
          ...base,
          visibilityState: 'PUBLIC',
        },
        { now },
      ),
    ).toBeUndefined();
    expect(
      buildResearchEntityDiscoveryProjection(
        {
          ...base,
          computedAt: '2026-07-27T12:00:00.000Z',
        },
        { now },
      ),
    ).toBeUndefined();
    expect(
      buildResearchEntityDiscoveryProjection(
        {
          ...base,
          computedAt: new Date(now.getTime() + 1),
        },
        { now },
      ),
    ).toBeUndefined();
    expect(
      buildResearchEntityDiscoveryProjection(
        {
          ...base,
          accessState: 'SOURCE_BACKED_REVIEW_SUMMARY',
        },
        { now },
      )?.accessState,
    ).toBe('SOURCE_BACKED_REVIEW_SUMMARY');
  });

  it('marks discovery summaries stale exactly after the documented bound', () => {
    const atBound = {
      computedAt: new Date(now.getTime() - RESEARCH_ENTITY_DISCOVERY_STALENESS_BOUND_MS),
    };
    const overBound = {
      computedAt: new Date(now.getTime() - RESEARCH_ENTITY_DISCOVERY_STALENESS_BOUND_MS - 1),
    };
    const future = {
      computedAt: new Date(now.getTime() + 1),
    };

    expect(researchEntityDiscoveryFreshness(undefined, now)).toBe('missing');
    expect(researchEntityDiscoveryFreshness(atBound, now)).toBe('fresh');
    expect(researchEntityDiscoveryFreshness(overBound, now)).toBe('stale');
    expect(researchEntityDiscoveryFreshness(future, now)).toBe('future');
    expect(shouldRecomputeResearchEntityDiscovery(atBound, now)).toBe(false);
    expect(shouldRecomputeResearchEntityDiscovery(overBound, now)).toBe(true);
  });

  it('defines direct invalidation plus a reconciliation interval below the stale bound', () => {
    expect(researchEntityDiscoveryRecomputeTriggers).toEqual([
      'CANONICAL_MATERIALIZER_COMMIT',
      'MODERATED_CANONICAL_WRITE',
      'SCHEDULED_RECONCILIATION',
    ]);
    expect(RESEARCH_ENTITY_DISCOVERY_RECONCILIATION_INTERVAL_MS).toBeLessThan(
      RESEARCH_ENTITY_DISCOVERY_STALENESS_BOUND_MS,
    );
  });
});

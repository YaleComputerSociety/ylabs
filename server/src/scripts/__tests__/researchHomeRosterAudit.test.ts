import { describe, expect, it } from 'vitest';
import { buildResearchHomeRosterAudit } from '../researchHomeRosterAuditCore';

const verifiedRow = {
  researchEntityId: 'entity-1',
  name: 'Fixture Scholar',
  title: 'Graduate Student',
  role: 'grad-student',
  sourceName: 'official-research-home-roster',
  sourceUrl: 'https://medicine.yale.edu/lab/fixture/members/',
  profileUrl: 'https://medicine.yale.edu/lab/fixture/profile/fixture-scholar/',
  identityKey: 'official-profile:fixture',
  membershipKey: 'official-profile:fixture|grad-student',
  evidenceStatus: 'verified',
  isCurrentMember: true,
  archived: false,
  lastObservedAt: '2026-07-14T00:00:00Z',
  freshnessExpiresAt: '2026-08-04T00:00:00Z',
};

const expectedSource = {
  researchEntityKey: 'fixture',
  researchEntityId: 'entity-1',
  sourceUrl: 'https://medicine.yale.edu/lab/fixture/members/',
  enrichment: {
    state: 'current',
    sourceUrl: 'https://medicine.yale.edu/lab/fixture/members/',
    freshnessExpiresAt: '2026-08-04T00:00:00Z',
  },
};

describe('research-home roster coverage and precision audit', () => {
  it('requires both clean structure and explicit sampled precision review for broad enablement', () => {
    const pending = buildResearchHomeRosterAudit([verifiedRow], {
      now: new Date('2026-07-15T00:00:00Z'),
      expectedSources: [expectedSource],
    });
    expect(pending.structuralPrecisionEligible).toBe(true);
    expect(pending.broadEnablementReady).toBe(false);

    const reviewed = buildResearchHomeRosterAudit([verifiedRow], {
      now: new Date('2026-07-15T00:00:00Z'),
      sampledPrecisionReviewed: true,
      sampledPrecisionReviewedBy: 'reviewer@yale.edu',
      expectedSources: [expectedSource],
    });
    expect(reviewed.broadEnablementReady).toBe(true);
    expect(reviewed.counts.entitiesCovered).toBe(1);
    expect(reviewed.sampledPrecisionReviewedBy).toBe('reviewer@yale.edu');
  });

  it('flags stale rows, missing stable identities, unsafe URLs, and identity collisions', () => {
    const report = buildResearchHomeRosterAudit(
      [
        { ...verifiedRow, freshnessExpiresAt: '2026-01-01T00:00:00Z' },
        {
          ...verifiedRow,
          name: 'Different Scholar',
          membershipKey: '',
          profileUrl: 'javascript:alert(1)',
        },
      ],
      { now: new Date('2026-07-15T00:00:00Z'), expectedSources: [expectedSource] },
    );
    expect(report.structuralPrecisionEligible).toBe(false);
    expect(report.counts).toMatchObject({
      staleCurrent: 1,
      missingStableIdentity: 1,
      unsafeUrls: 1,
      identityCollisions: 1,
    });
  });

  it('fails closed when any configured source is failed, empty, stale, or missing', () => {
    const blockedStates = ['failed', 'empty', 'withheld', 'stale'];
    for (const state of blockedStates) {
      const report = buildResearchHomeRosterAudit([verifiedRow], {
        now: new Date('2026-07-15T00:00:00Z'),
        sampledPrecisionReviewed: true,
        sampledPrecisionReviewedBy: 'reviewer@yale.edu',
        expectedSources: [
          expectedSource,
          {
            ...expectedSource,
            researchEntityKey: `blocked-${state}`,
            researchEntityId: `entity-${state}`,
            enrichment: { ...expectedSource.enrichment, state },
          },
        ],
      });
      expect(report.broadEnablementReady).toBe(false);
      expect(report.counts.entitiesBlocked).toBe(1);
      expect(report.sources[1]).toMatchObject({ ready: false, reason: state });
    }

    const missing = buildResearchHomeRosterAudit([verifiedRow], {
      now: new Date('2026-07-15T00:00:00Z'),
      expectedSources: [
        expectedSource,
        {
          researchEntityKey: 'missing',
          sourceUrl: 'https://medicine.yale.edu/lab/missing/members/',
        },
      ],
    });
    expect(missing.counts).toMatchObject({
      entitiesExpected: 2,
      entitiesReady: 1,
      entitiesBlocked: 1,
    });
    expect(missing.sources[1]).toMatchObject({ state: 'missing', reason: 'missing' });
  });
});

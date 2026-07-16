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
    observedAt: '2026-07-14T00:00:00Z',
    freshnessExpiresAt: '2026-08-04T00:00:00Z',
    memberKeys: ['official-profile:fixture|grad-student'],
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

  it('requires every latest snapshot member to be freshly materialized from its official source', () => {
    const secondMember = {
      ...verifiedRow,
      name: 'Second Scholar',
      identityKey: 'official-profile:second',
      membershipKey: 'official-profile:second|grad-student',
    };
    const sourceWithTwoMembers = {
      ...expectedSource,
      enrichment: {
        ...expectedSource.enrichment,
        memberKeys: [verifiedRow.membershipKey, secondMember.membershipKey],
      },
    };

    for (const invalidSecondMember of [
      undefined,
      { ...secondMember, lastObservedAt: '2026-07-13T00:00:00Z' },
      { ...secondMember, freshnessExpiresAt: '2026-01-01T00:00:00Z' },
      { ...secondMember, sourceUrl: 'https://medicine.yale.edu/lab/other/members/' },
      { ...secondMember, evidenceStatus: 'under-review' },
    ]) {
      const report = buildResearchHomeRosterAudit(
        [verifiedRow, ...(invalidSecondMember ? [invalidSecondMember] : [])],
        {
          now: new Date('2026-07-15T00:00:00Z'),
          sampledPrecisionReviewed: true,
          sampledPrecisionReviewedBy: 'reviewer@yale.edu',
          expectedSources: [sourceWithTwoMembers],
        },
      );
      expect(report.broadEnablementReady).toBe(false);
      expect(report.sources[0]).toMatchObject({
        ready: false,
        reason: 'incomplete-materialization',
      });
    }

    const complete = buildResearchHomeRosterAudit([verifiedRow, secondMember], {
      now: new Date('2026-07-15T00:00:00Z'),
      sampledPrecisionReviewed: true,
      sampledPrecisionReviewedBy: 'reviewer@yale.edu',
      expectedSources: [sourceWithTwoMembers],
    });
    expect(complete.broadEnablementReady).toBe(true);
  });

  it('rejects current or partial enrichment without declared snapshot members', () => {
    const report = buildResearchHomeRosterAudit([verifiedRow], {
      now: new Date('2026-07-15T00:00:00Z'),
      expectedSources: [
        { ...expectedSource, enrichment: { ...expectedSource.enrichment, memberKeys: [] } },
      ],
    });
    expect(report.sources[0]).toMatchObject({ ready: false, reason: 'no-snapshot-members' });
  });

  it('rejects extra, duplicate, mismatched-source, and older current materializations', () => {
    const invalidRows = [
      { ...verifiedRow, membershipKey: 'official-profile:old|grad-student' },
      { ...verifiedRow },
      { ...verifiedRow, sourceUrl: 'https://medicine.yale.edu/lab/other/members/' },
      { ...verifiedRow, lastObservedAt: '2026-07-13T00:00:00Z' },
    ];

    for (const invalidRow of invalidRows) {
      const report = buildResearchHomeRosterAudit([verifiedRow, invalidRow], {
        now: new Date('2026-07-15T00:00:00Z'),
        sampledPrecisionReviewed: true,
        sampledPrecisionReviewedBy: 'reviewer@yale.edu',
        expectedSources: [expectedSource],
      });
      expect(report.broadEnablementReady).toBe(false);
      expect(report.sources[0]).toMatchObject({
        ready: false,
        reason: 'unexpected-materialization',
      });
    }
  });
});

import { describe, expect, it } from 'vitest';
import type { FellowshipCatalogCandidate } from '../../scrapers/sources/yaleCollegeFellowshipsOfficeScraper';
import {
  aggregateFellowshipRefreshPlan,
  assertFellowshipRefreshGuards,
  buildFellowshipRefreshPlan,
  fellowshipRefreshAuditToken,
  validateFellowshipRefreshCandidate,
} from '../fellowshipRefreshCore';

const now = new Date('2026-07-11T12:00:00.000Z');
function candidate(
  overrides: Partial<FellowshipCatalogCandidate> = {},
): FellowshipCatalogCandidate {
  return {
    sourceKey: 'yale-college-fellowships-office:summer-research-fellowship',
    sourceFingerprint: 'new-fingerprint',
    title: 'Summer Research Fellowship',
    sourceUrl: 'https://funding.yale.edu/fellowships/summer-research',
    applicationLink: 'https://funding.yale.edu/apply',
    links: [],
    deadline: new Date('2027-02-01T23:59:59.999Z'),
    yearOfStudy: [],
    termOfAward: ['Summer'],
    purpose: ['Research'],
    globalRegions: [],
    citizenshipStatus: [],
    isAcceptingApplications: true,
    reviewRequired: false,
    ...overrides,
  };
}

describe('fellowship refresh planning', () => {
  it('emits a reopen only for a validated past-to-future transition', () => {
    const plan = buildFellowshipRefreshPlan({
      candidates: [candidate()],
      existing: [
        {
          sourceKey: candidate().sourceKey,
          sourceFingerprint: 'old',
          deadline: new Date('2026-02-01T23:59:59.999Z'),
          isAcceptingApplications: false,
        },
      ],
      now,
    });
    expect(plan[0]).toMatchObject({ action: 'update', transition: 'reopened' });
    expect(aggregateFellowshipRefreshPlan(plan).reopened).toBe(1);
  });

  it('is idempotent when the authoritative fingerprint is unchanged', () => {
    const item = candidate();
    expect(
      buildFellowshipRefreshPlan({
        candidates: [item],
        existing: [{ sourceKey: item.sourceKey, sourceFingerprint: item.sourceFingerprint }],
      })[0],
    ).toMatchObject({ action: 'unchanged', changedFields: [] });
  });

  it('routes missing and invalid deadlines to review without inventing dates', () => {
    const missing = candidate({ deadline: undefined });
    const invalid = candidate({
      sourceKey: 'yale-college-fellowships-office:invalid-date-fellowship',
      deadline: new Date('invalid'),
    });
    const plan = buildFellowshipRefreshPlan({ candidates: [missing, invalid], existing: [] });
    expect(plan.map((item) => item.reviewReason)).toEqual(['missing-deadline', 'invalid-deadline']);
    expect(plan.every((item) => item.action === 'review')).toBe(true);
  });

  it('rejects junk titles and non-authoritative sources', () => {
    expect(validateFellowshipRefreshCandidate(candidate({ title: 'Apply' }))).toBe('junk-title');
    expect(
      validateFellowshipRefreshCandidate(candidate({ sourceUrl: 'https://example.com/program' })),
    ).toBe('non-authoritative-source');
  });

  it('routes a duplicate source identity to review', () => {
    const plan = buildFellowshipRefreshPlan({
      candidates: [candidate(), candidate()],
      existing: [],
    });
    expect(plan[1]).toMatchObject({ action: 'review', reviewReason: 'duplicate-source-key' });
  });

  it('enforces the bounded batch', () => {
    expect(() =>
      buildFellowshipRefreshPlan({ candidates: [], existing: [], maxBatch: 101 }),
    ).toThrow(/1 through 100/);
  });
});

describe('fellowship refresh execution guards', () => {
  it('rejects target mismatch', () => {
    expect(() =>
      assertFellowshipRefreshGuards({ target: 'beta', runtimeTarget: 'prod', execute: false }),
    ).toThrow(/does not match/);
  });

  it('requires execute confirmation and a rollback token', () => {
    expect(() =>
      assertFellowshipRefreshGuards({ target: 'beta', runtimeTarget: 'beta', execute: true }),
    ).toThrow(/confirmation/);
    expect(() =>
      assertFellowshipRefreshGuards({
        target: 'beta',
        runtimeTarget: 'beta',
        execute: true,
        confirmation: 'execute-fellowship-refresh-beta',
      }),
    ).toThrow(/restore token/);
  });

  it('requires a separate production confirmation', () => {
    expect(() =>
      assertFellowshipRefreshGuards({
        target: 'prod',
        runtimeTarget: 'prod',
        execute: true,
        confirmation: 'execute-fellowship-refresh-prod',
        restoreToken: 'restore-123',
      }),
    ).toThrow(/production confirmation/);
  });

  it('stores only a one-way restore token digest', () => {
    const digest = fellowshipRefreshAuditToken('private-restore-token');
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    expect(digest).not.toContain('private-restore-token');
  });

  it('keeps aggregate reports free of source URLs and titles', () => {
    const report = JSON.stringify(
      aggregateFellowshipRefreshPlan(
        buildFellowshipRefreshPlan({ candidates: [candidate()], existing: [] }),
      ),
    );
    expect(report).not.toContain('funding.yale.edu');
    expect(report).not.toContain('Summer Research Fellowship');
  });
});

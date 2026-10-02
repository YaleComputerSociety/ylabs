import { describe, expect, it } from 'vitest';
import { collectSourceLinkHealthCandidates } from '../backfillSourceLinkHealthCore';
import {
  countWebsiteUrlOwnerRows,
  DEAD_LINK_HEALTH_REFUSAL_RULE,
  DEAD_WEBSITE_REFUSAL_KIND,
  deadLinkHealthRefusalEvidenceUrls,
  planDeadWebsiteClearWrite,
  planDeadWebsiteRefusalWithdrawals,
  planDeadWebsiteRefusalWithdrawalWrite,
  entityIdentityIsInQuestion,
  reportDeadWebsiteRefusals,
  normalizeWebsiteUrl,
  planDeadResearchWebsiteClears,
  summarizeDeadWebsiteRefusals,
  type DeadWebsiteRow,
} from '../clearDeadResearchWebsitesCore';

const DEAD = 'https://gonelab.example.edu/';
const row = (overrides: Partial<DeadWebsiteRow> = {}): DeadWebsiteRow => ({
  slug: 'dept-physics-avery-lab',
  entityType: 'LAB',
  name: 'Avery Lab',
  websiteUrl: DEAD,
  ...overrides,
});

const plan = (
  rows: DeadWebsiteRow[],
  ownerCount = 1,
  isDead: (r: DeadWebsiteRow, u: string) => boolean = () => true,
) =>
  planDeadResearchWebsiteClears(
    rows,
    isDead,
    () => 2,
    () => ownerCount,
  );

describe('dead research website clears (#3309)', () => {
  it('plans a clear for a served row whose own website is known dead', () => {
    const outcome = plan([row()]);
    expect(outcome.refused).toEqual([]);
    expect(outcome.plans).toEqual([
      { slug: 'dept-physics-avery-lab', field: 'websiteUrl', url: DEAD, liveCitationsRemaining: 2 },
    ]);
  });

  it('reads the legacy website field when websiteUrl is empty', () => {
    const outcome = plan([row({ websiteUrl: '', website: DEAD })]);
    expect(outcome.plans[0].field).toBe('website');
  });

  it('plans both fields when a row stores the dead website in each', () => {
    const outcome = plan([row({ website: DEAD })]);
    expect(outcome.plans.map((entry) => entry.field)).toEqual(['websiteUrl', 'website']);
  });

  it('counts a row once when both its fields hold the same website', () => {
    const owners = countWebsiteUrlOwnerRows([
      { websiteUrl: DEAD, website: 'https://www.gonelab.example.edu' },
      { websiteUrl: 'https://otherlab.example.edu/' },
    ]);
    expect(owners.get(normalizeWebsiteUrl(DEAD))).toBe(1);
  });

  it('leaves a live website alone', () => {
    const outcome = plan([row()], 1, () => false);
    expect(outcome.plans).toEqual([]);
    expect(outcome.refused[0].reason).toBe('no-dead-website');
  });

  // An operator decision is not this pass's to reverse, and #3191 measured the cost of a
  // repair that froze a cleared field whose value was correct.
  it('never reverses an operator lock on either field name', () => {
    for (const field of ['websiteUrl', 'website']) {
      const outcome = plan([row({ manuallyLockedFields: [field] })]);
      expect(outcome.plans).toEqual([]);
      expect(outcome.refused[0].reason).toBe('operator-locked');
    }
  });

  // Clearing a borrowed url promotes the borrower, so a url a second row also owns is
  // left for the ownership work rather than cleared here.
  it('refuses a url another row also owns', () => {
    const outcome = plan([row()], 2);
    expect(outcome.plans).toEqual([]);
    expect(outcome.refused[0].reason).toBe('url-owned-by-another-row');
  });

  // A mis-aimed website on a row whose own fields disagree about what it is is a symptom
  // of the identity defect, so clearing it would be the wrong fix.
  it('hands over a row whose identity fields disagree', () => {
    const sharesNothing = plan([row({ name: 'Quantum Materials Group', slug: 'dept-econ-zzz' })]);
    expect(sharesNothing.refused[0].reason).toBe('entity-identity-is-in-question');
    const collectiveOnPerson = plan([
      row({ name: 'Avery Lab', entityType: 'FACULTY_RESEARCH_AREA' }),
    ]);
    expect(collectiveOnPerson.refused[0].reason).toBe('entity-identity-is-in-question');
  });

  it('does not call a consistent row an identity defect', () => {
    expect(entityIdentityIsInQuestion(row())).toBe(false);
    expect(
      entityIdentityIsInQuestion({
        slug: 'dept-econ-avery',
        entityType: 'FACULTY_RESEARCH_AREA',
        name: 'Avery Faculty Research',
      }),
    ).toBe(false);
  });

  it('treats two spellings of one address as one owner', () => {
    expect(normalizeWebsiteUrl('https://WWW.GoneLab.example.edu/')).toBe('gonelab.example.edu');
  });

  it('counts every refusal reason it can emit', () => {
    const counts = summarizeDeadWebsiteRefusals([
      { reason: 'operator-locked' },
      { reason: 'operator-locked' },
      { reason: 'url-owned-by-another-row' },
    ]);
    expect(counts['operator-locked']).toBe(2);
    expect(counts['url-owned-by-another-row']).toBe(1);
    expect(counts['entity-identity-is-in-question']).toBe(0);
  });
});

/**
 * A scheduled pass reports its skips so the next operator can tell a deliberate
 * exclusion from work left undone (#3309).
 */
describe('scheduled reporting of dead-website skips', () => {
  it('separates a deliberate exclusion from the ordinary remainder', () => {
    const report = reportDeadWebsiteRefusals([
      { reason: 'operator-locked' },
      { reason: 'url-owned-by-another-row' },
      { reason: 'entity-identity-is-in-question' },
      { reason: 'no-dead-website' },
      { reason: 'no-dead-website' },
    ]);
    expect(report.deliberatelyExcluded).toEqual({
      'operator-locked': 1,
      'url-owned-by-another-row': 1,
      'entity-identity-is-in-question': 1,
    });
    expect(report.notApplicable).toEqual({ 'no-dead-website': 2 });
    expect(report.deliberatelyExcludedTotal).toBe(3);
  });

  // An operator-locked row must never read as a remainder, because driving a remainder to
  // zero means overriding the operator.
  it('never counts an operator lock as the ordinary remainder', () => {
    const report = reportDeadWebsiteRefusals([{ reason: 'operator-locked' }]);
    expect(report.notApplicable['operator-locked']).toBeUndefined();
    expect(DEAD_WEBSITE_REFUSAL_KIND['operator-locked']).toBe('deliberate');
    expect(DEAD_WEBSITE_REFUSAL_KIND['no-dead-website']).toBe('not-applicable');
  });

  it('classifies every reason it can emit', () => {
    for (const kind of Object.values(DEAD_WEBSITE_REFUSAL_KIND)) {
      expect(['deliberate', 'not-applicable']).toContain(kind);
    }
    expect(Object.keys(DEAD_WEBSITE_REFUSAL_KIND).sort()).toEqual(
      Object.keys(summarizeDeadWebsiteRefusals([])).sort(),
    );
  });
});

describe('the dead-website clear records a refusal the next resolve honours (#3722)', () => {
  const NOW = new Date('2026-10-01T00:00:00Z');
  const deadHealth = [
    { url: DEAD, healthStatus: 'UNAVAILABLE', httpStatusCode: 404, checkedAt: NOW },
  ];
  const refusedRow = (healthStatus: string, rule = DEAD_LINK_HEALTH_REFUSAL_RULE) =>
    row({
      websiteUrl: '',
      sourceLinkHealth: [{ url: DEAD, healthStatus, checkedAt: NOW }],
      fieldValueRefusals: {
        websiteUrl: [
          { valueKey: 'gonelab.example.edu', rule, refusedBy: 'test', evidenceUrl: DEAD },
        ],
      },
    });

  it('clears the field and refuses its value in the same write', () => {
    const target = row({ website: DEAD, sourceLinkHealth: deadHealth });
    const write = planDeadWebsiteClearWrite(target, plan([target]).plans, NOW);
    expect(write.websiteUrl).toBe('');
    expect(write.website).toBe('');
    for (const field of ['websiteUrl', 'website']) {
      const [refusal] = write[`fieldValueRefusals.${field}`] as Array<Record<string, unknown>>;
      expect(refusal.rule).toBe(DEAD_LINK_HEALTH_REFUSAL_RULE);
      expect(refusal.evidenceUrl).toBe(DEAD);
      expect(String(refusal.note)).toContain('HTTP 404');
    }
  });

  it('keeps probing a page it refused, so a withdrawal has a verdict to wait on', () => {
    const target = refusedRow('UNAVAILABLE');
    expect(deadLinkHealthRefusalEvidenceUrls(target)).toEqual([DEAD]);
    expect(collectSourceLinkHealthCandidates(target)).toContain(DEAD);
    expect(collectSourceLinkHealthCandidates(refusedRow('UNAVAILABLE', 'wrong_owner'))).toEqual([]);
  });

  it('withdraws its refusal only when the page reads healthy again', () => {
    expect(planDeadWebsiteRefusalWithdrawals([refusedRow('UNAVAILABLE')])).toEqual([]);
    expect(planDeadWebsiteRefusalWithdrawals([refusedRow('UNKNOWN')])).toEqual([]);
    expect(planDeadWebsiteRefusalWithdrawals([refusedRow('HEALTHY', 'wrong_owner')])).toEqual([]);
    const healthy = refusedRow('HEALTHY');
    const withdrawals = planDeadWebsiteRefusalWithdrawals([healthy]);
    expect(withdrawals).toEqual([{ slug: healthy.slug, field: 'websiteUrl', url: DEAD }]);
    const write = planDeadWebsiteRefusalWithdrawalWrite(healthy, withdrawals, NOW);
    const [withdrawn] = write['fieldValueRefusals.websiteUrl'] as Array<Record<string, unknown>>;
    expect(withdrawn.withdrawnAt).toEqual(NOW);
  });
});

import { describe, expect, it } from 'vitest';
import {
  DEAD_WEBSITE_REFUSAL_KIND,
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
      { slug: 'dept-physics-avery-lab', field: 'websiteUrl', liveCitationsRemaining: 2 },
    ]);
  });

  it('reads the legacy website field when websiteUrl is empty', () => {
    const outcome = plan([row({ websiteUrl: '', website: DEAD })]);
    expect(outcome.plans[0].field).toBe('website');
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

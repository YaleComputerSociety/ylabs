import { describe, expect, it } from 'vitest';
import { buildLabSiteLeadVerification } from '../labSiteLeadVerification';
import {
  LAB_SITE_LEAD_STATEMENT_FIXTURES,
  type LabSiteLeadStatementFixture,
} from './fixtures/labSiteLeadStatementPages';

const observedAt = new Date('2026-11-12T00:00:00.000Z');

function judgeFixture(fixture: LabSiteLeadStatementFixture) {
  const verification = buildLabSiteLeadVerification(
    fixture.leads,
    {
      website: fixture.website,
      visitedUrls: fixture.pages.map((one) => one.url),
      html: fixture.pages.map((one) => one.html).join('\n'),
    },
    observedAt,
    fixture.entityType,
  );
  return Object.fromEntries(
    verification.leads.map((judgement) => [
      judgement.personId,
      {
        verdict: judgement.verdict,
        ...(fixture.expected[judgement.personId]?.matchedBy
          ? { matchedBy: judgement.matchedBy }
          : {}),
        ...(judgement.contradictedBy ? { contradictedBy: judgement.contradictedBy } : {}),
      },
    ]),
  );
}

const readTodayAsExpected = new Set([
  'co-directors of a center named in their own cards confirm each other',
  'a principal investigator card on the row own page names another person as the lead',
  'a staff director qualified by another unit is not a lead of the row',
  'faculty contacts on a multi-PI site stay confirmed',
  'a self-referencing lead sentence on a page that is not the row own page anchors nothing',
  'a lead sentence about another unit on the row own page is ignored',
  'a lead sentence naming somebody who could be the lead never contradicts the lead',
  'a faculty and an executive director of a center both named as directors confirm each other',
]);

describe('row-anchored lead statement fixtures (#5962)', () => {
  it('names every fixture once', () => {
    const names = LAB_SITE_LEAD_STATEMENT_FIXTURES.map((fixture) => fixture.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of readTodayAsExpected) expect(names).toContain(name);
  });

  for (const fixture of LAB_SITE_LEAD_STATEMENT_FIXTURES) {
    const test = readTodayAsExpected.has(fixture.name) ? it : it.fails;
    test(fixture.name, () => {
      expect(judgeFixture(fixture)).toEqual(fixture.expected);
    });
  }
});

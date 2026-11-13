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
      pages: fixture.pages,
    },
    observedAt,
    fixture.entityType,
    fixture.rowName,
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

describe('row-anchored lead statement fixtures (#5962)', () => {
  it('names every fixture once', () => {
    const names = LAB_SITE_LEAD_STATEMENT_FIXTURES.map((fixture) => fixture.name);
    expect(new Set(names).size).toBe(names.length);
  });

  for (const fixture of LAB_SITE_LEAD_STATEMENT_FIXTURES) {
    it(fixture.name, () => {
      expect(judgeFixture(fixture)).toEqual(fixture.expected);
    });
  }
});

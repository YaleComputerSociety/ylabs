import { describe, expect, it } from 'vitest';
import {
  PROMOTION_REGRESSED_WEBSITE_URL_DECISIONS,
  planWebsiteUrlRepair,
  summarizeWebsiteUrlRepairPlans,
  websiteUrlCitationKey,
  type WebsiteUrlRepairDecision,
} from '../repairPromotionRegressedWebsiteUrlsCore';

const restoreDecision: WebsiteUrlRepairDecision = {
  slug: 'watts-dwatts',
  action: 'restore',
  intendedWebsiteUrl: 'https://anthropology.yale.edu/profile/david-watts',
  expectedCurrentWebsiteUrl: 'http://www.ngogochimp.commons.yale.edu/',
  why: 'test',
};

const clearDecision: WebsiteUrlRepairDecision = {
  slug: 'ysm-faculty-shrikant-mane',
  action: 'clear',
  expectedCurrentWebsiteUrl: 'https://ycga.yale.edu/',
  why: 'test',
};

const reachable = (...urls: string[]) => (url: string) => ({ reachable: urls.includes(url) });
const allDead = () => ({ reachable: false });

describe('planWebsiteUrlRepair restore', () => {
  const entity = {
    slug: 'watts-dwatts',
    websiteUrl: 'http://www.ngogochimp.commons.yale.edu/',
    sourceUrls: [
      'https://anthropology.yale.edu/profile/david-watts',
      'http://www.ngogochimp.commons.yale.edu/',
    ],
  };

  it('restores a reachable url the row already cites', () => {
    expect(
      planWebsiteUrlRepair(
        restoreDecision,
        entity,
        reachable('https://anthropology.yale.edu/profile/david-watts'),
      ),
    ).toMatchObject({
      slug: 'watts-dwatts',
      nextWebsiteUrl: 'https://anthropology.yale.edu/profile/david-watts',
      requiresVisibilityRegate: false,
    });
  });

  it('refuses to mint a value the row does not already cite', () => {
    expect(
      planWebsiteUrlRepair(
        restoreDecision,
        { ...entity, sourceUrls: ['http://www.ngogochimp.commons.yale.edu/'] },
        reachable('https://anthropology.yale.edu/profile/david-watts'),
      ).skipped,
    ).toBe('intended_url_not_cited');
  });

  it('matches a citation written under a cosmetically different spelling', () => {
    expect(
      planWebsiteUrlRepair(
        restoreDecision,
        { ...entity, sourceUrls: ['https://anthropology.yale.edu/profile/david-watts/'] },
        reachable('https://anthropology.yale.edu/profile/david-watts'),
      ).nextWebsiteUrl,
    ).toBe('https://anthropology.yale.edu/profile/david-watts');
  });

  it('refuses when the intended url does not resolve at apply time', () => {
    expect(planWebsiteUrlRepair(restoreDecision, entity, allDead).skipped).toBe(
      'intended_url_not_reachable',
    );
  });

  it('refuses when the stored value is not the one the decision expected', () => {
    expect(
      planWebsiteUrlRepair(
        restoreDecision,
        { ...entity, websiteUrl: 'https://example.org/somewhere-else' },
        reachable('https://anthropology.yale.edu/profile/david-watts'),
      ).skipped,
    ).toBe('current_value_unexpected');
  });

  it('refuses when an operator has locked websiteUrl', () => {
    expect(
      planWebsiteUrlRepair(
        restoreDecision,
        { ...entity, manuallyLockedFields: ['websiteUrl'] },
        reachable('https://anthropology.yale.edu/profile/david-watts'),
      ).skipped,
    ).toBe('website_url_manually_locked');
  });

  it('refuses when the row is absent', () => {
    expect(planWebsiteUrlRepair(restoreDecision, undefined, allDead).skipped).toBe('entity_missing');
  });
});

describe('planWebsiteUrlRepair clear', () => {
  const entity = {
    slug: 'ysm-faculty-shrikant-mane',
    websiteUrl: 'https://ycga.yale.edu/',
    sourceUrls: ['https://medicine.yale.edu/profile/shrikant-mane/'],
  };

  it('clears a dead value and flags the row for a visibility re-gate', () => {
    expect(planWebsiteUrlRepair(clearDecision, entity, allDead)).toMatchObject({
      nextWebsiteUrl: '',
      requiresVisibilityRegate: true,
    });
  });

  it('refuses to clear a value that turns out to still resolve', () => {
    expect(
      planWebsiteUrlRepair(clearDecision, entity, reachable('https://ycga.yale.edu/')).skipped,
    ).toBe('current_value_still_reachable');
  });
});

describe('the checked-in decision table', () => {
  it('covers exactly the three rows the sync regressed, and every restore names a value', () => {
    expect(PROMOTION_REGRESSED_WEBSITE_URL_DECISIONS.map((d) => d.slug)).toEqual([
      'watts-dwatts',
      'dept-physics-john-sous',
      'ysm-faculty-shrikant-mane',
    ]);
    for (const decision of PROMOTION_REGRESSED_WEBSITE_URL_DECISIONS) {
      if (decision.action === 'restore') expect(decision.intendedWebsiteUrl).toBeTruthy();
      else expect(decision.intendedWebsiteUrl).toBeUndefined();
      expect(decision.expectedCurrentWebsiteUrl).toBeTruthy();
      expect(decision.why.length).toBeGreaterThan(20);
    }
  });

  it('never restores a value equal to the one it replaces', () => {
    for (const decision of PROMOTION_REGRESSED_WEBSITE_URL_DECISIONS) {
      if (decision.action !== 'restore') continue;
      expect(websiteUrlCitationKey(decision.intendedWebsiteUrl)).not.toBe(
        websiteUrlCitationKey(decision.expectedCurrentWebsiteUrl),
      );
    }
  });
});

describe('summarizeWebsiteUrlRepairPlans', () => {
  it('counts actions and collects only the slugs needing a re-gate', () => {
    expect(
      summarizeWebsiteUrlRepairPlans([
        { slug: 'a', action: 'restore', requiresVisibilityRegate: false },
        { slug: 'b', action: 'clear', requiresVisibilityRegate: true },
        { slug: 'c', action: 'restore', requiresVisibilityRegate: false, skipped: 'entity_missing' },
      ]),
    ).toEqual({
      planned: 2,
      restored: 1,
      cleared: 1,
      skipped: 1,
      skipReasons: { entity_missing: 1 },
      regateSlugs: ['b'],
    });
  });
});

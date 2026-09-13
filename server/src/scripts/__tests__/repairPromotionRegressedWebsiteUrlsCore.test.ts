import { describe, expect, it } from 'vitest';
import {
  PROMOTION_REGRESSED_WEBSITE_URL_DECISIONS,
  isSameWebsiteUrlDestination,
  planWebsiteUrlRepair,
  summarizeWebsiteUrlRepairPlans,
  websiteUrlProbeVerdict,
  type WebsiteUrlProbeVerdict,
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

const live =
  (...urls: string[]) =>
  (url: string): WebsiteUrlProbeVerdict =>
    urls.includes(url) ? 'live' : 'dead';
const allDead = (): WebsiteUrlProbeVerdict => 'dead';
const allInconclusive = (): WebsiteUrlProbeVerdict => 'inconclusive';

describe('planWebsiteUrlRepair restore', () => {
  const entity = {
    slug: 'watts-dwatts',
    websiteUrl: 'http://www.ngogochimp.commons.yale.edu/',
    sourceUrls: [
      'https://anthropology.yale.edu/profile/david-watts',
      'http://www.ngogochimp.commons.yale.edu/',
    ],
  };

  it('restores a live url the row already cites, and locks the field so it survives', () => {
    expect(
      planWebsiteUrlRepair(
        restoreDecision,
        entity,
        live('https://anthropology.yale.edu/profile/david-watts'),
      ),
    ).toMatchObject({
      slug: 'watts-dwatts',
      nextWebsiteUrl: 'https://anthropology.yale.edu/profile/david-watts',
      nextManuallyLockedFields: ['websiteUrl'],
      requiresVisibilityRegate: false,
    });
  });

  it('keeps any locks the row already carries when it adds its own', () => {
    expect(
      planWebsiteUrlRepair(
        restoreDecision,
        { ...entity, manuallyLockedFields: ['fullDescription'] },
        live('https://anthropology.yale.edu/profile/david-watts'),
      ).nextManuallyLockedFields,
    ).toEqual(['fullDescription', 'websiteUrl']);
  });

  it('refuses to mint a value the row does not already cite', () => {
    expect(
      planWebsiteUrlRepair(
        restoreDecision,
        { ...entity, sourceUrls: ['http://www.ngogochimp.commons.yale.edu/'] },
        live('https://anthropology.yale.edu/profile/david-watts'),
      ).skipped,
    ).toBe('intended_url_not_cited');
  });

  it('does not accept an unparseable citation as a match for an unparseable target', () => {
    expect(
      planWebsiteUrlRepair(
        { ...restoreDecision, intendedWebsiteUrl: 'not a url' },
        { ...entity, sourceUrls: ['also not a url'] },
        live('not a url'),
      ).skipped,
    ).toBe('intended_url_not_cited');
  });

  it('matches a citation written under a cosmetically different spelling', () => {
    expect(
      planWebsiteUrlRepair(
        restoreDecision,
        { ...entity, sourceUrls: ['https://anthropology.yale.edu/profile/david-watts/'] },
        live('https://anthropology.yale.edu/profile/david-watts'),
      ).nextWebsiteUrl,
    ).toBe('https://anthropology.yale.edu/profile/david-watts');
  });

  it('refuses when the intended url does not resolve at apply time', () => {
    expect(planWebsiteUrlRepair(restoreDecision, entity, allDead).skipped).toBe(
      'intended_url_not_reachable',
    );
  });

  it('refuses to restore on a probe that settled nothing', () => {
    expect(planWebsiteUrlRepair(restoreDecision, entity, allInconclusive).skipped).toBe(
      'probe_inconclusive',
    );
  });

  it('refuses when the stored value is not the one the decision expected', () => {
    expect(
      planWebsiteUrlRepair(
        restoreDecision,
        { ...entity, websiteUrl: 'https://example.org/somewhere-else' },
        live('https://anthropology.yale.edu/profile/david-watts'),
      ).skipped,
    ).toBe('current_value_unexpected');
  });

  it('refuses when an operator has locked websiteUrl', () => {
    expect(
      planWebsiteUrlRepair(
        restoreDecision,
        { ...entity, manuallyLockedFields: ['websiteUrl'] },
        live('https://anthropology.yale.edu/profile/david-watts'),
      ).skipped,
    ).toBe('website_url_manually_locked');
  });

  it('refuses when the row is absent', () => {
    expect(planWebsiteUrlRepair(restoreDecision, undefined, allDead).skipped).toBe(
      'entity_missing',
    );
  });
});

describe('planWebsiteUrlRepair clear', () => {
  const entity = {
    slug: 'ysm-faculty-shrikant-mane',
    websiteUrl: 'https://ycga.yale.edu/',
    sourceUrls: ['https://medicine.yale.edu/profile/shrikant-mane/'],
  };

  it('clears a dead value, locks the field, and flags the row for a visibility re-gate', () => {
    expect(planWebsiteUrlRepair(clearDecision, entity, allDead)).toMatchObject({
      nextWebsiteUrl: '',
      nextManuallyLockedFields: ['websiteUrl'],
      requiresVisibilityRegate: true,
    });
  });

  it('refuses to clear a value that turns out to still resolve', () => {
    expect(
      planWebsiteUrlRepair(clearDecision, entity, live('https://ycga.yale.edu/')).skipped,
    ).toBe('current_value_still_reachable');
  });

  it('refuses to clear a served value on a probe that settled nothing', () => {
    expect(planWebsiteUrlRepair(clearDecision, entity, allInconclusive).skipped).toBe(
      'probe_inconclusive',
    );
  });
});

describe('websiteUrlProbeVerdict', () => {
  it('calls a plain 200 live and a 404 dead', () => {
    expect(
      websiteUrlProbeVerdict({
        status: 200,
        requestedUrl: 'https://sous.yale.edu/profile/john-sous',
        finalUrl: 'https://sous.yale.edu/profile/john-sous',
      }),
    ).toBe('live');
    expect(websiteUrlProbeVerdict({ status: 404 })).toBe('dead');
  });

  it('calls a soft 404 dead rather than live, so it can never license a restore', () => {
    expect(
      websiteUrlProbeVerdict({
        status: 200,
        requestedUrl: 'https://sous.yale.edu/profile/john-sous',
        finalUrl: 'https://sous.yale.edu/',
      }),
    ).toBe('dead');
  });

  it('calls a dns failure dead and a throttle, outage, or ssrf false positive inconclusive', () => {
    expect(websiteUrlProbeVerdict({ errorCode: 'ENOTFOUND' })).toBe('dead');
    expect(websiteUrlProbeVerdict({ status: 403 })).toBe('inconclusive');
    expect(websiteUrlProbeVerdict({ status: 503 })).toBe('inconclusive');
    expect(websiteUrlProbeVerdict({ errorCode: 'ERR_SSRF_BLOCKED' })).toBe('inconclusive');
    expect(websiteUrlProbeVerdict({})).toBe('inconclusive');
  });
});

describe('isSameWebsiteUrlDestination', () => {
  it('folds cosmetic spelling differences', () => {
    expect(
      isSameWebsiteUrlDestination(
        'http://WWW.Anthropology.yale.edu/profile/david-watts/',
        'https://anthropology.yale.edu/profile/david-watts',
      ),
    ).toBe(true);
  });

  it('never matches an unparseable url, including another unparseable one', () => {
    expect(isSameWebsiteUrlDestination('not a url', 'not a url')).toBe(false);
    expect(isSameWebsiteUrlDestination(undefined, undefined)).toBe(false);
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
      expect(
        isSameWebsiteUrlDestination(
          decision.intendedWebsiteUrl,
          decision.expectedCurrentWebsiteUrl,
        ),
      ).toBe(false);
    }
  });
});

describe('summarizeWebsiteUrlRepairPlans', () => {
  it('counts actions and collects only the slugs needing a re-gate', () => {
    expect(
      summarizeWebsiteUrlRepairPlans([
        { slug: 'a', action: 'restore', requiresVisibilityRegate: false },
        { slug: 'b', action: 'clear', requiresVisibilityRegate: true },
        {
          slug: 'c',
          action: 'restore',
          requiresVisibilityRegate: false,
          skipped: 'entity_missing',
        },
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

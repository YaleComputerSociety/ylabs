import { describe, expect, it } from 'vitest';
import {
  OPERATOR_LED_GROUP_VERDICT_CONFIDENCE,
  planLedGroupSiteVerdict,
  siteUrlLookupVariants,
  type LedGroupSiteRow,
} from '../adoptLedGroupSiteCore';
import { parseAdoptLedGroupSiteArgs } from '../adoptLedGroupSite';

const row = (overrides: Partial<LedGroupSiteRow> = {}): LedGroupSiteRow => ({
  _id: '0123456789abcdef01234567',
  slug: 'faculty-research-area-verdict-fixture',
  name: 'Verdict Fixture Research',
  websiteUrl: '',
  sourceUrls: ['https://engineering.yale.edu/research-and-faculty/faculty-directory/fixture/'],
  manuallyLockedFields: [],
  rowsServingTheSite: 0,
  ...overrides,
});

const verdict = {
  siteUrl: 'https://orca.fixture.yale.edu/',
  name: 'Orca Fixture Systems Group',
  evidenceUrls: ['https://orca.fixture.yale.edu/people.php'],
};

describe('planLedGroupSiteVerdict', () => {
  it('records the verdict as observations citing the evidence page, with no field write', () => {
    const planned = planLedGroupSiteVerdict(row(), verdict);
    expect('observations' in planned).toBe(true);
    if (!('observations' in planned)) return;
    const byField = Object.fromEntries(planned.observations.map((obs) => [obs.field, obs]));
    expect(Object.keys(byField).sort()).toEqual(
      ['displayName', 'entityType', 'kind', 'name', 'sourceUrls', 'website', 'websiteUrl'].sort(),
    );
    expect(byField.name.value).toBe(verdict.name);
    expect(byField.websiteUrl.value).toBe(verdict.siteUrl);
    expect(byField.entityType.value).toBe('LAB');
    expect(byField.sourceUrls.value).toEqual([
      'https://engineering.yale.edu/research-and-faculty/faculty-directory/fixture/',
      'https://orca.fixture.yale.edu/people.php',
      'https://orca.fixture.yale.edu/',
    ]);
    for (const obs of planned.observations) {
      expect(obs).toMatchObject({
        entityType: 'researchEntity',
        entityKey: 'faculty-research-area-verdict-fixture',
        sourceUrl: 'https://orca.fixture.yale.edu/people.php',
        confidenceOverride: OPERATOR_LED_GROUP_VERDICT_CONFIDENCE,
      });
    }
  });

  it('refuses a row an operator has locked', () => {
    expect(planLedGroupSiteVerdict(row({ manuallyLockedFields: ['websiteUrl'] }), verdict)).toEqual(
      { refused: 'manually-locked' },
    );
  });

  it('refuses a name that does not name a group', () => {
    expect(planLedGroupSiteVerdict(row(), { ...verdict, name: 'Orca Fixture Systems' })).toEqual({
      refused: 'name-is-not-a-group',
    });
  });

  it("refuses an umbrella host's root, whose root names the host organization", () => {
    expect(planLedGroupSiteVerdict(row(), { ...verdict, siteUrl: 'https://csl.yale.edu/' })).toEqual(
      { refused: 'site-is-not-promotable' },
    );
  });

  it('refuses a site another live row already serves', () => {
    expect(planLedGroupSiteVerdict(row({ rowsServingTheSite: 1 }), verdict)).toEqual({
      refused: 'another-row-serves-the-site',
    });
  });

  it('refuses a verdict the row already serves', () => {
    expect(
      planLedGroupSiteVerdict(
        row({ name: verdict.name, websiteUrl: 'https://orca.fixture.yale.edu' }),
        verdict,
      ),
    ).toEqual({ refused: 'already-the-verdict' });
  });
});

describe('siteUrlLookupVariants', () => {
  it('matches the stored site with or without a trailing slash and either scheme', () => {
    expect(siteUrlLookupVariants('https://orca.fixture.yale.edu/')).toEqual(
      expect.arrayContaining([
        'https://orca.fixture.yale.edu/',
        'https://orca.fixture.yale.edu',
        'http://orca.fixture.yale.edu/',
        'http://orca.fixture.yale.edu',
      ]),
    );
  });
});

describe('parseAdoptLedGroupSiteArgs', () => {
  const required = [
    '--slug=faculty-research-area-verdict-fixture',
    `--site-url=${verdict.siteUrl}`,
    `--name=${verdict.name}`,
    `--evidence-url=${verdict.evidenceUrls[0]}`,
  ];

  it('defaults to a dry run and collects every evidence URL', () => {
    expect(parseAdoptLedGroupSiteArgs([...required, '--evidence-url=https://x.yale.edu/'])).toEqual(
      {
        slug: 'faculty-research-area-verdict-fixture',
        siteUrl: verdict.siteUrl,
        name: verdict.name,
        evidenceUrls: [verdict.evidenceUrls[0], 'https://x.yale.edu/'],
        apply: false,
        confirmed: false,
      },
    );
  });

  it('requires each per-row argument', () => {
    for (const missing of required) {
      expect(() => parseAdoptLedGroupSiteArgs(required.filter((arg) => arg !== missing))).toThrow(
        /required/,
      );
    }
  });
});

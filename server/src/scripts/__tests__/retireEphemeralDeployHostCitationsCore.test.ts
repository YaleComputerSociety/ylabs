import { describe, expect, it } from 'vitest';
import {
  budgetDeployHostCitationWrites,
  countDeployHostCitations,
  countDeployHostEntityUrls,
  deployHostOf,
  planDeployHostCitationRetirement,
  type DeployHostCitationRow,
} from '../retireEphemeralDeployHostCitationsCore';
import { parseRetireDeployHostCitationsArgs } from '../retireEphemeralDeployHostCitations';
import { CONFIRM_RETIRE_DEPLOY_HOST_CITATIONS } from '../retireEphemeralDeployHostCitationsCore';

const DEPLOY_HOST = 'https://ysoa-2025-nuxt-production-fqvp7.ondigitalocean.app';

const row = (over: Partial<DeployHostCitationRow> = {}): DeployHostCitationRow => ({
  id: over.id || 'a1',
  sourceName: 'dept-faculty-roster',
  sourceUrl: `${DEPLOY_HOST}/people/faculty-and-staff/example-person`,
  field: 'profileUrls',
  entityType: 'user',
  ...over,
});

describe('deployHostOf', () => {
  it('names the host only for a platform-assigned deploy target', () => {
    expect(deployHostOf(`${DEPLOY_HOST}/people`)).toBe(
      'ysoa-2025-nuxt-production-fqvp7.ondigitalocean.app',
    );
    expect(deployHostOf('https://www.art.yale.edu/people')).toBeNull();
    expect(deployHostOf(undefined)).toBeNull();
  });
});

describe('planDeployHostCitationRetirement', () => {
  it('splits the population by stored state and leaves an already-retired row alone', () => {
    const plan = planDeployHostCitationRetirement([
      row({ id: 'active-1' }),
      row({ id: 'active-2', field: 'title' }),
      row({ id: 'superseded-1', superseded: true }),
      row({ id: 'retired-1', superseded: true, alreadyRolledBack: true }),
    ]);

    expect(plan.active.map((entry) => entry.id)).toEqual(['active-1', 'active-2']);
    expect(plan.supersededOnly.map((entry) => entry.id)).toEqual(['superseded-1']);
    expect(plan.alreadyRetired).toBe(1);
    expect(plan.byHost).toEqual([['ysoa-2025-nuxt-production-fqvp7.ondigitalocean.app', 4]]);
    expect(plan.byLaneField).toEqual([
      ['dept-faculty-roster/profileUrls', 3],
      ['dept-faculty-roster/title', 1],
    ]);
  });

  /**
   * #2805's triage proposed retracting every `dept-faculty-roster` row whose sourceUrl
   * host is not a Yale host. On Development that reads 239 active rows, 139 of which are
   * the lane legitimately quoting a professor's own site, so the predicate has to ask
   * about the host's durability rather than about the lane.
   */
  it('keeps a lane citing a durable non-Yale host, which is legitimate evidence', () => {
    const plan = planDeployHostCitationRetirement([
      row({ id: 'personal-site', sourceUrl: 'https://example-lab.org/', field: 'bio' }),
      row({ id: 'chosen-subdomain', sourceUrl: 'https://example-lab.github.io/', field: 'bio' }),
      row({ id: 'yale', sourceUrl: 'https://www.art.yale.edu/people' }),
      row({ id: 'deploy-host' }),
    ]);

    expect(plan.active.map((entry) => entry.id)).toEqual(['deploy-host']);
    expect(plan.scanned).toBe(4);
  });

  it('ignores a row with no citation at all', () => {
    const plan = planDeployHostCitationRetirement([row({ id: 'no-url', sourceUrl: undefined })]);
    expect(plan.active).toEqual([]);
    expect(plan.supersededOnly).toEqual([]);
  });
});

describe('countDeployHostCitations', () => {
  /**
   * The Mongo prefilter that selects rows is an unanchored substring match, so it also
   * hands over a durable host that merely contains a deploy domain. Counting those would
   * report a complete repair as incomplete.
   */
  it('counts only rows the predicate judges, not every prefiltered row', () => {
    const counts = countDeployHostCitations([
      row({ id: 'lookalike-host', sourceUrl: 'https://notondigitalocean.app/lab' }),
      row({
        id: 'domain-in-query',
        sourceUrl: 'https://example.com/redirect?to=https://x.ondigitalocean.app/',
      }),
      row({ id: 'retired', superseded: true, alreadyRolledBack: true }),
    ]);

    expect(counts).toEqual({ active: 0, inReadScope: 0 });
  });

  it('separates rows still active from rows still inside the lossless read scope', () => {
    const counts = countDeployHostCitations([
      row({ id: 'active' }),
      row({ id: 'superseded-unstamped', superseded: true }),
      row({ id: 'retired', superseded: true, alreadyRolledBack: true }),
    ]);

    expect(counts).toEqual({ active: 1, inReadScope: 2 });
  });
});

describe('countDeployHostEntityUrls', () => {
  /**
   * Retiring the Observations does not rewrite the materialized entity fields, so the
   * apply report has to say separately how many entities still store a deploy host.
   */
  it('reports the entities still storing a deploy host, by field', () => {
    expect(
      countDeployHostEntityUrls([
        { id: 'both', websiteUrl: `${DEPLOY_HOST}/`, sourceUrls: [`${DEPLOY_HOST}/people`] },
        { id: 'website-only', websiteUrl: `${DEPLOY_HOST}/`, sourceUrls: ['https://art.yale.edu/'] },
        {
          id: 'sources-only',
          websiteUrl: 'https://art.yale.edu/',
          sourceUrls: ['https://art.yale.edu/', `${DEPLOY_HOST}/people`],
        },
        { id: 'clean', websiteUrl: 'https://art.yale.edu/', sourceUrls: ['https://art.yale.edu/'] },
      ]),
    ).toEqual({ entities: 3, websiteUrl: 2, sourceUrls: 2 });
  });

  it('counts only what the predicate judges, not every prefiltered row', () => {
    expect(
      countDeployHostEntityUrls([
        { id: 'lookalike', websiteUrl: 'https://notondigitalocean.app/lab' },
        { id: 'domain-in-query', sourceUrls: ['https://example.com/?to=https://x.ngrok.io/'] },
        { id: 'no-urls' },
      ]),
    ).toEqual({ entities: 0, websiteUrl: 0, sourceUrls: 0 });
  });
});

describe('budgetDeployHostCitationWrites', () => {
  it('shares one --limit budget across both write sets', () => {
    const plan = planDeployHostCitationRetirement([
      row({ id: 'active-1' }),
      row({ id: 'active-2' }),
      row({ id: 'superseded-1', superseded: true }),
      row({ id: 'superseded-2', superseded: true }),
    ]);

    const budgeted = budgetDeployHostCitationWrites(plan, 3);
    expect(budgeted.active.map((entry) => entry.id)).toEqual(['active-1', 'active-2']);
    expect(budgeted.supersededOnly.map((entry) => entry.id)).toEqual(['superseded-1']);

    expect(budgetDeployHostCitationWrites(plan, 2).supersededOnly).toEqual([]);
    expect(budgetDeployHostCitationWrites(plan).active).toHaveLength(2);
    expect(budgetDeployHostCitationWrites(plan).supersededOnly).toHaveLength(2);
  });
});

describe('parseRetireDeployHostCitationsArgs', () => {
  it('is dry-run by default and needs the confirm flag paired with --apply', () => {
    expect(parseRetireDeployHostCitationsArgs([])).toEqual({ dryRun: true, confirmed: false });
    expect(
      parseRetireDeployHostCitationsArgs(['--apply', CONFIRM_RETIRE_DEPLOY_HOST_CITATIONS]),
    ).toEqual({ dryRun: false, confirmed: true });
    expect(parseRetireDeployHostCitationsArgs(['--limit=25']).limit).toBe(25);
    expect(() => parseRetireDeployHostCitationsArgs(['--limit=0'])).toThrow(/positive integer/);
    expect(() => parseRetireDeployHostCitationsArgs(['--nope'])).toThrow(/Unknown argument/);
  });
});

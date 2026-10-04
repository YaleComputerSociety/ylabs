import { afterEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import mongoose from 'mongoose';
import {
  NihReporterScraper,
  groupGrantsByCreditedPi,
  latestContactPiAffiliations,
  nonContactPiProfileIds,
  type ContactPiAffiliation,
  type NihGrant,
} from '../sources/nihReporterScraper';
import type { ObservationInput, ScraperContext } from '../types';

const CONTACT = 101;
const YALE_CO_PI = 202;
const OUTSIDE_CO_PI = 303;
const UNKNOWN_CO_PI = 404;

const multiPiGrant: NihGrant = {
  appl_id: 1,
  project_num: '5R01GM000001-02',
  core_project_num: 'R01GM000001',
  project_title: 'Synthetic multi-PI project',
  activity_code: 'R01',
  fiscal_year: 2026,
  project_start_date: '2025-04-01T00:00:00',
  project_end_date: '2029-03-31T00:00:00',
  organization: { org_name: 'YALE UNIVERSITY' },
  principal_investigators: [
    { profile_id: CONTACT, first_name: 'Avery', last_name: 'Contactlead', is_contact_pi: true },
    { profile_id: YALE_CO_PI, first_name: 'Blair', last_name: 'Yalecopi', is_contact_pi: false },
    { profile_id: OUTSIDE_CO_PI, first_name: 'Casey', last_name: 'Namesake', is_contact_pi: false },
    {
      profile_id: UNKNOWN_CO_PI,
      first_name: 'Devon',
      last_name: 'Nocontact',
      is_contact_pi: false,
    },
  ],
};

const project = (profileId: number, fiscalYear: number, orgName: string): NihGrant => ({
  fiscal_year: fiscalYear,
  organization: { org_name: orgName },
  principal_investigators: [{ profile_id: profileId, is_contact_pi: true }],
});

function makeContext() {
  const emitted: ObservationInput[] = [];
  const ctx: ScraperContext = {
    scrapeRunId: 'test-run',
    sourceId: 'test-source',
    sourceName: 'nih-reporter',
    sourceWeight: 0.9,
    options: { dryRun: true, useCache: false, release: false },
    emit: async (obs) => {
      emitted.push(...(Array.isArray(obs) ? obs : [obs]));
    },
    log: () => {},
  };
  return { ctx, emitted };
}

function stubYaleGrants(results: NihGrant[]) {
  vi.spyOn(axios, 'post').mockImplementation(async (_url, body) => {
    const offset = (body as any).offset || 0;
    return {
      data: {
        meta: { total: results.length, offset, limit: 500 },
        results: offset === 0 ? results : [],
      },
    } as any;
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('multi-PI attribution helpers', () => {
  it('lists only the PIs who are never a contact PI in the window', () => {
    expect(nonContactPiProfileIds([multiPiGrant]).sort()).toEqual(
      [YALE_CO_PI, OUTSIDE_CO_PI, UNKNOWN_CO_PI].sort(),
    );
  });

  it('reads affiliation from the latest contact-PI project and fails closed on a split year', () => {
    const affiliations = latestContactPiAffiliations(
      [
        project(YALE_CO_PI, 2019, 'ELSEWHERE UNIVERSITY'),
        project(YALE_CO_PI, 2024, 'YALE UNIVERSITY'),
        project(OUTSIDE_CO_PI, 2025, 'ELSEWHERE UNIVERSITY'),
        project(UNKNOWN_CO_PI, 2025, 'YALE UNIVERSITY'),
        project(UNKNOWN_CO_PI, 2025, 'ELSEWHERE UNIVERSITY'),
      ],
      new Set([YALE_CO_PI, OUTSIDE_CO_PI, UNKNOWN_CO_PI]),
    );
    expect(affiliations.get(YALE_CO_PI)).toEqual({ fiscalYear: 2024, atYale: true });
    expect(affiliations.get(OUTSIDE_CO_PI)?.atYale).toBe(false);
    expect(affiliations.get(UNKNOWN_CO_PI)?.atYale).toBe(false);
  });

  it('groups a grant under its contact PI and every credited co-PI only', () => {
    const groups = groupGrantsByCreditedPi([multiPiGrant], new Set([CONTACT, YALE_CO_PI]));
    expect([...groups.keys()]).toHaveLength(2);
    expect([...groups.keys()].some((name) => /Namesake/i.test(name))).toBe(false);
  });
});

describe('NihReporterScraper multi-PI run', () => {
  const ids = new Map<string, mongoose.Types.ObjectId>();
  const resolveResearcherId = async (name: string) => {
    const key =
      name.split(/[ ,]+/).find((part) => /lead|copi|namesake|nocontact/i.test(part)) ?? name;
    if (!ids.has(key)) ids.set(key, new mongoose.Types.ObjectId());
    return { status: 'matched' as const, researcherId: ids.get(key)! };
  };

  const scraperWith = (affiliations: Map<number, ContactPiAffiliation> | Error) =>
    new NihReporterScraper({
      resolveResearcherId,
      loadResearcherProfileTitle: async () => undefined,
      researchHomeResolver: async (researcherId) => ({
        status: 'canonical',
        slug: `row-${researcherId}`,
      }),
      lookupContactPiAffiliations: async () => {
        if (affiliations instanceof Error) throw affiliations;
        return affiliations;
      },
    });

  it('credits a co-PI whose latest contact-PI project is at Yale as a full PI', async () => {
    stubYaleGrants([multiPiGrant]);
    const { ctx, emitted } = makeContext();
    const result = await scraperWith(
      new Map([
        [YALE_CO_PI, { fiscalYear: 2024, atYale: true }],
        [OUTSIDE_CO_PI, { fiscalYear: 2025, atYale: false }],
      ]),
    ).run(ctx);

    const grantRows = emitted.filter((o) => o.field === 'recentGrants');
    expect(grantRows).toHaveLength(2);
    for (const row of grantRows) {
      expect((row.value as Array<{ role: string }>).map((g) => g.role)).toEqual(['pi']);
    }
    expect(result.entitiesObserved).toBe(2);
    expect(result.notes).toMatch(/1 credited/);
    expect(result.notes).toMatch(/1 refused \(latest contact-PI project elsewhere\)/);
    expect(result.notes).toMatch(/1 refused \(never a contact PI/);
  });

  it('never credits a co-PI at another institution to a same-name Yale researcher', async () => {
    stubYaleGrants([multiPiGrant]);
    const { ctx, emitted } = makeContext();
    await scraperWith(new Map([[OUTSIDE_CO_PI, { fiscalYear: 2025, atYale: false }]])).run(ctx);

    const namesakeRow = `row-${ids.get('Namesake')}`;
    expect(emitted.some((o) => o.entityKey === namesakeRow)).toBe(false);
    expect(emitted.filter((o) => o.field === 'recentGrants')).toHaveLength(1);
  });

  it('credits contact PIs only when the affiliation lookup fails', async () => {
    stubYaleGrants([multiPiGrant]);
    const { ctx, emitted } = makeContext();
    const result = await scraperWith(new Error('socket hang up')).run(ctx);

    expect(emitted.filter((o) => o.field === 'recentGrants')).toHaveLength(1);
    expect(result.notes).toMatch(/affiliation lookup failed, so none credited/);
  });

  it('emits one award once when two credited PIs share a row', async () => {
    stubYaleGrants([multiPiGrant]);
    const { ctx, emitted } = makeContext();
    await new NihReporterScraper({
      resolveResearcherId,
      loadResearcherProfileTitle: async () => undefined,
      researchHomeResolver: async () => ({ status: 'canonical', slug: 'shared-row' }),
      lookupContactPiAffiliations: async () =>
        new Map([[YALE_CO_PI, { fiscalYear: 2024, atYale: true }]]),
    }).run(ctx);

    const grants = emitted.filter((o) => o.field === 'recentGrants');
    expect(grants).toHaveLength(1);
    expect(grants[0].value as unknown[]).toHaveLength(1);
    expect(emitted.find((o) => o.field === 'recentGrantCount')?.value).toBe(1);
    expect(emitted.some((o) => o.field === 'inferredPiUserId')).toBe(false);
  });
});

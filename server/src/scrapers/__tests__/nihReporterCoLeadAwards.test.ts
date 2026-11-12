import { afterEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import mongoose from 'mongoose';
import {
  NihReporterScraper,
  coLedAwardRowSlugs,
  type NihGrant,
} from '../sources/nihReporterScraper';
import {
  coLedOfficialLeadRows,
  type CanonicalResearchHomeResolution,
  type OfficialLeadRow,
} from '../canonicalResearchHomeResolver';
import type { ObservationInput, ScraperContext } from '../types';

const coLead = new mongoose.Types.ObjectId().toString();
const partner = new mongoose.Types.ObjectId().toString();
const otherPartner = new mongoose.Types.ObjectId().toString();
const soloLead = new mongoose.Types.ObjectId().toString();

const researcherByLastName = new Map([
  ['Colead', coLead],
  ['Partner', partner],
  ['Otherpartner', otherPartner],
  ['Sololead', soloLead],
]);

const award = (
  applId: number,
  core: string,
  investigators: Array<{ profileId: number; first: string; last: string; contact: boolean }>,
): NihGrant => ({
  appl_id: applId,
  project_num: `5${core}-02`,
  core_project_num: core,
  project_title: `Synthetic project ${core}`,
  activity_code: 'R01',
  fiscal_year: 2026,
  project_start_date: '2025-04-01T00:00:00',
  project_end_date: '2029-03-31T00:00:00',
  organization: { org_name: 'YALE UNIVERSITY' },
  principal_investigators: investigators.map((pi) => ({
    profile_id: pi.profileId,
    first_name: pi.first,
    last_name: pi.last,
    is_contact_pi: pi.contact,
  })),
});

const CO_LEAD_PI = { profileId: 11, first: 'Avery', last: 'Colead' };
const PARTNER_PI = { profileId: 22, first: 'Blair', last: 'Partner' };
const SOLO_PI = { profileId: 44, first: 'Devon', last: 'Sololead' };

const coLeadSoleAward = award(1, 'R01GM000101', [{ ...CO_LEAD_PI, contact: true }]);
const coLeadWithPartnerAward = award(2, 'R01GM000102', [
  { ...CO_LEAD_PI, contact: true },
  { ...PARTNER_PI, contact: false },
]);
const partnerSoleAward = award(3, 'R01GM000103', [{ ...PARTNER_PI, contact: true }]);
const soloLeadAward = award(4, 'R01GM000104', [{ ...SOLO_PI, contact: true }]);

const officialLeadRows = new Map<string, OfficialLeadRow[]>([
  [
    coLead,
    [
      { slug: 'shared-with-partner', leadPersonIds: [coLead, partner] },
      { slug: 'shared-with-other-partner', leadPersonIds: [coLead, otherPartner] },
      { slug: 'co-lead-own-row', leadPersonIds: [coLead] },
    ],
  ],
  [
    soloLead,
    [
      { slug: 'solo-first-row', leadPersonIds: [soloLead] },
      { slug: 'solo-second-row', leadPersonIds: [soloLead] },
    ],
  ],
]);

const rowResolution = new Map<string, CanonicalResearchHomeResolution>([
  [coLead, { status: 'ambiguous' }],
  [partner, { status: 'canonical', slug: 'shared-with-partner' }],
  [soloLead, { status: 'ambiguous' }],
]);

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

const scraper = () =>
  new NihReporterScraper({
    resolveCorroborated: async () => ({ status: 'absent' as const }),
    resolveResearcherId: async (name: string) => {
      const lastName = [...researcherByLastName.keys()].find((last) => name.includes(last));
      const researcherId = lastName ? researcherByLastName.get(lastName) : undefined;
      return researcherId
        ? { status: 'matched' as const, researcherId: new mongoose.Types.ObjectId(researcherId) }
        : { status: 'absent' as const };
    },
    loadResearcherProfileTitle: async () => undefined,
    researchHomeResolver: async (researcherId) =>
      rowResolution.get(researcherId) ?? { status: 'safe-shell' },
    officialLeadRowsLoader: async (researcherId) => officialLeadRows.get(researcherId) ?? [],
    lookupContactPiAffiliations: async () =>
      new Map([[PARTNER_PI.profileId, { fiscalYear: 2025, atYale: true }]]),
    loadLegacyGrantObservations: async () => [],
  });

const awardIdsBySlug = (emitted: ObservationInput[]) =>
  Object.fromEntries(
    emitted
      .filter((obs) => obs.field === 'recentGrants')
      .map((obs) => [
        obs.entityKey,
        (obs.value as Array<{ id: string }>).map((grant) => grant.id).sort(),
      ]),
  );

afterEach(() => {
  vi.restoreAllMocks();
});

describe('co-led row selection', () => {
  it('keeps only the rows the researcher leads with someone else', () => {
    expect(coLedOfficialLeadRows(officialLeadRows.get(coLead)!, coLead).map((r) => r.slug)).toEqual(
      ['shared-with-partner', 'shared-with-other-partner'],
    );
    expect(coLedOfficialLeadRows(officialLeadRows.get(soloLead)!, soloLead)).toEqual([]);
  });

  it('sends an award to the co-led row it shares with another of its PIs', () => {
    const rows = coLedOfficialLeadRows(officialLeadRows.get(coLead)!, coLead);
    const lookup = (pi: { last_name?: string }) =>
      pi.last_name ? researcherByLastName.get(pi.last_name) : undefined;
    expect(coLedAwardRowSlugs([coLeadWithPartnerAward], coLead, rows, lookup)).toEqual([
      'shared-with-partner',
    ]);
    expect(coLedAwardRowSlugs([coLeadSoleAward], coLead, rows, lookup)).toEqual([
      'shared-with-partner',
      'shared-with-other-partner',
    ]);
  });
});

describe('NihReporterScraper co-lead of several rows', () => {
  it("attaches a co-lead's awards to their co-led rows and never to a solely-led row", async () => {
    stubYaleGrants([coLeadSoleAward, coLeadWithPartnerAward, partnerSoleAward, soloLeadAward]);
    const { ctx, emitted } = makeContext();
    const result = await scraper().run(ctx);

    const coLeadSoleId = String(coLeadSoleAward.core_project_num);
    const sharedId = String(coLeadWithPartnerAward.core_project_num);
    const partnerSoleId = String(partnerSoleAward.core_project_num);
    const grants = awardIdsBySlug(emitted);
    expect(Object.keys(grants).sort()).toEqual([
      'shared-with-other-partner',
      'shared-with-partner',
    ]);
    expect(grants['shared-with-partner']).toEqual([coLeadSoleId, sharedId, partnerSoleId].sort());
    expect(grants['shared-with-other-partner']).toEqual([coLeadSoleId]);
    expect(result.notes).toMatch(/2 ambiguous row/);
    expect(result.notes).toMatch(
      /1 PI\(s\) of an ambiguous row attached 2 award\(s\) to 2 co-led row/,
    );
  });

  it('never names the co-lead as the inferred PI of a row they reach only as a co-lead', async () => {
    stubYaleGrants([coLeadSoleAward, partnerSoleAward]);
    const { ctx, emitted } = makeContext();
    await scraper().run(ctx);

    const inferred = emitted.filter((obs) => obs.field === 'inferredPiUserId');
    expect(inferred).toEqual([
      expect.objectContaining({ entityKey: 'shared-with-partner', value: partner }),
    ]);
  });

  it('records the co-lead as the contact investigator on the attached award', async () => {
    stubYaleGrants([coLeadSoleAward]);
    const { ctx, emitted } = makeContext();
    await scraper().run(ctx);

    const grants = emitted.find(
      (obs) => obs.field === 'recentGrants' && obs.entityKey === 'shared-with-other-partner',
    )?.value as Array<{ investigators?: Array<{ contact: boolean; researcherId?: string }> }>;
    expect(grants[0].investigators).toEqual([
      expect.objectContaining({ contact: true, researcherId: coLead }),
    ]);
  });

  it('emits the same observations on a second run', async () => {
    stubYaleGrants([coLeadSoleAward, coLeadWithPartnerAward, partnerSoleAward, soloLeadAward]);
    const first = makeContext();
    await scraper().run(first.ctx);
    const second = makeContext();
    await scraper().run(second.ctx);

    expect(second.emitted).toEqual(first.emitted);
  });
});

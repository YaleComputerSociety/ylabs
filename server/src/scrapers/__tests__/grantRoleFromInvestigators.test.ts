import axios from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { aggregateResearchEntityGrantEvidence } from '../entityMaterializer';
import { NihReporterScraper, type NihGrant } from '../sources/nihReporterScraper';
import { buildRowObservations, type NsfAward } from '../sources/nsfAwardScraper';
import type { ObservationInput, ScraperContext } from '../types';

const LEAD = 'researcher-lead';
const OTHER = 'researcher-other';
const LEADS = new Set([LEAD]);

const award = (id: string, investigators?: unknown[]) => ({
  id,
  agency: 'NIGMS',
  title: `Synthetic award ${id}`,
  abstract: '',
  startDate: new Date('2025-01-01T00:00:00Z'),
  endDate: new Date('2999-01-01T00:00:00Z'),
  dollarAmount: 1,
  url: `https://reporter.nih.gov/project-details/${id}`,
  role: 'pi',
  ...(investigators ? { investigators } : {}),
});

const observation = (field: string, value: unknown, sourceName = 'nih-reporter') => ({
  field,
  value,
  sourceName,
  observedAt: new Date('2026-02-01T00:00:00Z'),
});

const laneSnapshot = (awards: ReturnType<typeof award>[], agencies = ['NIH']) => [
  observation('recentGrants', awards),
  observation('recentGrantPeriods', awards),
  observation('recentGrantCount', awards.length),
  observation('fundingAgencies', agencies),
];

const byId = (entries: unknown[] | undefined) =>
  Object.fromEntries((entries ?? []).map((entry: any) => [entry.id, entry]));

describe('a grant entry is labelled with the row lead role on that award (#5779)', () => {
  const mixed = [
    award('R01GM000001', [{ contact: true, researcherId: LEAD, profileId: 1 }]),
    award('R01GM000002', [{ contact: true, researcherId: OTHER, profileId: 2 }]),
    award('R01GM000003', [
      { contact: true, researcherId: OTHER, profileId: 2 },
      { contact: false, researcherId: LEAD, profileId: 1 },
    ]),
  ];

  it('does not serve another person sole-PI award as the lead award', () => {
    const evidence = aggregateResearchEntityGrantEvidence(laneSnapshot(mixed), LEADS);
    expect(Object.keys(byId(evidence.recentGrants))).not.toContain('R01GM000002');
    expect(Object.keys(byId(evidence.recentGrantPeriods))).not.toContain('R01GM000002');
    expect(evidence.recentGrantCount).toBe(2);
  });

  it('labels the lead as copi where the lead is another listed PI', () => {
    const evidence = aggregateResearchEntityGrantEvidence(laneSnapshot(mixed), LEADS);
    expect(byId(evidence.recentGrants).R01GM000003.role).toBe('copi');
  });

  it('keeps the contact PI as pi', () => {
    const evidence = aggregateResearchEntityGrantEvidence(laneSnapshot(mixed), LEADS);
    expect(byId(evidence.recentGrants).R01GM000001.role).toBe('pi');
  });

  it('never stores the investigator list on the row', () => {
    const evidence = aggregateResearchEntityGrantEvidence(laneSnapshot(mixed), LEADS);
    for (const entry of [...evidence.recentGrants!, ...evidence.recentGrantPeriods!]) {
      expect(entry).not.toHaveProperty('investigators');
    }
  });

  it('holds a legacy entry with no recorded list without defaulting it to pi', () => {
    const evidence = aggregateResearchEntityGrantEvidence(
      laneSnapshot([award('R01GM000009')]),
      LEADS,
    );
    expect(evidence.recentGrants).toHaveLength(1);
    expect(evidence.recentGrants![0]).not.toHaveProperty('role');
    expect(evidence.recentGrantCount).toBe(1);
  });

  it('withholds every listed award when the row has no lead', () => {
    const evidence = aggregateResearchEntityGrantEvidence(laneSnapshot(mixed), new Set());
    expect(evidence.recentGrants).toEqual([]);
    expect(evidence.recentGrantCount).toBe(0);
  });

  it('drops a lane agency once every award from that lane is withheld', () => {
    const evidence = aggregateResearchEntityGrantEvidence(
      [
        ...laneSnapshot([award('R01GM000002', [{ contact: true, researcherId: OTHER }])]),
        ...laneSnapshot([award('2400001', [{ contact: true, researcherId: LEAD }])], ['NSF']).map(
          (entry) => ({ ...entry, sourceName: 'nsf-awards' }),
        ),
      ],
      LEADS,
    );
    expect(evidence.fundingAgencies).toEqual(['NSF']);
  });

  it('derives the same output on a second resolve', () => {
    const first = aggregateResearchEntityGrantEvidence(laneSnapshot(mixed), LEADS);
    const second = aggregateResearchEntityGrantEvidence(laneSnapshot(mixed), LEADS);
    expect(second).toEqual(first);
    const reread = aggregateResearchEntityGrantEvidence(
      [
        observation('recentGrants', first.recentGrants),
        observation('recentGrantPeriods', first.recentGrantPeriods),
        observation('recentGrantCount', first.recentGrantCount),
        observation('fundingAgencies', first.fundingAgencies),
      ],
      LEADS,
    );
    expect(byId(reread.recentGrants).R01GM000001).toMatchObject({ id: 'R01GM000001' });
    expect(Object.keys(byId(reread.recentGrants)).sort()).toEqual(
      Object.keys(byId(first.recentGrants)).sort(),
    );
  });
});

describe('the NIH lane records each award PI list (#5779)', () => {
  afterEach(() => vi.restoreAllMocks());

  const LEAD_PROFILE = 11;
  const OTHER_PROFILE = 22;
  const OUTSIDE_PROFILE = 33;
  const grant = (applId: number, pis: NihGrant['principal_investigators']): NihGrant => ({
    appl_id: applId,
    project_num: `5R01GM00000${applId}-02`,
    core_project_num: `R01GM00000${applId}`,
    project_title: `Synthetic project ${applId}`,
    activity_code: 'R01',
    fiscal_year: 2026,
    project_start_date: '2025-04-01T00:00:00',
    project_end_date: '2999-03-31T00:00:00',
    organization: { org_name: 'YALE UNIVERSITY' },
    principal_investigators: pis,
  });

  it('lists the contact flag, the profile id and the researcher the lane resolved', async () => {
    const results = [
      grant(1, [
        {
          profile_id: LEAD_PROFILE,
          first_name: 'Avery',
          last_name: 'Leadperson',
          is_contact_pi: true,
        },
      ]),
      grant(2, [
        {
          profile_id: OTHER_PROFILE,
          first_name: 'Blair',
          last_name: 'Leadperson',
          is_contact_pi: true,
        },
      ]),
      grant(3, [
        {
          profile_id: LEAD_PROFILE,
          first_name: 'Avery',
          last_name: 'Leadperson',
          is_contact_pi: true,
        },
        {
          profile_id: OUTSIDE_PROFILE,
          first_name: 'Casey',
          last_name: 'Elsewhere',
          is_contact_pi: false,
        },
      ]),
    ];
    vi.spyOn(axios, 'post').mockImplementation(
      async (_url, body) =>
        ({
          data: {
            meta: { total: results.length, offset: (body as any).offset || 0, limit: 500 },
            results: ((body as any).offset || 0) === 0 ? results : [],
          },
        }) as any,
    );
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
    const ids: Record<string, string> = { 'Avery Leadperson': LEAD, 'Blair Leadperson': OTHER };
    await new NihReporterScraper({
      fiscalYears: [2026],
      resolveResearcherId: async (name: string) =>
        ids[name]
          ? ({ status: 'matched', researcherId: ids[name] } as any)
          : ({ status: 'absent' } as any),
      loadResearcherProfileTitle: async () => 'Professor',
      researchHomeResolver: async () =>
        ({ status: 'canonical', slug: 'synthetic-shared-row' }) as any,
      lookupContactPiAffiliations: async () => new Map(),
    }).run(ctx);

    const grants = emitted.find((obs) => obs.field === 'recentGrants')!.value as any[];
    const listed = Object.fromEntries(grants.map((entry) => [entry.id, entry.investigators]));
    expect(listed.R01GM000001).toEqual([
      { contact: true, profileId: LEAD_PROFILE, researcherId: LEAD },
    ]);
    expect(listed.R01GM000002).toEqual([
      { contact: true, profileId: OTHER_PROFILE, researcherId: OTHER },
    ]);
    expect(listed.R01GM000003).toEqual([
      { contact: true, profileId: LEAD_PROFILE, researcherId: LEAD },
      { contact: false, profileId: OUTSIDE_PROFILE },
    ]);

    const served = aggregateResearchEntityGrantEvidence(
      emitted.map((obs) => ({ ...obs, observedAt: new Date('2026-02-01T00:00:00Z') })) as any,
      LEADS,
    );
    expect(Object.keys(byId(served.recentGrants)).sort()).toEqual(['R01GM000001', 'R01GM000003']);
  });
});

describe('the NSF lane records the credited researcher on each award (#5779)', () => {
  const nsfAward = (id: string): NsfAward => ({
    id,
    title: `Synthetic NSF award ${id}`,
    startDate: '01/01/2025',
    expDate: '01/01/2999',
  });

  it('labels a pooled co-PI credit as copi for the lead and withholds the other credit', () => {
    const observations = buildRowObservations(
      [
        { award: nsfAward('2400001'), role: 'copi', researcherId: LEAD },
        { award: nsfAward('2400001'), role: 'pi', researcherId: OTHER },
        { award: nsfAward('2400002'), role: 'pi', researcherId: OTHER },
      ],
      undefined,
      'synthetic-shared-row',
    );
    const served = aggregateResearchEntityGrantEvidence(
      observations.map((obs) => ({
        ...obs,
        sourceName: 'nsf-awards',
        observedAt: new Date('2026-02-01T00:00:00Z'),
      })) as any,
      LEADS,
    );
    expect(served.recentGrants!.map((entry: any) => [entry.id, entry.role])).toEqual([
      ['2400001', 'copi'],
    ]);
  });
});

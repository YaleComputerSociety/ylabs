import axios from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { aggregateResearchEntityGrantEvidence } from '../entityMaterializer';
import {
  NihReporterScraper,
  relistedLegacyGrantObservations,
  type LegacyGrantObservation,
  type NihGrant,
} from '../sources/nihReporterScraper';
import type { ObservationInput, ScraperContext } from '../types';

const LEAD = 'researcher-lead';
const OTHER = 'researcher-other';
const READ_AT = new Date('2026-07-25T08:00:00Z');

const project = (
  coreNumber: string,
  contact: { profileId: number; first: string; last: string },
  coPi?: { profileId: number; first: string; last: string },
  fiscalYear = 2026,
): NihGrant => ({
  appl_id: Number(coreNumber.replace(/\D/g, '')) * 10000 + fiscalYear,
  project_num: `5${coreNumber}-03`,
  core_project_num: coreNumber,
  fiscal_year: fiscalYear,
  organization: { org_name: 'YALE UNIVERSITY' },
  principal_investigators: [
    {
      profile_id: contact.profileId,
      first_name: contact.first,
      last_name: contact.last,
      is_contact_pi: true,
    },
    ...(coPi
      ? [
          {
            profile_id: coPi.profileId,
            first_name: coPi.first,
            last_name: coPi.last,
            is_contact_pi: false,
          },
        ]
      : []),
  ],
});

const lead = { profileId: 11, first: 'Avery', last: 'Leadperson' };
const other = { profileId: 22, first: 'Blair', last: 'Leadperson' };

const legacyEntry = (id: string) => ({
  id,
  agency: 'NIGMS',
  title: `Synthetic legacy award ${id}`,
  abstract: '',
  startDate: new Date('2022-01-01T00:00:00Z'),
  endDate: new Date('2999-01-01T00:00:00Z'),
  dollarAmount: 1,
  url: `https://reporter.nih.gov/project-details/${id}`,
  role: 'pi',
});

const legacyObservations = (): LegacyGrantObservation[] => [
  {
    entityKey: 'synthetic-merged-in-key',
    field: 'recentGrants',
    value: [legacyEntry('R01GM000001'), legacyEntry('5R01GM000002-03'), legacyEntry('R01GM000099')],
    observedAt: READ_AT,
  },
  {
    entityKey: 'synthetic-row-read-this-run',
    field: 'recentGrants',
    value: [legacyEntry('R01GM000001')],
    observedAt: READ_AT,
  },
];

const projects = [project('R01GM000001', lead), project('R01GM000002', other, lead)];
const researcherFor = (name: string) =>
  ({ 'Avery Leadperson': LEAD, 'Blair Leadperson': OTHER })[name];

describe('relisting a legacy NIH grant observation with its PI list (#5779)', () => {
  const lookup = (pi: { first_name?: string; last_name?: string }) =>
    researcherFor(`${pi.first_name} ${pi.last_name}`);

  it('attaches the PI list by award number, keeps the read time, and skips keys read this run', () => {
    const relisted = relistedLegacyGrantObservations(
      legacyObservations(),
      projects,
      (pi) => lookup(pi),
      new Set(['synthetic-row-read-this-run']),
    );
    expect(relisted.observations).toHaveLength(1);
    const [observation] = relisted.observations;
    expect(observation).toMatchObject({
      entityKey: 'synthetic-merged-in-key',
      field: 'recentGrants',
      observedAt: READ_AT,
    });
    const entries = observation.value as Array<Record<string, any>>;
    expect(entries[0].investigators).toEqual([
      { contact: true, profileId: 11, researcherId: LEAD, name: 'Avery Leadperson' },
    ]);
    expect(entries[1].investigators).toEqual([
      { contact: true, profileId: 22, researcherId: OTHER, name: 'Blair Leadperson' },
      { contact: false, profileId: 11, researcherId: LEAD, name: 'Avery Leadperson' },
    ]);
    expect(entries[2]).not.toHaveProperty('investigators');
    expect(relisted).toMatchObject({ listed: 2, unmatched: 1 });
  });

  it('holds an award whose credited PI the resolver could not settle', () => {
    const relisted = relistedLegacyGrantObservations(
      legacyObservations(),
      projects,
      (pi) => (pi.profile_id === 22 ? null : lookup(pi)),
      new Set(['synthetic-row-read-this-run']),
    );
    const entries = relisted.observations[0].value as Array<Record<string, any>>;
    expect(entries[1]).not.toHaveProperty('investigators');
    expect(relisted).toMatchObject({ listed: 1, unresolved: 1, unmatched: 1 });
  });

  it('relists nothing on a second pass over its own output', () => {
    const first = relistedLegacyGrantObservations(
      legacyObservations(),
      projects,
      (pi) => lookup(pi),
      new Set(),
    );
    const again = relistedLegacyGrantObservations(
      first.observations.map((observation) => ({
        entityKey: observation.entityKey!,
        field: observation.field as LegacyGrantObservation['field'],
        value: (observation.value as unknown[]).filter(
          (entry: any) => entry.investigators !== undefined,
        ),
      })),
      projects,
      (pi) => lookup(pi),
      new Set(),
    );
    expect(again.observations).toEqual([]);
  });
});

describe('a lane run relists legacy awards so another person award stops being served (#5779)', () => {
  afterEach(() => vi.restoreAllMocks());

  const runLane = async (
    lookupProjectsByNumber: (numbers: string[]) => Promise<NihGrant[]>,
    loadLegacyGrantObservations: () => Promise<LegacyGrantObservation[]> = async () =>
      legacyObservations(),
  ) => {
    vi.spyOn(axios, 'post').mockResolvedValue({
      data: { meta: { total: 0, offset: 0, limit: 500 }, results: [] },
    } as any);
    const emitted: ObservationInput[] = [];
    const logs: string[] = [];
    const ctx: ScraperContext = {
      scrapeRunId: 'test-run',
      sourceId: 'test-source',
      sourceName: 'nih-reporter',
      sourceWeight: 0.9,
      options: { dryRun: true, useCache: false, release: false },
      emit: async (obs) => {
        emitted.push(...(Array.isArray(obs) ? obs : [obs]));
      },
      log: (line) => logs.push(line),
    };
    const result = await new NihReporterScraper({
      fiscalYears: [2026],
      resolveResearcherId: async (name: string) =>
        researcherFor(name)
          ? ({ status: 'matched', researcherId: researcherFor(name) } as any)
          : ({ status: 'absent' } as any),
      loadResearcherProfileTitle: async () => 'Professor',
      researchHomeResolver: async () => ({ status: 'canonical', slug: 'synthetic-row' }) as any,
      lookupContactPiAffiliations: async () => new Map(),
      loadLegacyGrantObservations,
      lookupProjectsByNumber,
    }).run({
      ...ctx,
      options: { ...ctx.options },
    } as ScraperContext);
    return { emitted, logs, result };
  };

  it('withholds the other person sole-PI award and keeps the lead award as pi', async () => {
    const { emitted } = await runLane(async () => projects);
    const relisted = emitted.filter((obs) => obs.entityKey === 'synthetic-merged-in-key');
    expect(relisted).toHaveLength(1);
    const served = aggregateResearchEntityGrantEvidence(
      relisted.map((obs) => ({ ...obs, sourceName: 'nih-reporter', observedAt: READ_AT })) as any,
      new Set([LEAD]),
      (investigator) => investigator.researcherId !== LEAD,
    );
    expect(
      Object.fromEntries((served.recentGrants as any[]).map((entry) => [entry.id, entry.role])),
    ).toEqual({ R01GM000001: 'pi', '5R01GM000002-03': 'copi', R01GM000099: undefined });
    const soleOther = aggregateResearchEntityGrantEvidence(
      relisted.map((obs) => ({ ...obs, sourceName: 'nih-reporter', observedAt: READ_AT })) as any,
      new Set(['researcher-unrelated']),
      () => true,
    );
    expect((soleOther.recentGrants as any[]).map((entry) => entry.id)).toEqual(['R01GM000099']);
  });

  it('credits the PI list of the award newest record, not an earlier holder', async () => {
    const handedOver = 'R01GM000003';
    const { emitted } = await runLane(
      async () => [project(handedOver, lead, undefined, 2008), project(handedOver, other)],
      async () => [
        {
          entityKey: 'synthetic-merged-in-key',
          field: 'recentGrants',
          value: [legacyEntry(handedOver)],
          observedAt: READ_AT,
        },
      ],
    );
    const relisted = emitted.filter((obs) => obs.entityKey === 'synthetic-merged-in-key');
    expect(relisted).toHaveLength(1);
    expect((relisted[0].value as Array<Record<string, any>>)[0].investigators).toEqual([
      { contact: true, profileId: 22, researcherId: OTHER, name: 'Blair Leadperson' },
    ]);
    const servedForEarlierLead = aggregateResearchEntityGrantEvidence(
      relisted.map((obs) => ({ ...obs, sourceName: 'nih-reporter', observedAt: READ_AT })) as any,
      new Set([LEAD]),
      (investigator) => investigator.researcherId !== LEAD,
    );
    expect(servedForEarlierLead.recentGrants ?? []).toEqual([]);
  });

  it('reports a failed legacy observation load as a partial failure', async () => {
    const { emitted, result } = await runLane(
      async () => projects,
      async () => {
        throw new Error('synthetic database outage');
      },
    );
    expect(emitted.filter((obs) => obs.entityKey === 'synthetic-merged-in-key')).toEqual([]);
    expect(
      result.partialFailures?.some((line) => line.includes('legacy award PI read failed')),
    ).toBe(true);
  });

  it('records no PI list on a fresh award whose contact PI the resolver cannot settle', async () => {
    const unresolvedContact = { profileId: 33, first: 'Casey', last: 'Unsettled' };
    const fresh: NihGrant = {
      ...project('R01GM000077', unresolvedContact, lead),
      fiscal_year: 2026,
      project_start_date: '2025-04-01T00:00:00',
      project_end_date: '2999-03-31T00:00:00',
    };
    vi.spyOn(axios, 'post').mockResolvedValue({
      data: { meta: { total: 1, offset: 0, limit: 500 }, results: [fresh] },
    } as any);
    const emitted: ObservationInput[] = [];
    await new NihReporterScraper({
      fiscalYears: [2026],
      resolveResearcherId: async (name: string) =>
        researcherFor(name)
          ? ({ status: 'matched', researcherId: researcherFor(name) } as any)
          : ({ status: 'ambiguous' } as any),
      resolveCorroborated: async () => ({ status: 'absent' }) as any,
      loadResearcherProfileTitle: async () => 'Professor',
      researchHomeResolver: async () => ({ status: 'canonical', slug: 'synthetic-row' }) as any,
      lookupContactPiAffiliations: async () => new Map([[11, { fiscalYear: 2026, atYale: true }]]),
      loadLegacyGrantObservations: async () => [],
    }).run({
      scrapeRunId: 'test-run',
      sourceId: 'test-source',
      sourceName: 'nih-reporter',
      sourceWeight: 0.9,
      options: { dryRun: true, useCache: false, release: false },
      emit: async (obs) => {
        emitted.push(...(Array.isArray(obs) ? obs : [obs]));
      },
      log: () => {},
    });
    const grants = emitted.find((obs) => obs.field === 'recentGrants')!.value as any[];
    expect(grants.map((entry) => entry.id)).toEqual(['R01GM000077']);
    expect(grants[0]).not.toHaveProperty('investigators');
  });

  it('fails closed and relists nothing when RePORTER cannot be read', async () => {
    const { emitted, result } = await runLane(async () => {
      throw new Error('synthetic outage');
    });
    expect(emitted.filter((obs) => obs.entityKey === 'synthetic-merged-in-key')).toEqual([]);
    expect(
      result.partialFailures?.some((line) => line.includes('legacy award PI read failed')),
    ).toBe(true);
  });
});

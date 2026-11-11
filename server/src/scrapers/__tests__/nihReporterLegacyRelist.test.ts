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
): NihGrant => ({
  appl_id: Number(coreNumber.replace(/\D/g, '')),
  project_num: `5${coreNumber}-03`,
  core_project_num: coreNumber,
  fiscal_year: 2023,
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
      { contact: true, profileId: 11, researcherId: LEAD },
    ]);
    expect(entries[1].investigators).toEqual([
      { contact: true, profileId: 22, researcherId: OTHER },
      { contact: false, profileId: 11, researcherId: LEAD },
    ]);
    expect(entries[2]).not.toHaveProperty('investigators');
    expect(relisted).toMatchObject({ listed: 2, unmatched: 1 });
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

  const runLane = async (lookupProjectsByNumber: (numbers: string[]) => Promise<NihGrant[]>) => {
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
      loadLegacyGrantObservations: async () => legacyObservations(),
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
    );
    expect(
      Object.fromEntries((served.recentGrants as any[]).map((entry) => [entry.id, entry.role])),
    ).toEqual({ R01GM000001: 'pi', '5R01GM000002-03': 'copi', R01GM000099: undefined });
    const soleOther = aggregateResearchEntityGrantEvidence(
      relisted.map((obs) => ({ ...obs, sourceName: 'nih-reporter', observedAt: READ_AT })) as any,
      new Set(['researcher-unrelated']),
    );
    expect((soleOther.recentGrants as any[]).map((entry) => entry.id)).toEqual(['R01GM000099']);
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

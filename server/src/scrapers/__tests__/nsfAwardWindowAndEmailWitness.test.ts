import mongoose from 'mongoose';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import {
  NsfAwardScraper,
  emailWitnessedCandidateId,
  parseNsfDate,
  type NsfAward,
} from '../sources/nsfAwardScraper';
import type { ResearcherNameCandidate } from '../../services/researcherPersonNameResolver';
import type { ObservationInput, ScraperContext } from '../types';

vi.mock('axios', () => ({ default: { get: vi.fn() } }));

const REFERENCE_DATE = new Date('2026-11-12T12:00:00.000Z');

const award = (overrides: Partial<NsfAward>): NsfAward => ({
  title: 'Synthetic award',
  abstractText: 'Synthetic abstract.',
  awardeeName: 'Yale University',
  agency: 'NSF',
  fundsObligatedAmt: '100000',
  ...overrides,
});

const STARTED_BEFORE_WINDOW_STILL_RUNNING = award({
  id: '1900001',
  piFirstName: 'Orla',
  piLastName: 'Longrun',
  piEmail: 'orla.longrun.pi@yale.edu',
  startDate: '07/01/2019',
  expDate: '06/30/2027',
});

const ENDED_BEFORE_WINDOW = award({
  id: '1500001',
  piFirstName: 'Edda',
  piLastName: 'Pastend',
  piEmail: 'edda.pastend.pi@yale.edu',
  startDate: '01/01/2015',
  expDate: '06/30/2021',
});

const STARTED_INSIDE_WINDOW = award({
  id: '2300001',
  piFirstName: 'Nell',
  piLastName: 'Recentia',
  piEmail: 'nell.recentia.pi@yale.edu',
  startDate: '09/01/2023',
  expDate: '08/31/2026',
});

const CATALOG = [STARTED_BEFORE_WINDOW_STILL_RUNNING, ENDED_BEFORE_WINDOW, STARTED_INSIDE_WINDOW];

function fakeNsfApi(catalog: NsfAward[]) {
  return async (_url: string, config: { params: Record<string, string> }) => {
    const { params } = config;
    const atOrAfter = (value: string | undefined, bound: string | undefined) =>
      !bound || parseNsfDate(value)!.getTime() >= parseNsfDate(bound)!.getTime();
    const matching = catalog.filter(
      (entry) =>
        atOrAfter(entry.startDate, params.dateStart) &&
        atOrAfter(entry.expDate, params.expDateStart),
    );
    const offset = Number(params.offset);
    const rpp = Number(params.rpp);
    return {
      data: {
        response: {
          award: matching.slice(offset - 1, offset - 1 + rpp),
          metadata: { totalCount: matching.length + 1 },
        },
      },
    };
  };
}

function buildContext() {
  const emitted: ObservationInput[] = [];
  const ctx: ScraperContext = {
    scrapeRunId: 'test-run',
    sourceId: 'test-source-id',
    sourceName: 'nsf-award-search',
    sourceWeight: 0.9,
    options: { dryRun: true, useCache: false, release: false, referenceDate: REFERENCE_DATE },
    emit: async (observations: ObservationInput[]) => {
      emitted.push(...observations);
    },
    log: () => {},
  } as unknown as ScraperContext;
  return { ctx, emitted };
}

const rowPerResearcher = async (researcherId: string) => ({
  status: 'canonical' as const,
  slug: `row-${researcherId}`,
});

const grantIdsByRow = (emitted: ObservationInput[]) =>
  Object.fromEntries(
    emitted
      .filter((o) => o.field === 'recentGrants')
      .map((o) => [o.entityKey, (o.value as Array<{ id: string }>).map((g) => g.id).sort()]),
  );

describe('NSF award window reads the award end date', () => {
  const researcherIdByName = new Map<string, mongoose.Types.ObjectId>();
  const matchedByName = async (name: string) => {
    const id = researcherIdByName.get(name) ?? new mongoose.Types.ObjectId();
    researcherIdByName.set(name, id);
    return { status: 'matched' as const, researcherId: id };
  };

  beforeEach(() => {
    researcherIdByName.clear();
    vi.mocked(axios.get).mockReset();
    vi.mocked(axios.get).mockImplementation(fakeNsfApi(CATALOG) as any);
  });

  const runOnce = async () => {
    const scraper = new NsfAwardScraper({
      resolveResearcherId: matchedByName,
      researchHomeResolver: rowPerResearcher,
    });
    const { ctx, emitted } = buildContext();
    const result = await scraper.run(ctx);
    return { result, emitted };
  };

  it('asks NSF for awards ending inside the window, not awards starting inside it', async () => {
    await runOnce();
    const params = vi.mocked(axios.get).mock.calls[0][1]?.params as Record<string, string>;
    expect(params.expDateStart).toBe('11/12/2021');
    expect(params).not.toHaveProperty('dateStart');
  });

  it('fetches an award that started before the window and is still running', async () => {
    const { emitted } = await runOnce();
    const rows = grantIdsByRow(emitted);
    const longRunId = researcherIdByName.get('Orla Longrun');
    expect(rows[`row-${longRunId}`]).toEqual(['1900001']);
    expect(rows[`row-${researcherIdByName.get('Nell Recentia')}`]).toEqual(['2300001']);
  });

  it('does not fetch an award that ended before the window', async () => {
    const { emitted, result } = await runOnce();
    expect(researcherIdByName.has('Edda Pastend')).toBe(false);
    expect(Object.values(grantIdsByRow(emitted)).flat()).not.toContain('1500001');
    expect(result.entitiesObserved).toBe(2);
  });

  it('drops an ended award even when the API returns it', async () => {
    vi.mocked(axios.get).mockImplementation(async (_url: string, config: any) => ({
      data: {
        response: {
          award: Number(config.params.offset) === 1 ? CATALOG : [],
          metadata: { totalCount: CATALOG.length + 1 },
        },
      },
    }));
    const { emitted, result } = await runOnce();
    expect(Object.values(grantIdsByRow(emitted)).flat()).not.toContain('1500001');
    expect(result.notes).toMatch(/1 ended before 11\/12\/2021 and dropped/);
  });

  it('re-derives the same rows and grants on a second run', async () => {
    const first = await runOnce();
    const second = await runOnce();
    expect(grantIdsByRow(second.emitted)).toEqual(grantIdsByRow(first.emitted));
    expect(second.result.entitiesObserved).toBe(first.result.entitiesObserved);
  });
});

describe('NSF PI email settles an ambiguous PI name', () => {
  const AMBIGUOUS_PI_AWARD = award({
    id: '2400001',
    piFirstName: 'Tamsin',
    piLastName: 'Doublet',
    piEmail: 'Tamsin.Doublet.pi@Yale.edu',
    startDate: '01/01/2024',
    expDate: '12/31/2027',
  });

  const candidate = (email?: string): ResearcherNameCandidate => ({
    _id: new mongoose.Types.ObjectId(),
    displayName: 'Tamsin Doublet',
    identifiers: email === undefined ? {} : { email },
  });

  const runWith = async (candidates: ResearcherNameCandidate[]) => {
    const scraper = new NsfAwardScraper({
      fetchPage: vi.fn().mockResolvedValue({ awards: [AMBIGUOUS_PI_AWARD] }) as any,
      resolveResearcherId: async () => ({
        status: 'ambiguous' as const,
        ambiguousCandidates: candidates,
      }),
      researchHomeResolver: rowPerResearcher,
      expDateStart: '11/12/2021',
    });
    const { ctx, emitted } = buildContext();
    const result = await scraper.run(ctx);
    return { result, emitted };
  };

  it('attaches when exactly one ambiguous candidate stores the NSF PI email', async () => {
    const holder = candidate('tamsin.doublet.pi@yale.edu');
    const { emitted, result } = await runWith([candidate('t.doublet.pi@yale.edu'), holder]);
    expect(grantIdsByRow(emitted)).toEqual({ [`row-${holder._id}`]: ['2400001'] });
    expect(emitted.find((o) => o.field === 'inferredPiUserId')?.value).toBe(String(holder._id));
    expect(result.notes).toMatch(/1 ambiguous PI name\(s\) settled by the NSF PI email/);
    expect(result.notes).toMatch(/rows enriched: 1;/);
  });

  it('stays unattached when no ambiguous candidate stores the NSF PI email', async () => {
    const { emitted, result } = await runWith([
      candidate('t.doublet.pi@yale.edu'),
      candidate(),
      candidate('doublet.pi@yale.edu'),
    ]);
    expect(emitted).toEqual([]);
    expect(result.notes).toMatch(/1 resolved to several researchers/);
  });

  it('stays unattached when two ambiguous candidates store the NSF PI email', async () => {
    const { emitted, result } = await runWith([
      candidate('tamsin.doublet.pi@yale.edu'),
      candidate('TAMSIN.DOUBLET.PI@YALE.EDU'),
    ]);
    expect(emitted).toEqual([]);
    expect(result.notes).toMatch(/1 resolved to several researchers/);
  });

  it('re-derives the same attachment on a second run', async () => {
    const candidates = [
      candidate('t.doublet.pi@yale.edu'),
      candidate('tamsin.doublet.pi@yale.edu'),
    ];
    const first = await runWith(candidates);
    const second = await runWith(candidates);
    expect(second.emitted).toEqual(first.emitted);
    expect(grantIdsByRow(second.emitted)).toEqual({
      [`row-${candidates[1]._id}`]: ['2400001'],
    });
  });

  it('credits only the awards whose own NSF PI email witnesses the candidate', async () => {
    const holder = candidate('tamsin.doublet.pi@yale.edu');
    const namesakeAward = award({
      ...AMBIGUOUS_PI_AWARD,
      id: '2400002',
      piEmail: 'tdoublet.pi@yale.edu',
    });
    const unaddressedAward = award({ ...AMBIGUOUS_PI_AWARD, id: '2400003', piEmail: undefined });
    const scraper = new NsfAwardScraper({
      fetchPage: vi.fn().mockResolvedValue({
        awards: [AMBIGUOUS_PI_AWARD, namesakeAward, unaddressedAward],
      }) as any,
      resolveResearcherId: async () => ({
        status: 'ambiguous' as const,
        ambiguousCandidates: [holder, candidate()],
      }),
      researchHomeResolver: rowPerResearcher,
      expDateStart: '11/12/2021',
    });
    const { ctx, emitted } = buildContext();
    await scraper.run(ctx);
    expect(grantIdsByRow(emitted)).toEqual({ [`row-${holder._id}`]: ['2400001'] });
  });

  it('never accepts a partial email or a name alone', () => {
    const holder = candidate('tamsin.doublet.pi@yale.edu');
    expect(emailWitnessedCandidateId([holder], ['doublet.pi@yale.edu'])).toBeUndefined();
    expect(emailWitnessedCandidateId([holder], ['tamsin.doublet.pi@yale.edu.au'])).toBeUndefined();
    expect(emailWitnessedCandidateId([holder], ['tamsin.doublet'])).toBeUndefined();
    expect(emailWitnessedCandidateId([candidate('tamsin.doublet')], ['tamsin.doublet'])).toBe(
      undefined,
    );
    expect(emailWitnessedCandidateId([holder], [undefined, ''])).toBeUndefined();
    expect(emailWitnessedCandidateId([holder], [' Tamsin.Doublet.pi@yale.EDU '])).toBe(
      String(holder._id),
    );
  });
});

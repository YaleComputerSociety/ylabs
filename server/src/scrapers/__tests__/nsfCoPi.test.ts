import { describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import {
  NsfAwardScraper,
  groupAwardsByYaleCoPi,
  isYaleEmail,
  parseCoPiEntry,
  type NsfAward,
} from '../sources/nsfAwardScraper';
import type { ObservationInput, ScraperContext } from '../types';

const award = (id: string, coPDPI: string[]): NsfAward => ({
  id,
  title: `Synthetic award ${id}`,
  awardeeName: 'Yale University',
  piFirstName: 'Avery',
  piLastName: 'Leadperson',
  coPDPI,
  startDate: '09/01/2024',
  expDate: '08/31/2028',
  fundsObligatedAmt: '300000',
});

const YALE_CO_PI = 'Blair Yalecopi test.copi@yale.edu';
const SUBDOMAIN_CO_PI = 'Casey Subdomain casey.subdomain@med.yale.edu';
const OUTSIDE_CO_PI = 'Devon Namesake devon.namesake@elsewhere.edu';
const UNADDRESSED_CO_PI = 'Emery Noaddress';

function buildContext() {
  const emitted: ObservationInput[] = [];
  const ctx: ScraperContext = {
    scrapeRunId: 'test-run',
    sourceId: 'test-source-id',
    sourceName: 'nsf-award-search',
    sourceWeight: 0.9,
    options: { dryRun: true, useCache: false, release: false },
    emit: async (input) => {
      emitted.push(...(Array.isArray(input) ? input : [input]));
    },
    log: () => {},
  } as ScraperContext;
  return { ctx, emitted };
}

const ids = new Map<string, mongoose.Types.ObjectId>();
const resolveEveryone = async (name: string) => {
  const surname = name.trim().split(/\s+/).pop() ?? name;
  if (!ids.has(surname)) ids.set(surname, new mongoose.Types.ObjectId());
  return { status: 'matched' as const, researcherId: ids.get(surname)! };
};

describe('NSF co-PI entries', () => {
  it('splits the name from the email address', () => {
    expect(parseCoPiEntry(YALE_CO_PI)).toEqual({
      firstName: 'Blair',
      lastName: 'Yalecopi',
      email: 'test.copi@yale.edu',
    });
    expect(parseCoPiEntry(UNADDRESSED_CO_PI)?.email).toBe('');
  });

  it('recognises a Yale address including a subdomain, and nothing that only resembles one', () => {
    expect(isYaleEmail('test@yale.edu')).toBe(true);
    expect(isYaleEmail('test@med.yale.edu')).toBe(true);
    expect(isYaleEmail('test@notyale.edu')).toBe(false);
    expect(isYaleEmail('test@yale.edu.example.com')).toBe(false);
  });

  it('groups only Yale-addressed co-PIs and counts the rest by reason', () => {
    const { groups, tally } = groupAwardsByYaleCoPi([
      award('1', [YALE_CO_PI, OUTSIDE_CO_PI]),
      award('2', [SUBDOMAIN_CO_PI, UNADDRESSED_CO_PI, YALE_CO_PI]),
    ]);
    expect(groups.map((g) => g.piLastName).sort()).toEqual(['Subdomain', 'Yalecopi']);
    expect(groups.find((g) => g.piLastName === 'Yalecopi')?.awards).toHaveLength(2);
    expect(tally).toEqual({ yaleAddressed: 3, otherAddressed: 1, unaddressed: 1 });
  });
});

describe('NsfAwardScraper co-PI crediting', () => {
  it('credits a Yale co-PI on their own row and never an off-Yale namesake', async () => {
    const scraper = new NsfAwardScraper({
      fetchPage: vi.fn().mockResolvedValueOnce({
        awards: [award('1', [YALE_CO_PI, OUTSIDE_CO_PI, UNADDRESSED_CO_PI])],
      }) as any,
      resolveResearcherId: resolveEveryone,
      researchHomeResolver: async (researcherId) => ({
        status: 'canonical',
        slug: `row-${researcherId}`,
      }),
      dateStart: '01/01/2020',
    });
    const { ctx, emitted } = buildContext();
    const result = await scraper.run(ctx);

    const coPiRow = `row-${ids.get('Yalecopi')}`;
    const coPiGrants = emitted.find((o) => o.entityKey === coPiRow && o.field === 'recentGrants')
      ?.value as Array<{ role: string }>;
    expect(coPiGrants.map((g) => g.role)).toEqual(['copi']);
    expect(emitted.some((o) => o.entityKey === `row-${ids.get('Namesake')}`)).toBe(false);
    expect(emitted.some((o) => o.entityKey === `row-${ids.get('Noaddress')}`)).toBe(false);
    expect(result.entitiesObserved).toBe(2);
    expect(result.notes).toMatch(
      /1 at a Yale address, 1 refused \(another address\), 1 refused \(no address\)/,
    );
  });

  it('lists one award once, as the PI, when the PI and a co-PI share a row', async () => {
    const scraper = new NsfAwardScraper({
      fetchPage: vi.fn().mockResolvedValueOnce({ awards: [award('1', [YALE_CO_PI])] }) as any,
      resolveResearcherId: resolveEveryone,
      researchHomeResolver: async () => ({ status: 'canonical', slug: 'shared-row' }),
      dateStart: '01/01/2020',
    });
    const { ctx, emitted } = buildContext();
    await scraper.run(ctx);

    const grants = emitted.filter((o) => o.field === 'recentGrants');
    expect(grants).toHaveLength(1);
    expect((grants[0].value as Array<{ role: string }>).map((g) => g.role)).toEqual(['pi']);
    expect(emitted.find((o) => o.field === 'recentGrantCount')?.value).toBe(1);
    expect(emitted.some((o) => o.field === 'inferredPiUserId')).toBe(false);
  });
});

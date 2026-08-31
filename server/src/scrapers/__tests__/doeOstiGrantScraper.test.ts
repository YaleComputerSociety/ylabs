/**
 * Unit tests for DoeOstiGrantScraper.
 *
 * No network, no Mongo - the OSTI fetcher, the Yale-faculty PI resolver, and the
 * canonical research-home resolver are all injected via the scraper's
 * constructor, so run() is exercised deterministically against canned fixtures.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  DoeOstiGrantScraper,
  buildResearchGroupObservations,
  groupReportsByPi,
  normalizeDoeContractId,
  parseOstiAuthor,
  recordToGrant,
  resolveReportPi,
  selectYalePiCandidates,
  type OstiRecord,
  type PiResolver,
} from '../sources/doeOstiGrantScraper';
import type { CanonicalResearchHomeResolution } from '../canonicalResearchHomeResolver';
import type { ObservationInput, ScraperContext } from '../types';

const FIXED_NOW = new Date('2026-08-24T00:00:00Z');

function ctxWith(options: Partial<ScraperContext['options']> = {}): {
  ctx: ScraperContext;
  emitted: ObservationInput[];
} {
  const emitted: ObservationInput[] = [];
  const ctx: ScraperContext = {
    scrapeRunId: 'run',
    sourceId: 'src',
    sourceName: 'doe-osti',
    sourceWeight: 0.9,
    options: { dryRun: true, useCache: false, release: false, ...options },
    emit: async (obs) => {
      if (Array.isArray(obs)) emitted.push(...obs);
      else emitted.push(obs);
    },
    log: () => {},
  };
  return { ctx, emitted };
}

const HARRIS_REPORT: OstiRecord = {
  osti_id: '3365558',
  title: 'Relativistic Heavy Ion Physics at Yale',
  description: 'Final technical report on heavy-ion collisions.',
  authors: ['Harris, John [Yale Univ., New Haven, CT (United States)] (ORCID:000000000000)'],
  research_orgs: ['Yale University'],
  doe_contract_number: 'SC0023672; ',
  publication_date: '2026-05-29T00:00:00Z',
};

const SUBAWARD_REPORT: OstiRecord = {
  osti_id: '949875',
  title: 'Model Developments for Improved Emission Scenarios',
  description: 'Integrated assessment modeling.',
  authors: ['Yang, Zili [Department of Economics, SUNY at Binghamton]', 'Nordhaus, William'],
  research_orgs: ['The Research Foundation of SUNY at Binghamton', 'Yale University'],
  doe_contract_number: 'FG02-06ER64180;',
  publication_date: '2025-01-31T00:00:00Z',
};

const STALE_REPORT: OstiRecord = {
  osti_id: '885075',
  title: 'Very old work',
  authors: ['Berner, Robert A [Yale University]'],
  doe_contract_number: 'FG02-01ER15173;',
  publication_date: '2008-02-05T00:00:00Z',
};

// Two distinct Yale faculty authors => ambiguous => fail closed.
const AMBIGUOUS_REPORT: OstiRecord = {
  osti_id: '111',
  title: 'Two Yale PIs',
  authors: ['Alpha, Ann [Yale University]', 'Beta, Bob [Yale University]'],
  doe_contract_number: 'SC0000001;',
  publication_date: '2025-06-01T00:00:00Z',
};

describe('parseOstiAuthor', () => {
  it('splits name, affiliation, and strips ORCID', () => {
    expect(parseOstiAuthor('Moore, David Craig [Yale Univ.] (ORCID:0000)')).toEqual({
      name: 'Moore, David Craig',
      affiliation: 'Yale Univ.',
    });
  });

  it('handles an affiliation-less author', () => {
    expect(parseOstiAuthor('Nordhaus, William')).toEqual({
      name: 'Nordhaus, William',
      affiliation: '',
    });
  });
});

describe('selectYalePiCandidates', () => {
  it('prefers Yale-tagged authors and drops non-Yale institutions', () => {
    const picked = selectYalePiCandidates([
      'Smith, Melinda [Colorado State University]',
      'Moore, David [Yale University]',
    ]);
    expect(picked.map((c) => c.name)).toEqual(['Moore, David']);
  });

  it('falls back to affiliation-less authors only when none are Yale-tagged', () => {
    const picked = selectYalePiCandidates([
      'Yang, Zili [Department of Economics, SUNY at Binghamton]',
      'Nordhaus, William',
    ]);
    expect(picked.map((c) => c.name)).toEqual(['Nordhaus, William']);
  });

  it('returns nothing when every author is a tagged non-Yale collaborator', () => {
    expect(selectYalePiCandidates(['Doe, Jane [MIT]'])).toEqual([]);
  });
});

describe('normalizeDoeContractId', () => {
  it('prefixes DE- and takes the first semicolon-joined token', () => {
    expect(normalizeDoeContractId('SC0023672; ')).toBe('DE-SC0023672');
    expect(normalizeDoeContractId('FG02-98ER20311')).toBe('DE-FG02-98ER20311');
    expect(normalizeDoeContractId('DE-SC0004168')).toBe('DE-SC0004168');
    expect(normalizeDoeContractId('')).toBeNull();
    expect(normalizeDoeContractId(undefined)).toBeNull();
  });
});

describe('recordToGrant', () => {
  it('maps an OSTI record onto the recentGrants shape', () => {
    const grant = recordToGrant(HARRIS_REPORT);
    expect(grant.id).toBe('DE-SC0023672');
    expect(grant.agency).toBe('DOE');
    expect(grant.url).toBe('https://www.osti.gov/biblio/3365558');
    expect(grant.role).toBe('pi');
    expect(grant.startDate?.getUTCFullYear()).toBe(2026);
  });

  it('falls back to an OSTI id when no contract number is present', () => {
    expect(recordToGrant({ osti_id: '42', title: 't' }).id).toBe('osti-42');
  });
});

const matchResolver = (byName: Record<string, string>): PiResolver => {
  return async (canonicalName: string) => {
    const userId = byName[canonicalName];
    return userId ? { status: 'matched', userId } : { status: 'absent' };
  };
};

describe('resolveReportPi', () => {
  it('resolves a single Yale faculty author to its User', async () => {
    const resolver = matchResolver({ 'John Harris': 'user-harris' });
    expect(await resolveReportPi(HARRIS_REPORT, resolver)).toEqual({
      userId: 'user-harris',
      piName: 'John Harris',
    });
  });

  it('excludes the non-Yale author and resolves the Yale PI', async () => {
    const resolver = matchResolver({ 'William Nordhaus': 'user-nordhaus' });
    expect(await resolveReportPi(SUBAWARD_REPORT, resolver)).toEqual({
      userId: 'user-nordhaus',
      piName: 'William Nordhaus',
    });
  });

  it('fails closed when no candidate resolves', async () => {
    expect(await resolveReportPi(HARRIS_REPORT, matchResolver({}))).toBeNull();
  });

  it('fails closed when two distinct faculty match (ambiguous)', async () => {
    const resolver = matchResolver({ 'Ann Alpha': 'user-a', 'Bob Beta': 'user-b' });
    expect(await resolveReportPi(AMBIGUOUS_REPORT, resolver)).toBeNull();
  });
});

describe('groupReportsByPi', () => {
  it('groups multiple reports under one PI', () => {
    const groups = groupReportsByPi([
      { userId: 'u1', piName: 'A', record: HARRIS_REPORT },
      { userId: 'u1', piName: 'A', record: STALE_REPORT },
      { userId: 'u2', piName: 'B', record: SUBAWARD_REPORT },
    ]);
    expect(groups).toHaveLength(2);
    expect(groups.find((g) => g.userId === 'u1')?.records).toHaveLength(2);
  });
});

describe('buildResearchGroupObservations', () => {
  it('mints a shell with a low-confidence name when no canonical home exists', () => {
    const obs = buildResearchGroupObservations(
      { userId: 'u1', piName: 'John Harris', records: [HARRIS_REPORT] },
      null,
      'https://www.osti.gov/api/v1/records',
    );
    const byField = Object.fromEntries(obs.map((o) => [o.field, o]));
    expect(byField.slug.value).toBe('doe-pi-u1');
    expect(byField.name.value).toBe('John Harris Lab');
    expect(byField.name.confidenceOverride).toBeLessThan(0.5);
    expect(byField.kind.value).toBe('lab');
    expect(byField.fundingAgencies.value).toEqual(['DOE']);
    expect(byField.inferredPiUserId.value).toBe('u1');
  });

  it('self-attaches to a canonical home without re-emitting identity fields', () => {
    const obs = buildResearchGroupObservations(
      { userId: 'u1', piName: 'John Harris', records: [HARRIS_REPORT] },
      'harris-lab',
      'https://www.osti.gov/api/v1/records',
    );
    const fields = obs.map((o) => o.field);
    expect(fields).not.toContain('slug');
    expect(fields).not.toContain('name');
    expect(fields).not.toContain('kind');
    expect(obs.every((o) => o.entityKey === 'harris-lab')).toBe(true);
    expect(fields).toContain('recentGrants');
    expect(fields).toContain('fundingAgencies');
  });

  it('never emits a description field so abstract prose cannot leak', () => {
    const obs = buildResearchGroupObservations(
      { userId: 'u1', piName: 'John Harris', records: [HARRIS_REPORT] },
      null,
      'https://www.osti.gov/api/v1/records',
    );
    const fields = obs.map((o) => o.field);
    expect(fields).not.toContain('fullDescription');
    expect(fields).not.toContain('description');
    expect(fields).not.toContain('shortDescription');
  });
});

const safeShell: CanonicalResearchHomeResolution = { status: 'safe-shell' };
const canonical = (slug: string): CanonicalResearchHomeResolution => ({
  status: 'canonical',
  slug,
});

describe('DoeOstiGrantScraper.run', () => {
  it('attributes Yale reports, drops stale ones, and enriches an existing home', async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce([HARRIS_REPORT, SUBAWARD_REPORT, STALE_REPORT])
      .mockResolvedValue([]);
    const piResolver = matchResolver({
      'John Harris': 'user-harris',
      'William Nordhaus': 'user-nordhaus',
    });
    const researchHomeResolver = vi.fn(async (userId: string) =>
      userId === 'user-harris' ? canonical('harris-heavy-ion-lab') : safeShell,
    );
    const scraper = new DoeOstiGrantScraper({
      fetchPage,
      piResolver,
      researchHomeResolver,
      now: () => FIXED_NOW,
    });
    const { ctx, emitted } = ctxWith();

    const result = await scraper.run(ctx);

    expect(result.entitiesObserved).toBe(2);
    const harris = emitted.filter((o) => o.entityKey === 'harris-heavy-ion-lab');
    expect(harris.find((o) => o.field === 'fundingAgencies')?.value).toEqual(['DOE']);
    expect(harris.some((o) => o.field === 'slug')).toBe(false);
    const nordhaus = emitted.filter((o) => o.entityKey === 'doe-pi-user-nordhaus');
    expect(nordhaus.find((o) => o.field === 'name')?.value).toBe('William Nordhaus Lab');
    expect(emitted.some((o) => String(o.entityKey).includes('robert'))).toBe(false);
  });

  it('fails closed and emits nothing when OSTI is unreachable', async () => {
    const fetchPage = vi.fn().mockRejectedValue(new Error('ETIMEDOUT'));
    const scraper = new DoeOstiGrantScraper({
      fetchPage,
      piResolver: matchResolver({}),
      researchHomeResolver: async () => safeShell,
      now: () => FIXED_NOW,
    });
    const { ctx, emitted } = ctxWith();

    const result = await scraper.run(ctx);

    expect(emitted).toHaveLength(0);
    expect(result.observationCount).toBe(0);
    expect(result.notes).toMatch(/failed closed/i);
  });

  it('skips a PI whose research home is ambiguous', async () => {
    const fetchPage = vi.fn().mockResolvedValueOnce([HARRIS_REPORT]).mockResolvedValue([]);
    const scraper = new DoeOstiGrantScraper({
      fetchPage,
      piResolver: matchResolver({ 'John Harris': 'user-harris' }),
      researchHomeResolver: async () => ({ status: 'ambiguous' }),
      now: () => FIXED_NOW,
    });
    const { ctx, emitted } = ctxWith();

    const result = await scraper.run(ctx);

    expect(emitted).toHaveLength(0);
    expect(result.entitiesObserved).toBe(1);
  });

  it('honors --limit by capping the number of PIs processed', async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce([HARRIS_REPORT, SUBAWARD_REPORT])
      .mockResolvedValue([]);
    const scraper = new DoeOstiGrantScraper({
      fetchPage,
      piResolver: matchResolver({
        'John Harris': 'user-harris',
        'William Nordhaus': 'user-nordhaus',
      }),
      researchHomeResolver: async () => safeShell,
      now: () => FIXED_NOW,
    });
    const { ctx, emitted } = ctxWith({ limit: 1 });

    const result = await scraper.run(ctx);

    expect(result.entitiesObserved).toBe(1);
    const entityKeys = new Set(emitted.map((o) => o.entityKey));
    expect(entityKeys.size).toBe(1);
  });
});

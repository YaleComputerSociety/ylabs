/**
 * Unit tests for DoeOstiGrantScraper.
 *
 * No network, no Mongo - the OSTI fetcher, the Yale-faculty PI resolver, and the
 * canonical research-row resolver are all injected via the scraper's
 * constructor, so run() is exercised deterministically against canned fixtures.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  DoeOstiGrantScraper,
  buildResearchEntityObservations,
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
const MINTING_FIELDS = ['slug', 'name', 'kind', 'entityType'];

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

const AVERY_REPORT: OstiRecord = {
  osti_id: '3365558',
  title: 'Synthetic Plasma Transport Studies',
  description: 'Final technical report on synthetic plasma transport.',
  authors: ['Avery, Jordan [Yale Univ., New Haven, CT (United States)] (ORCID:000000000000)'],
  research_orgs: ['Yale University'],
  doe_contract_number: 'SC0023672; ',
  publication_date: '2026-05-29T00:00:00Z',
};

const SUBAWARD_REPORT: OstiRecord = {
  osti_id: '949875',
  title: 'Model Developments for Synthetic Scenarios',
  description: 'Integrated assessment modeling.',
  authors: ['Ember, Casey [Department of Economics, Example State University]', 'Quill, Morgan'],
  research_orgs: ['Example State University Research Foundation', 'Yale University'],
  doe_contract_number: 'FG02-06ER64180;',
  publication_date: '2025-01-31T00:00:00Z',
};

const STALE_REPORT: OstiRecord = {
  osti_id: '885075',
  title: 'Very old work',
  authors: ['Stone, Robin A [Yale University]'],
  doe_contract_number: 'FG02-01ER15173;',
  publication_date: '2008-02-05T00:00:00Z',
};

const AMBIGUOUS_REPORT: OstiRecord = {
  osti_id: '111',
  title: 'Two Yale PIs',
  authors: ['Alpha, Ann [Yale University]', 'Beta, Bob [Yale University]'],
  doe_contract_number: 'SC0000001;',
  publication_date: '2025-06-01T00:00:00Z',
};

describe('parseOstiAuthor', () => {
  it('splits name, affiliation, and strips ORCID', () => {
    expect(parseOstiAuthor('Lark, Dana Quinn [Yale Univ.] (ORCID:0000)')).toEqual({
      name: 'Lark, Dana Quinn',
      affiliation: 'Yale Univ.',
    });
  });

  it('handles an affiliation-less author', () => {
    expect(parseOstiAuthor('Quill, Morgan')).toEqual({
      name: 'Quill, Morgan',
      affiliation: '',
    });
  });
});

describe('selectYalePiCandidates', () => {
  it('prefers Yale-tagged authors and drops non-Yale institutions', () => {
    const picked = selectYalePiCandidates([
      'Fern, Riley [Example Mountain University]',
      'Lark, Dana [Yale University]',
    ]);
    expect(picked.map((c) => c.name)).toEqual(['Lark, Dana']);
  });

  it('falls back to affiliation-less authors only when none are Yale-tagged', () => {
    const picked = selectYalePiCandidates([
      'Ember, Casey [Department of Economics, Example State University]',
      'Quill, Morgan',
    ]);
    expect(picked.map((c) => c.name)).toEqual(['Quill, Morgan']);
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
    const grant = recordToGrant(AVERY_REPORT);
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

const matchResolver = (
  byName: Record<string, string>,
  ambiguousNames: string[] = [],
): PiResolver => {
  return async (canonicalName: string) => {
    if (ambiguousNames.includes(canonicalName)) return { status: 'ambiguous' };
    const userId = byName[canonicalName];
    return userId ? { status: 'matched', userId } : { status: 'absent' };
  };
};

describe('resolveReportPi', () => {
  it('resolves a single Yale faculty author to its User', async () => {
    const resolver = matchResolver({ 'Jordan Avery': 'user-avery' });
    expect(await resolveReportPi(AVERY_REPORT, resolver)).toEqual({
      status: 'matched',
      userId: 'user-avery',
      piName: 'Jordan Avery',
    });
  });

  it('excludes the non-Yale author and resolves the Yale PI', async () => {
    const resolver = matchResolver({ 'Morgan Quill': 'user-quill' });
    expect(await resolveReportPi(SUBAWARD_REPORT, resolver)).toEqual({
      status: 'matched',
      userId: 'user-quill',
      piName: 'Morgan Quill',
    });
  });

  it('reports absent when no candidate resolves', async () => {
    expect(await resolveReportPi(AVERY_REPORT, matchResolver({}))).toEqual({ status: 'absent' });
  });

  it('reports ambiguous when two distinct faculty match', async () => {
    const resolver = matchResolver({ 'Ann Alpha': 'user-a', 'Bob Beta': 'user-b' });
    expect(await resolveReportPi(AMBIGUOUS_REPORT, resolver)).toEqual({ status: 'ambiguous' });
  });

  it('reports ambiguous when the only candidate resolves to several researchers', async () => {
    const resolver = matchResolver({}, ['Jordan Avery']);
    expect(await resolveReportPi(AVERY_REPORT, resolver)).toEqual({ status: 'ambiguous' });
  });
});

describe('groupReportsByPi', () => {
  it('groups multiple reports under one PI', () => {
    const groups = groupReportsByPi([
      { userId: 'u1', piName: 'A', record: AVERY_REPORT },
      { userId: 'u1', piName: 'A', record: STALE_REPORT },
      { userId: 'u2', piName: 'B', record: SUBAWARD_REPORT },
    ]);
    expect(groups).toHaveLength(2);
    expect(groups.find((g) => g.userId === 'u1')?.records).toHaveLength(2);
  });
});

describe('buildResearchEntityObservations', () => {
  const group = { userId: 'u1', piName: 'Jordan Avery', records: [AVERY_REPORT] };

  it('keys every observation to the existing row and emits no identity fields', () => {
    const obs = buildResearchEntityObservations(group, 'example-plasma-lab');
    const fields = obs.map((o) => o.field);
    for (const field of MINTING_FIELDS) expect(fields).not.toContain(field);
    expect(obs.every((o) => o.entityKey === 'example-plasma-lab')).toBe(true);
    const byField = Object.fromEntries(obs.map((o) => [o.field, o]));
    expect(byField.fundingAgencies.value).toEqual(['DOE']);
    expect(byField.inferredPiUserId.value).toBe('u1');
    expect(byField.recentGrantCount.value).toBe(1);
  });

  it('never emits a description field so abstract prose cannot leak', () => {
    const fields = buildResearchEntityObservations(group, 'example-plasma-lab').map((o) => o.field);
    expect(fields).not.toContain('fullDescription');
    expect(fields).not.toContain('description');
    expect(fields).not.toContain('shortDescription');
  });
});

const canonical = (slug: string): CanonicalResearchHomeResolution => ({
  status: 'canonical',
  slug,
});

function scraperFor(
  reports: OstiRecord[],
  piResolver: PiResolver,
  researchHomeResolver: (userId: string) => Promise<CanonicalResearchHomeResolution>,
): DoeOstiGrantScraper {
  const fetchPage = vi.fn().mockResolvedValueOnce(reports).mockResolvedValue([]);
  return new DoeOstiGrantScraper({
    fetchPage,
    piResolver,
    researchHomeResolver,
    now: () => FIXED_NOW,
  });
}

describe('DoeOstiGrantScraper.run', () => {
  it('enriches the row the resolver names and drops stale reports', async () => {
    const scraper = scraperFor(
      [AVERY_REPORT, STALE_REPORT],
      matchResolver({ 'Jordan Avery': 'user-avery' }),
      async () => canonical('example-plasma-lab'),
    );
    const { ctx, emitted } = ctxWith();

    const result = await scraper.run(ctx);

    expect(result.entitiesObserved).toBe(1);
    expect(emitted.length).toBeGreaterThan(0);
    expect(emitted.every((o) => o.entityKey === 'example-plasma-lab')).toBe(true);
    expect(emitted.some((o) => MINTING_FIELDS.includes(o.field))).toBe(false);
    expect(result.notes).toMatch(/rows enriched: 1;/);
  });

  it.each([
    ['safe-shell', /0 ineligible row/, /1 have no existing research row/],
    ['ineligible', /1 ineligible row/, /0 have no existing research row/],
    ['ambiguous', /1 ambiguous row/, /0 have no existing research row/],
  ] as const)(
    'mints nothing and counts the refusal when the row resolves %s',
    async (status, countPattern, noRowPattern) => {
      const scraper = scraperFor(
        [AVERY_REPORT],
        matchResolver({ 'Jordan Avery': 'user-avery' }),
        async () => ({ status }) as CanonicalResearchHomeResolution,
      );
      const { ctx, emitted } = ctxWith();

      const result = await scraper.run(ctx);

      expect(emitted).toHaveLength(0);
      expect(result.observationCount).toBe(0);
      expect(result.notes).toMatch(/rows enriched: 0;/);
      expect(result.notes).toMatch(countPattern);
      expect(result.notes).toMatch(noRowPattern);
    },
  );

  it('mints nothing and counts reports that resolve to no researcher or several', async () => {
    const researchHomeResolver = vi.fn(async () => canonical('unused-row'));
    const scraper = scraperFor(
      [AVERY_REPORT, AMBIGUOUS_REPORT],
      matchResolver({ 'Ann Alpha': 'user-a', 'Bob Beta': 'user-b' }),
      researchHomeResolver,
    );
    const { ctx, emitted } = ctxWith();

    const result = await scraper.run(ctx);

    expect(emitted).toHaveLength(0);
    expect(researchHomeResolver).not.toHaveBeenCalled();
    expect(result.notes).toMatch(/1 resolved to no researcher/);
    expect(result.notes).toMatch(/1 resolved to several researchers/);
  });

  it('skips and counts a PI whose row lookup throws, without minting', async () => {
    const scraper = scraperFor(
      [AVERY_REPORT],
      matchResolver({ 'Jordan Avery': 'user-avery' }),
      async () => {
        throw new Error('lookup failed');
      },
    );
    const { ctx, emitted } = ctxWith();

    const result = await scraper.run(ctx);

    expect(emitted).toHaveLength(0);
    expect(result.notes).toMatch(/1 PI\(s\) skipped on a resolve error/);
  });

  it('fails closed and emits nothing when OSTI is unreachable', async () => {
    const fetchPage = vi.fn().mockRejectedValue(new Error('ETIMEDOUT'));
    const scraper = new DoeOstiGrantScraper({
      fetchPage,
      piResolver: matchResolver({}),
      researchHomeResolver: async () => canonical('unused-row'),
      now: () => FIXED_NOW,
    });
    const { ctx, emitted } = ctxWith();

    const result = await scraper.run(ctx);

    expect(emitted).toHaveLength(0);
    expect(result.observationCount).toBe(0);
    expect(result.notes).toMatch(/failed closed/i);
  });

  it('honors --limit by capping the number of PIs processed', async () => {
    const scraper = scraperFor(
      [AVERY_REPORT, SUBAWARD_REPORT],
      matchResolver({ 'Jordan Avery': 'user-avery', 'Morgan Quill': 'user-quill' }),
      async (userId) => canonical(`row-${userId}`),
    );
    const { ctx, emitted } = ctxWith({ limit: 1 });

    const result = await scraper.run(ctx);

    expect(result.entitiesObserved).toBe(1);
    expect(new Set(emitted.map((o) => o.entityKey)).size).toBe(1);
  });
});

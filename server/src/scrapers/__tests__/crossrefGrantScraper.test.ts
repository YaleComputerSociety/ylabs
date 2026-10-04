import { describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import {
  CrossrefGrantScraper,
  crossrefGrantUrl,
  extractCrossrefGrant,
  isYaleAffiliation,
  parseCrossrefGrantPage,
  readCrossrefGrantCorpus,
  type CrossrefGrantItem,
} from '../sources/crossrefGrantScraper';
import type { ResearcherPersonNameResolution } from '../../services/researcherPersonNameResolver';
import type { ObservationInput, ScraperContext } from '../types';

const YALE = [{ name: 'Yale University', id: [{ id: 'https://ror.org/03v76x132' }] }];
const ORCID_A = 'https://orcid.org/0000-0000-0000-0028';

function grantItem(overrides: {
  doi?: string;
  award?: string;
  fundingType?: string;
  funder?: string;
  start?: number[];
  end?: number[];
  lead?: Record<string, unknown> | null;
  amount?: { amount: number; currency: string };
}): CrossrefGrantItem {
  const lead =
    overrides.lead === null
      ? []
      : [{ given: 'Avery', family: 'Placeholder', affiliation: YALE, ...(overrides.lead ?? {}) }];
  return {
    DOI: overrides.doi ?? '10.5555/grant-1',
    award: overrides.award ?? 'RSG-24-0000001-01',
    project: [
      {
        'project-title': [{ title: 'Synthetic   project title' }],
        'project-description': [{ description: 'Synthetic description.' }],
        'award-start': { 'date-parts': [overrides.start ?? [2024, 1, 1]] },
        'award-end': { 'date-parts': [overrides.end ?? [2027, 12, 31]] },
        ...(overrides.amount ? { 'award-amount': overrides.amount } : {}),
        funding: [
          {
            type: overrides.fundingType ?? 'award',
            funder: { name: overrides.funder ?? 'American Cancer Society' },
          },
        ],
        'lead-investigator': lead as any,
      },
    ],
  };
}

const page = (items: CrossrefGrantItem[], total = items.length, nextCursor = 'next') =>
  JSON.stringify({
    status: 'ok',
    message: { 'total-results': total, items, 'next-cursor': nextCursor },
  });

function buildContext() {
  const emitted: ObservationInput[] = [];
  const ctx: ScraperContext = {
    scrapeRunId: 'test-run',
    sourceId: 'test-source-id',
    sourceName: 'crossref-grants',
    sourceWeight: 0.9,
    options: { dryRun: true, useCache: false, release: false },
    emit: async (input) => {
      emitted.push(...(Array.isArray(input) ? input : [input]));
    },
    log: () => {},
  } as ScraperContext;
  return { ctx, emitted };
}

const matched = (id: mongoose.Types.ObjectId): ResearcherPersonNameResolution => ({
  status: 'matched',
  researcherId: id,
});

describe('crossref grant page parsing', () => {
  it('reads a page carrying raw control characters inside strings', () => {
    const text = page([grantItem({})]).replace(
      'Synthetic description.',
      'Synthetic\u0002 description.',
    );
    const parsed = parseCrossrefGrantPage(text);
    expect(parsed?.items).toHaveLength(1);
    expect(parsed?.totalResults).toBe(1);
  });

  it('returns null for a page with no items array', () => {
    expect(parseCrossrefGrantPage('{"message":{}}')).toBeNull();
    expect(parseCrossrefGrantPage('not json')).toBeNull();
  });

  it('recognises Yale by ROR or by name, and not the Yale-NUS college or the hospital', () => {
    expect(isYaleAffiliation({ id: [{ id: 'https://ror.org/03v76x132' }] })).toBe(true);
    expect(isYaleAffiliation({ name: 'Yale University School of Medicine' })).toBe(true);
    expect(isYaleAffiliation({ name: 'Yale-NUS College' })).toBe(false);
    expect(isYaleAffiliation({ name: 'Yale New Haven Hospital' })).toBe(false);
  });
});

describe('extractCrossrefGrant', () => {
  it('admits a funded award and cites the grant DOI', () => {
    const result = extractCrossrefGrant(
      grantItem({ amount: { amount: 792000, currency: 'USD' } }),
      2020,
    );
    expect(result.kind).toBe('grant');
    if (result.kind !== 'grant') return;
    expect(result.grant.title).toBe('Synthetic project title');
    expect(result.grant.amountUsd).toBe(792000);
    expect(result.grant.traineeAward).toBe(false);
    expect(crossrefGrantUrl(result.grant.doi)).toBe('https://doi.org/10.5555/grant-1');
  });

  it('refuses an instrument-time allocation as non-funding', () => {
    expect(extractCrossrefGrant(grantItem({ fundingType: 'facilities' }), 2020)).toEqual({
      kind: 'refused',
      reason: 'nonFunding',
    });
  });

  it('refuses a record whose lead investigator is not at Yale', () => {
    expect(
      extractCrossrefGrant(
        grantItem({ lead: { affiliation: [{ name: 'Elsewhere University' }] } }),
        2020,
      ),
    ).toEqual({ kind: 'refused', reason: 'noYaleLead' });
    expect(extractCrossrefGrant(grantItem({ lead: null }), 2020)).toEqual({
      kind: 'refused',
      reason: 'noYaleLead',
    });
  });

  it('refuses a grant that ended before the window', () => {
    expect(
      extractCrossrefGrant(grantItem({ start: [2010, 1, 1], end: [2013, 1, 1] }), 2020),
    ).toEqual({ kind: 'refused', reason: 'outsideWindow' });
  });

  it('drops a non-dollar amount rather than storing it as dollars', () => {
    const result = extractCrossrefGrant(
      grantItem({ amount: { amount: 100000, currency: 'GBP' } }),
      2020,
    );
    expect(result.kind === 'grant' && result.grant.amountUsd).toBeUndefined();
  });

  it('marks a fellowship as a trainee award', () => {
    const result = extractCrossrefGrant(grantItem({ fundingType: 'fellowship' }), 2020);
    expect(result.kind === 'grant' && result.grant.traineeAward).toBe(true);
  });
});

describe('readCrossrefGrantCorpus', () => {
  it('walks the cursor until every reported record is read', async () => {
    const pages = [
      page([grantItem({ doi: 'a' })], 2, 'c2'),
      page([grantItem({ doi: 'b' })], 2, 'c3'),
    ];
    const cursors: string[] = [];
    const read = await readCrossrefGrantCorpus(async (cursor) => {
      cursors.push(cursor);
      return pages[cursors.length - 1];
    });
    expect(read.kind).toBe('complete');
    expect(cursors).toEqual(['*', 'c2']);
  });

  it('is incomplete when the walk serves fewer records than reported', async () => {
    const read = await readCrossrefGrantCorpus(async (cursor) =>
      cursor === '*' ? page([grantItem({})], 3, 'c2') : page([], 3, 'c3'),
    );
    expect(read.kind).toBe('incomplete');
  });

  it('is incomplete when a page is unreachable', async () => {
    const read = await readCrossrefGrantCorpus(async () => {
      throw new Error('socket hang up');
    });
    expect(read.kind).toBe('incomplete');
  });
});

describe('CrossrefGrantScraper.run', () => {
  const researcher = new mongoose.Types.ObjectId();

  it('fails closed with no writes when the corpus is incomplete', async () => {
    const { ctx, emitted } = buildContext();
    const result = await new CrossrefGrantScraper({
      fetchPage: async (cursor) =>
        cursor === '*' ? page([grantItem({})], 5, 'c2') : page([], 5, 'c3'),
      resolveByOrcid: async () => matched(researcher),
      resolveByName: async () => matched(researcher),
      researchHomeResolver: async () => ({ status: 'canonical', slug: 'synthetic-row' }) as any,
      currentYear: 2026,
    }).run(ctx);
    expect(emitted).toHaveLength(0);
    expect(result.notes).toMatch(/served 1 of 5 reported records\); failed closed/);
  });

  it('resolves by ORCID before the name and enriches the canonical row once per row', async () => {
    const { ctx, emitted } = buildContext();
    const byName: string[] = [];
    const items = [
      grantItem({ doi: 'g1', award: 'RSG-24-0000001-01', lead: { ORCID: ORCID_A } }),
      grantItem({
        doi: 'g2',
        award: '24POST0000001',
        funder: 'American Heart Association',
        lead: { ORCID: ORCID_A },
      }),
    ];
    const result = await new CrossrefGrantScraper({
      fetchPage: async () => page(items),
      resolveByOrcid: async (orcid) => (orcid ? matched(researcher) : { status: 'absent' }),
      resolveByName: async (name) => {
        byName.push(name);
        return { status: 'absent' };
      },
      researchHomeResolver: async () => ({ status: 'canonical', slug: 'synthetic-row' }) as any,
      currentYear: 2026,
    }).run(ctx);
    expect(byName).toEqual([]);
    expect(result.entitiesObserved).toBe(1);
    const grants = emitted.find((o) => o.field === 'recentGrants');
    expect(grants?.entityKey).toBe('synthetic-row');
    expect((grants?.value as unknown[]).length).toBe(2);
    expect(emitted.find((o) => o.field === 'recentGrantCount')?.value).toBe(2);
    expect(emitted.find((o) => o.field === 'fundingAgencies')?.value).toEqual([
      'American Cancer Society',
      'American Heart Association',
    ]);
    expect(emitted.find((o) => o.field === 'inferredPiUserId')?.value).toBe(researcher.toString());
  });

  it('attaches a fellowship only through an ORCID match, never through the name', async () => {
    const { ctx, emitted } = buildContext();
    const byName: string[] = [];
    const result = await new CrossrefGrantScraper({
      fetchPage: async () => page([grantItem({ fundingType: 'fellowship' })]),
      resolveByOrcid: async () => ({ status: 'absent' }),
      resolveByName: async (name) => {
        byName.push(name);
        return matched(researcher);
      },
      researchHomeResolver: async () => ({ status: 'canonical', slug: 'synthetic-row' }) as any,
      currentYear: 2026,
    }).run(ctx);
    expect(byName).toEqual([]);
    expect(emitted).toHaveLength(0);
    expect(result.notes).toMatch(/1 fellowship or salary award\(s\) skipped/);
  });

  it('refuses an ORCID that conflicts with the named investigator without trying the name', async () => {
    const { ctx, emitted } = buildContext();
    const byName: string[] = [];
    await new CrossrefGrantScraper({
      fetchPage: async () => page([grantItem({ lead: { ORCID: ORCID_A } })]),
      resolveByOrcid: async () => ({ status: 'ambiguous' }),
      resolveByName: async (name) => {
        byName.push(name);
        return matched(researcher);
      },
      researchHomeResolver: async () => ({ status: 'canonical', slug: 'synthetic-row' }) as any,
      currentYear: 2026,
    }).run(ctx);
    expect(byName).toEqual([]);
    expect(emitted).toHaveLength(0);
  });

  it('never mints a row for a researcher with no existing research row', async () => {
    const { ctx, emitted } = buildContext();
    const result = await new CrossrefGrantScraper({
      fetchPage: async () => page([grantItem({})]),
      resolveByOrcid: async () => ({ status: 'absent' }),
      resolveByName: async () => matched(researcher),
      researchHomeResolver: async () => ({ status: 'safe-shell' }) as any,
      currentYear: 2026,
    }).run(ctx);
    expect(emitted).toHaveLength(0);
    expect(result.notes).toMatch(/1 have no existing research row/);
  });
});

/**
 * Unit tests for the Center affiliation LLM extractor. All deps (page fetch, LLM,
 * center finder) are injected — no network, no DB, no OpenAI calls.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  CenterAffiliationLLMExtractor,
  affiliationExtractionToObservations,
  normalizeCenterAffiliationObjectId,
  type CandidateCenter,
} from '../sources/centerAffiliationLLMExtractor';
import { centerRosterReadAdmissibility } from '../centerRosterRetirement';
import type { ScraperContext, ObservationInput } from '../types';

function makeContext(overrides: Partial<ScraperContext['options']> = {}) {
  const emitted: ObservationInput[] = [];
  const ctx: ScraperContext = {
    scrapeRunId: 'test-run',
    sourceId: 'test-source',
    sourceName: 'center-affiliation-llm',
    sourceWeight: 0.6,
    options: { dryRun: true, useCache: false, release: false, ...overrides },
    emit: async (obs) => {
      if (Array.isArray(obs)) emitted.push(...obs);
      else emitted.push(obs);
    },
    log: () => {},
  };
  return { ctx, emitted };
}

describe('affiliationExtractionToObservations', () => {
  it('emits relationship-only observations keyed by the center slug', () => {
    const obs = affiliationExtractionToObservations(
      { affiliatedPeople: [{ name: 'Jane Doe', role: 'director' }] },
      {
        centerEntityKey: 'center-jackson-centers-blue-center',
        sourceUrl: 'https://jackson.yale.edu/x',
      },
    );
    expect(obs.length).toBeGreaterThan(0);
    // relationship-only: no researchGroupMember observations
    expect(obs.every((o) => o.entityType === 'researchEntityRelationship')).toBe(true);
    expect(obs.find((o) => o.field === 'sourceEntityKey')!.value).toBe(
      'center-jackson-centers-blue-center',
    );
    expect(obs.find((o) => o.field === 'targetEntityKey')!.value).toBe(
      'faculty-research-area-jane-doe',
    );
  });

  it('dedupes repeated names and skips empty ones', () => {
    const obs = affiliationExtractionToObservations(
      {
        affiliatedPeople: [
          { name: 'Jane Doe' },
          { name: 'jane doe' },
          { name: '   ' },
          { name: 'Bob Smith' },
        ],
      },
      { centerEntityKey: 'yse-industrial-ecology', sourceUrl: 'https://environment.yale.edu/x' },
    );
    const targets = new Set(
      obs.filter((o) => o.field === 'targetEntityKey').map((o) => o.value as string),
    );
    expect(targets).toEqual(
      new Set(['faculty-research-area-jane-doe', 'faculty-research-area-bob-smith']),
    );
  });

  it('returns nothing without a center key', () => {
    expect(
      affiliationExtractionToObservations(
        { affiliatedPeople: [{ name: 'Jane Doe' }] },
        { centerEntityKey: '', sourceUrl: 'https://x' },
      ),
    ).toEqual([]);
  });
});

describe('CenterAffiliationLLMExtractor.run', () => {
  it('normalizes center affiliation ObjectIds without object-shaped coercion', () => {
    expect(normalizeCenterAffiliationObjectId(' 507f1f77bcf86cd799439011 ')).toBe(
      '507f1f77bcf86cd799439011',
    );
    expect(normalizeCenterAffiliationObjectId('abcdefghijkl')).toBeUndefined();
    expect(
      normalizeCenterAffiliationObjectId({
        toString: () => '507f1f77bcf86cd799439011',
      }),
    ).toBeUndefined();
  });

  const center: CandidateCenter = {
    _id: 'abc',
    slug: 'center-jackson-centers-blue-center',
    name: 'Blue Center for Global Strategic Assessment',
    websiteUrl: 'https://jackson.yale.edu/centers-initiatives/blue-center/',
  };

  it('fetches, calls the LLM, and emits relationship observations', async () => {
    const fetchPage = vi.fn(async () => ({
      url: center.websiteUrl as string,
      html: `<html><body>${'The Blue Center is directed by Jane Doe. '.repeat(20)}</body></html>`,
    }));
    const callLLM = vi.fn(async () => ({
      affiliatedPeople: [{ name: 'Jane Doe', role: 'director' }],
    }));
    const centerFinder = vi.fn(async () => [center]);
    const scraper = new CenterAffiliationLLMExtractor({
      fetchPage,
      callLLM,
      centerFinder,
      liveClaimFinder: async () => [],
      apiKey: 'test-key',
    });
    const { ctx, emitted } = makeContext();
    const result = await scraper.run(ctx);

    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(callLLM).toHaveBeenCalledTimes(1);
    expect(result.entitiesObserved).toBe(1);
    const relationships = emitted.filter((o) => o.entityType === 'researchEntityRelationship');
    expect(relationships.find((o) => o.field === 'sourceEntityKey')!.value).toBe(center.slug);
    const snapshots = emitted.filter((o) => o.entityType === 'centerRosterHealth');
    expect(snapshots).toHaveLength(1);
    expect(centerRosterReadAdmissibility(snapshots[0].value as any)).toBe('read-listed-members');
  });

  const runOnce = async (
    html: string,
    llm: () => Promise<{ affiliatedPeople: Array<{ name: string }> }>,
    liveClaims: Array<{ relationshipKey: string; targetEntityKey: string }> = [],
  ) => {
    const scraper = new CenterAffiliationLLMExtractor({
      fetchPage: async () => ({ url: center.websiteUrl as string, html }),
      callLLM: llm,
      centerFinder: async () => [center],
      liveClaimFinder: async () => liveClaims,
      apiKey: 'test-key',
    });
    const { ctx, emitted } = makeContext();
    const result = await scraper.run(ctx);
    const snapshot = emitted.find((o) => o.entityType === 'centerRosterHealth');
    return { result, emitted, snapshot };
  };

  it('records a truncated page as a read that cannot retire anything', async () => {
    const { snapshot } = await runOnce(
      `<html><body>Jane Doe directs the center. ${'filler text '.repeat(4000)}</body></html>`,
      async () => ({ affiliatedPeople: [{ name: 'Jane Doe' }] }),
    );
    expect(centerRosterReadAdmissibility(snapshot!.value as any)).toBe('incomplete');
  });

  it('records no read at all when the model call fails', async () => {
    const { emitted, result } = await runOnce(
      `<html><body>${'Jane Doe directs the center. '.repeat(20)}</body></html>`,
      async () => {
        throw new Error('model unavailable');
      },
    );
    expect(emitted).toEqual([]);
    expect(result.notes).toContain('1 model failure(s)');
  });

  it('drops a returned name the page does not state and reports the drop', async () => {
    const { emitted, result } = await runOnce(
      `<html><body>${'Jane Doe directs the center. '.repeat(20)}</body></html>`,
      async () => ({ affiliatedPeople: [{ name: 'Jane Doe' }, { name: 'Robin Absent' }] }),
    );
    const targets = emitted
      .filter((o) => o.field === 'targetEntityKey')
      .map((o) => o.value as string);
    expect(targets).toEqual(['faculty-research-area-jane-doe']);
    expect(result.notes).toContain('1 name(s) dropped as absent from the page');
  });

  it('lists a live claim the page still names although the model omitted it', async () => {
    const stillNamed = {
      relationshipKey: `${center.slug}:faculty-research-area-bob-smith:MEMBER_RESEARCH_AREA`,
      targetEntityKey: 'faculty-research-area-bob-smith',
    };
    const goneFromPage = {
      relationshipKey: `${center.slug}:faculty-research-area-pat-gone:MEMBER_RESEARCH_AREA`,
      targetEntityKey: 'faculty-research-area-pat-gone',
    };
    const { snapshot } = await runOnce(
      `<html><body>${'Jane Doe directs the center with Smith, Bob. '.repeat(20)}</body></html>`,
      async () => ({ affiliatedPeople: [{ name: 'Jane Doe' }] }),
      [stillNamed, goneFromPage],
    );
    const listed = ((snapshot!.value as any).members as Array<{ relationshipKey: string }>).map(
      (member) => member.relationshipKey,
    );
    expect(listed).toContain(stillNamed.relationshipKey);
    expect(listed).not.toContain(goneFromPage.relationshipKey);
  });

  it('skips cleanly when the LLM names no one', async () => {
    const fetchPage = vi.fn(async () => ({
      url: center.websiteUrl as string,
      html: `<html><body>${'No people are named on this page. '.repeat(20)}</body></html>`,
    }));
    const callLLM = vi.fn(async () => ({ affiliatedPeople: [] }));
    const centerFinder = vi.fn(async () => [center]);
    const scraper = new CenterAffiliationLLMExtractor({
      fetchPage,
      callLLM,
      centerFinder,
      liveClaimFinder: async () => [],
      apiKey: 'test-key',
    });
    const { ctx, emitted } = makeContext();
    const result = await scraper.run(ctx);
    expect(result.entitiesObserved).toBe(0);
    expect(emitted.filter((o) => o.entityType !== 'centerRosterHealth')).toEqual([]);
    expect(emitted.map((o) => centerRosterReadAdmissibility(o.value as any))).toEqual([
      'read-listed-nobody',
    ]);
  });

  it('processes candidates beyond the default cap in exhaustive mode', async () => {
    const candidates = Array.from({ length: 101 }, (_, index) => ({
      _id: String(index),
      slug: `center-${index}`,
      name: `Center ${index}`,
      websiteUrl: `https://example.yale.edu/center-${index}`,
    }));
    const fetchPage = vi.fn(async (url: string) => ({ url, html: '<main>Empty</main>' }));
    const scraper = new CenterAffiliationLLMExtractor({
      fetchPage,
      centerFinder: vi.fn(async () => candidates),
      apiKey: 'test-key',
    });

    await scraper.run(makeContext({ exhaustive: true }).ctx);

    expect(fetchPage).toHaveBeenCalledTimes(101);
  });

  it('no-ops without an API key', async () => {
    const centerFinder = vi.fn(async () => [center]);
    const scraper = new CenterAffiliationLLMExtractor({ centerFinder, apiKey: undefined });
    const { ctx, emitted } = makeContext();
    const result = await scraper.run(ctx);
    expect(result.observationCount).toBe(0);
    expect(centerFinder).not.toHaveBeenCalled();
    expect(emitted).toEqual([]);
  });
});

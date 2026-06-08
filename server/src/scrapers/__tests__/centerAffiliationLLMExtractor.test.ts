/**
 * Unit tests for the Center affiliation LLM extractor. All deps (page fetch, LLM,
 * center finder) are injected — no network, no DB, no OpenAI calls.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  CenterAffiliationLLMExtractor,
  affiliationExtractionToObservations,
  type CandidateCenter,
} from '../sources/centerAffiliationLLMExtractor';
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
      { centerEntityKey: 'center-jackson-centers-blue-center', sourceUrl: 'https://jackson.yale.edu/x' },
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
      apiKey: 'test-key',
    });
    const { ctx, emitted } = makeContext();
    const result = await scraper.run(ctx);

    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(callLLM).toHaveBeenCalledTimes(1);
    expect(result.entitiesObserved).toBe(1);
    expect(emitted.every((o) => o.entityType === 'researchEntityRelationship')).toBe(true);
    expect(emitted.find((o) => o.field === 'sourceEntityKey')!.value).toBe(center.slug);
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
      apiKey: 'test-key',
    });
    const { ctx, emitted } = makeContext();
    const result = await scraper.run(ctx);
    expect(result.entitiesObserved).toBe(0);
    expect(emitted).toEqual([]);
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

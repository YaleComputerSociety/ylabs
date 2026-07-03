/**
 * Unit tests for the Center director LLM extractor. All deps (page fetch, LLM,
 * center finder) are injected — no network, no DB, no OpenAI calls.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  CenterDirectorLLMExtractor,
  directorExtractionToObservations,
  discoverLeadershipUrls,
  normalizeCenterDirectorObjectId,
  type CandidateCenter,
} from '../sources/centerDirectorLLMExtractor';
import type { ScraperContext, ObservationInput } from '../types';

function makeContext(overrides: Partial<ScraperContext['options']> = {}) {
  const emitted: ObservationInput[] = [];
  const ctx: ScraperContext = {
    scrapeRunId: 'test-run',
    sourceId: 'test-source',
    sourceName: 'center-director-llm',
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

describe('discoverLeadershipUrls', () => {
  const pageUrl = 'https://medicine.yale.edu/cancer/research/membership/directory';

  it('ranks same-host leadership links ahead of the page itself', () => {
    const html = `
      <html><body>
        <a href="/cancer/about-us/leadership/">Leadership</a>
        <a href="/cancer/research/">Research</a>
        <a href="https://twitter.com/ycc">Follow us</a>
        <a href="/cancer/about-us/director/">Our Director</a>
      </body></html>`;
    const urls = discoverLeadershipUrls(html, pageUrl);
    expect(urls[0]).toBe('https://medicine.yale.edu/cancer/about-us/leadership/');
    expect(urls).toContain('https://medicine.yale.edu/cancer/about-us/director/');
    // off-host link excluded; the page itself is included as a fallback
    expect(urls.some((u) => u.includes('twitter.com'))).toBe(false);
    expect(urls).toContain(pageUrl);
  });

  it('caps the number of candidates and drops non-leadership links', () => {
    const html = `
      <html><body>
        <a href="/a/leadership">Leadership A</a>
        <a href="/b/about-us">About Us</a>
        <a href="/c/our-team">Our Team</a>
        <a href="/d/governance">Governance</a>
        <a href="/e/news">News</a>
      </body></html>`;
    const urls = discoverLeadershipUrls(html, 'https://example.yale.edu/x', 3);
    expect(urls.length).toBe(3);
    expect(urls.some((u) => u.includes('/news'))).toBe(false);
  });
});

describe('directorExtractionToObservations', () => {
  const context = {
    centerEntityKey: 'center-yale-cancer-center',
    sourceUrl: 'https://medicine.yale.edu/cancer/about-us/leadership/',
  };

  it('emits entity-level director observations with a name split and lifted role confidence', () => {
    const obs = directorExtractionToObservations(
      { director: { name: 'Elliot P. Fixture', title: 'Director', profileUrl: 'https://medicine.yale.edu/profile/fixture-center-director/' } },
      context,
    );
    expect(obs.every((o) => o.entityType === 'researchEntity')).toBe(true);
    expect(obs.every((o) => o.entityKey === context.centerEntityKey)).toBe(true);
    const byField = Object.fromEntries(obs.map((o) => [o.field, o]));
    expect(byField.inferredDirectorUserName.value).toEqual({ fname: 'Elliot', lname: 'Fixture' });
    expect(byField.inferredDirectorRole.value).toBe('director');
    expect(byField.inferredDirectorRole.confidenceOverride).toBe(0.85);
    expect(byField.inferredDirectorProfileUrl.value).toBe(
      'https://medicine.yale.edu/profile/fixture-center-director/',
    );
    expect(byField.inferredDirectorTitle.value).toBe('Director');
  });

  it('classifies associate/deputy leaders as co-director', () => {
    const obs = directorExtractionToObservations(
      { director: { name: 'Jane Doe', title: 'Associate Director' } },
      context,
    );
    const role = obs.find((o) => o.field === 'inferredDirectorRole');
    expect(role!.value).toBe('co-director');
  });

  it('drops a non-http profile URL but keeps the director', () => {
    const obs = directorExtractionToObservations(
      { director: { name: 'Jane Doe', profileUrl: 'mailto:jane@yale.edu' } },
      context,
    );
    expect(obs.some((o) => o.field === 'inferredDirectorProfileUrl')).toBe(false);
    expect(obs.some((o) => o.field === 'inferredDirectorUserName')).toBe(true);
  });

  it('returns nothing for a null director, a single-token name, or a missing center key', () => {
    expect(directorExtractionToObservations({ director: null }, context)).toEqual([]);
    expect(
      directorExtractionToObservations({ director: { name: 'Madonna' } }, context),
    ).toEqual([]);
    expect(
      directorExtractionToObservations(
        { director: { name: 'Jane Doe' } },
        { centerEntityKey: '', sourceUrl: 'https://x' },
      ),
    ).toEqual([]);
  });
});

describe('CenterDirectorLLMExtractor.run', () => {
  it('normalizes center director ObjectIds without object-shaped coercion', () => {
    expect(normalizeCenterDirectorObjectId(' 507f1f77bcf86cd799439011 ')).toBe(
      '507f1f77bcf86cd799439011',
    );
    expect(normalizeCenterDirectorObjectId('abcdefghijkl')).toBeUndefined();
    expect(
      normalizeCenterDirectorObjectId({
        toString: () => '507f1f77bcf86cd799439011',
      }),
    ).toBeUndefined();
  });

  const center: CandidateCenter = {
    _id: 'abc',
    slug: 'center-yale-cancer-center',
    name: 'Yale Cancer Center',
    websiteUrl: 'https://medicine.yale.edu/cancer/research/membership/directory',
  };

  it('follows a leadership link, extracts the director, and emits entity observations', async () => {
    const landing = {
      url: center.websiteUrl as string,
      html: '<html><body><a href="/cancer/about-us/leadership/">Leadership</a></body></html>',
    };
    const leadership = {
      url: 'https://medicine.yale.edu/cancer/about-us/leadership/',
      html: `<html><body>${'Elliot P. Fixture is the Director of Yale Cancer Center. '.repeat(20)}</body></html>`,
    };
    const fetchPage = vi.fn(async (url: string) =>
      url === landing.url ? landing : leadership,
    );
    const callLLM = vi.fn(async (input: { sourceUrl: string }) =>
      input.sourceUrl === leadership.url
        ? { director: { name: 'Elliot P. Fixture', title: 'Director', role: 'director' as const } }
        : { director: null },
    );
    const centerFinder = vi.fn(async () => [center]);
    const scraper = new CenterDirectorLLMExtractor({
      fetchPage,
      callLLM,
      centerFinder,
      apiKey: 'test-key',
    });
    const { ctx, emitted } = makeContext();
    const result = await scraper.run(ctx);

    expect(result.entitiesObserved).toBe(1);
    expect(emitted.every((o) => o.entityKey === center.slug)).toBe(true);
    expect(emitted.find((o) => o.field === 'inferredDirectorUserName')!.value).toEqual({
      fname: 'Elliot',
      lname: 'Fixture',
    });
    // the finder is asked only for homes missing a lead
    expect(centerFinder).toHaveBeenCalledWith(
      expect.objectContaining({ missingLeadOnly: true }),
    );
  });

  it('skips cleanly when no director is named on any candidate page', async () => {
    const fetchPage = vi.fn(async () => ({
      url: center.websiteUrl as string,
      html: `<html><body>${'No leader is named here. '.repeat(20)}</body></html>`,
    }));
    const callLLM = vi.fn(async () => ({ director: null }));
    const centerFinder = vi.fn(async () => [center]);
    const scraper = new CenterDirectorLLMExtractor({
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
    const scraper = new CenterDirectorLLMExtractor({ centerFinder, apiKey: undefined });
    const { ctx, emitted } = makeContext();
    const result = await scraper.run(ctx);
    expect(result.observationCount).toBe(0);
    expect(centerFinder).not.toHaveBeenCalled();
    expect(emitted).toEqual([]);
  });
});

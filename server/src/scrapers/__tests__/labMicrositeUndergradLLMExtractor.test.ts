/**
 * Tests for LabMicrositeUndergradLLMExtractor.
 *
 * Every external dependency is injected via the constructor `deps` argument:
 *   - `fetchPage`    — replaces axios HTML fetches
 *   - `callLLM`      — replaces the OpenAI chat-completions call
 *   - `labFinder`    — replaces the Mongo ResearchGroup query
 *   - `apiKey`       — provided explicitly so we never look at process.env
 *
 * No network or DB access happens in this suite.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  LabMicrositeUndergradLLMExtractor,
  htmlToPromptText,
  discoverSubPageUrl,
  candidateSubPageUrls,
  buildLLMPrompt,
  extractionToObservations,
  selectLabsToProcess,
  type CandidateLab,
  type LLMExtraction,
  type FetchedPage,
} from '../sources/labMicrositeUndergradLLMExtractor';
import type { ObservationInput, ScraperContext } from '../types';

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

function makeContext(
  overrides: Partial<ScraperContext['options']> = {},
): { ctx: ScraperContext; emitted: ObservationInput[]; logs: string[] } {
  const emitted: ObservationInput[] = [];
  const logs: string[] = [];
  const ctx: ScraperContext = {
    scrapeRunId: 'test-run',
    sourceId: 'test-source',
    sourceName: 'lab-microsite-undergrad-llm',
    sourceWeight: 0.5,
    options: {
      dryRun: true,
      useCache: false,
      release: false,
      ...overrides,
    },
    emit: async (obs) => {
      const arr = Array.isArray(obs) ? obs : [obs];
      emitted.push(...arr);
    },
    log: (msg) => {
      logs.push(msg);
    },
  };
  return { ctx, emitted, logs };
}

// ---------------------------------------------------------------------------
// htmlToPromptText
// ---------------------------------------------------------------------------

describe('htmlToPromptText', () => {
  it('strips <script> and <style> blocks and collapses whitespace', () => {
    const html = `
      <html><head><style>body{color:red}</style></head>
      <body>
        <h1>Welcome to the Smith Lab</h1>
        <p>We do research.</p>
        <script>alert('hi')</script>
        <p>We welcome   undergraduates.</p>
      </body></html>
    `;
    const text = htmlToPromptText(html);
    expect(text).toContain('Welcome to the Smith Lab');
    expect(text).toContain('We welcome undergraduates.');
    expect(text).not.toContain('alert');
    expect(text).not.toContain('color:red');
    // whitespace was collapsed to single spaces
    expect(text).not.toMatch(/\s{2,}/);
  });

  it('truncates output to 50000 characters', () => {
    const big = '<p>' + 'x'.repeat(80_000) + '</p>';
    const text = htmlToPromptText(big);
    expect(text.length).toBeLessThanOrEqual(50_000);
    expect(text.length).toBe(50_000);
  });

  it('returns an empty string for empty input', () => {
    expect(htmlToPromptText('')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// discoverSubPageUrl + candidateSubPageUrls
// ---------------------------------------------------------------------------

describe('discoverSubPageUrl', () => {
  it('returns the absolute URL of a same-host link whose text matches', () => {
    const html = `
      <a href="/people">Lab Members</a>
      <a href="https://twitter.com/x">Twitter</a>
    `;
    const url = discoverSubPageUrl(html, 'https://lab.example.com/');
    expect(url).toBe('https://lab.example.com/people');
  });

  it('skips off-site links even when the text matches', () => {
    const html = `<a href="https://otherhost.example.com/team">Our Team</a>`;
    const url = discoverSubPageUrl(html, 'https://lab.example.com/');
    expect(url).toBeNull();
  });

  it('returns null when no anchor matches the people/members/join pattern', () => {
    const html = `<a href="/news">News</a><a href="/papers">Papers</a>`;
    const url = discoverSubPageUrl(html, 'https://lab.example.com/');
    expect(url).toBeNull();
  });
});

describe('candidateSubPageUrls', () => {
  it('builds origin-rooted candidate URLs for the standard hint paths', () => {
    const urls = candidateSubPageUrls('https://lab.example.com/some/page');
    expect(urls).toContain('https://lab.example.com/people');
    expect(urls).toContain('https://lab.example.com/members');
    expect(urls).toContain('https://lab.example.com/join');
    expect(urls.every((u) => u.startsWith('https://lab.example.com/'))).toBe(true);
  });

  it('returns [] for malformed input', () => {
    expect(candidateSubPageUrls('not a url')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// buildLLMPrompt
// ---------------------------------------------------------------------------

describe('buildLLMPrompt', () => {
  it('includes the lab name, URL, home text, and sub-page text', () => {
    const prompt = buildLLMPrompt(
      'Smith Lab',
      'https://smith.example.com/',
      'we welcome undergraduates',
      'https://smith.example.com/people',
      'undergrads: alice, bob',
    );
    expect(prompt).toContain('Smith Lab');
    expect(prompt).toContain('https://smith.example.com/');
    expect(prompt).toContain('we welcome undergraduates');
    expect(prompt).toContain('https://smith.example.com/people');
    expect(prompt).toContain('undergrads: alice, bob');
  });

  it('omits the sub-page section when none was fetched', () => {
    const prompt = buildLLMPrompt(
      'Smith Lab',
      'https://smith.example.com/',
      'home text',
      null,
      null,
    );
    expect(prompt).not.toContain('SUB-PAGE TEXT');
  });
});

// ---------------------------------------------------------------------------
// extractionToObservations
// ---------------------------------------------------------------------------

describe('extractionToObservations', () => {
  const fixedDate = new Date('2026-04-27T12:00:00Z');

  it('emits acceptingUndergrads=true on yes (with confidence override 0.5)', () => {
    const ext: LLMExtraction = {
      openToUndergrads: 'yes',
      currentUndergradCount: 0,
      evidenceQuote: 'We welcome motivated undergraduates each semester.',
      evidenceSource: 'explicit_text',
      joinPageUrl: null,
    };
    const obs = extractionToObservations('lab-foo', 'https://x.example/', ext, fixedDate);
    const accepting = obs.find((o) => o.field === 'acceptingUndergrads');
    expect(accepting).toBeDefined();
    expect(accepting!.value).toBe(true);
    expect(accepting!.confidenceOverride).toBe(0.5);
    // count not emitted because evidenceSource is explicit_text, not members_section
    expect(obs.find((o) => o.field === 'currentUndergradCount')).toBeUndefined();
    // quote was emitted
    const quote = obs.find((o) => o.field === 'undergradEvidenceQuote');
    expect(quote!.value).toBe('We welcome motivated undergraduates each semester.');
    // lastObservedAt always emitted
    expect(obs.find((o) => o.field === 'lastObservedAt')!.value).toEqual(fixedDate);
  });

  it('emits acceptingUndergrads=false on no', () => {
    const ext: LLMExtraction = {
      openToUndergrads: 'no',
      currentUndergradCount: 0,
      evidenceQuote: 'We do not accept undergraduate students.',
      evidenceSource: 'explicit_text',
      joinPageUrl: null,
    };
    const obs = extractionToObservations('lab-bar', 'https://x.example/', ext, fixedDate);
    const accepting = obs.find((o) => o.field === 'acceptingUndergrads');
    expect(accepting!.value).toBe(false);
    expect(accepting!.confidenceOverride).toBe(0.5);
  });

  it('skips acceptingUndergrads observation entirely on unclear', () => {
    const ext: LLMExtraction = {
      openToUndergrads: 'unclear',
      currentUndergradCount: 0,
      evidenceQuote: '',
      evidenceSource: 'none',
      joinPageUrl: null,
    };
    const obs = extractionToObservations('lab-baz', 'https://x.example/', ext, fixedDate);
    expect(obs.find((o) => o.field === 'acceptingUndergrads')).toBeUndefined();
    expect(obs.find((o) => o.field === 'undergradEvidenceQuote')).toBeUndefined();
    // Only lastObservedAt
    expect(obs).toHaveLength(1);
    expect(obs[0].field).toBe('lastObservedAt');
  });

  it('emits currentUndergradCount only when evidenceSource is members_section', () => {
    const fromMembers: LLMExtraction = {
      openToUndergrads: 'yes',
      currentUndergradCount: 4,
      evidenceQuote: 'Undergraduates: Alice, Bob, Carol, Dan',
      evidenceSource: 'members_section',
      joinPageUrl: null,
    };
    const obs1 = extractionToObservations('lab-1', 'https://x/', fromMembers, fixedDate);
    const count1 = obs1.find((o) => o.field === 'currentUndergradCount');
    expect(count1).toBeDefined();
    expect(count1!.value).toBe(4);
    expect(count1!.confidenceOverride).toBe(0.5);

    const fromProse: LLMExtraction = {
      openToUndergrads: 'yes',
      currentUndergradCount: 4,
      evidenceQuote: 'We have many undergraduates.',
      evidenceSource: 'explicit_text',
      joinPageUrl: null,
    };
    const obs2 = extractionToObservations('lab-2', 'https://x/', fromProse, fixedDate);
    expect(obs2.find((o) => o.field === 'currentUndergradCount')).toBeUndefined();
  });

  it('truncates very long evidence quotes to 500 characters', () => {
    const ext: LLMExtraction = {
      openToUndergrads: 'yes',
      currentUndergradCount: 0,
      evidenceQuote: 'q'.repeat(2000),
      evidenceSource: 'explicit_text',
      joinPageUrl: null,
    };
    const obs = extractionToObservations('lab-3', 'https://x/', ext, fixedDate);
    const quote = obs.find((o) => o.field === 'undergradEvidenceQuote');
    expect((quote!.value as string).length).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// selectLabsToProcess
// ---------------------------------------------------------------------------

describe('selectLabsToProcess', () => {
  const labs: CandidateLab[] = [
    { _id: '1', slug: 'lab-a', name: 'A', websiteUrl: 'https://a.example/' },
    {
      _id: '2',
      slug: 'lab-b',
      name: 'B',
      websiteUrl: 'https://b.example/',
      manuallyLockedFields: ['acceptingUndergrads'],
    },
    { _id: '3', slug: 'lab-c', name: 'C', websiteUrl: '', manuallyLockedFields: [] },
    {
      _id: '4',
      slug: 'lab-d',
      name: 'D',
      websiteUrl: 'https://d.example/',
      archived: true,
    },
    { _id: '5', slug: 'lab-e', name: 'E', websiteUrl: 'https://e.example/' },
  ];

  it('drops labs without a websiteUrl, with the field locked, or archived', () => {
    const out = selectLabsToProcess(labs, {});
    expect(out.map((l) => l.slug)).toEqual(['lab-a', 'lab-e']);
  });

  it('honors --only as a slug allowlist (case-insensitive)', () => {
    const out = selectLabsToProcess(labs, { only: ['LAB-E'] });
    expect(out.map((l) => l.slug)).toEqual(['lab-e']);
  });

  it('caps results at the configured limit', () => {
    const out = selectLabsToProcess(labs, { limit: 1 });
    expect(out).toHaveLength(1);
    expect(out[0].slug).toBe('lab-a');
  });
});

// ---------------------------------------------------------------------------
// Full-run integration with mocked fetchPage + callLLM + labFinder
// ---------------------------------------------------------------------------

const HOME_HTML = `
<html><body>
  <h1>The Smith Lab</h1>
  <p>We welcome undergraduate researchers each semester.</p>
  <a href="/people">Lab Members</a>
</body></html>
`;

const PEOPLE_HTML = `
<html><body>
  <h2>Members</h2>
  <h3>Undergraduates</h3>
  <ul><li>Alice</li><li>Bob</li><li>Carol</li></ul>
</body></html>
`;

function makeFetchPage(pages: Record<string, string>) {
  return vi.fn(async (url: string): Promise<FetchedPage | null> => {
    if (pages[url] !== undefined) return { url, html: pages[url] };
    return null;
  });
}

describe('LabMicrositeUndergradLLMExtractor.run', () => {
  it('fetches the home page, follows a discovered sub-page, and emits the right observations', async () => {
    const fetchPage = makeFetchPage({
      'https://smith.example.com/': HOME_HTML,
      'https://smith.example.com/people': PEOPLE_HTML,
    });
    const callLLM = vi.fn(
      async (
        _input: { model: string; systemPrompt: string; userPrompt: string; apiKey: string },
      ): Promise<LLMExtraction> => ({
        openToUndergrads: 'yes',
        currentUndergradCount: 3,
        evidenceQuote: 'We welcome undergraduate researchers each semester.',
        evidenceSource: 'members_section',
        joinPageUrl: null,
      }),
    );
    const labFinder = async (): Promise<CandidateLab[]> => [
      {
        _id: '1',
        slug: 'smith-lab',
        name: 'The Smith Lab',
        websiteUrl: 'https://smith.example.com/',
      },
    ];

    const scraper = new LabMicrositeUndergradLLMExtractor({
      fetchPage,
      callLLM,
      labFinder,
      apiKey: 'sk-test',
    });
    const { ctx, emitted } = makeContext();
    const result = await scraper.run(ctx);

    // Home + sub-page were both fetched
    expect(fetchPage).toHaveBeenCalledWith('https://smith.example.com/');
    expect(fetchPage).toHaveBeenCalledWith('https://smith.example.com/people');
    expect(callLLM).toHaveBeenCalledTimes(1);

    // The system prompt and user prompt include the sub-page text.
    const llmInput = callLLM.mock.calls[0][0];
    expect(llmInput.userPrompt).toContain('We welcome undergraduate researchers');
    expect(llmInput.userPrompt).toContain('SUB-PAGE TEXT');
    expect(llmInput.userPrompt).toContain('Alice');

    // Observations
    expect(result.entitiesObserved).toBe(1);
    const fields = emitted.map((o) => o.field).sort();
    expect(fields).toEqual(
      [
        'acceptingUndergrads',
        'currentUndergradCount',
        'lastObservedAt',
        'undergradEvidenceQuote',
      ].sort(),
    );
    const accepting = emitted.find((o) => o.field === 'acceptingUndergrads');
    expect(accepting!.value).toBe(true);
    expect(accepting!.confidenceOverride).toBe(0.5);
    expect(accepting!.entityKey).toBe('smith-lab');
    expect(emitted.find((o) => o.field === 'currentUndergradCount')!.value).toBe(3);
  });

  it('skips labs whose acceptingUndergrads field is manually locked', async () => {
    const fetchPage = makeFetchPage({});
    const callLLM = vi.fn();
    const labFinder = async (): Promise<CandidateLab[]> => [
      {
        _id: '1',
        slug: 'locked-lab',
        name: 'Locked',
        websiteUrl: 'https://locked.example.com/',
        manuallyLockedFields: ['acceptingUndergrads'],
      },
      {
        _id: '2',
        slug: 'free-lab',
        name: 'Free',
        websiteUrl: 'https://free.example.com/',
      },
    ];

    const scraper = new LabMicrositeUndergradLLMExtractor({
      fetchPage,
      callLLM,
      labFinder,
      apiKey: 'sk-test',
    });
    const { ctx } = makeContext();
    await scraper.run(ctx);

    // Locked lab was never fetched
    expect(fetchPage).not.toHaveBeenCalledWith('https://locked.example.com/');
    // Free lab was fetched
    expect(fetchPage).toHaveBeenCalledWith('https://free.example.com/');
  });

  it('respects the --only filter (slug allowlist)', async () => {
    const fetchPage = makeFetchPage({
      'https://b.example/': HOME_HTML,
    });
    const callLLM = vi.fn(async () => ({
      openToUndergrads: 'unclear',
      currentUndergradCount: 0,
      evidenceQuote: '',
      evidenceSource: 'none',
      joinPageUrl: null,
    } satisfies LLMExtraction));
    const labFinder = async (): Promise<CandidateLab[]> => [
      { _id: '1', slug: 'lab-a', name: 'A', websiteUrl: 'https://a.example/' },
      { _id: '2', slug: 'lab-b', name: 'B', websiteUrl: 'https://b.example/' },
    ];

    const scraper = new LabMicrositeUndergradLLMExtractor({
      fetchPage,
      callLLM,
      labFinder,
      apiKey: 'sk-test',
    });
    const { ctx, emitted } = makeContext({ only: ['lab-b'] });
    await scraper.run(ctx);

    expect(fetchPage).not.toHaveBeenCalledWith('https://a.example/');
    expect(fetchPage).toHaveBeenCalledWith('https://b.example/');
    // openToUndergrads was 'unclear' → no acceptingUndergrads obs, only lastObservedAt
    expect(emitted.find((o) => o.field === 'acceptingUndergrads')).toBeUndefined();
  });

  it('continues to the next lab when the LLM call throws', async () => {
    const fetchPage = makeFetchPage({
      'https://a.example/': HOME_HTML,
      'https://b.example/': HOME_HTML,
    });
    const callLLM = vi.fn(async ({ userPrompt }: any) => {
      if (userPrompt.includes('Crashy Lab')) {
        throw new Error('rate limited');
      }
      return {
        openToUndergrads: 'yes',
        currentUndergradCount: 0,
        evidenceQuote: 'We welcome undergraduates.',
        evidenceSource: 'explicit_text',
        joinPageUrl: null,
      } satisfies LLMExtraction;
    });
    const labFinder = async (): Promise<CandidateLab[]> => [
      { _id: '1', slug: 'crashy', name: 'Crashy Lab', websiteUrl: 'https://a.example/' },
      { _id: '2', slug: 'happy', name: 'Happy Lab', websiteUrl: 'https://b.example/' },
    ];

    const scraper = new LabMicrositeUndergradLLMExtractor({
      fetchPage,
      callLLM,
      labFinder,
      apiKey: 'sk-test',
    });
    const { ctx, emitted, logs } = makeContext();
    const result = await scraper.run(ctx);

    expect(callLLM).toHaveBeenCalledTimes(2);
    // crashy lab produced no observations; happy lab succeeded
    const slugs = new Set(emitted.map((o) => o.entityKey));
    expect(slugs.has('happy')).toBe(true);
    expect(slugs.has('crashy')).toBe(false);
    expect(result.entitiesObserved).toBe(1);
    expect(logs.some((l) => /LLM call failed: rate limited/.test(l))).toBe(true);
  });

  it('skips labs whose home page returns 404 (fetchPage returns null) and logs nothing scary', async () => {
    // fetchPage returns null for the first lab's home page (simulating 404),
    // and a real page for the second lab.
    const fetchPage = vi.fn(async (url: string) => {
      if (url === 'https://gone.example.com/') return null; // 404
      if (url === 'https://present.example.com/') {
        return { url, html: HOME_HTML };
      }
      return null; // sub-page probes return null too
    });
    const callLLM = vi.fn(async () => ({
      openToUndergrads: 'yes',
      currentUndergradCount: 0,
      evidenceQuote: 'We welcome undergraduates.',
      evidenceSource: 'explicit_text',
      joinPageUrl: null,
    } satisfies LLMExtraction));
    const labFinder = async (): Promise<CandidateLab[]> => [
      { _id: '1', slug: 'gone-lab', name: 'Gone', websiteUrl: 'https://gone.example.com/' },
      {
        _id: '2',
        slug: 'present-lab',
        name: 'Present',
        websiteUrl: 'https://present.example.com/',
      },
    ];

    const scraper = new LabMicrositeUndergradLLMExtractor({
      fetchPage,
      callLLM,
      labFinder,
      apiKey: 'sk-test',
    });
    const { ctx, emitted } = makeContext();
    const result = await scraper.run(ctx);

    // The 404 lab was attempted (one fetch call) but skipped before LLM
    expect(fetchPage).toHaveBeenCalledWith('https://gone.example.com/');
    expect(callLLM).toHaveBeenCalledTimes(1); // only present-lab
    expect(result.entitiesObserved).toBe(1);
    // No observations for the gone lab
    expect(emitted.every((o) => o.entityKey !== 'gone-lab')).toBe(true);
    // present-lab got its observations
    expect(emitted.some((o) => o.entityKey === 'present-lab' && o.field === 'acceptingUndergrads')).toBe(
      true,
    );
  });

  it('returns zero observations and logs a warning when OPENAI_API_KEY is missing', async () => {
    const labFinder = async (): Promise<CandidateLab[]> => [
      { _id: '1', slug: 'x', name: 'X', websiteUrl: 'https://x.example/' },
    ];
    const scraper = new LabMicrositeUndergradLLMExtractor({
      fetchPage: vi.fn(),
      callLLM: vi.fn(),
      labFinder,
      apiKey: '',
    });
    const { ctx, logs } = makeContext();
    const result = await scraper.run(ctx);
    expect(result.observationCount).toBe(0);
    expect(result.entitiesObserved).toBe(0);
    expect(logs.some((l) => /OPENAI_API_KEY missing/.test(l))).toBe(true);
  });

  it('respects the --limit cap on the number of LLM calls', async () => {
    const labs: CandidateLab[] = Array.from({ length: 5 }, (_i, i) => ({
      _id: String(i),
      slug: `lab-${i}`,
      name: `Lab ${i}`,
      websiteUrl: `https://lab${i}.example/`,
    }));
    const fetchPage = vi.fn(async (url: string) => ({ url, html: HOME_HTML }));
    const callLLM = vi.fn(async () => ({
      openToUndergrads: 'yes',
      currentUndergradCount: 0,
      evidenceQuote: 'q',
      evidenceSource: 'explicit_text',
      joinPageUrl: null,
    } satisfies LLMExtraction));

    const scraper = new LabMicrositeUndergradLLMExtractor({
      fetchPage,
      callLLM,
      labFinder: async () => labs,
      apiKey: 'sk-test',
    });
    const { ctx } = makeContext({ limit: 2 });
    const result = await scraper.run(ctx);

    expect(callLLM).toHaveBeenCalledTimes(2);
    expect(result.entitiesObserved).toBe(2);
  });
});

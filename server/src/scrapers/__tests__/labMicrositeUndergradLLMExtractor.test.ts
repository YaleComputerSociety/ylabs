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
  discoverSubPageUrls,
  candidateSubPageUrls,
  candidateCrawlUrls,
  buildLLMPrompt,
  extractionToObservations,
  sourceUrlForExtraction,
  candidateLabFromResearchEntityDoc,
  selectLabsToProcess,
  type CandidateLab,
  type LabMicrositeUndergradLLMExtractorDeps,
  type LLMExtraction,
  type FetchedPage,
  type WorkPlanLoaderFn,
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

const alwaysFetchWorkPlan: WorkPlanLoaderFn = async (lab, policy) => ({
  entityType: policy.entityType,
  entityKey: lab.slug,
  sourceName: policy.sourceName,
  fields: policy.targetFields.map((field) => ({
    field,
    shouldFetch: true,
    reason: 'missing' as const,
  })),
  shouldFetch: true,
});

function newTestScraper(
  deps: LabMicrositeUndergradLLMExtractorDeps,
): LabMicrositeUndergradLLMExtractor {
  return new LabMicrositeUndergradLLMExtractor({
    workPlanLoader: alwaysFetchWorkPlan,
    ...deps,
  });
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

describe('discoverSubPageUrls', () => {
  it('returns multiple same-host relevant links in document order', () => {
    const html = `
      <a href="/people">People</a>
      <a href="/join">Join Us</a>
      <a href="/opportunities#students">Opportunities</a>
      <a href="/news">News</a>
    `;
    expect(discoverSubPageUrls(html, 'https://lab.example.com/')).toEqual([
      'https://lab.example.com/people',
      'https://lab.example.com/join',
      'https://lab.example.com/opportunities',
    ]);
  });

  it('dedupes links after normalizing URL hashes and honors the max', () => {
    const html = `
      <a href="/people#students">People</a>
      <a href="/people">Lab Members</a>
      <a href="/join">Join</a>
    `;
    expect(discoverSubPageUrls(html, 'https://lab.example.com/', 2)).toEqual([
      'https://lab.example.com/people',
      'https://lab.example.com/join',
    ]);
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

describe('candidateCrawlUrls', () => {
  it('combines discovered links with fallback paths, deduped and bounded', () => {
    const html = `
      <a href="/join">Join</a>
      <a href="/people#current">People</a>
      <a href="/join#students">Opportunities</a>
    `;
    expect(candidateCrawlUrls(html, 'https://lab.example.com/', 4)).toEqual([
      'https://lab.example.com/join',
      'https://lab.example.com/people',
      'https://lab.example.com/members',
      'https://lab.example.com/team',
    ]);
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

  it('includes additional sub-pages with their raw source URLs', () => {
    const prompt = buildLLMPrompt(
      'Smith Lab',
      'https://smith.example.com/',
      'home text',
      'https://smith.example.com/people',
      'people text',
      [{ url: 'https://smith.example.com/join', text: 'join text' }],
    );
    expect(prompt).toContain('SUB-PAGE TEXT (https://smith.example.com/people)');
    expect(prompt).toContain('people text');
    expect(prompt).toContain('SUB-PAGE TEXT (https://smith.example.com/join)');
    expect(prompt).toContain('join text');
  });
});

describe('sourceUrlForExtraction', () => {
  it('returns the page whose text contains the evidence quote', () => {
    const ext: LLMExtraction = {
      openToUndergrads: 'yes',
      currentUndergradCount: 0,
      evidenceQuote: 'Undergraduates help with field work.',
      evidenceSource: 'explicit_text',
      joinPageUrl: 'https://smith.example.com/join',
    };
    const sourceUrl = sourceUrlForExtraction(
      { url: 'https://smith.example.com/', text: 'Welcome.' },
      [
        { url: 'https://smith.example.com/people', text: 'Members.' },
        {
          url: 'https://smith.example.com/join',
          text: 'Undergraduates help with field work.',
        },
      ],
      ext,
    );
    expect(sourceUrl).toBe('https://smith.example.com/join');
  });
});

// ---------------------------------------------------------------------------
// extractionToObservations
// ---------------------------------------------------------------------------

describe('extractionToObservations', () => {
  const fixedDate = new Date('2026-04-27T12:00:00Z');

  it('emits evidence-shaped access observations plus legacy compatibility on yes', () => {
    const ext: LLMExtraction = {
      openToUndergrads: 'yes',
      currentUndergradCount: 0,
      evidenceQuote: 'We welcome motivated undergraduates each semester.',
      evidenceSource: 'explicit_text',
      joinPageUrl: null,
    };
    const obs = extractionToObservations('lab-foo', 'https://x.example/', ext, fixedDate, {
      sourceUrls: ['https://x.example/', 'https://x.example/join'],
      quoteSourceUrl: 'https://x.example/join',
    });
    const accepting = obs.find((o) => o.field === 'acceptingUndergrads');
    expect(accepting).toBeDefined();
    expect(accepting!.value).toBe(true);
    expect(accepting!.confidenceOverride).toBe(0.5);
    const evidence = obs.find((o) => o.field === 'undergradAccessEvidence');
    expect(evidence!.value).toMatchObject({
      openToUndergrads: 'yes',
      evidenceSource: 'explicit_text',
      sourceUrls: ['https://x.example/', 'https://x.example/join'],
      quoteSourceUrl: 'https://x.example/join',
    });
    // count not emitted because evidenceSource is explicit_text, not members_section
    expect(obs.find((o) => o.field === 'currentUndergradCount')).toBeUndefined();
    // quote was emitted
    const quote = obs.find((o) => o.field === 'undergradEvidenceQuote');
    expect(quote!.value).toBe('We welcome motivated undergraduates each semester.');
    expect(quote!.sourceUrl).toBe('https://x.example/join');
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
    expect(obs.find((o) => o.field === 'undergradAccessEvidence')!.value).toMatchObject({
      openToUndergrads: 'no',
    });
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

  it('emits join/contact/role evidence as separate observations', () => {
    const ext: LLMExtraction = {
      openToUndergrads: 'yes',
      currentUndergradCount: 0,
      evidenceQuote: 'We welcome students.',
      evidenceSource: 'explicit_text',
      joinPageUrl: 'https://x.example/join',
      undergradRoleQuote: 'Undergraduates help collect data.',
      contactInstructionsQuote: 'Apply using the form on this page.',
      explicitConstraintQuote: 'Prior Python experience preferred.',
    };
    const obs = extractionToObservations('lab-4', 'https://x/', ext, fixedDate);
    expect(obs.find((o) => o.field === 'joinPageUrl')!.value).toBe('https://x.example/join');
    expect(obs.find((o) => o.field === 'undergradRoleEvidenceQuote')!.value).toBe(
      'Undergraduates help collect data.',
    );
    expect(obs.find((o) => o.field === 'contactInstructionsQuote')!.value).toBe(
      'Apply using the form on this page.',
    );
    expect(obs.find((o) => o.field === 'undergradConstraintQuote')!.value).toBe(
      'Prior Python experience preferred.',
    );
  });

  it('redacts direct contact details from legacy public quote fields', () => {
    const ext: LLMExtraction = {
      openToUndergrads: 'yes',
      currentUndergradCount: 0,
      evidenceQuote: 'Email pi.person@yale.edu to discuss undergraduate research.',
      evidenceSource: 'explicit_text',
      joinPageUrl: 'https://x.example/join',
      undergradRoleQuote: '',
      contactInstructionsQuote: 'Call 203-432-1234 or email manager@yale.edu.',
      explicitConstraintQuote: '',
    };
    const obs = extractionToObservations('lab-5', 'https://x/', ext, fixedDate);

    expect(obs.find((o) => o.field === 'undergradEvidenceQuote')!.value).toBe(
      'Email [email redacted] to discuss undergraduate research.',
    );
    expect(obs.find((o) => o.field === 'contactInstructionsQuote')!.value).toBe(
      'Call [phone redacted] or email [email redacted].',
    );
    expect((obs.find((o) => o.field === 'undergradAccessEvidence')!.value as any).evidenceQuote).toBe(
      'Email pi.person@yale.edu to discuss undergraduate research.',
    );
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

  it('normalizes canonical ResearchEntity website fallbacks for candidate selection', () => {
    expect(
      candidateLabFromResearchEntityDoc({
        _id: 'entity-1',
        slug: 'legacy-website',
        name: 'Legacy Website Lab',
        website: 'https://legacy.example.edu/',
        websiteUrl: '',
      }),
    ).toMatchObject({
      slug: 'legacy-website',
      websiteUrl: 'https://legacy.example.edu/',
    });

    expect(
      candidateLabFromResearchEntityDoc({
        _id: 'entity-2',
        slug: 'source-url',
        name: 'Source URL Lab',
        sourceUrls: ['mailto:hidden@example.edu', 'https://source.example.edu/lab'],
      }),
    ).toMatchObject({
      slug: 'source-url',
      websiteUrl: 'https://source.example.edu/lab',
    });
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

    const scraper = newTestScraper({
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
    expect(result.metrics?.workPlanner).toEqual({
      planned: 1,
      fetched: 1,
      skippedFresh: 0,
      skippedManualLock: 0,
      skippedNoIdentifier: 0,
    });
    const fields = emitted.map((o) => o.field).sort();
    expect(fields).toEqual(
      [
        'acceptingUndergrads',
        'currentUndergradCount',
        'lastObservedAt',
        'undergradAccessEvidence',
        'undergradEvidenceQuote',
      ].sort(),
    );
    const accepting = emitted.find((o) => o.field === 'acceptingUndergrads');
    expect(accepting!.value).toBe(true);
    expect(accepting!.confidenceOverride).toBe(0.5);
    expect(accepting!.entityKey).toBe('smith-lab');
    expect(emitted.find((o) => o.field === 'currentUndergradCount')!.value).toBe(3);
  });

  it('uses WorkPlanner to skip fresh labs before fetch or LLM calls', async () => {
    const fetchPage = vi.fn();
    const callLLM = vi.fn();
    const workPlanLoader: WorkPlanLoaderFn = async (lab, policy) => ({
      entityType: policy.entityType,
      entityKey: lab.slug,
      sourceName: policy.sourceName,
      fields: policy.targetFields.map((field) => ({
        field,
        shouldFetch: false,
        reason: 'fresh' as const,
        lastObservedAt: '2026-05-12T00:00:00.000Z',
      })),
      shouldFetch: false,
    });

    const scraper = newTestScraper({
      fetchPage,
      callLLM,
      workPlanLoader,
      labFinder: async () => [
        {
          _id: '1',
          slug: 'fresh-lab',
          name: 'Fresh Lab',
          websiteUrl: 'https://fresh.example.com/',
        },
      ],
      apiKey: 'sk-test',
    });
    const { ctx, emitted, logs } = makeContext();
    const result = await scraper.run(ctx);

    expect(fetchPage).not.toHaveBeenCalled();
    expect(callLLM).not.toHaveBeenCalled();
    expect(emitted).toEqual([]);
    expect(result).toMatchObject({
      observationCount: 0,
      entitiesObserved: 0,
      metrics: {
        workPlanner: {
          planned: 1,
          fetched: 0,
          skippedFresh: 1,
          skippedManualLock: 0,
          skippedNoIdentifier: 0,
        },
      },
    });
    expect(logs.some((log) => log.includes('[fresh-lab] skipped by WorkPlanner'))).toBe(true);
  });

  it('can bypass WorkPlanner for full audit runs', async () => {
    const fetchPage = makeFetchPage({
      'https://fresh.example.com/':
        '<html><body><h1>Fresh Lab</h1><p>Undergraduates join projects.</p></body></html>',
    });
    const callLLM = vi.fn(async (): Promise<LLMExtraction> => ({
      openToUndergrads: 'yes',
      currentUndergradCount: 0,
      evidenceQuote: 'Undergraduates join projects.',
      evidenceSource: 'explicit_text',
      joinPageUrl: null,
    }));
    const workPlanLoader = vi.fn(async (lab, policy) => ({
      entityType: policy.entityType,
      entityKey: lab.slug,
      sourceName: policy.sourceName,
      fields: policy.targetFields.map((field: string) => ({
        field,
        shouldFetch: false,
        reason: 'fresh' as const,
      })),
      shouldFetch: false,
    }));

    const scraper = newTestScraper({
      fetchPage,
      callLLM,
      workPlanLoader,
      labFinder: async () => [
        {
          _id: '1',
          slug: 'fresh-lab',
          name: 'Fresh Lab',
          websiteUrl: 'https://fresh.example.com/',
        },
      ],
      apiKey: 'sk-test',
    });
    const { ctx } = makeContext({ ignoreWorkPlanner: true });
    const result = await scraper.run(ctx);

    expect(workPlanLoader).not.toHaveBeenCalled();
    expect(fetchPage).toHaveBeenCalledWith('https://fresh.example.com/');
    expect(callLLM).toHaveBeenCalledTimes(1);
    expect(result.entitiesObserved).toBe(1);
    expect(result.metrics?.workPlanner).toEqual({
      planned: 0,
      fetched: 0,
      skippedFresh: 0,
      skippedManualLock: 0,
      skippedNoIdentifier: 0,
    });
  });

  it('follows multiple relevant home-page links and preserves the quote source URL', async () => {
    const fetchPage = makeFetchPage({
      'https://smith.example.com/': `
        <html><body>
          <h1>The Smith Lab</h1>
          <a href="/people">People</a>
          <a href="/join">Join Us</a>
        </body></html>
      `,
      'https://smith.example.com/people': '<html><body>Current students</body></html>',
      'https://smith.example.com/join':
        '<html><body>Undergraduates help collect data each summer.</body></html>',
    });
    const callLLM = vi.fn(async () => ({
      openToUndergrads: 'yes',
      currentUndergradCount: 0,
      evidenceQuote: 'Undergraduates help collect data each summer.',
      evidenceSource: 'explicit_text',
      joinPageUrl: 'https://smith.example.com/join',
    } satisfies LLMExtraction));
    const scraper = newTestScraper({
      fetchPage,
      callLLM,
      labFinder: async () => [
        {
          _id: '1',
          slug: 'smith-lab',
          name: 'The Smith Lab',
          websiteUrl: 'https://smith.example.com/',
        },
      ],
      apiKey: 'sk-test',
    });
    const { ctx, emitted } = makeContext();
    await scraper.run(ctx);

    expect(fetchPage).toHaveBeenCalledWith('https://smith.example.com/people');
    expect(fetchPage).toHaveBeenCalledWith('https://smith.example.com/join');
    const prompt = (callLLM.mock.calls as unknown as Array<[{ userPrompt: string }]>)[0][0]
      .userPrompt;
    expect(prompt).toContain('SUB-PAGE TEXT (https://smith.example.com/people)');
    expect(prompt).toContain('SUB-PAGE TEXT (https://smith.example.com/join)');
    const evidence = emitted.find((o) => o.field === 'undergradAccessEvidence');
    expect(evidence!.sourceUrl).toBe('https://smith.example.com/join');
    expect(evidence!.value).toMatchObject({
      sourceUrls: [
        'https://smith.example.com/',
        'https://smith.example.com/people',
        'https://smith.example.com/join',
      ],
      quoteSourceUrl: 'https://smith.example.com/join',
    });
    expect(emitted.find((o) => o.field === 'undergradEvidenceQuote')!.sourceUrl).toBe(
      'https://smith.example.com/join',
    );
  });

  it('dedupes candidate pages and fetches only the bounded number of sub-pages', async () => {
    const fetchPage = makeFetchPage({
      'https://bounded.example.com/': `
        <html><body>
          <a href="/people#undergrads">People</a>
          <a href="/people">Lab Members</a>
          <a href="/join">Join</a>
          <a href="/opportunities">Opportunities</a>
          <a href="/undergraduates">Undergraduates</a>
        </body></html>
      `,
      'https://bounded.example.com/people': '<html><body>People page</body></html>',
      'https://bounded.example.com/join': '<html><body>Join page</body></html>',
      'https://bounded.example.com/opportunities':
        '<html><body>Opportunities page</body></html>',
      'https://bounded.example.com/undergraduates':
        '<html><body>Undergraduates page</body></html>',
    });
    const callLLM = vi.fn(async () => ({
      openToUndergrads: 'unclear',
      currentUndergradCount: 0,
      evidenceQuote: '',
      evidenceSource: 'none',
      joinPageUrl: null,
    } satisfies LLMExtraction));
    const scraper = newTestScraper({
      fetchPage,
      callLLM,
      labFinder: async () => [
        {
          _id: '1',
          slug: 'bounded-lab',
          name: 'Bounded Lab',
          websiteUrl: 'https://bounded.example.com/',
        },
      ],
      apiKey: 'sk-test',
    });
    const { ctx } = makeContext();
    await scraper.run(ctx);

    expect(fetchPage).toHaveBeenCalledWith('https://bounded.example.com/people');
    expect(fetchPage).toHaveBeenCalledWith('https://bounded.example.com/join');
    expect(fetchPage).toHaveBeenCalledWith('https://bounded.example.com/opportunities');
    expect(fetchPage).not.toHaveBeenCalledWith(
      'https://bounded.example.com/undergraduates',
    );
    expect(
      fetchPage.mock.calls.filter(
        ([url]) => url === 'https://bounded.example.com/people',
      ),
    ).toHaveLength(1);
    const prompt = (callLLM.mock.calls as unknown as Array<[{ userPrompt: string }]>)[0][0]
      .userPrompt;
    expect(prompt).not.toContain(
      'Undergraduates page',
    );
  });

  it('falls back to a rendered fetcher when the home page is empty or script-heavy', async () => {
    const fetchPage = makeFetchPage({
      'https://hydrated.example.com/': '<html><body><div id="root"></div><script>app()</script></body></html>',
    });
    const renderedFetcher = vi.fn().mockResolvedValue({
      url: 'https://hydrated.example.com/',
      html: HOME_HTML,
      fetchMode: 'scrapling',
    });
    const callLLM = vi.fn(async () => ({
      openToUndergrads: 'yes',
      currentUndergradCount: 0,
      evidenceQuote: 'We welcome undergraduate researchers each semester.',
      evidenceSource: 'explicit_text',
      joinPageUrl: null,
    } satisfies LLMExtraction));
    const labFinder = async (): Promise<CandidateLab[]> => [
      {
        _id: '1',
        slug: 'hydrated-lab',
        name: 'Hydrated Lab',
        websiteUrl: 'https://hydrated.example.com/',
      },
    ];

    const scraper = newTestScraper({
      fetchPage,
      renderedFetcher,
      callLLM,
      labFinder,
      apiKey: 'sk-test',
    });
    const { ctx } = makeContext();
    const result = await scraper.run(ctx);

    expect(renderedFetcher).toHaveBeenCalledWith({
      url: 'https://hydrated.example.com/',
      waitSelector: 'body',
      timeoutMs: 10000,
    });
    expect(callLLM).toHaveBeenCalled();
    const llmInput = (callLLM.mock.calls as unknown as Array<[{ userPrompt: string }]>)[0][0];
    expect(llmInput.userPrompt).toContain('We welcome undergraduate researchers');
    expect(result.fetchMetrics?.summary.byMode.scrapling?.succeeded).toBe(1);
    expect(result.fetchMetrics?.summary.byMode.http?.succeeded).toBe(1);
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

    const scraper = newTestScraper({
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

    const scraper = newTestScraper({
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

    const scraper = newTestScraper({
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

    const scraper = newTestScraper({
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
    const scraper = newTestScraper({
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

    const scraper = newTestScraper({
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

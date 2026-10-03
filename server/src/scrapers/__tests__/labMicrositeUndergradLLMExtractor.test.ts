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
  htmlToRosterText,
  discoverSubPageUrl,
  discoverSubPageUrls,
  candidateSubPageUrls,
  candidateCrawlUrls,
  buildLLMPrompt,
  LAB_UNDERGRAD_RESPONSE_FORMAT,
  LAB_UNDERGRAD_SYSTEM_PROMPT,
  extractionToObservations,
  joinPageRecruitsOnlyNonUndergraduates,
  laneJoinPageRefusal,
  rosterSnippetSitsUnderAHistoricalHeading,
  pageContainingQuote,
  pagesWithinEntityScope,
  evidenceQuoteRecitationObservation,
  evidenceQuoteIsWithdrawnByRead,
  quoteFieldsNotOnPage,
  deriveCurrentUndergradCount,
  isHistoricalUndergradEvidence,
  namesNonYaleInstitution,
  sourceUrlForExtraction,
  candidateLabFromResearchEntityDoc,
  selectLabsToProcess,
  type CandidateLab,
  type LabMicrositeUndergradLLMExtractorDeps,
  type LLMExtraction,
  type FetchedPage,
  type WorkPlanLoaderFn,
  DEFAULT_MODEL,
} from '../sources/labMicrositeUndergradLLMExtractor';
import { computeVersionedContentHash } from '../contentHashGate';
import { UNDERGRAD_EXTRACTION_PROMPT_HASH } from '../prompts';
import type { ObservationInput, ScraperContext } from '../types';
import { isFullDescriptionRestatementOfShortDescription } from '../../utils/researchEntityDescriptionQuality';

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

function makeContext(overrides: Partial<ScraperContext['options']> = {}): {
  ctx: ScraperContext;
  emitted: ObservationInput[];
  logs: string[];
} {
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

describe('LLM extraction contract', () => {
  it('requires conservative source-backed research description fields', () => {
    const required = (LAB_UNDERGRAD_RESPONSE_FORMAT as any).json_schema.schema.required as string[];

    expect(required).toEqual(
      expect.arrayContaining(['researchSummary', 'methodsQuote', 'topicsQuote']),
    );
    expect(LAB_UNDERGRAD_RESPONSE_FORMAT.json_schema.schema.properties).toHaveProperty(
      'researchSummary',
    );
    expect(LAB_UNDERGRAD_RESPONSE_FORMAT.json_schema.schema.properties).toHaveProperty(
      'methodsQuote',
    );
    expect(LAB_UNDERGRAD_RESPONSE_FORMAT.json_schema.schema.properties).toHaveProperty(
      'topicsQuote',
    );
  });

  it('tells the LLM not to use publication blurbs, generic bios, or unsupported description claims', () => {
    const prompt = LAB_UNDERGRAD_SYSTEM_PROMPT.toLowerCase();

    expect(prompt).toContain('publication');
    expect(prompt).toContain('generic faculty bio');
    expect(prompt).toContain('unsupported');
    expect(prompt).toContain('lab/faculty site research text');
  });

  it("recognizes a faculty profile page's own prospective-students/opportunities section as affirmative evidence, not just a lab members/join section (#1326)", () => {
    const prompt = LAB_UNDERGRAD_SYSTEM_PROMPT.toLowerCase();

    expect(prompt).toContain('faculty member');
    expect(prompt).toContain('profile');
    expect(prompt).toContain('prospective students');
    expect(prompt).toContain('opportunities for undergraduates');
    expect(prompt).toContain('how to get involved');
  });

  it('defaults a bare faculty profile with no such section to unclear, not no (#1326)', () => {
    const prompt = LAB_UNDERGRAD_SYSTEM_PROMPT.toLowerCase();

    expect(prompt).toContain('a faculty profile with no such section is "unclear", not "no"');
  });
});

describe('pageContainingQuote', () => {
  const pages = [
    { url: 'https://x.example/', text: 'Welcome to the lab.' },
    {
      url: 'https://x.example/join',
      text: 'Undergraduates   help\nwith field work. Email pi.person@yale.edu to ask.',
    },
  ];

  it('finds the page a quote was copied from across whitespace differences', () => {
    expect(pageContainingQuote('Undergraduates help with field work.', pages)?.url).toBe(
      'https://x.example/join',
    );
  });

  it('matches a quote the model copied from the contact-redacted prompt text', () => {
    expect(pageContainingQuote('Email [email redacted] to ask.', pages)?.url).toBe(
      'https://x.example/join',
    );
  });

  it('forgives typographic quotes and dashes but not a reworded sentence', () => {
    const typographic = [
      { url: 'https://x.example/', text: 'Students\u2019 projects \u2013 paid.' },
    ];
    expect(pageContainingQuote("Students' projects - paid.", typographic)).not.toBeNull();
    expect(pageContainingQuote('Undergraduates assist with field work.', pages)).toBeNull();
  });
});

describe('extractionToObservations quote grounding', () => {
  const fixedDate = new Date('2026-04-27T12:00:00Z');
  const pages = [
    { url: 'https://x.example/', text: 'Welcome to the lab.' },
    { url: 'https://x.example/join', text: 'Undergraduates help with field work.' },
  ];

  it('drops a verdict the model offered no quote for', () => {
    const ext: LLMExtraction = {
      openToUndergrads: 'yes',
      currentUndergradCount: 0,
      evidenceQuote: '',
      evidenceSource: 'explicit_text',
      joinPageUrl: null,
    };
    const obs = extractionToObservations('lab-q', 'https://x.example/', ext, fixedDate, {
      sourcePages: pages,
    });
    expect(obs.map((o) => o.field).sort()).toEqual([
      'currentUndergradCount',
      'joinPageUrl',
      'lastObservedAt',
    ]);
  });

  it('counts only roster snippets that are on a fetched page', () => {
    const ext: LLMExtraction = {
      openToUndergrads: 'yes',
      currentUndergradCount: 2,
      currentUndergradEvidenceQuotes: [
        'Undergraduates help with field work.',
        'Jane Doe, Yale College',
      ],
      evidenceQuote: 'Undergraduates help with field work.',
      evidenceSource: 'members_section',
      joinPageUrl: null,
    };
    const obs = extractionToObservations('lab-r', 'https://x.example/', ext, fixedDate, {
      sourcePages: pages,
    });
    expect(obs.find((o) => o.field === 'currentUndergradCount')?.value).toBe(1);
    expect(quoteFieldsNotOnPage(ext, pages)).toEqual(['currentUndergradEvidenceQuotes[1]']);
  });

  it('zeroes a rosterless count whose backing quote is on no fetched page', () => {
    const ext: LLMExtraction = {
      openToUndergrads: 'yes',
      currentUndergradCount: 3,
      evidenceQuote: 'Undergraduate researchers: Alice, Bob, Carol',
      evidenceSource: 'members_section',
      joinPageUrl: null,
    };
    const obs = extractionToObservations('lab-f', 'https://x.example/', ext, fixedDate, {
      sourcePages: pages,
    });
    expect(obs.find((o) => o.field === 'currentUndergradCount')?.value).toBe(0);
    expect(obs.find((o) => o.field === 'undergradAccessEvidence')).toBeUndefined();
  });

  it('drops a paraphrased quote and the verdict it was offered to back', () => {
    const ext: LLMExtraction = {
      openToUndergrads: 'yes',
      currentUndergradCount: 0,
      evidenceQuote: 'Undergraduates regularly join our field work.',
      evidenceSource: 'explicit_text',
      joinPageUrl: null,
      contactInstructionsQuote: 'Email the PI to apply.',
    };
    const obs = extractionToObservations('lab-p', 'https://x.example/', ext, fixedDate, {
      sourcePages: pages,
    });
    expect(obs.map((o) => o.field).sort()).toEqual([
      'currentUndergradCount',
      'joinPageUrl',
      'lastObservedAt',
    ]);
    expect(quoteFieldsNotOnPage(ext, pages)).toEqual(['evidenceQuote', 'contactInstructionsQuote']);
  });

  it('cites each quote to the page that contains it', () => {
    const ext: LLMExtraction = {
      openToUndergrads: 'yes',
      currentUndergradCount: 0,
      evidenceQuote: 'Undergraduates help with field work.',
      evidenceSource: 'explicit_text',
      joinPageUrl: null,
      contactInstructionsQuote: 'Please email the lab manager to join.',
    };
    const obs = extractionToObservations('lab-c', 'https://x.example/', ext, fixedDate, {
      sourcePages: [
        {
          url: 'https://x.example/',
          text: 'Welcome to the lab. Please email the lab manager to join.',
        },
        pages[1],
      ],
      quoteSourceUrl: 'https://x.example/',
    });
    expect(obs.find((o) => o.field === 'undergradEvidenceQuote')?.sourceUrl).toBe(
      'https://x.example/join',
    );
    expect(obs.find((o) => o.field === 'contactInstructionsQuote')?.sourceUrl).toBe(
      'https://x.example/',
    );
    expect(
      (obs.find((o) => o.field === 'undergradAccessEvidence')?.value as any).quoteSourceUrl,
    ).toBe('https://x.example/join');
  });
});

describe('extractionToObservations contact quote admission (#3928)', () => {
  const fixedDate = new Date('2026-04-27T12:00:00Z');
  const contactObservation = (contactInstructionsQuote: string) =>
    extractionToObservations(
      'lab-contact',
      'https://x.example/',
      {
        openToUndergrads: 'unclear',
        currentUndergradCount: 0,
        evidenceQuote: '',
        evidenceSource: 'none',
        joinPageUrl: null,
        contactInstructionsQuote,
      },
      fixedDate,
      {
        sourcePages: [{ url: 'https://x.example/', text: `Welcome. ${contactInstructionsQuote}` }],
      },
    ).find((o) => o.field === 'contactInstructionsQuote');

  it('drops a quote that is only an address or a contact heading', () => {
    expect(contactObservation('fixture.person@example.edu')).toBeUndefined();
    expect(contactObservation('Contact fixture.person@example.edu')).toBeUndefined();
    expect(contactObservation('Get In Touch')).toBeUndefined();
  });

  it('keeps a quote that tells a student how to reach out', () => {
    expect(
      contactObservation('Interested students should email fixture.person@example.edu with a CV.')
        ?.value,
    ).toBe('Interested students should email [email redacted] with a CV.');
  });
});

describe('namesNonYaleInstitution visiting scope (#3775)', () => {
  it('reads visiting as a visitor only when it modifies a student or researcher', () => {
    expect(
      namesNonYaleInstitution(
        'We welcome undergraduates, post-bacs, graduate students, postdoctoral fellows and visiting faculty.',
      ),
    ).toBe(false);
    expect(namesNonYaleInstitution('She is a visiting senior undergraduate this summer.')).toBe(
      true,
    );
    expect(namesNonYaleInstitution('A visiting student joined the group.')).toBe(true);
    expect(namesNonYaleInstitution('Alex Example, Visiting Summer Research Student')).toBe(true);
    expect(namesNonYaleInstitution('Alex Example, undergraduate visiting from Wesleyan')).toBe(
      true,
    );
    expect(
      namesNonYaleInstitution('Alex Example, undergraduate (visiting, Swarthmore College)'),
    ).toBe(true);
  });
});

describe('evidenceQuoteRecitationObservation (#3831)', () => {
  const live = {
    value: 'The internship program hosts college undergraduates each summer.',
    sourceUrl: 'https://lab.example.edu/profile',
  };

  it('re-cites a kept quote to the fetched page that carries it', () => {
    const recited = evidenceQuoteRecitationObservation('lab-a', live, [
      { url: 'https://lab.example.edu/', text: 'The lab home page.' },
      { url: 'https://lab.example.edu/program', text: `Intro. ${live.value} More.` },
      { url: 'https://lab.example.edu/profile', text: 'A profile with no such sentence.' },
    ]);
    expect(recited).toMatchObject({
      entityKey: 'lab-a',
      field: 'undergradEvidenceQuote',
      value: live.value,
      sourceUrl: 'https://lab.example.edu/program',
    });
  });

  it('restates nothing when the cited page already carries the quote, or no page does', () => {
    expect(
      evidenceQuoteRecitationObservation('lab-a', live, [
        { url: 'https://lab.example.edu/profile', text: live.value },
      ]),
    ).toBeNull();
    expect(
      evidenceQuoteRecitationObservation('lab-a', live, [
        { url: 'https://lab.example.edu/', text: `Shared block. ${live.value}` },
        { url: 'https://lab.example.edu/profile', text: `Shared block. ${live.value}` },
      ]),
    ).toBeNull();
    expect(
      evidenceQuoteRecitationObservation('lab-a', live, [
        { url: 'https://lab.example.edu/profile', text: 'Nothing here.' },
      ]),
    ).toBeNull();
  });
});

describe('pagesWithinEntityScope (#3764)', () => {
  const page = (url: string) => ({ url, text: 'text' });

  it('drops a crawled page from a sibling section of a shared host', () => {
    const scoped = pagesWithinEntityScope([
      page('https://shared.example.edu/center-a'),
      page('https://shared.example.edu/center-a/people'),
      page('https://shared.example.edu/network-b/members'),
      page('https://elsewhere.example.org/center-a/people'),
    ]);
    expect(scoped.map((entry) => entry.url)).toEqual([
      'https://shared.example.edu/center-a',
      'https://shared.example.edu/center-a/people',
    ]);
  });

  it('keeps every page when the home page is the site root or a landing file', () => {
    expect(
      pagesWithinEntityScope([
        page('https://lab.example.edu/'),
        page('https://lab.example.edu/join'),
      ]),
    ).toHaveLength(2);
    expect(
      pagesWithinEntityScope([
        page('https://lab.example.edu/home'),
        page('https://lab.example.edu/people'),
      ]),
    ).toHaveLength(2);
  });
});

describe('evidenceQuoteIsWithdrawnByRead scope (#3764)', () => {
  const QUOTE = 'Undergraduate researchers join the network every summer.';
  const filler = 'The program studies regional history and culture. '.repeat(6);
  const home = { url: 'https://shared.example.edu/center-a', text: filler };

  it('withdraws a stored quote cited to a sibling section of a shared host', () => {
    const siblingUrl = 'https://shared.example.edu/network-b/members';
    expect(
      evidenceQuoteIsWithdrawnByRead({ value: QUOTE, sourceUrl: siblingUrl }, [
        home,
        { url: siblingUrl, text: `${filler} ${QUOTE}` },
      ]),
    ).toBe(true);
  });

  it('keeps a stored quote that still reads on a page within the entity', () => {
    const peopleUrl = 'https://shared.example.edu/center-a/people';
    expect(
      evidenceQuoteIsWithdrawnByRead({ value: QUOTE, sourceUrl: peopleUrl }, [
        home,
        { url: peopleUrl, text: `${filler} ${QUOTE}` },
      ]),
    ).toBe(false);
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

  it('emits an evidence-shaped access observation and no bare boolean on yes', () => {
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
      sourcePages: [
        { url: 'https://x.example/', text: 'Welcome to the lab.' },
        {
          url: 'https://x.example/join',
          text: 'Joining. We welcome motivated undergraduates each semester.',
        },
      ],
    });
    expect(obs.find((o) => o.field === 'acceptingUndergrads')).toBeUndefined();
    const evidence = obs.find((o) => o.field === 'undergradAccessEvidence');
    expect(evidence!.confidenceOverride).toBe(0.5);
    expect(evidence!.value).toMatchObject({
      openToUndergrads: 'yes',
      evidenceSource: 'explicit_text',
      sourceUrls: ['https://x.example/', 'https://x.example/join'],
      quoteSourceUrl: 'https://x.example/join',
    });
    expect(obs.find((o) => o.field === 'currentUndergradCount')?.value).toBe(0);
    // quote was emitted
    const quote = obs.find((o) => o.field === 'undergradEvidenceQuote');
    expect(quote!.value).toBe('We welcome motivated undergraduates each semester.');
    expect(quote!.sourceUrl).toBe('https://x.example/join');
    // lastObservedAt always emitted
    expect(obs.find((o) => o.field === 'lastObservedAt')!.value).toEqual(fixedDate);
  });

  it('emits conservative description observations from source-supported researchSummary', () => {
    const ext: LLMExtraction = {
      openToUndergrads: 'unclear',
      currentUndergradCount: 0,
      evidenceQuote: '',
      evidenceSource: 'none',
      joinPageUrl: null,
      researchSummary:
        'The lab studies urban climate adaptation using satellite imagery and field sensors.',
      methodsQuote: 'We combine satellite imagery with field sensors',
      topicsQuote: 'urban climate adaptation',
    };
    const obs = extractionToObservations('lab-desc', 'https://x.example/', ext, fixedDate, {
      sourceTexts: [
        'Research: We combine satellite imagery with field sensors to study urban climate adaptation.',
      ],
    });

    const shortDescription = obs.find((o) => o.field === 'shortDescription');
    const fullDescription = obs.find((o) => o.field === 'fullDescription');
    expect(fullDescription?.value).toBe(
      'The lab studies urban climate adaptation using satellite imagery and field sensors.',
    );
    expect(fullDescription?.confidenceOverride).toBe(0.55);
    // A summary that is already one card-length sentence has no distinct shorter
    // form, so no card observation is emitted and the derivation path owns it.
    expect(shortDescription).toBeUndefined();
  });

  it('never emits a shortDescription equal to the fullDescription it accompanies', () => {
    const summaries = [
      'The lab studies urban climate adaptation using satellite imagery and field sensors.',
      'Research in the group focuses on protein folding kinetics, single-molecule spectroscopy, and computational structure prediction.',
      'We investigate coastal sediment transport, estuary hydrodynamics, and marsh accretion under sea-level rise.',
    ];

    for (const summary of summaries) {
      const ext: LLMExtraction = {
        openToUndergrads: 'unclear',
        currentUndergradCount: 0,
        evidenceQuote: '',
        evidenceSource: 'none',
        joinPageUrl: null,
        researchSummary: summary,
        methodsQuote: summary.slice(0, 40),
        topicsQuote: summary.slice(10, 45),
      };
      const obs = extractionToObservations('lab-pair', 'https://x.example/', ext, fixedDate, {
        sourceTexts: [summary],
      });
      const short = obs.find((o) => o.field === 'shortDescription');
      const full = obs.find((o) => o.field === 'fullDescription');
      if (!short || !full) continue;
      expect(short.value).not.toBe(full.value);
      expect(isFullDescriptionRestatementOfShortDescription(full.value, short.value)).toBe(false);
    }
  });

  it('emits a genuinely shorter card when the full prose compresses to a distinct line', () => {
    const summary =
      'Primary research interests include computational genomics and statistical modeling of gene regulation. The group builds open analysis pipelines, trains graduate students in reproducible workflows, and collaborates with clinical partners across the medical campus on translational projects.';
    const ext: LLMExtraction = {
      openToUndergrads: 'unclear',
      currentUndergradCount: 0,
      evidenceQuote: '',
      evidenceSource: 'none',
      joinPageUrl: null,
      researchSummary: summary,
      methodsQuote: 'statistical modeling of gene regulation',
      topicsQuote: 'computational genomics',
    };
    const obs = extractionToObservations('lab-card', 'https://x.example/', ext, fixedDate, {
      sourceTexts: [summary],
    });

    const full = obs.find((o) => o.field === 'fullDescription');
    const short = obs.find((o) => o.field === 'shortDescription');
    expect(full?.value).toBeTruthy();
    expect(short?.value).toBeTruthy();
    expect(short?.value).not.toBe(full?.value);
    expect(String(short?.value).length).toBeLessThan(String(full?.value).length);
    expect(short?.confidenceOverride).toBe(0.55);
  });

  describe('a crawled page is a crawl seed until it is shown to be about this entity (#2570)', () => {
    const climateExtraction: LLMExtraction = {
      openToUndergrads: 'unclear',
      currentUndergradCount: 0,
      evidenceQuote: '',
      evidenceSource: 'none',
      joinPageUrl: null,
      researchSummary:
        'The lab studies urban climate adaptation using satellite imagery and field sensors.',
      methodsQuote: 'We combine satellite imagery with field sensors',
      topicsQuote: 'urban climate adaptation',
    };
    const sourceTexts = [
      'Research: We combine satellite imagery with field sensors to study urban climate adaptation.',
    ];
    const paltielIdentity = {
      slug: 'dept-mgmt-rowan-ashgrove',
      name: 'Rowan Ashgrove - Research',
    };

    const descriptionFieldsFrom = (quoteSourceUrl: string, entityIdentity?: object) =>
      extractionToObservations(paltielIdentity.slug, quoteSourceUrl, climateExtraction, fixedDate, {
        sourceTexts,
        quoteSourceUrl,
        entityIdentity,
      })
        .filter((o) => o.field === 'fullDescription' || o.field === 'shortDescription')
        .map((o) => o.field);

    it('refuses a paginated faculty index as a description source', () => {
      expect(
        descriptionFieldsFrom(
          'https://som.yale.edu/faculty-research/faculty-directory?page=1',
          paltielIdentity,
        ),
      ).toEqual([]);
    });

    it('refuses a person page belonging to somebody else', () => {
      expect(
        descriptionFieldsFrom(
          'https://medicine.yale.edu/profile/juniper-fallowfield/',
          paltielIdentity,
        ),
      ).toEqual([]);
    });

    it('still cites the entity own person page', () => {
      expect(
        descriptionFieldsFrom('https://medicine.yale.edu/profile/rowan-ashgrove/', paltielIdentity),
      ).toEqual(['fullDescription']);
    });
  });

  it('does not emit description observations when researchSummary is empty', () => {
    const ext: LLMExtraction = {
      openToUndergrads: 'unclear',
      currentUndergradCount: 0,
      evidenceQuote: '',
      evidenceSource: 'none',
      joinPageUrl: null,
      researchSummary: '',
      methodsQuote: 'We use interviews and archival sources.',
      topicsQuote: 'labor history',
    };
    const obs = extractionToObservations('lab-empty-desc', 'https://x.example/', ext, fixedDate, {
      sourceTexts: ['We use interviews and archival sources to study labor history.'],
    });

    expect(obs.find((o) => o.field === 'shortDescription')).toBeUndefined();
    expect(obs.find((o) => o.field === 'fullDescription')).toBeUndefined();
  });

  it('does not invent description observations from unsupported publication or generic bio text', () => {
    const ext: LLMExtraction = {
      openToUndergrads: 'unclear',
      currentUndergradCount: 0,
      evidenceQuote: '',
      evidenceSource: 'none',
      joinPageUrl: null,
      researchSummary:
        'The lab studies neural circuits with optogenetics and computational modeling.',
      methodsQuote: 'Nature Neuroscience 2024',
      topicsQuote: 'Professor Smith is an award-winning researcher',
    };
    const obs = extractionToObservations(
      'lab-unsupported-desc',
      'https://x.example/',
      ext,
      fixedDate,
      {
        sourceTexts: [
          'Selected publications: Nature Neuroscience 2024. Professor Smith is an award-winning researcher.',
        ],
      },
    );

    expect(obs.find((o) => o.field === 'shortDescription')).toBeUndefined();
    expect(obs.find((o) => o.field === 'fullDescription')).toBeUndefined();
  });

  it('fails closed on an academic-appointment/PI-bio researchSummary even when source-supported', () => {
    const ext: LLMExtraction = {
      openToUndergrads: 'unclear',
      currentUndergradCount: 0,
      evidenceQuote: '',
      evidenceSource: 'none',
      joinPageUrl: null,
      researchSummary:
        'Jane Smith is an Associate Professor of Neuroscience and Principal Investigator at Yale.',
      methodsQuote: 'Associate Professor of Neuroscience',
      topicsQuote: 'Principal Investigator at Yale',
    };
    const obs = extractionToObservations('lab-appointment', 'https://x.example/', ext, fixedDate, {
      sourceTexts: [
        'Jane Smith is an Associate Professor of Neuroscience and Principal Investigator at Yale.',
      ],
    });

    expect(obs.find((o) => o.field === 'fullDescription')).toBeUndefined();
    expect(obs.find((o) => o.field === 'shortDescription')).toBeUndefined();
  });

  it('fails closed on a role-only title fragment researchSummary even when source-supported', () => {
    const ext: LLMExtraction = {
      openToUndergrads: 'unclear',
      currentUndergradCount: 0,
      evidenceQuote: '',
      evidenceSource: 'none',
      joinPageUrl: null,
      researchSummary: 'Director of the Yale Program in Cognitive Neuroscience.',
      methodsQuote: 'Yale Program in Cognitive Neuroscience',
      topicsQuote: 'Director of the Yale Program',
    };
    const obs = extractionToObservations('lab-role-only', 'https://x.example/', ext, fixedDate, {
      sourceTexts: ['Director of the Yale Program in Cognitive Neuroscience.'],
    });

    expect(obs.find((o) => o.field === 'fullDescription')).toBeUndefined();
    expect(obs.find((o) => o.field === 'shortDescription')).toBeUndefined();
  });

  it('does not emit description observations sourced from a department-wide undergrad hub page', () => {
    const ext: LLMExtraction = {
      openToUndergrads: 'unclear',
      currentUndergradCount: 0,
      evidenceQuote: '',
      evidenceSource: 'none',
      joinPageUrl: null,
      researchSummary:
        'The lab conducts research in molecular biology, biochemistry, genetics, cell biology, neurobiology, physiology, and computational plant sciences.',
      methodsQuote: 'molecular biology, biochemistry, genetics',
      topicsQuote: 'cell biology, neurobiology, physiology',
    };
    const obs = extractionToObservations(
      'dept-mcdb-mark-mooseker',
      'https://mcdb.yale.edu/profile/mark-mooseker-phd',
      ext,
      fixedDate,
      {
        sourceTexts: [
          'The lab conducts research in molecular biology, biochemistry, genetics, cell biology, neurobiology, physiology, and computational plant sciences.',
        ],
        quoteSourceUrl: 'https://mcdb.yale.edu/undergraduate/undergraduate-research-opportunities',
      },
    );

    expect(obs.find((o) => o.field === 'fullDescription')).toBeUndefined();
    expect(obs.find((o) => o.field === 'shortDescription')).toBeUndefined();
  });

  it('emits a grounded fullDescription but drops an over-long shortDescription', () => {
    const summary =
      'The lab studies urban climate adaptation using satellite imagery and field sensors, and examines how heat exposure, flooding, and air quality affect neighborhoods across the region while developing computational models and open datasets that inform local resilience planning for vulnerable communities.';
    const ext: LLMExtraction = {
      openToUndergrads: 'unclear',
      currentUndergradCount: 0,
      evidenceQuote: '',
      evidenceSource: 'none',
      joinPageUrl: null,
      researchSummary: summary,
      methodsQuote: 'satellite imagery and field sensors',
      topicsQuote: 'urban climate adaptation',
    };
    const obs = extractionToObservations('lab-long-desc', 'https://x.example/', ext, fixedDate, {
      sourceTexts: [summary],
    });

    expect(obs.find((o) => o.field === 'fullDescription')?.value).toBe(summary);
    expect(obs.find((o) => o.field === 'shortDescription')).toBeUndefined();
  });

  it('emits a negative access evidence observation and no bare boolean on no', () => {
    const ext: LLMExtraction = {
      openToUndergrads: 'no',
      currentUndergradCount: 0,
      evidenceQuote: 'We do not accept undergraduate students.',
      evidenceSource: 'explicit_text',
      joinPageUrl: null,
    };
    const obs = extractionToObservations('lab-bar', 'https://x.example/', ext, fixedDate, {
      sourcePages: [
        { url: 'https://x.example/', text: 'We do not accept undergraduate students.' },
      ],
    });
    expect(obs.find((o) => o.field === 'acceptingUndergrads')).toBeUndefined();
    const evidence = obs.find((o) => o.field === 'undergradAccessEvidence');
    expect(evidence!.confidenceOverride).toBe(0.5);
    expect(evidence!.value).toMatchObject({ openToUndergrads: 'no' });
  });

  it('skips the access evidence observation entirely on unclear', () => {
    const ext: LLMExtraction = {
      openToUndergrads: 'unclear',
      currentUndergradCount: 0,
      evidenceQuote: '',
      evidenceSource: 'none',
      joinPageUrl: null,
    };
    const obs = extractionToObservations('lab-baz', 'https://x.example/', ext, fixedDate);
    expect(obs.find((o) => o.field === 'undergradAccessEvidence')).toBeUndefined();
    expect(obs.find((o) => o.field === 'undergradEvidenceQuote')).toBeUndefined();
    // Only lastObservedAt
    expect(obs.map((o) => o.field).sort()).toEqual([
      'currentUndergradCount',
      'joinPageUrl',
      'lastObservedAt',
    ]);
    expect(obs.find((o) => o.field === 'currentUndergradCount')?.value).toBe(0);
  });

  it('emits currentUndergradCount on every read, zero without a grounded roster (#3789)', () => {
    const roster = [
      'Alice, undergraduate researcher',
      'Bob, undergraduate researcher',
      'Carol, undergraduate researcher',
      'Dan, undergraduate researcher',
    ];
    const fromMembers: LLMExtraction = {
      openToUndergrads: 'yes',
      currentUndergradCount: 4,
      evidenceQuote: 'Undergraduates: Alice, Bob, Carol, Dan',
      evidenceSource: 'members_section',
      joinPageUrl: null,
      currentUndergradEvidenceQuotes: roster,
    };
    const obs1 = extractionToObservations('lab-1', 'https://x/', fromMembers, fixedDate, {
      sourcePages: [{ url: 'https://x/', text: [fromMembers.evidenceQuote, ...roster].join('\n') }],
    });
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
    expect(obs2.find((o) => o.field === 'currentUndergradCount')?.value).toBe(0);
  });

  const countObservationValue = (ext: LLMExtraction): number | undefined => {
    const pageText = [ext.evidenceQuote, ...(ext.currentUndergradEvidenceQuotes ?? [])].join('\n');
    const obs = extractionToObservations('lab-count', 'https://x/', ext, fixedDate, {
      sourcePages: [{ url: 'https://x/', text: pageText }],
    });
    return obs.find((o) => o.field === 'currentUndergradCount')?.value as number | undefined;
  };

  it('derives currentUndergradCount from the current-Yale subset of the roster (#1314)', () => {
    const ext: LLMExtraction = {
      openToUndergrads: 'yes',
      currentUndergradCount: 5,
      currentUndergradEvidenceQuotes: [
        'Jane Doe, Yale College, Molecular Biophysics',
        'John Smith, undergraduate researcher',
        'Amber Anders 2009 Undergraduate student, now Senior Director Commercial BizOps, Illumina',
        'Dustin Morado, Georgia Tech, Visiting Undergraduate, 2010, 2011',
        'Anisha Jain - Undergraduate, University of Connecticut',
      ],
      evidenceQuote: 'Undergraduates in the lab',
      evidenceSource: 'members_section',
      joinPageUrl: null,
    };
    expect(deriveCurrentUndergradCount(ext)).toBe(2);
    expect(countObservationValue(ext)).toBe(2);
  });

  it('excludes an all-alumni roster and writes a corrected zero count (#1314)', () => {
    const ext: LLMExtraction = {
      openToUndergrads: 'yes',
      currentUndergradCount: 3,
      currentUndergradEvidenceQuotes: [
        'Matthew Barber (Physics, Yale College, 2009); Associate at Flexpoint Ford',
        'Former undergraduate researcher, graduated 2015',
        'Past undergrad, now a medical student',
      ],
      evidenceQuote: 'Alumni and former lab members',
      evidenceSource: 'members_section',
      joinPageUrl: null,
    };
    expect(deriveCurrentUndergradCount(ext)).toBe(0);
    expect(countObservationValue(ext)).toBe(0);
  });

  it('counts current Yale undergrads listed with an active class year (#1314)', () => {
    const ext: LLMExtraction = {
      openToUndergrads: 'yes',
      currentUndergradCount: 2,
      currentUndergradEvidenceQuotes: [
        'Priya Nair, Yale College Class of 2027',
        'Marcus Lee, B.S. candidate, Yale',
      ],
      evidenceQuote: 'Current undergraduate members',
      evidenceSource: 'members_section',
      joinPageUrl: null,
    };
    expect(deriveCurrentUndergradCount(ext)).toBe(2);
    expect(countObservationValue(ext)).toBe(2);
  });

  it('treats an empty roster as zero even when the raw count is positive (#1314)', () => {
    const ext: LLMExtraction = {
      openToUndergrads: 'yes',
      currentUndergradCount: 7,
      currentUndergradEvidenceQuotes: [],
      evidenceQuote: 'Undergraduates: see roster',
      evidenceSource: 'members_section',
      joinPageUrl: null,
    };
    expect(deriveCurrentUndergradCount(ext)).toBe(0);
    expect(countObservationValue(ext)).toBe(0);
  });

  it('never trusts the raw count without a roster, even beside a clean quote (#3789)', () => {
    const ext: LLMExtraction = {
      openToUndergrads: 'yes',
      currentUndergradCount: 4,
      evidenceQuote: 'Undergraduate researchers: Alice, Bob, Carol, Dan',
      evidenceSource: 'members_section',
      joinPageUrl: null,
    };
    expect(deriveCurrentUndergradCount(ext)).toBe(0);
    expect(countObservationValue(ext)).toBe(0);
  });

  it('does not count a staff title or a member own degree as a current undergraduate (#3789)', () => {
    const ext: LLMExtraction = {
      openToUndergrads: 'yes',
      currentUndergradCount: 3,
      evidenceQuote: 'Lab members',
      evidenceSource: 'members_section',
      joinPageUrl: null,
      currentUndergradEvidenceQuotes: [
        'Sam Example, Senior Software Developer',
        'Taylor Example completed her undergraduate degree at another university',
        'Riley Example, Yale College Class of 2028',
      ],
    };
    expect(deriveCurrentUndergradCount(ext)).toBe(1);
  });

  it('zeroes a legacy count whose only backing quote is historical or non-Yale (#1314)', () => {
    const historical: LLMExtraction = {
      openToUndergrads: 'yes',
      currentUndergradCount: 40,
      evidenceQuote: 'Matthew Barber (Physics, Yale College, 2009); Associate at Flexpoint Ford',
      evidenceSource: 'members_section',
      joinPageUrl: null,
    };
    expect(deriveCurrentUndergradCount(historical)).toBe(0);
    expect(countObservationValue(historical)).toBe(0);

    const visiting: LLMExtraction = {
      openToUndergrads: 'yes',
      currentUndergradCount: 5,
      evidenceQuote: 'Dustin Morado, Georgia Tech, Visiting Undergraduate',
      evidenceSource: 'members_section',
      joinPageUrl: null,
    };
    expect(deriveCurrentUndergradCount(visiting)).toBe(0);
    expect(countObservationValue(visiting)).toBe(0);
  });

  it('does not emit undergradEvidenceQuote from a historical or non-Yale evidenceQuote (#1372)', () => {
    const historical: LLMExtraction = {
      openToUndergrads: 'yes',
      currentUndergradCount: 40,
      evidenceQuote: 'Matthew Barber (Physics, Yale College, 2009); Associate at Flexpoint Ford',
      evidenceSource: 'members_section',
      joinPageUrl: null,
    };
    const historicalObs = extractionToObservations(
      'lab-historical',
      'https://x/',
      historical,
      fixedDate,
    );
    expect(historicalObs.find((o) => o.field === 'undergradEvidenceQuote')).toBeUndefined();

    const visiting: LLMExtraction = {
      openToUndergrads: 'yes',
      currentUndergradCount: 5,
      evidenceQuote: 'Young Lin, undergraduate, Emory University',
      evidenceSource: 'members_section',
      joinPageUrl: null,
    };
    const visitingObs = extractionToObservations('lab-visiting', 'https://x/', visiting, fixedDate);
    expect(visitingObs.find((o) => o.field === 'undergradEvidenceQuote')).toBeUndefined();
  });

  it('recency and institution gates classify roster snippets correctly (#1314)', () => {
    expect(isHistoricalUndergradEvidence('Former undergraduate, alumni network')).toBe(true);
    expect(isHistoricalUndergradEvidence('Jane Doe (2008-2010)')).toBe(true);
    expect(isHistoricalUndergradEvidence('now a medical student')).toBe(true);
    expect(isHistoricalUndergradEvidence('Yale College Class of 2027')).toBe(false);

    expect(namesNonYaleInstitution('Visiting Undergraduate from UCLA')).toBe(true);
    expect(namesNonYaleInstitution('University of Connecticut')).toBe(true);
    expect(namesNonYaleInstitution('Georgia Tech')).toBe(true);
    expect(namesNonYaleInstitution('Yale College, Berkeley residential college')).toBe(false);
    expect(namesNonYaleInstitution('Undergraduate researcher')).toBe(false);
  });

  it('truncates very long evidence quotes to 500 characters', () => {
    const ext: LLMExtraction = {
      openToUndergrads: 'yes',
      currentUndergradCount: 0,
      evidenceQuote: `Undergraduates ${'q'.repeat(2000)}`,
      evidenceSource: 'explicit_text',
      joinPageUrl: null,
    };
    const obs = extractionToObservations('lab-3', 'https://x/', ext, fixedDate, {
      sourcePages: [{ url: 'https://x/', text: ext.evidenceQuote }],
    });
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
    const obs = extractionToObservations('lab-4', 'https://x/', ext, fixedDate, {
      sourcePages: [
        {
          url: 'https://x/',
          text: 'We welcome students. Undergraduates help collect data. Apply using the form on this page. Prior Python experience preferred.',
        },
        { url: 'https://x.example/join', text: 'Join the lab. Undergraduates are welcome.' },
      ],
    });
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
      contactInstructionsQuote: 'Call 203-432-1234 or email manager@yale.edu to arrange a visit.',
      explicitConstraintQuote: '',
    };
    const obs = extractionToObservations('lab-5', 'https://x/', ext, fixedDate, {
      sourcePages: [
        {
          url: 'https://x/',
          text: 'Email pi.person@yale.edu to discuss undergraduate research. Call 203-432-1234 or email manager@yale.edu to arrange a visit.',
        },
      ],
    });

    expect(obs.find((o) => o.field === 'undergradEvidenceQuote')!.value).toBe(
      'Email [email redacted] to discuss undergraduate research.',
    );
    expect(obs.find((o) => o.field === 'contactInstructionsQuote')!.value).toBe(
      'Call [phone redacted] or email [email redacted] to arrange a visit.',
    );
    expect(
      (obs.find((o) => o.field === 'undergradAccessEvidence')!.value as any).evidenceQuote,
    ).toBe('Email pi.person@yale.edu to discuss undergraduate research.');
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
      manuallyLockedFields: ['undergradAccessEvidence'],
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

  it('drops labs without a websiteUrl or when archived', () => {
    const out = selectLabsToProcess(labs, {});
    expect(out.map((l) => l.slug)).toEqual(['lab-a', 'lab-b', 'lab-e']);
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

  it('does not apply the default cap in exhaustive mode', () => {
    const candidates = Array.from({ length: 101 }, (_, index) => ({
      _id: String(index),
      slug: `lab-${index}`,
      name: `Lab ${index}`,
      websiteUrl: `https://lab-${index}.example/`,
    }));
    expect(selectLabsToProcess(candidates, { exhaustive: true })).toHaveLength(101);
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

  it('skips grant and identifier source URLs when selecting undergrad crawl targets', () => {
    expect(
      candidateLabFromResearchEntityDoc({
        _id: 'entity-grant',
        slug: 'nih-pi-grant-only',
        name: 'Grant Only Lab',
        sourceUrls: [
          'https://reporter.nih.gov/project-details/11252534',
          'https://orcid.org/0000-0001-2345-6789',
          'https://api.nsf.gov/services/v1/awards/2310836.json',
          'https://doi.org/10.1000/example',
          'https://openalex.org/A123',
          'https://api.crossref.org/works/10.1000/example',
        ],
      }),
    ).toMatchObject({
      slug: 'nih-pi-grant-only',
      websiteUrl: '',
    });
  });

  it('selects a real lab URL that appears after rejected grant sources', () => {
    expect(
      candidateLabFromResearchEntityDoc({
        _id: 'entity-lab',
        slug: 'nih-pi-with-lab-page',
        name: 'Lab Page Entity',
        websiteUrl: 'https://reporter.nih.gov/project-details/11252534',
        sourceUrls: [
          'https://orcid.org/0000-0001-2345-6789',
          'https://medicine.yale.edu/lab/example/',
        ],
      }),
    ).toMatchObject({
      slug: 'nih-pi-with-lab-page',
      websiteUrl: 'https://medicine.yale.edu/lab/example/',
    });
  });

  it('canonicalizes the legacy Yan lab host to the current YaleSites host', () => {
    expect(
      candidateLabFromResearchEntityDoc({
        _id: 'entity-3',
        slug: 'nih-pi-elsa-yan',
        name: 'Yan Lab',
        websiteUrl: 'https://ursula.chem.yale.edu/~yanlab/',
        sourceUrls: ['https://yan.chem.yale.edu/opportunities'],
      }),
    ).toMatchObject({
      slug: 'nih-pi-elsa-yan',
      websiteUrl: 'https://yan.chem.yale.edu/',
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
  it('rejects unsafe runtime limits before loading candidate labs', async () => {
    const fetchPage = vi.fn();
    const callLLM = vi.fn();
    const labFinder = vi.fn(
      async (): Promise<CandidateLab[]> => [
        {
          _id: '1',
          slug: 'smith-lab',
          name: 'Smith Lab',
          websiteUrl: 'https://smith.example.edu/',
        },
      ],
    );
    const scraper = newTestScraper({
      fetchPage,
      callLLM,
      labFinder,
      apiKey: 'sk-test',
    });
    const { ctx } = makeContext({ limit: 9007199254740992 });

    await expect(scraper.run(ctx)).rejects.toThrow(/--limit must be a safe positive integer/);

    expect(labFinder).not.toHaveBeenCalled();
    expect(fetchPage).not.toHaveBeenCalled();
    expect(callLLM).not.toHaveBeenCalled();
  });

  it('reads a join page the model named but the crawl skipped, and refuses one that does not resolve', async () => {
    const openings = `<html><body><h1>Openings</h1><p>If you are an undergraduate at Yale, please write to the PI with your CV.</p></body></html>`;
    const runWithJoinPage = async (joinPageUrl: string) => {
      const fetchPage = makeFetchPage({
        'https://smith.example.com/': HOME_HTML,
        'https://smith.example.com/people': PEOPLE_HTML,
        'https://smith.example.com/openings': openings,
      });
      const scraper = newTestScraper({
        fetchPage,
        callLLM: vi.fn(
          async (): Promise<LLMExtraction> => ({
            openToUndergrads: 'yes',
            currentUndergradCount: 0,
            evidenceQuote: 'We welcome undergraduate researchers each semester.',
            evidenceSource: 'explicit_text',
            joinPageUrl,
          }),
        ),
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
      return { fetchPage, join: emitted.find((o) => o.field === 'joinPageUrl')?.value };
    };

    const read = await runWithJoinPage('https://smith.example.com/openings');
    expect(read.fetchPage).toHaveBeenCalledWith('https://smith.example.com/openings');
    expect(read.join).toBe('https://smith.example.com/openings');

    const missing = await runWithJoinPage('https://smith.example.com/open-positions');
    expect(missing.fetchPage).toHaveBeenCalledWith('https://smith.example.com/open-positions');
    expect(missing.join).toBe('');
  });

  it('fetches the home page, follows a discovered sub-page, and emits the right observations', async () => {
    const fetchPage = makeFetchPage({
      'https://smith.example.com/': HOME_HTML,
      'https://smith.example.com/people': PEOPLE_HTML,
    });
    const callLLM = vi.fn(
      async (_input: {
        model: string;
        systemPrompt: string;
        userPrompt: string;
        apiKey: string;
        responseFormat: Record<string, unknown>;
      }): Promise<LLMExtraction> => ({
        openToUndergrads: 'yes',
        currentUndergradCount: 3,
        evidenceQuote: 'We welcome undergraduate researchers each semester.',
        evidenceSource: 'members_section',
        joinPageUrl: null,
        currentUndergradEvidenceQuotes: ['Alice', 'Bob', 'Carol'],
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
    expect(llmInput.systemPrompt).toBe(LAB_UNDERGRAD_SYSTEM_PROMPT);
    expect(llmInput.systemPrompt).toContain('undergradRoleQuote');
    expect(llmInput.responseFormat).toBe(LAB_UNDERGRAD_RESPONSE_FORMAT);

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
        'currentUndergradCount',
        'joinPageUrl',
        'lastObservedAt',
        'sourceContentHash',
        'undergradAccessEvidence',
        'undergradEvidenceQuote',
      ].sort(),
    );
    const evidence = emitted.find((o) => o.field === 'undergradAccessEvidence');
    expect(evidence!.confidenceOverride).toBe(0.5);
    expect(evidence!.entityKey).toBe('smith-lab');
    expect(emitted.find((o) => o.field === 'currentUndergradCount')!.value).toBe(3);
  });

  describe('re-deriving a stored current-undergraduate count (#3789)', () => {
    const smithLab = async (): Promise<CandidateLab[]> => [
      {
        _id: '1',
        slug: 'smith-lab',
        name: 'The Smith Lab',
        websiteUrl: 'https://smith.example.com/',
      },
    ];
    const noRosterAnswer: LLMExtraction = {
      openToUndergrads: 'yes',
      currentUndergradCount: 3,
      evidenceQuote: 'We welcome undergraduate researchers each semester.',
      evidenceSource: 'explicit_text',
      joinPageUrl: null,
    };
    const runWith = async (pages: Record<string, string>) => {
      const scraper = newTestScraper({
        fetchPage: makeFetchPage(pages),
        callLLM: async () => noRosterAnswer,
        labFinder: smithLab,
        apiKey: 'sk-test',
      });
      const { ctx, emitted } = makeContext();
      await scraper.run(ctx);
      return emitted;
    };

    it('writes a zero when every linked page was read and no roster line survives', async () => {
      const emitted = await runWith({
        'https://smith.example.com/': HOME_HTML,
        'https://smith.example.com/people': PEOPLE_HTML,
      });
      expect(emitted.find((o) => o.field === 'currentUndergradCount')?.value).toBe(0);
    });

    it('withholds a zero when a sub-page the home page links to failed to fetch', async () => {
      const emitted = await runWith({ 'https://smith.example.com/': HOME_HTML });
      expect(emitted.some((o) => o.field === 'currentUndergradCount')).toBe(false);
    });

    it('stores a content hash that a hash from before the roster-only count does not match', async () => {
      const emitted = await runWith({
        'https://smith.example.com/': HOME_HTML,
        'https://smith.example.com/people': PEOPLE_HTML,
      });
      const priorContractHash = computeVersionedContentHash(
        [htmlToPromptText(HOME_HTML), htmlToPromptText(PEOPLE_HTML)].join('\n'),
        UNDERGRAD_EXTRACTION_PROMPT_HASH,
        DEFAULT_MODEL,
      );
      const stored = emitted.find((o) => o.field === 'sourceContentHash')?.value;
      expect(stored).toEqual(expect.any(String));
      expect(stored).not.toBe(priorContractHash);
    });
  });

  it('discovers sub-pages from the resolved final home page URL', async () => {
    const fetchPage = vi.fn(async (url: string): Promise<FetchedPage | null> => {
      if (url === 'https://legacy.example.edu/lab') {
        return {
          url: 'https://current.example.edu/',
          html: '<html><body><h1>Current Lab</h1><a href="/opportunities">Opportunities</a></body></html>',
        };
      }
      if (url === 'https://current.example.edu/opportunities') {
        return {
          url,
          html: '<html><body><h1>Opportunities</h1><p>We welcome undergraduate researchers.</p></body></html>',
        };
      }
      return null;
    });
    const callLLM = vi.fn(
      async (input: {
        model: string;
        systemPrompt: string;
        userPrompt: string;
        apiKey: string;
      }): Promise<LLMExtraction> => {
        expect(input.userPrompt).toContain('https://current.example.edu/opportunities');
        return {
          openToUndergrads: 'yes',
          currentUndergradCount: 0,
          evidenceQuote: 'We welcome undergraduate researchers.',
          evidenceSource: 'explicit_text',
          joinPageUrl: 'https://current.example.edu/opportunities',
        };
      },
    );

    const scraper = newTestScraper({
      fetchPage,
      callLLM,
      labFinder: async () => [
        {
          _id: '1',
          slug: 'current-lab',
          name: 'Current Lab',
          websiteUrl: 'https://legacy.example.edu/lab',
        },
      ],
      apiKey: 'sk-test',
    });
    const { ctx, emitted } = makeContext();
    await scraper.run(ctx);

    expect(fetchPage).toHaveBeenCalledWith('https://legacy.example.edu/lab');
    expect(fetchPage).toHaveBeenCalledWith('https://current.example.edu/opportunities');
    expect(emitted.some((o) => o.field === 'undergradEvidenceQuote')).toBe(true);
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
    const callLLM = vi.fn(
      async (): Promise<LLMExtraction> => ({
        openToUndergrads: 'yes',
        currentUndergradCount: 0,
        evidenceQuote: 'Undergraduates join projects.',
        evidenceSource: 'explicit_text',
        joinPageUrl: null,
      }),
    );
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
    const callLLM = vi.fn(
      async () =>
        ({
          openToUndergrads: 'yes',
          currentUndergradCount: 0,
          evidenceQuote: 'Undergraduates help collect data each summer.',
          evidenceSource: 'explicit_text',
          joinPageUrl: 'https://smith.example.com/join',
        }) satisfies LLMExtraction,
    );
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
      'https://bounded.example.com/opportunities': '<html><body>Opportunities page</body></html>',
      'https://bounded.example.com/undergraduates': '<html><body>Undergraduates page</body></html>',
    });
    const callLLM = vi.fn(
      async () =>
        ({
          openToUndergrads: 'unclear',
          currentUndergradCount: 0,
          evidenceQuote: '',
          evidenceSource: 'none',
          joinPageUrl: null,
        }) satisfies LLMExtraction,
    );
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
    expect(fetchPage).not.toHaveBeenCalledWith('https://bounded.example.com/undergraduates');
    expect(
      fetchPage.mock.calls.filter(([url]) => url === 'https://bounded.example.com/people'),
    ).toHaveLength(1);
    const prompt = (callLLM.mock.calls as unknown as Array<[{ userPrompt: string }]>)[0][0]
      .userPrompt;
    expect(prompt).not.toContain('Undergraduates page');
  });

  it('falls back to a rendered fetcher when the home page is empty or script-heavy', async () => {
    const fetchPage = makeFetchPage({
      'https://hydrated.example.com/':
        '<html><body><div id="root"></div><script>app()</script></body></html>',
    });
    const renderedFetcher = vi.fn().mockResolvedValue({
      url: 'https://hydrated.example.com/',
      html: HOME_HTML,
      fetchMode: 'scrapling',
    });
    const callLLM = vi.fn(
      async () =>
        ({
          openToUndergrads: 'yes',
          currentUndergradCount: 0,
          evidenceQuote: 'We welcome undergraduate researchers each semester.',
          evidenceSource: 'explicit_text',
          joinPageUrl: null,
        }) satisfies LLMExtraction,
    );
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

  it('records a home page that failed to load as a failed fetch, not an http selector breakage (#4429)', async () => {
    const fetchPage = makeFetchPage({});
    const callLLM = vi.fn();
    const labFinder = async (): Promise<CandidateLab[]> => [
      {
        _id: '1',
        slug: 'offline-lab',
        name: 'Offline Lab',
        websiteUrl: 'https://offline.example.com/',
      },
    ];

    const scraper = newTestScraper({
      fetchPage,
      renderedFetcher: null,
      callLLM,
      labFinder,
      apiKey: 'sk-test',
    });
    const { ctx } = makeContext();
    const result = await scraper.run(ctx);

    expect(callLLM).not.toHaveBeenCalled();
    expect(result.fetchMetrics?.summary.byMode.http).toMatchObject({
      total: 1,
      succeeded: 0,
      selectorBreakages: 0,
    });
    expect(result.fetchMetrics?.summary.failed).toBe(1);
  });

  it('records no rendered attempt when the renderer is disabled, so it adds no scrapling selector breakage (#3742)', async () => {
    const fetchPage = makeFetchPage({
      'https://hydrated.example.com/':
        '<html><body><div id="root"></div><script>app()</script></body></html>',
    });
    const callLLM = vi.fn(
      async () =>
        ({
          openToUndergrads: 'unknown',
          currentUndergradCount: 0,
          evidenceQuote: null,
          evidenceSource: 'none',
          joinPageUrl: null,
        }) as unknown as LLMExtraction,
    );
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
      renderedFetcher: null,
      callLLM,
      labFinder,
      apiKey: 'sk-test',
    });
    const { ctx } = makeContext();
    const result = await scraper.run(ctx);

    expect(result.fetchMetrics?.summary.byMode.scrapling).toBeUndefined();
    expect(
      result.fetchMetrics?.attempts.filter((attempt) => attempt.fetchMode === 'scrapling'),
    ).toEqual([]);
  });

  it.each([
    {
      label: 'a 404 page the bridge does not flag',
      page: { statusCode: 404, blocked: false },
    },
    {
      label: 'a challenge page the bridge flags as blocked',
      page: { statusCode: 403, blocked: true, blockedReason: 'http-403' },
    },
  ])('counts $label from the rendered fallback as a fetch failure', async ({ page }) => {
    const fetchPage = makeFetchPage({});
    const renderedFetcher = vi.fn().mockResolvedValue({
      url: 'https://gone.example.com/',
      html: `<html><body><h1>Page not found</h1><p>${'The page you requested could not be found on this server. '.repeat(8)}</p></body></html>`,
      fetchMode: 'scrapling',
      ...page,
    });
    const callLLM = vi.fn();
    const labFinder = async (): Promise<CandidateLab[]> => [
      { _id: '1', slug: 'gone-lab', name: 'Gone Lab', websiteUrl: 'https://gone.example.com/' },
    ];

    const scraper = newTestScraper({
      fetchPage,
      renderedFetcher,
      callLLM,
      labFinder,
      apiKey: 'sk-test',
    });
    const { ctx, emitted } = makeContext();
    const result = await scraper.run(ctx);

    expect(renderedFetcher).toHaveBeenCalledTimes(1);
    expect(callLLM).not.toHaveBeenCalled();
    expect(emitted).toEqual([]);
    expect(result.notes).toContain('LLM-extracted undergrad signals for 0/1 labs (1 fetch-failed');
    expect(result.fetchMetrics?.summary.byMode.scrapling?.succeeded).toBe(0);
  });

  it('keeps emitting other observations while preserving a legacy acceptance lock', async () => {
    const fetchPage = makeFetchPage({
      'https://locked.yale.edu/': HOME_HTML.replace(
        '</body>',
        '<p>Undergraduate researchers are paid.</p></body>',
      ),
    });
    const callLLM = vi.fn(
      async (input: {
        systemPrompt: string;
        responseFormat: Record<string, unknown>;
      }): Promise<LLMExtraction> => {
        expect(input.systemPrompt).toBe(LAB_UNDERGRAD_SYSTEM_PROMPT);
        expect(input.responseFormat).toBe(LAB_UNDERGRAD_RESPONSE_FORMAT);
        return {
          openToUndergrads: 'yes',
          currentUndergradCount: 0,
          evidenceQuote: 'We welcome undergraduate researchers each semester.',
          evidenceSource: 'explicit_text',
          joinPageUrl: null,
        };
      },
    );
    const labFinder = async (): Promise<CandidateLab[]> => [
      {
        _id: '1',
        slug: 'locked-lab',
        name: 'Locked',
        websiteUrl: 'https://locked.yale.edu/',
        manuallyLockedFields: ['undergradAccessEvidence'],
      },
    ];

    const scraper = newTestScraper({
      fetchPage,
      callLLM,
      labFinder,
      apiKey: 'sk-test',
    });
    const { ctx, emitted } = makeContext({ only: ['locked-lab'] });
    await scraper.run(ctx);

    expect(fetchPage).toHaveBeenCalledWith('https://locked.yale.edu/');
    expect(emitted.some((item) => item.field === 'undergradEvidenceQuote')).toBe(true);
    expect(emitted.some((item) => item.field === 'undergradAccessEvidence')).toBe(false);
  });

  it('respects the --only filter (slug allowlist)', async () => {
    const fetchPage = makeFetchPage({
      'https://b.example/': HOME_HTML,
    });
    const callLLM = vi.fn(
      async () =>
        ({
          openToUndergrads: 'unclear',
          currentUndergradCount: 0,
          evidenceQuote: '',
          evidenceSource: 'none',
          joinPageUrl: null,
        }) satisfies LLMExtraction,
    );
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
    // openToUndergrads was 'unclear' → no access evidence obs, only lastObservedAt
    expect(emitted.find((o) => o.field === 'undergradAccessEvidence')).toBeUndefined();
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
    expect(logs.some((l) => /LLM call failed: .*rate limited/.test(l))).toBe(true);
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
    const callLLM = vi.fn(
      async () =>
        ({
          openToUndergrads: 'yes',
          currentUndergradCount: 0,
          evidenceQuote: 'We welcome undergraduate researchers each semester.',
          evidenceSource: 'explicit_text',
          joinPageUrl: null,
        }) satisfies LLMExtraction,
    );
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
    expect(
      emitted.some((o) => o.entityKey === 'present-lab' && o.field === 'undergradAccessEvidence'),
    ).toBe(true);
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
    const callLLM = vi.fn(
      async () =>
        ({
          openToUndergrads: 'yes',
          currentUndergradCount: 0,
          evidenceQuote: 'q',
          evidenceSource: 'explicit_text',
          joinPageUrl: null,
        }) satisfies LLMExtraction,
    );

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

describe('LabMicrositeUndergradLLMExtractor one-lab failure isolation (#3558)', () => {
  const depth = 5_000;
  const deeplyNestedHomeHtml =
    '<html><body>' +
    '<div>'.repeat(depth) +
    '<p>We welcome undergraduate researchers each semester in our laboratory group.</p>' +
    '<p>' +
    'Our research program studies synthetic example systems. '.repeat(6) +
    '</p>' +
    '<a href="/people">Lab Members</a>' +
    '</div>'.repeat(depth) +
    '</body></html>';

  const extraction: LLMExtraction = {
    openToUndergrads: 'yes',
    currentUndergradCount: 3,
    evidenceQuote: 'We welcome undergraduate researchers each semester.',
    evidenceSource: 'members_section',
    joinPageUrl: null,
  };

  const twoLabs = async (): Promise<CandidateLab[]> => [
    { _id: '1', slug: 'failing-lab', name: 'Failing Lab', websiteUrl: 'https://fail.example.com/' },
    {
      _id: '2',
      slug: 'smith-lab',
      name: 'The Smith Lab',
      websiteUrl: 'https://smith.example.com/',
    },
  ];

  it('flattens a 5,000-level nested page to prompt text instead of overflowing', () => {
    const text = htmlToPromptText(deeplyNestedHomeHtml);
    expect(text).toContain('We welcome undergraduate researchers each semester');
    expect(discoverSubPageUrls(deeplyNestedHomeHtml, 'https://deep.example.com/')).toEqual([
      'https://deep.example.com/people',
    ]);
  });

  it('extracts from a deeply nested lab page end to end', async () => {
    const callLLM = vi.fn(async (): Promise<LLMExtraction> => extraction);
    const scraper = newTestScraper({
      fetchPage: makeFetchPage({ 'https://deep.example.com/': deeplyNestedHomeHtml }),
      callLLM,
      labFinder: async () => [
        { _id: '1', slug: 'deep-lab', name: 'Deep Lab', websiteUrl: 'https://deep.example.com/' },
      ],
      apiKey: 'sk-test',
    });
    const { ctx } = makeContext();
    const result = await scraper.run(ctx);

    expect(callLLM).toHaveBeenCalledTimes(1);
    expect(result.entitiesObserved).toBe(1);
    expect(result.notes).toContain('0 processing-failed');
  });

  it('counts an exception on one lab as processing-failed and continues with the rest', async () => {
    const unreadableExtraction = {
      get openToUndergrads(): never {
        throw new RangeError('Maximum call stack size exceeded');
      },
    } as unknown as LLMExtraction;
    const callLLM = vi.fn(
      async ({ userPrompt }: { userPrompt: string }): Promise<LLMExtraction> =>
        userPrompt.includes('Failing Lab') ? unreadableExtraction : extraction,
    );
    const scraper = newTestScraper({
      fetchPage: makeFetchPage({
        'https://fail.example.com/': HOME_HTML,
        'https://smith.example.com/': HOME_HTML,
        'https://smith.example.com/people': PEOPLE_HTML,
      }),
      callLLM,
      labFinder: twoLabs,
      apiKey: 'sk-test',
    });
    const { ctx, logs } = makeContext({ sourceConcurrency: 1 });
    const result = await scraper.run(ctx);

    expect(callLLM).toHaveBeenCalledTimes(2);
    expect(result.entitiesObserved).toBe(1);
    expect(result.notes).toContain('1/2 labs');
    expect(result.notes).toContain('1 processing-failed');
    expect(
      logs.some(
        (log) =>
          log.includes('[failing-lab] processing failed') &&
          log.includes('Maximum call stack size exceeded'),
      ),
    ).toBe(true);
  });

  it('fails the lane when the WorkPlanner read fails', async () => {
    const callLLM = vi.fn(async (): Promise<LLMExtraction> => extraction);
    const scraper = newTestScraper({
      fetchPage: makeFetchPage({ 'https://smith.example.com/': HOME_HTML }),
      callLLM,
      workPlanLoader: async () => {
        throw new Error('work plan store unavailable');
      },
      labFinder: twoLabs,
      apiKey: 'sk-test',
    });
    const { ctx } = makeContext({ sourceConcurrency: 1 });

    await expect(scraper.run(ctx)).rejects.toThrow('work plan store unavailable');
    expect(callLLM).not.toHaveBeenCalled();
  });

  it('still fails the lane when writing observations fails', async () => {
    const scraper = newTestScraper({
      fetchPage: makeFetchPage({
        'https://smith.example.com/': HOME_HTML,
        'https://smith.example.com/people': PEOPLE_HTML,
      }),
      callLLM: async () => extraction,
      labFinder: async () => [
        {
          _id: '2',
          slug: 'smith-lab',
          name: 'The Smith Lab',
          websiteUrl: 'https://smith.example.com/',
        },
      ],
      apiKey: 'sk-test',
    });
    const { ctx } = makeContext();
    ctx.emit = async () => {
      throw new Error('observation store unavailable');
    };

    await expect(scraper.run(ctx)).rejects.toThrow('observation store unavailable');
  });
});

describe('LabMicrositeUndergradLLMExtractor.run withdrawing a stored evidence quote (#3592)', () => {
  const FILLER =
    'The group studies synthetic membranes, protein folding kinetics and the design of new imaging methods for living tissue across many scales of time, from single molecules to whole organs, with collaborators in chemistry and physics.';
  const HOME = `<html><body><h1>Example Lab</h1><p>${FILLER}</p><p>Undergraduates join us every fall.</p></body></html>`;
  const JOIN = `<html><body><h2>Join</h2><p>${FILLER}</p><p>Email the lab manager to ask about openings.</p></body></html>`;
  const lab: CandidateLab = {
    _id: '1',
    slug: 'example-lab',
    name: 'Example Lab',
    websiteUrl: 'https://example-lab.example.edu/',
  };
  const noQuoteAnswer: LLMExtraction = {
    openToUndergrads: 'unclear',
    currentUndergradCount: 0,
    evidenceQuote: '',
    evidenceSource: 'none',
    joinPageUrl: null,
  };

  async function runWith(
    live: { value: string; sourceUrl: string } | null,
    pages: Record<string, string>,
    answer: LLMExtraction = noQuoteAnswer,
  ) {
    const fetchPage = makeFetchPage(pages);
    const scraper = newTestScraper({
      fetchPage,
      callLLM: vi.fn(async () => answer),
      labFinder: async () => [lab],
      liveEvidenceQuoteLoader: async () => live,
      renderedFetcher: null,
      apiKey: 'sk-test',
    });
    const { ctx, emitted } = makeContext();
    const result = await scraper.run(ctx);
    const quoteRows = emitted.filter((obs) => obs.field === 'undergradEvidenceQuote');
    return { result, quoteRows, fetchPage };
  }

  it('states the stored quote has no value when the page it cites no longer carries it', async () => {
    const { result, quoteRows } = await runWith(
      {
        value: 'No explicit mention of undergraduates was found on the provided pages.',
        sourceUrl: 'https://example-lab.example.edu/',
      },
      { 'https://example-lab.example.edu/': HOME },
    );
    expect(quoteRows).toEqual([
      expect.objectContaining({
        value: '',
        sourceUrl: 'https://example-lab.example.edu/',
        assertsNoValueFor: ['undergradEvidenceQuote'],
      }),
    ]);
    expect(result.metrics?.evidenceQuotesWithdrawn).toBe(1);
  });

  it('keeps a stored quote that is still on a page the lane read, whatever the model says now', async () => {
    const { quoteRows, result } = await runWith(
      {
        value: 'Undergraduates   join us every fall.',
        sourceUrl: 'https://example-lab.example.edu/',
      },
      { 'https://example-lab.example.edu/': HOME },
    );
    expect(quoteRows).toEqual([]);
    expect(result.metrics?.evidenceQuotesWithdrawn).toBe(0);
  });

  it('reads the cited page itself when the crawl did not reach it', async () => {
    const { quoteRows, fetchPage } = await runWith(
      {
        value: 'Email the lab manager to ask about openings.',
        sourceUrl: 'https://example-lab.example.edu/about/join/',
      },
      {
        'https://example-lab.example.edu/': HOME,
        'https://example-lab.example.edu/about/join/': JOIN,
      },
    );
    expect(fetchPage).toHaveBeenCalledWith('https://example-lab.example.edu/about/join/');
    expect(quoteRows).toEqual([]);
  });

  it('states nothing when the cited page could not be read', async () => {
    const { quoteRows } = await runWith(
      {
        value: 'A sentence only an unreachable page could confirm, about undergraduates.',
        sourceUrl: 'https://example-lab.example.edu/gone/',
      },
      { 'https://example-lab.example.edu/': HOME },
    );
    expect(quoteRows).toEqual([]);
  });

  it('lets a quote the model finds on the page in the same run replace the withdrawal', async () => {
    const { quoteRows } = await runWith(
      {
        value: 'A paraphrase the page never said about undergraduates.',
        sourceUrl: 'https://example-lab.example.edu/',
      },
      { 'https://example-lab.example.edu/': HOME },
      {
        ...noQuoteAnswer,
        openToUndergrads: 'yes',
        evidenceQuote: 'Undergraduates join us every fall.',
        evidenceSource: 'explicit_text',
      },
    );
    expect(quoteRows.map((obs) => obs.value)).toEqual(['', 'Undergraduates join us every fall.']);
  });

  it('re-cites a kept quote to the fetched page that carries it when its cited page does not (#3831)', async () => {
    const { quoteRows, result } = await runWith(
      {
        value: 'Undergraduates join us every fall.',
        sourceUrl: 'https://example-lab.example.edu/about/join/',
      },
      {
        'https://example-lab.example.edu/': HOME,
        'https://example-lab.example.edu/about/join/': JOIN,
      },
    );
    expect(quoteRows).toEqual([
      expect.objectContaining({
        value: 'Undergraduates join us every fall.',
        sourceUrl: 'https://example-lab.example.edu/',
      }),
    ]);
    expect(quoteRows[0].assertsNoValueFor).toBeUndefined();
    expect(result.metrics?.evidenceQuotesRecited).toBe(1);
    expect(result.metrics?.evidenceQuotesWithdrawn).toBe(0);
  });

  it('restates nothing when the cited page is read and carries the quote (#3831)', async () => {
    const { quoteRows, result } = await runWith(
      {
        value: 'Undergraduates join us every fall.',
        sourceUrl: 'https://example-lab.example.edu/',
      },
      { 'https://example-lab.example.edu/': HOME },
    );
    expect(quoteRows).toEqual([]);
    expect(result.metrics?.evidenceQuotesRecited).toBe(0);
  });
});

describe('LabMicrositeUndergradLLMExtractor.run on a stale center-program citation (#3831)', () => {
  const FILLER =
    'The group studies synthetic membranes, protein folding kinetics and the design of new imaging methods for living tissue across many scales of time, from single molecules to whole organs, with collaborators in chemistry and physics.';
  const BLURB =
    'The Example Center hosts the Summer Internship for College Undergraduates, a 10-week program designed to inspire the next generation of leaders in research.';
  const PROFILE = `<html><body><h1>Example Person</h1><p>${FILLER}</p></body></html>`;
  const CENTER_PROFILE = `<html><body><h1>Example Person</h1><p>${FILLER}</p><a href="/center/education/opportunities/internship">Summer Internship for College Undergraduates</a></body></html>`;
  const PROGRAM_ROOT = `<html><body><h1>Example Center</h1><p>${FILLER}</p><a href="/center/education/opportunities/internship">Summer Internship for College Undergraduates</a></body></html>`;
  const INTERNSHIP = `<html><body><h2>Internship</h2><p>${FILLER}</p><p>${BLURB}</p></body></html>`;
  const noQuoteAnswer: LLMExtraction = {
    openToUndergrads: 'unclear',
    currentUndergradCount: 0,
    evidenceQuote: '',
    evidenceSource: 'none',
    joinPageUrl: null,
  };
  const staleQuote = {
    value: BLURB,
    sourceUrl: 'https://medical.example.edu/center/profile/example-person/',
  };

  async function runFor(websiteUrl: string, pages: Record<string, string>) {
    const scraper = newTestScraper({
      fetchPage: makeFetchPage(pages),
      callLLM: vi.fn(async () => noQuoteAnswer),
      labFinder: async () => [
        { _id: '1', slug: 'example-person', name: 'Example Person', websiteUrl },
      ],
      liveEvidenceQuoteLoader: async () => staleQuote,
      renderedFetcher: null,
      apiKey: 'sk-test',
    });
    const { ctx, emitted } = makeContext();
    const result = await scraper.run(ctx);
    return { result, quoteRows: emitted.filter((obs) => obs.field === 'undergradEvidenceQuote') };
  }

  it('withdraws the blurb for a faculty row whose own profile never carries it', async () => {
    const { result, quoteRows } = await runFor(
      'https://medical.example.edu/profile/example-person/',
      {
        'https://medical.example.edu/profile/example-person/': PROFILE,
        'https://medical.example.edu/center/profile/example-person/': CENTER_PROFILE,
        'https://medical.example.edu/center/education/opportunities/internship': INTERNSHIP,
      },
    );
    expect(quoteRows).toEqual([
      expect.objectContaining({ value: '', assertsNoValueFor: ['undergradEvidenceQuote'] }),
    ]);
    expect(result.metrics?.evidenceQuotesWithdrawn).toBe(1);
    expect(result.metrics?.evidenceQuotesRecited).toBe(0);
  });

  it('re-cites the blurb to the program page when that page is inside the row it belongs to', async () => {
    const { result, quoteRows } = await runFor('https://medical.example.edu/center/', {
      'https://medical.example.edu/center/': PROGRAM_ROOT,
      'https://medical.example.edu/center/profile/example-person/': CENTER_PROFILE,
      'https://medical.example.edu/center/education/opportunities/internship': INTERNSHIP,
    });
    expect(quoteRows[0]).toEqual(
      expect.objectContaining({
        value: BLURB,
        sourceUrl: 'https://medical.example.edu/center/education/opportunities/internship',
      }),
    );
    expect(result.metrics?.evidenceQuotesRecited).toBe(1);
  });
});

describe('roster lines under an alumni heading (#4430)', () => {
  const rosterPage = (text: string) => [{ url: 'https://examplelab.org/people', text }];

  it('reads bare names listed after an Alumni heading as historical', () => {
    const pages = rosterPage(
      'Lab members Principal Investigator Graduate student Alumni Avery Example (undergraduate) Jordan Sample (undergraduate) Casey Placeholder (graduate student)',
    );
    expect(rosterSnippetSitsUnderAHistoricalHeading('Avery Example (undergraduate)', pages)).toBe(
      true,
    );
  });

  it('reads a Former members heading as historical', () => {
    const pages = rosterPage(
      'Undergraduate researchers Riley Fixture Former members Quinn Fixture (Yale College 2024)',
    );
    expect(rosterSnippetSitsUnderAHistoricalHeading('Quinn Fixture', pages)).toBe(true);
    expect(rosterSnippetSitsUnderAHistoricalHeading('Riley Fixture', pages)).toBe(false);
  });

  it('keeps a current undergraduate listed before the alumni heading', () => {
    const pages = rosterPage(
      'People Undergraduate Students Morgan Example is a member of a residential college studying physics. Alumni Taylor Example (now a graduate student)',
    );
    expect(rosterSnippetSitsUnderAHistoricalHeading('Morgan Example', pages)).toBe(false);
  });

  it('keeps a roster that follows a navigation link named Alumni once a current heading resets it', () => {
    const pages = rosterPage(
      'Home Research Alumni Contact Lab Members Drew Sample Undergraduate Student Email',
    );
    expect(
      rosterSnippetSitsUnderAHistoricalHeading('Drew Sample Undergraduate Student', pages),
    ).toBe(false);
  });

  it('keeps a line a tab strip puts after the alumni tab when the panel repeats it under the team heading', () => {
    const pages = rosterPage(
      'Members Alumni Sky Fixture Undergraduate Student Team Members Sky Fixture Undergraduate Student',
    );
    expect(
      rosterSnippetSitsUnderAHistoricalHeading('Sky Fixture Undergraduate Student', pages),
    ).toBe(false);
  });

  it('treats a Current: label as current and a Former: label as historical', () => {
    const pages = rosterPage(
      'Undergraduate Students Current: Rowan Example Former: Harper Example (BS 2023; graduate student elsewhere)',
    );
    expect(rosterSnippetSitsUnderAHistoricalHeading('Rowan Example', pages)).toBe(false);
    expect(rosterSnippetSitsUnderAHistoricalHeading('Harper Example', pages)).toBe(true);
  });

  it('does not read a career line inside an alumni list as a current heading', () => {
    const pages = rosterPage(
      'Alumni Parker Example, PhD Student. Current position: Postdoc elsewhere. Sage Example (undergraduate)',
    );
    expect(rosterSnippetSitsUnderAHistoricalHeading('Sage Example (undergraduate)', pages)).toBe(
      true,
    );
  });

  it('lets a principal investigator heading reset a prose mention of an alumnus', () => {
    const pages = rosterPage(
      'People Life in Lab sketch gallery drawn by an alumnus. Principal Investigator Example PI Postdocs Avery Example Undergraduate Students Jordan Example Undergraduate Student Alumni Casey Example Former Graduate Student',
    );
    expect(
      rosterSnippetSitsUnderAHistoricalHeading('Jordan Example Undergraduate Student', pages),
    ).toBe(false);
  });

  it('reads role sub-headings inside an alumni section as historical', () => {
    const pages = rosterPage(
      'People Faculty Example PI Lab alumni Postdocs Avery Example - Assistant Professor elsewhere Masters students Jordan Example Undergraduate students Yale: Casey Example, Riley Example',
    );
    expect(rosterSnippetSitsUnderAHistoricalHeading('Casey Example', pages)).toBe(true);
  });

  it('finds an alumni heading a site builder glued to the words around it', () => {
    const pages = rosterPage(
      'People Riley ExampleUndergraduate Researcher Other UniversityAlumniCasey FixtureRotation Student Quinn ExampleUndergraduate Researcher Yale',
    );
    expect(
      rosterSnippetSitsUnderAHistoricalHeading('Quinn ExampleUndergraduate Researcher Yale', pages),
    ).toBe(true);
  });

  it('reads the roster against the page without its navigation menu', () => {
    const html = `<html><body><nav><a>People</a> <a>Publications</a> <a>Alumni</a> <a>Past members</a></nav>
      <main><h2>Directory</h2><p>Avery Example Graduate Student</p><p>Drew Sample Undergraduate</p></main></body></html>`;
    const page = {
      url: 'https://examplelab.org/directory',
      text: htmlToPromptText(html),
      rosterText: htmlToRosterText(html),
    };
    expect(rosterSnippetSitsUnderAHistoricalHeading('Drew Sample Undergraduate', [page])).toBe(
      false,
    );
    expect(
      rosterSnippetSitsUnderAHistoricalHeading('Drew Sample Undergraduate', [
        { url: page.url, text: page.text },
      ]),
    ).toBe(true);
  });

  it('reads a section label the counted line itself carries', () => {
    const pages = rosterPage(
      'Graduate Students Current: Avery Example Former: Jordan Example Undergraduate Students Current: Rowan Example',
    );
    expect(rosterSnippetSitsUnderAHistoricalHeading('Current: Rowan Example', pages)).toBe(false);
  });

  it('reads a Former Graduate Students heading as historical', () => {
    const pages = rosterPage(
      'Lab Members Example PI Former Graduate Students Avery Example Sage Example (undergraduate)',
    );
    expect(rosterSnippetSitsUnderAHistoricalHeading('Sage Example (undergraduate)', pages)).toBe(
      true,
    );
  });

  it('does not count undergraduates the page lists only under alumni', () => {
    const page = {
      url: 'https://examplelab.org/people',
      text: 'Lab members Postdoctoral Fellow Graduate Student Alumni Avery Example (undergraduate) Jordan Sample (undergraduate)',
    };
    const obs = extractionToObservations(
      'lab-alumni',
      page.url,
      {
        openToUndergrads: 'unclear',
        currentUndergradCount: 2,
        currentUndergradEvidenceQuotes: [
          'Avery Example (undergraduate)',
          'Jordan Sample (undergraduate)',
        ],
        evidenceQuote: '',
        evidenceSource: 'members_section',
        joinPageUrl: null,
      },
      new Date('2026-10-01T00:00:00Z'),
      { sourcePages: [page] },
    );
    expect(obs.find((o) => o.field === 'currentUndergradCount')?.value).toBe(0);
  });

  it('still counts undergraduates listed under the current undergraduate heading', () => {
    const page = {
      url: 'https://examplelab.org/people',
      text: 'People Undergraduate Students Morgan Example Yale College Physics Riley Example Yale College Chemistry Alumni Taylor Example (undergraduate)',
    };
    const obs = extractionToObservations(
      'lab-current',
      page.url,
      {
        openToUndergrads: 'unclear',
        currentUndergradCount: 3,
        currentUndergradEvidenceQuotes: [
          'Morgan Example Yale College Physics',
          'Riley Example Yale College Chemistry',
          'Taylor Example (undergraduate)',
        ],
        evidenceQuote: '',
        evidenceSource: 'members_section',
        joinPageUrl: null,
      },
      new Date('2026-10-01T00:00:00Z'),
      { sourcePages: [page] },
    );
    expect(obs.find((o) => o.field === 'currentUndergradCount')?.value).toBe(2);
  });
});

describe('join pages that are not an undergraduate route (#4430)', () => {
  const home = { url: 'https://examplelab.org/', text: 'Example Lab studies example systems.' };
  const facultyRow = { entityType: 'FACULTY_RESEARCH_AREA', kind: 'individual' };

  it('refuses a join URL the lane never read, since the model is shown only read URLs', () => {
    expect(laneJoinPageRefusal('https://examplelab.org/open-positions', [home])).toBe(
      'join-page-not-read',
    );
  });

  it('refuses a roster page that invites no one', () => {
    const team = {
      url: 'https://examplelab.org/team',
      text: 'Current Members Avery Example Associate Research Scientist. Jordan Example first joined the lab during undergraduate studies.',
    };
    expect(laneJoinPageRefusal(team.url, [home, team])).toBe('join-page-invites-no-one');
  });

  it('reads a biography that mentions joining the lab as no invitation', () => {
    const team = {
      url: 'https://examplelab.org/team',
      text: 'Welcome Research Team Contact. Current Members Avery Example, PhD 2023Before joining the Example Lab, Avery worked on imaging applications elsewhere.',
    };
    expect(laneJoinPageRefusal(team.url, [home, team])).toBe('join-page-invites-no-one');
  });

  it('refuses a join page that recruits only graduate students, postdocs and visiting scientists', () => {
    const join = {
      url: 'https://examplelab.org/join',
      text: "Join our Team. We're currently on the lookout for motivated postgraduates, graduate students, post-doctorates and visiting scientists.",
    };
    expect(laneJoinPageRefusal(join.url, [home, join])).toBe(
      'join-page-recruits-only-non-undergraduates',
    );
  });

  it('refuses a study-recruitment page even when the lane read it', () => {
    const participate = {
      url: 'https://examplelab.org/participate',
      text: 'Participate in our studies! We are recruiting parents and babies.',
    };
    expect(laneJoinPageRefusal(participate.url, [home, participate])).toBe(
      'participant-recruitment-route',
    );
  });

  it("refuses a sibling center's page outside the row's section of a shared host", () => {
    const centerHome = {
      url: 'https://school.yale.edu/example-center',
      text: 'The Example Center studies diplomacy.',
    };
    const sibling = {
      url: 'https://school.yale.edu/other-center/opportunities',
      text: 'The Other Center accepts applications from undergraduate students for research awards.',
    };
    expect(laneJoinPageRefusal(sibling.url, [centerHome, sibling])).toBe(
      'join-page-outside-the-entity-scope',
    );
  });

  it("keeps a contact page on a lab's own host whose home is a sub-page", () => {
    const labHome = {
      url: 'https://examplelab.wordpress.com/about/',
      text: 'About the Example Lab.',
    };
    const contact = {
      url: 'https://examplelab.wordpress.com/contact/',
      text: 'We are always interested in recruiting motivated undergraduate students, graduate students, and postdocs.',
    };
    expect(laneJoinPageRefusal(contact.url, [labHome, contact])).toBeNull();
  });

  it("refuses a center's training page reached from a faculty profile", () => {
    const profile = {
      url: 'https://medicine.yale.edu/cancer/profile/example-person/',
      text: 'Example Person, MD. Research interests.',
    };
    const training = {
      url: 'https://medicine.yale.edu/cancer/collaborative-excellence/training-opportunities/',
      text: 'Training Opportunities. Internship for college undergraduates. Learn more and how to apply.',
    };
    expect(laneJoinPageRefusal(training.url, [profile, training], facultyRow)).toBe(
      'programme-page-of-another-entity',
    );
  });

  it('keeps a lab join page that invites undergraduates', () => {
    const join = {
      url: 'https://examplelab.org/join/',
      text: 'Join Our Lab. We are always looking for motivated people. Undergraduate Students: please reach out with your CV.',
    };
    expect(laneJoinPageRefusal('https://examplelab.org/join', [home, join])).toBeNull();
  });

  it('keeps a join page that invites students without naming their level', () => {
    const people = {
      url: 'https://examplelab.org/people/',
      text: 'People. Join our group: I am always looking for highly-motivated students and postdocs.',
    };
    expect(laneJoinPageRefusal(people.url, [home, people])).toBeNull();
  });

  it('keeps a join page that welcomes members at all levels', () => {
    const positions = {
      url: 'https://examplelab.org/positions',
      text: 'Open positions. We are currently seeking new members at all levels! PhD students should contact the PI.',
    };
    expect(laneJoinPageRefusal(positions.url, [home, positions])).toBeNull();
  });

  it('reads navigation chrome that names patients and staff as no audience', () => {
    expect(
      joinPageRecruitsOnlyNonUndergraduates(
        'About FacultyStaffStudentsResidents & FellowsPatients Join Us. Our lab welcomes trainees.',
      ),
    ).toBe(false);
  });

  it('emits joinPageUrl only for a read page that passes every arm', () => {
    const ext: LLMExtraction = {
      openToUndergrads: 'yes',
      currentUndergradCount: 0,
      evidenceQuote: 'Undergraduate Students: please reach out with your CV.',
      evidenceSource: 'explicit_text',
      joinPageUrl: 'https://examplelab.org/join',
    };
    const join = {
      url: 'https://examplelab.org/join',
      text: 'Join Our Lab. Undergraduate Students: please reach out with your CV.',
    };
    const kept = extractionToObservations('lab-join', home.url, ext, new Date(), {
      sourcePages: [home, join],
    });
    expect(kept.find((o) => o.field === 'joinPageUrl')?.value).toBe(join.url);

    const refused = extractionToObservations(
      'lab-join',
      home.url,
      { ...ext, joinPageUrl: 'https://examplelab.org/open-positions' },
      new Date(),
      { sourcePages: [home, join] },
    );
    expect(refused.find((o) => o.field === 'joinPageUrl')?.value).toBe('');
  });

  it('withholds the empty join page when a linked sub-page failed to fetch', () => {
    const obs = extractionToObservations(
      'lab-join',
      home.url,
      {
        openToUndergrads: 'unclear',
        currentUndergradCount: 0,
        evidenceQuote: '',
        evidenceSource: 'none',
        joinPageUrl: null,
      },
      new Date(),
      { sourcePages: [home], readIsComplete: false },
    );
    expect(obs.find((o) => o.field === 'joinPageUrl')).toBeUndefined();
  });
});

describe('join pages whose path does not decide their audience (#4430)', () => {
  const home = { url: 'https://examplelab.org/', text: 'Example Lab studies example systems.' };

  it('refuses a careers page that recruits graduate students, postdocs and technicians only', () => {
    const careers = {
      url: 'https://examplelab.org/career-opportunities/',
      text: 'Career opportunities. The lab welcomes graduates interested in research. Graduate students interested in rotations should contact the PI. We are seeking highly motivated postdoctoral fellows. Research technician applications are welcome.',
    };
    expect(laneJoinPageRefusal(careers.url, [home, careers])).toBe(
      'join-page-recruits-only-non-undergraduates',
    );
  });

  it('keeps a lab jobs page that invites undergraduates to do research', () => {
    const jobs = {
      url: 'https://examplelab.org/jobs',
      text: 'Jobs. Postdoctoral positions: a post-doctoral position is available. Yale graduate and undergraduate students who would like to do research in the laboratory should email the lab manager.',
    };
    expect(laneJoinPageRefusal(jobs.url, [home, jobs])).toBeNull();
  });

  it('keeps a volunteer research-assistant page that recruits Yale students', () => {
    const volunteer = {
      url: 'https://examplelab.org/volunteer',
      text: 'Join the Lab. The lab is accepting volunteer research assistants for the fall. We recruit students from Yale as well as surrounding universities.',
    };
    expect(laneJoinPageRefusal(volunteer.url, [home, volunteer])).toBeNull();
  });
});

describe("a department's own undergraduate research programme as a join page (#4430)", () => {
  const profile = {
    url: 'https://economics.yale.edu/people/example-person',
    text: 'Example Person. Professor of Economics.',
  };
  const programme = {
    url: 'https://economics.yale.edu/undergraduate/employment-opportunities',
    text: 'Employment Opportunities. Research assistantships give undergraduates at Yale an opportunity to work as a research assistant for a professor. Applications are due in the fall.',
  };
  const faculty = { entityType: 'FACULTY_RESEARCH_AREA', kind: 'individual' };

  it("keeps the department's page for that department's faculty row", () => {
    expect(
      laneJoinPageRefusal(programme.url, [profile, programme], {
        ...faculty,
        departments: ['Economics'],
      }),
    ).toBeNull();
  });

  it('refuses it for a faculty row of another department', () => {
    expect(
      laneJoinPageRefusal(programme.url, [profile, programme], {
        ...faculty,
        departments: ['Global Affairs'],
      }),
    ).toBe('join-page-outside-the-entity-scope');
  });
});

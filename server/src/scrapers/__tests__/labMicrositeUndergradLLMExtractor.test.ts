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
  labIdentityObservationsFromHomePage,
  normalizeExtraction,
  sourceUrlForExtraction,
  candidateLabFromResearchEntityDoc,
  applyListingGuidanceToCandidateLabs,
  selectLabsToProcess,
  type CandidateLab,
  type ListingGuidance,
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
        <h1>Welcome to the Fixture Access Lab</h1>
        <p>We do research.</p>
        <script>alert('hi')</script>
        <p>We welcome   undergraduates.</p>
      </body></html>
    `;
    const text = htmlToPromptText(html);
    expect(text).toContain('Welcome to the Fixture Access Lab');
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

  it('keeps nested lab microsite links inside the lab path and skips global same-host navigation', () => {
    const html = `
      <a href="/people">Yale Medicine People</a>
      <a href="/lab/fixture-access/members">Members</a>
      <a href="/lab/fixture-access/join#students">Join Us</a>
    `;

    expect(discoverSubPageUrls(html, 'https://medicine.yale.edu/lab/fixture-access/')).toEqual([
      'https://medicine.yale.edu/lab/fixture-access/members',
      'https://medicine.yale.edu/lab/fixture-access/join',
    ]);
  });
});

describe('candidateSubPageUrls', () => {
  it('builds origin-rooted candidate URLs for the standard hint paths', () => {
    const urls = candidateSubPageUrls('https://lab.example.com/some/page');
    expect(urls).toContain('https://lab.example.com/some/page/people');
    expect(urls).toContain('https://lab.example.com/some/page/members');
    expect(urls).toContain('https://lab.example.com/some/page/join');
    expect(urls.every((u) => u.startsWith('https://lab.example.com/some/page/'))).toBe(true);
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
      'Fixture Access Lab',
      'https://fixture-access.example.com/',
      'we welcome undergraduates',
      'https://fixture-access.example.com/people',
      'undergrads: student-one, student-two',
    );
    expect(prompt).toContain('Fixture Access Lab');
    expect(prompt).toContain('https://fixture-access.example.com/');
    expect(prompt).toContain('we welcome undergraduates');
    expect(prompt).toContain('https://fixture-access.example.com/people');
    expect(prompt).toContain('undergrads: student-one, student-two');
  });

  it('omits the sub-page section when none was fetched', () => {
    const prompt = buildLLMPrompt(
      'Fixture Access Lab',
      'https://fixture-access.example.com/',
      'home text',
      null,
      null,
    );
    expect(prompt).not.toContain('SUB-PAGE TEXT');
  });

  it('includes additional sub-pages with their raw source URLs', () => {
    const prompt = buildLLMPrompt(
      'Fixture Access Lab',
      'https://fixture-access.example.com/',
      'home text',
      'https://fixture-access.example.com/people',
      'people text',
      [{ url: 'https://fixture-access.example.com/join', text: 'join text' }],
    );
    expect(prompt).toContain('SUB-PAGE TEXT (https://fixture-access.example.com/people)');
    expect(prompt).toContain('people text');
    expect(prompt).toContain('SUB-PAGE TEXT (https://fixture-access.example.com/join)');
    expect(prompt).toContain('join text');
  });
});

describe('labIdentityObservationsFromHomePage', () => {
  it('emits official lab name and website observations from a Yale-shaped lab homepage', () => {
    const observations = labIdentityObservationsFromHomePage(
      {
        slug: 'fixture-identity-lab',
        name: 'Legacy Fixture Lab',
        websiteUrl: '',
        _id: 'entity-1',
      },
      {
        url: 'https://www.eng.yale.edu/fixture-identity-lab/',
        html: `
          <html>
            <head><title>Fixture Identity Lab at Yale University</title></head>
            <body><h1>Fixture Identity Lab</h1></body>
          </html>
        `,
      },
      new Date('2026-05-18T12:00:00Z'),
    );

    expect(observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityType: 'researchEntity',
          entityKey: 'fixture-identity-lab',
          field: 'name',
          value: 'Fixture Identity Lab',
          sourceUrl: 'https://www.eng.yale.edu/fixture-identity-lab/',
        }),
        expect.objectContaining({
          field: 'websiteUrl',
          value: 'https://www.eng.yale.edu/fixture-identity-lab/',
        }),
        expect.objectContaining({
          field: 'sourceUrls',
          value: ['https://www.eng.yale.edu/fixture-identity-lab/'],
        }),
      ]),
    );
  });
});

describe('sourceUrlForExtraction', () => {
  it('returns the page whose text contains the evidence quote', () => {
    const ext: LLMExtraction = {
      openToUndergrads: 'yes',
      currentUndergradCount: 0,
      evidenceQuote: 'Undergraduates help with field work.',
      evidenceSource: 'explicit_text',
      joinPageUrl: 'https://fixture-access.example.com/join',
    };
    const sourceUrl = sourceUrlForExtraction(
      { url: 'https://fixture-access.example.com/', text: 'Welcome.' },
      [
        { url: 'https://fixture-access.example.com/people', text: 'Members.' },
        {
          url: 'https://fixture-access.example.com/join',
          text: 'Undergraduates help with field work.',
        },
      ],
      ext,
    );
    expect(sourceUrl).toBe('https://fixture-access.example.com/join');
  });

  it('returns null instead of blessing an unsupported evidence quote with another source URL', () => {
    const ext: LLMExtraction = {
      openToUndergrads: 'yes',
      currentUndergradCount: 0,
      evidenceQuote: 'Undergraduates lead independent projects every summer.',
      evidenceSource: 'explicit_text',
      joinPageUrl: null,
      undergradRoleQuote: 'Undergraduates help with field work.',
    };
    const sourceUrl = sourceUrlForExtraction(
      { url: 'https://fixture-access.example.com/', text: 'Welcome.' },
      [
        {
          url: 'https://fixture-access.example.com/join',
          text: 'Undergraduates help with field work.',
        },
      ],
      ext,
    );
    expect(sourceUrl).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// extractionToObservations
// ---------------------------------------------------------------------------

describe('extractionToObservations', () => {
  const fixedDate = new Date('2026-04-27T12:00:00Z');

  it('normalizes strong negative evidence into an explicit constraint and negative verdict', () => {
    const normalized = normalizeExtraction({
      openToUndergrads: 'unclear',
      currentUndergradCount: 0,
      evidenceQuote: "I regrettably don't have bandwidth to respond to all of them.",
      evidenceSource: 'none',
      joinPageUrl: null,
      contactInstructionsQuote:
        'For prospective PhD students, you are encouraged to apply through Yale SDS or CS.',
      explicitConstraintQuote: '',
    });

    expect(normalized.openToUndergrads).toBe('no');
    expect(normalized.evidenceSource).toBe('explicit_text');
    expect(normalized.explicitConstraintQuote).toBe(
      "I regrettably don't have bandwidth to respond to all of them.",
    );
  });

  it('preserves graduate-only instructions as constraints without turning them into a negative verdict by themselves', () => {
    const normalized = normalizeExtraction({
      openToUndergrads: 'unclear',
      currentUndergradCount: 0,
      evidenceQuote: '',
      evidenceSource: 'none',
      joinPageUrl: 'https://x.example/join',
      contactInstructionsQuote:
        'Prospective PhD students should apply through the Yale CS admissions portal.',
      explicitConstraintQuote: '',
    });

    expect(normalized.openToUndergrads).toBe('unclear');
    expect(normalized.explicitConstraintQuote).toBe(
      'Prospective PhD students should apply through the Yale CS admissions portal.',
    );
  });

  it('does not treat undergraduate-studies administrative titles as access evidence', () => {
    const normalized = normalizeExtraction({
      openToUndergrads: 'yes',
      currentUndergradCount: 0,
      evidenceQuote:
        'Dr. Fixture joined the Department of Molecular Biophysics and Biochemistry at Yale University in 2009, where they are now Professor and Director of Undergraduate Studies.',
      evidenceSource: 'explicit_text',
      joinPageUrl: null,
      undergradRoleQuote: '',
      contactInstructionsQuote: '',
      explicitConstraintQuote: '',
    });

    expect(normalized.openToUndergrads).toBe('unclear');
    expect(normalized.evidenceSource).toBe('none');
    expect(normalized.evidenceQuote).toBe('');
  });

  it('requires positive undergraduate verdicts to cite undergraduate-specific evidence', () => {
    const traineeHistory = normalizeExtraction({
      openToUndergrads: 'yes',
      currentUndergradCount: 0,
      evidenceQuote:
        'Dr. Fixture has trained, mentored, and advised more than 60 trainees ranging from MPH and PhD students to postdoctoral fellows and junior faculty.',
      evidenceSource: 'explicit_text',
      joinPageUrl: null,
    });
    expect(traineeHistory.openToUndergrads).toBe('unclear');
    expect(traineeHistory.evidenceSource).toBe('none');
    expect(traineeHistory.evidenceQuote).toBe('');

    const genericMembersHeading = normalizeExtraction({
      openToUndergrads: 'yes',
      currentUndergradCount: 0,
      evidenceQuote: 'Students and Visiting Scholars',
      evidenceSource: 'members_section',
      joinPageUrl: null,
    });
    expect(genericMembersHeading.openToUndergrads).toBe('unclear');
    expect(genericMembersHeading.evidenceSource).toBe('none');
    expect(genericMembersHeading.evidenceQuote).toBe('');
  });

  it('preserves graduate-only instructions as constraints instead of positive access', () => {
    const normalized = normalizeExtraction({
      openToUndergrads: 'yes',
      currentUndergradCount: 0,
      evidenceQuote: 'Applications from postdocs, postdocs and graduate students are always welcomed.',
      evidenceSource: 'explicit_text',
      joinPageUrl: null,
    });

    expect(normalized.openToUndergrads).toBe('unclear');
    expect(normalized.evidenceSource).toBe('none');
    expect(normalized.evidenceQuote).toBe('');
    expect(normalized.explicitConstraintQuote).toBe(
      'Applications from postdocs, postdocs and graduate students are always welcomed.',
    );
  });

  it('does not turn alumni maintenance notes into negative undergraduate evidence', () => {
    const normalized = normalizeExtraction({
      openToUndergrads: 'no',
      currentUndergradCount: 0,
      evidenceQuote: 'If you are a lab alumn who wishes to remove or add their email from the page let us know.',
      evidenceSource: 'none',
      joinPageUrl: null,
    });

    expect(normalized.openToUndergrads).toBe('unclear');
    expect(normalized.evidenceQuote).toBe('');
  });

  it('drops generic evidence quotes when the verdict remains unclear', () => {
    const normalized = normalizeExtraction({
      openToUndergrads: 'unclear',
      currentUndergradCount: 0,
      evidenceQuote:
        'We always welcome collaboration and look for students and fellows interested in working with us.',
      evidenceSource: 'explicit_text',
      joinPageUrl: null,
      undergradRoleQuote: '',
      contactInstructionsQuote: '',
      explicitConstraintQuote: '',
    });

    expect(normalized.openToUndergrads).toBe('unclear');
    expect(normalized.evidenceSource).toBe('none');
    expect(normalized.evidenceQuote).toBe('');
  });

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
      evidenceQuote: 'Undergraduates: Student One, Student Two, Student Three, Student Four',
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
      evidenceQuote: `Undergraduates ${'q'.repeat(2000)}`,
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
      evidenceQuote: 'Email fixture.pi@yale.edu to discuss undergraduate research.',
      evidenceSource: 'explicit_text',
      joinPageUrl: 'https://x.example/join',
      undergradRoleQuote: '',
      contactInstructionsQuote: 'Call 203-432-1234 or email fixture.contact@yale.edu.',
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
      'Email fixture.pi@yale.edu to discuss undergraduate research.',
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

  it('drops generated faculty research-area pages from lab microsite access extraction', () => {
    const out = selectLabsToProcess(
      [
        {
          _id: 'faculty-1',
          slug: 'faculty-research-area-profile-only',
          name: 'Profile Only Research',
          websiteUrl: 'https://medicine.yale.edu/profile/example/',
        },
        {
          _id: 'lab-1',
          slug: 'ysm-example',
          name: 'Example Lab',
          websiteUrl: 'https://medicine.yale.edu/lab/example/',
        },
      ],
      {},
    );

    expect(out.map((l) => l.slug)).toEqual(['ysm-example']);
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

  it('does not use the YSM lab websites index as a candidate lab website fallback', () => {
    expect(
      candidateLabFromResearchEntityDoc({
        _id: 'entity-3',
        slug: 'real-lab-from-source-url',
        name: 'Real Lab From Source URL',
        websiteUrl: '',
        sourceUrls: [
          'https://medicine.yale.edu/about/a-to-z-index/atoz/lab-websites/',
          'https://medicine.yale.edu/lab/fixture-access/',
        ],
      }),
    ).toMatchObject({
      slug: 'real-lab-from-source-url',
      websiteUrl: 'https://medicine.yale.edu/lab/fixture-access/',
    });
  });

  it('does not use the Yale glassblowing service as a candidate lab website fallback', () => {
    expect(
      candidateLabFromResearchEntityDoc({
        _id: 'entity-4',
        slug: 'bad-service-link',
        name: 'Bad Service Link Lab',
        websiteUrl: 'https://glassshop.yale.edu/',
        sourceUrls: ['https://glassshop.yale.edu/', 'https://real-lab.example.edu/'],
      }),
    ).toMatchObject({
      slug: 'bad-service-link',
      websiteUrl: 'https://real-lab.example.edu/',
    });
  });

  it('uses active listing guidance to fill missing candidate websites', () => {
    const candidates: CandidateLab[] = [
      {
        _id: 'entity-1',
        slug: 'listing-backed',
        name: 'Listing Backed',
        websiteUrl: '',
      },
      {
        _id: 'entity-2',
        slug: 'canonical-site',
        name: 'Canonical Site',
        websiteUrl: 'https://canonical.example.edu/',
      },
    ];
    const guidance: ListingGuidance[] = [
      {
        researchEntityId: 'entity-1',
        activeListingCount: 2,
        websiteUrls: [
          'mailto:skip@example.edu',
          'https://legacy-listing.example.edu/profile',
        ],
      },
      {
        researchEntityId: 'entity-2',
        activeListingCount: 1,
        websiteUrls: ['https://listing.example.edu/fallback'],
      },
    ];

    expect(applyListingGuidanceToCandidateLabs(candidates, guidance)).toEqual([
      {
        _id: 'entity-1',
        slug: 'listing-backed',
        name: 'Listing Backed',
        websiteUrl: 'https://legacy-listing.example.edu/profile',
        activeListingCount: 2,
        listingBacked: true,
        listingWebsiteUrls: ['https://legacy-listing.example.edu/profile'],
      },
      {
        _id: 'entity-2',
        slug: 'canonical-site',
        name: 'Canonical Site',
        websiteUrl: 'https://canonical.example.edu/',
        activeListingCount: 1,
        listingBacked: true,
        listingWebsiteUrls: ['https://listing.example.edu/fallback'],
      },
    ]);
  });

  it('prioritizes listing-backed labs before applying the LLM limit', () => {
    const out = selectLabsToProcess(
      [
        {
          _id: '1',
          slug: 'generic-lab',
          name: 'Generic Lab',
          websiteUrl: 'https://generic.example.edu/',
        },
        {
          _id: '2',
          slug: 'listing-backed-a',
          name: 'Listing Backed A',
          websiteUrl: 'https://listing-a.example.edu/',
          activeListingCount: 1,
          listingBacked: true,
        },
        {
          _id: '3',
          slug: 'listing-backed-b',
          name: 'Listing Backed B',
          websiteUrl: 'https://listing-b.example.edu/',
          activeListingCount: 3,
          listingBacked: true,
        },
      ],
      { limit: 2 },
    );

    expect(out.map((lab) => lab.slug)).toEqual(['listing-backed-b', 'listing-backed-a']);
  });
});

// ---------------------------------------------------------------------------
// Full-run integration with mocked fetchPage + callLLM + labFinder
// ---------------------------------------------------------------------------

const HOME_HTML = `
<html><body>
  <h1>The Fixture Access Lab</h1>
  <p>We welcome undergraduate researchers each semester.</p>
  <a href="/people">Lab Members</a>
</body></html>
`;

const PEOPLE_HTML = `
<html><body>
  <h2>Members</h2>
  <h3>Undergraduates</h3>
  <ul><li>Student One</li><li>Student Two</li><li>Student Three</li></ul>
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
      'https://fixture-access.example.com/': HOME_HTML,
      'https://fixture-access.example.com/people': PEOPLE_HTML,
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
        slug: 'fixture-access-lab',
        name: 'The Fixture Access Lab',
        websiteUrl: 'https://fixture-access.example.com/',
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
    expect(fetchPage).toHaveBeenCalledWith('https://fixture-access.example.com/');
    expect(fetchPage).toHaveBeenCalledWith('https://fixture-access.example.com/people');
    expect(callLLM).toHaveBeenCalledTimes(1);

    // The system prompt and user prompt include the sub-page text.
    const llmInput = callLLM.mock.calls[0][0];
    expect(llmInput.userPrompt).toContain('We welcome undergraduate researchers');
    expect(llmInput.userPrompt).toContain('SUB-PAGE TEXT');
    expect(llmInput.userPrompt).toContain('Student One');

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
        'sourceUrls',
        'undergradAccessEvidence',
        'undergradEvidenceQuote',
      ].sort(),
    );
    const accepting = emitted.find((o) => o.field === 'acceptingUndergrads');
    expect(accepting!.value).toBe(true);
    expect(accepting!.confidenceOverride).toBe(0.5);
    expect(accepting!.entityKey).toBe('fixture-access-lab');
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
      'https://fixture-access.example.com/': `
        <html><body>
          <h1>The Fixture Access Lab</h1>
          <a href="/people">People</a>
          <a href="/join">Join Us</a>
        </body></html>
      `,
      'https://fixture-access.example.com/people': '<html><body>Current students</body></html>',
      'https://fixture-access.example.com/join':
        '<html><body>Undergraduates help collect data each summer.</body></html>',
    });
    const callLLM = vi.fn(async () => ({
      openToUndergrads: 'yes',
      currentUndergradCount: 0,
      evidenceQuote: 'Undergraduates help collect data each summer.',
      evidenceSource: 'explicit_text',
      joinPageUrl: 'https://fixture-access.example.com/join',
    } satisfies LLMExtraction));
    const scraper = newTestScraper({
      fetchPage,
      callLLM,
      labFinder: async () => [
        {
          _id: '1',
          slug: 'fixture-access-lab',
          name: 'The Fixture Access Lab',
          websiteUrl: 'https://fixture-access.example.com/',
        },
      ],
      apiKey: 'sk-test',
    });
    const { ctx, emitted } = makeContext();
    await scraper.run(ctx);

    expect(fetchPage).toHaveBeenCalledWith('https://fixture-access.example.com/people');
    expect(fetchPage).toHaveBeenCalledWith('https://fixture-access.example.com/join');
    const prompt = (callLLM.mock.calls as unknown as Array<[{ userPrompt: string }]>)[0][0]
      .userPrompt;
    expect(prompt).toContain('SUB-PAGE TEXT (https://fixture-access.example.com/people)');
    expect(prompt).toContain('SUB-PAGE TEXT (https://fixture-access.example.com/join)');
    const evidence = emitted.find((o) => o.field === 'undergradAccessEvidence');
    expect(evidence!.sourceUrl).toBe('https://fixture-access.example.com/join');
    expect(evidence!.value).toMatchObject({
      sourceUrls: [
        'https://fixture-access.example.com/',
        'https://fixture-access.example.com/people',
        'https://fixture-access.example.com/join',
      ],
      quoteSourceUrl: 'https://fixture-access.example.com/join',
    });
    expect(emitted.find((o) => o.field === 'undergradEvidenceQuote')!.sourceUrl).toBe(
      'https://fixture-access.example.com/join',
    );
  });

  it('rejects unsupported LLM evidence quotes instead of treating the home page as source-backed', async () => {
    const fetchPage = makeFetchPage({
      'https://unsupported.example.com/': `
        <html><body>
          <h1>Unsupported Lab</h1>
          <p>Our group studies cellular signaling, imaging, and computational models.</p>
        </body></html>
      `,
    });
    const callLLM = vi.fn(async () => ({
      openToUndergrads: 'yes',
      currentUndergradCount: 0,
      evidenceQuote: 'Undergraduates lead independent projects every summer.',
      evidenceSource: 'explicit_text',
      joinPageUrl: null,
    } satisfies LLMExtraction));
    const scraper = newTestScraper({
      fetchPage,
      callLLM,
      labFinder: async () => [
        {
          _id: '1',
          slug: 'unsupported-lab',
          name: 'Unsupported Lab',
          websiteUrl: 'https://unsupported.example.com/',
        },
      ],
      apiKey: 'sk-test',
    });
    const { ctx, emitted } = makeContext();
    const result = await scraper.run(ctx);

    expect(emitted.find((o) => o.field === 'undergradAccessEvidence')).toBeUndefined();
    expect(emitted.find((o) => o.field === 'acceptingUndergrads')).toBeUndefined();
    expect(emitted.find((o) => o.field === 'undergradEvidenceQuote')).toBeUndefined();
    expect((result.metrics as any)?.undergradLlmReviewSamples).toEqual([
      expect.objectContaining({
        slug: 'unsupported-lab',
        sourceUrl: 'https://unsupported.example.com/',
        quote: '',
        verdict: 'unclear',
        evidenceSource: 'none',
        decision: 'rejected',
        rejectionReasons: ['unsupported_evidence_quote'],
      }),
    ]);
  });

  it('reports normalized unclear verdicts in dry-run review samples', async () => {
    const fetchPage = makeFetchPage({
      'https://unclear.example.com/': `
        <html><body>
          <h1>Unclear Lab</h1>
          <p>We always welcome collaboration and look for students and fellows interested in working with us.</p>
        </body></html>
      `,
    });
    const callLLM = vi.fn(async () => ({
      openToUndergrads: 'unclear',
      currentUndergradCount: 0,
      evidenceQuote:
        'We always welcome collaboration and look for students and fellows interested in working with us.',
      evidenceSource: 'explicit_text',
      joinPageUrl: null,
    } satisfies LLMExtraction));
    const scraper = newTestScraper({
      fetchPage,
      callLLM,
      labFinder: async () => [
        {
          _id: '1',
          slug: 'unclear-lab',
          name: 'Unclear Lab',
          websiteUrl: 'https://unclear.example.com/',
        },
      ],
      apiKey: 'sk-test',
    });
    const { ctx, emitted } = makeContext();
    const result = await scraper.run(ctx);

    expect(emitted.find((o) => o.field === 'undergradEvidenceQuote')).toBeUndefined();
    expect((result.metrics as any)?.undergradLlmReviewSamples).toEqual([
      expect.objectContaining({
        slug: 'unclear-lab',
        quote: '',
        verdict: 'unclear',
        evidenceSource: 'none',
        decision: 'accepted',
      }),
    ]);
  });

  it('does not keep a negative verdict when the only hard negative quote is unsupported', async () => {
    const fetchPage = makeFetchPage({
      'https://fixture-negative.example.com/': `
        <html><body>
          <h1>Fixture Negative Lab</h1>
          <p>Currently, I am a graduate student in Professor Fixture Mentor's lab, where I am studying arrhythmias using iPSC-derived engineered heart tissues.</p>
        </body></html>
      `,
    });
    const callLLM = vi.fn(async () => ({
      openToUndergrads: 'no',
      currentUndergradCount: 0,
      evidenceQuote:
        "Currently, I am a graduate student in Professor Fixture Mentor's lab, where I am studying arrhythmias using iPSC-derived engineered heart tissues.",
      evidenceSource: 'explicit_text',
      joinPageUrl: null,
      explicitConstraintQuote: 'We do not accept undergraduate students.',
    } satisfies LLMExtraction));
    const scraper = newTestScraper({
      fetchPage,
      callLLM,
      labFinder: async () => [
        {
          _id: '1',
          slug: 'fixture-negative-lab',
          name: 'Fixture Negative Lab',
          websiteUrl: 'https://fixture-negative.example.com/',
        },
      ],
      apiKey: 'sk-test',
    });
    const { ctx, emitted } = makeContext();
    const result = await scraper.run(ctx);

    expect(emitted.find((o) => o.field === 'undergradAccessEvidence')).toBeUndefined();
    expect(emitted.find((o) => o.field === 'acceptingUndergrads')).toBeUndefined();
    expect(emitted.find((o) => o.field === 'undergradEvidenceQuote')).toBeUndefined();
    expect((result.metrics as any)?.undergradLlmReviewSamples).toEqual([
      expect.objectContaining({
        slug: 'fixture-negative-lab',
        quote: '',
        verdict: 'unclear',
        evidenceSource: 'none',
        decision: 'accepted',
        rejectionReasons: ['unsupported_explicit_constraint_quote'],
      }),
    ]);
  });

  it('drops unsupported external joinPageUrl values while keeping source-backed access evidence', async () => {
    const fetchPage = makeFetchPage({
      'https://fixture-access.example.com/': `
        <html><body>
          <h1>Fixture Access Lab</h1>
          <p>We welcome undergraduate researchers each semester.</p>
        </body></html>
      `,
    });
    const callLLM = vi.fn(async () => ({
      openToUndergrads: 'yes',
      currentUndergradCount: 0,
      evidenceQuote: 'We welcome undergraduate researchers each semester.',
      evidenceSource: 'explicit_text',
      joinPageUrl: 'https://forms.example.com/fixture-access-lab-application',
    } satisfies LLMExtraction));
    const scraper = newTestScraper({
      fetchPage,
      callLLM,
      labFinder: async () => [
        {
          _id: '1',
          slug: 'fixture-access-lab',
          name: 'Fixture Access Lab',
          websiteUrl: 'https://fixture-access.example.com/',
        },
      ],
      apiKey: 'sk-test',
    });
    const { ctx, emitted } = makeContext();
    const result = await scraper.run(ctx);

    expect(emitted.find((o) => o.field === 'undergradAccessEvidence')).toBeDefined();
    expect(emitted.find((o) => o.field === 'joinPageUrl')).toBeUndefined();
    expect(
      emitted.some((o) => o.value === 'https://forms.example.com/fixture-access-lab-application'),
    ).toBe(false);
    expect((result.metrics as any)?.undergradLlmReviewSamples).toEqual([
      expect.objectContaining({
        slug: 'fixture-access-lab',
        quote: 'We welcome undergraduate researchers each semester.',
        verdict: 'yes',
        decision: 'accepted',
        rejectionReasons: ['unsupported_join_page_url'],
      }),
    ]);
  });

  it('allows unfetched joinPageUrl values when they stay inside the official microsite path', async () => {
    const fetchPage = makeFetchPage({
      'https://medicine.yale.edu/lab/fixture-access/': `
        <html><body>
          <h1>Fixture Access Lab</h1>
          <p>We welcome undergraduate researchers each semester.</p>
        </body></html>
      `,
    });
    const callLLM = vi.fn(async () => ({
      openToUndergrads: 'yes',
      currentUndergradCount: 0,
      evidenceQuote: 'We welcome undergraduate researchers each semester.',
      evidenceSource: 'explicit_text',
      joinPageUrl: 'https://medicine.yale.edu/lab/fixture-access/join-us',
    } satisfies LLMExtraction));
    const scraper = newTestScraper({
      fetchPage,
      callLLM,
      labFinder: async () => [
        {
          _id: '1',
          slug: 'fixture-access-lab',
          name: 'Fixture Access Lab',
          websiteUrl: 'https://medicine.yale.edu/lab/fixture-access/',
        },
      ],
      apiKey: 'sk-test',
    });
    const { ctx, emitted } = makeContext();
    await scraper.run(ctx);

    expect(emitted.find((o) => o.field === 'joinPageUrl')!.value).toBe(
      'https://medicine.yale.edu/lab/fixture-access/join-us',
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
      evidenceQuote: 'We welcome undergraduate researchers each semester.',
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

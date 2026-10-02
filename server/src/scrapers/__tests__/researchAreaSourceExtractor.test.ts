import { describe, expect, it } from 'vitest';
import {
  ResearchAreaSourceExtractor,
  candidateAreaEntitiesFromDocs,
  candidateAreaUrlsForDoc,
  deriveCanonicalResearchAreasFromPage,
  extractLabeledResearchAreaItems,
  isRejectedAreaSourceUrl,
  isSharedAreaFilteredDirectoryUrl,
  researchAreaObservationsFromExtraction,
  type CandidateAreaEntity,
  type FetchedAreaPage,
} from '../sources/researchAreaSourceExtractor';
import {
  buildResearchAreaResolverIndex,
  createResearchAreaCanonicalizer,
  type ResearchAreaCanonicalizer,
} from '../researchAreaCanonicalization';
import type { ObservationInput, ScraperContext } from '../types';

const approvedRows = [
  { name: 'Neuroscience' },
  { name: 'Immunology' },
  { name: 'Machine Learning' },
  { name: 'Cancer Biology' },
  { name: 'Genomics' },
  { name: 'History' },
  { name: 'Psychology' },
  { name: 'Social Media' },
];

const canonicalizer: ResearchAreaCanonicalizer = createResearchAreaCanonicalizer(
  buildResearchAreaResolverIndex(approvedRows),
);

function makeContext(options: Partial<ScraperContext['options']> = {}): {
  ctx: ScraperContext;
  emitted: ObservationInput[];
  logs: string[];
} {
  const emitted: ObservationInput[] = [];
  const logs: string[] = [];
  return {
    emitted,
    logs,
    ctx: {
      scrapeRunId: 'test-run',
      sourceId: 'source-1',
      sourceName: 'research-area-source-extractor',
      sourceWeight: 0.65,
      options: {
        dryRun: true,
        useCache: false,
        release: false,
        limit: 10,
        ignoreWorkPlanner: true,
        ...options,
      },
      emit: async (obs) => {
        emitted.push(...(Array.isArray(obs) ? obs : [obs]));
      },
      log: (msg) => logs.push(msg),
    },
  };
}

describe('isRejectedAreaSourceUrl', () => {
  it('rejects non-http, grant, and identifier hosts but accepts official pages', () => {
    expect(isRejectedAreaSourceUrl('mailto:someone@example.edu')).toBe(true);
    expect(isRejectedAreaSourceUrl('https://reporter.nih.gov/project/1')).toBe(true);
    expect(isRejectedAreaSourceUrl('https://orcid.org/0000-0000-0000-0000')).toBe(true);
    expect(isRejectedAreaSourceUrl('https://scholar.google.com/citations?user=x')).toBe(true);
    expect(isRejectedAreaSourceUrl('https://example-lab.org/research/')).toBe(false);
  });

  it('rejects a shared directory/listing page a per-entity graft can bleed from (#1580)', () => {
    expect(
      isRejectedAreaSourceUrl('https://research.yale.edu/cores?f%5B0%5D=result_type%3A1'),
    ).toBe(true);
    expect(isRejectedAreaSourceUrl('https://research.yale.edu/centers-institutes')).toBe(true);
    expect(isRejectedAreaSourceUrl('https://example.edu/people/faculty')).toBe(true);
  });
});

describe('candidateAreaUrlsForDoc and candidateAreaEntitiesFromDocs', () => {
  it('ranks research/lab pages ahead of profile and people pages', () => {
    expect(
      candidateAreaUrlsForDoc({
        websiteUrl: 'https://example.edu/people/jordan',
        sourceUrls: ['https://example.edu/research/lab', 'https://example.edu/profile/jordan'],
      }),
    ).toEqual([
      'https://example.edu/research/lab',
      'https://example.edu/profile/jordan',
      'https://example.edu/people/jordan',
    ]);
  });

  it('only surfaces entities with empty research areas and a usable url', () => {
    const candidates = candidateAreaEntitiesFromDocs([
      {
        _id: 'a',
        slug: 'empty-lab',
        websiteUrl: 'https://example.edu/research/a',
        researchAreas: [],
      },
      {
        _id: 'b',
        slug: 'already-has-areas',
        websiteUrl: 'https://example.edu/research/b',
        researchAreas: ['Neuroscience'],
      },
      { _id: 'c', slug: 'no-url', researchAreas: [] },
      { _id: 'd', slug: 'grant-only', websiteUrl: 'https://reporter.nih.gov/x', researchAreas: [] },
    ]);
    expect(candidates.map((candidate) => candidate.slug)).toEqual(['empty-lab']);
  });

  it('admits a non-empty row only when the evidence-backed set is supplied and omits it', () => {
    const docs = [
      {
        _id: 'f',
        slug: 'unbacked-areas',
        websiteUrl: 'https://example.edu/research/f',
        researchAreas: ['Neuroscience'],
      },
      {
        _id: 'g',
        slug: 'backed-areas',
        websiteUrl: 'https://example.edu/research/g',
        researchAreas: ['Neuroscience'],
      },
      {
        _id: 'h',
        slug: 'locked-areas',
        websiteUrl: 'https://example.edu/research/h',
        researchAreas: ['Neuroscience'],
        manuallyLockedFields: ['researchAreas'],
      },
    ];
    expect(candidateAreaEntitiesFromDocs(docs).map((candidate) => candidate.slug)).toEqual([]);
    expect(
      candidateAreaEntitiesFromDocs(docs, { evidenceBackedRowIds: new Set(['g']) }).map(
        (candidate) => candidate.slug,
      ),
    ).toEqual(['unbacked-areas']);
  });

  it('keeps admitting an empty-area row whatever its locks, as before the widening', () => {
    const candidates = candidateAreaEntitiesFromDocs([
      {
        _id: 'i',
        slug: 'locked-empty',
        websiteUrl: 'https://example.edu/research/i',
        researchAreas: [],
        manuallyLockedFields: ['researchAreas'],
      },
    ]);
    expect(candidates.map((candidate) => candidate.slug)).toEqual(['locked-empty']);
  });

  it('treats whitespace-only stored areas as empty', () => {
    const candidates = candidateAreaEntitiesFromDocs([
      {
        _id: 'e',
        slug: 'blank-area',
        websiteUrl: 'https://example.edu/research/e',
        researchAreas: ['  '],
      },
    ]);
    expect(candidates.map((candidate) => candidate.slug)).toEqual(['blank-area']);
  });
});

describe('shared area-filtered directory pages (#4030)', () => {
  const areaPage = 'https://school.example.edu/faculty-research/faculty-directory/finance';
  const ownProfile = 'https://school.example.edu/faculty-research/faculty-directory/ada-fixture';
  const citers = new Map([
    ['https://school.example.edu/faculty-research/faculty-directory/finance', 9],
    ['https://school.example.edu/faculty-research/faculty-directory/ada-fixture', 3],
    ['https://school.example.edu/faculty-research/faculty-directory/marketing', 2],
  ]);
  const row = { slug: 'faculty-ada-fixture', name: 'Ada Fixture' };

  it('refuses a directory leaf that three or more rows cite and that does not name the row', () => {
    expect(isSharedAreaFilteredDirectoryUrl(areaPage, row, citers)).toBe(true);
  });

  it('keeps the row its own directory profile even when several rows cite it', () => {
    expect(isSharedAreaFilteredDirectoryUrl(ownProfile, row, citers)).toBe(false);
  });

  it('keeps a directory leaf fewer than three rows cite', () => {
    expect(
      isSharedAreaFilteredDirectoryUrl(
        'https://school.example.edu/faculty-research/faculty-directory/marketing',
        row,
        citers,
      ),
    ).toBe(false);
  });

  it('drops the shared directory page from the candidate urls and records the refusal', () => {
    const doc = {
      _id: 'j',
      slug: 'faculty-ada-fixture',
      name: 'Ada Fixture',
      websiteUrl: areaPage,
      sourceUrls: [ownProfile],
      researchAreas: [],
    };
    expect(candidateAreaUrlsForDoc(doc, citers)).toEqual([ownProfile]);
    const [candidate] = candidateAreaEntitiesFromDocs([doc], { citerCounts: citers });
    expect(candidate.sourceUrls).toEqual([ownProfile]);
    expect(candidate.refusedSharedDirectoryUrls).toEqual([areaPage]);
  });

  it('refuses nothing when no citer counts are supplied', () => {
    expect(candidateAreaUrlsForDoc({ websiteUrl: areaPage })).toEqual([areaPage]);
  });
});

describe('extractLabeledResearchAreaItems', () => {
  it('reads a heading followed by a list', () => {
    const html = `
      <section>
        <h3>Research Areas</h3>
        <ul><li>Immunology</li><li>Cancer Biology</li></ul>
      </section>`;
    expect(extractLabeledResearchAreaItems(html)).toEqual(['Immunology', 'Cancer Biology']);
  });

  it('reads a definition list and an inline label', () => {
    const dl = '<dl><dt>Research Interests</dt><dd>Neuroscience; Genomics</dd></dl>';
    expect(extractLabeledResearchAreaItems(dl)).toEqual(['Neuroscience', 'Genomics']);
    const inline = '<p>Areas of Expertise: Machine Learning, Immunology</p>';
    expect(extractLabeledResearchAreaItems(inline)).toEqual(['Machine Learning', 'Immunology']);
  });

  it('returns nothing when no research-area label is present', () => {
    expect(
      extractLabeledResearchAreaItems('<h2>Recent News</h2><p>We hosted a seminar.</p>'),
    ).toEqual([]);
  });
});

describe('deriveCanonicalResearchAreasFromPage', () => {
  it('recovers approved areas from labeled items and prose, deduped', () => {
    const html = `
      <h3>Research Interests</h3>
      <ul><li>Immunology</li><li>Underwater Basket Weaving</li></ul>
      <p>Our lab studies neuroscience and machine learning approaches to disease.</p>`;
    const result = deriveCanonicalResearchAreasFromPage(canonicalizer, html);
    expect(result.labeledBacked).toBe(true);
    expect(result.areas).toEqual(
      expect.arrayContaining(['Immunology', 'Neuroscience', 'Machine Learning']),
    );
    expect(result.areas).not.toContain('Underwater Basket Weaving');
  });

  it('is fail-closed: emits nothing when the page has no approved-area signal', () => {
    const html = '<h3>Research Interests</h3><ul><li>Quantum Basket Weaving</li></ul>';
    expect(deriveCanonicalResearchAreasFromPage(canonicalizer, html)).toEqual({
      areas: [],
      labeledBacked: false,
    });
  });

  it('ignores an in-body social-follow block and a social-links label (#4047)', () => {
    const html = `
      <h1>Example Institute</h1>
      <p>The institute studies neuroscience.</p>
      <div class="quick-links">
        <h2 class="quick-links__heading">Follow us on social media</h2>
        <p>Keep up to date and tag us on social media</p>
        <a href="https://x.com/example">X</a>
        <a href="https://www.instagram.com/example">Instagram</a>
      </div>
      <dl>
        <dt class="profile-detail__social"><p class="h6">Social media</p></dt>
        <dd><a href="https://www.linkedin.com/in/example">LinkedIn</a></dd>
      </dl>`;
    const result = deriveCanonicalResearchAreasFromPage(canonicalizer, html);
    expect(result.areas).toEqual(['Neuroscience']);
  });

  it('ignores a follow call whose platform links sit in a sibling container (#4047)', () => {
    const html = `
      <p>The institute studies genomics.</p>
      <div class="quick-links">
        <div class="quick-links__text">
          <h2 class="quick-links__heading">Follow us on social media</h2>
          <p class="quick-links__description">Keep up to date and tag us on social media</p>
        </div>
        <ul class="quick-links__list">
          <li><a href="https://x.com/example">X</a></li>
          <li><a href="https://www.linkedin.com/company/example">LinkedIn</a></li>
        </ul>
      </div>`;
    expect(deriveCanonicalResearchAreasFromPage(canonicalizer, html).areas).toEqual(['Genomics']);
  });

  it('keeps a social-media topic the page itself declares or studies (#4047)', () => {
    const labeled = `
      <h3>Expertise</h3>
      <ul><li>Social Media</li><li>Psychology</li></ul>
      <a href="https://x.com/example">X</a>`;
    expect(deriveCanonicalResearchAreasFromPage(canonicalizer, labeled).areas).toEqual(
      expect.arrayContaining(['Social Media', 'Psychology']),
    );
    const prose = '<p>Her research examines how social media shapes adolescent psychology.</p>';
    expect(deriveCanonicalResearchAreasFromPage(canonicalizer, prose).areas).toEqual(
      expect.arrayContaining(['Social Media', 'Psychology']),
    );
  });

  it('still reads a talk title that only links to a video platform (#4047)', () => {
    const html = `
      <ul class="related-links">
        <li><a href="https://www.youtube.com/watch?v=example">Machine learning methods in modern genomics</a></li>
      </ul>`;
    expect(deriveCanonicalResearchAreasFromPage(canonicalizer, html).areas).toEqual(
      expect.arrayContaining(['Machine Learning', 'Genomics']),
    );
    const shortTitle = `
      <ul><li><a href="https://www.youtube.com/watch?v=example">Machine Learning in Genomics</a></li></ul>`;
    expect(deriveCanonicalResearchAreasFromPage(canonicalizer, shortTitle).areas).toEqual(
      expect.arrayContaining(['Machine Learning', 'Genomics']),
    );
    const platformWordTitles = `
      <ul>
        <li><a href="https://vimeo.com/example">X-ray views of genomics</a></li>
        <li><a href="https://www.youtube.com/watch?v=example">Machine learning on YouTube</a></li>
      </ul>`;
    expect(deriveCanonicalResearchAreasFromPage(canonicalizer, platformWordTitles).areas).toEqual(
      expect.arrayContaining(['Machine Learning', 'Genomics']),
    );
  });

  it('keeps a topic section headed by a social-media label that carries no follow link (#4047)', () => {
    const html = `
      <div><h3>Social Media</h3><p>We study misinformation and polarization on social media platforms.</p></div>
      <div><h3 class="card__title">Social</h3><p>We study the psychology of intergroup relations.</p></div>`;
    expect(deriveCanonicalResearchAreasFromPage(canonicalizer, html).areas).toEqual(
      expect.arrayContaining(['Social Media', 'Psychology']),
    );
  });

  it('keeps a short topic line that sits beside icon-only social links (#4047)', () => {
    const html = `
      <div class="profile-hero">
        <p>Studies cancer genomics</p>
        <a href="https://www.linkedin.com/in/example" aria-label="LinkedIn"><svg></svg></a>
      </div>`;
    expect(deriveCanonicalResearchAreasFromPage(canonicalizer, html).areas).toEqual(['Genomics']);
  });

  it('ignores a CSS-hidden global mega-menu panel rendered outside a nav tag', () => {
    const html = `
      <div class="base-header__navigation-panel">
        <div class="navigation-panel__wrapper navigation-panel__wrapper--hidden">
          <nav class="navigation-panel__top-container" aria-label="Navigation Panel"></nav>
          <ul>
            <li><a href="/education">Neuroscience Symposium</a></li>
          </ul>
        </div>
      </div>
      <p>Dr. Jones is a clinical oncologist focused on cancer biology and genomics.</p>`;
    const result = deriveCanonicalResearchAreasFromPage(canonicalizer, html);
    expect(result.areas).toEqual(expect.arrayContaining(['Cancer Biology', 'Genomics']));
    expect(result.areas).not.toContain('Neuroscience');
  });

  it('ignores a dated news teaser naming a topic the page is not about (#2734)', () => {
    const html = `
      <h1>Central Asia Initiative</h1>
      <p>The initiative supports interdisciplinary study of the region's history and politics.</p>
      <div class="view view--block-latest">
        <div class="view__rows">
          <div class="view__row view__row--1">
            <article class="node-teaser node-teaser--story">
              <header class="node-teaser__header">
                <a href="/news/love-in-the-time-of-ai">
                  <div class="node-teaser__heading">
                    <span>Love in the Time of AI: What Translation, Poetry, and Machine Learning
                    Teach Us About Human Connection</span>
                  </div>
                </a>
              </header>
            </article>
          </div>
        </div>
      </div>`;
    const result = deriveCanonicalResearchAreasFromPage(canonicalizer, html);
    expect(result.areas).not.toContain('Machine Learning');
    expect(result.labeledBacked).toBe(false);
  });

  it('ignores another subject named on a shared directory result row (#2734)', () => {
    const html = `
      <div class="view__content">
        <div class="view__row view__row--45">
          <article class="node-teaser node-teaser--faculty">
            <div class="node-teaser__content">
              <ul class="node-teaser__expertise">
                <li>Immunology</li>
                <li>Genomics</li>
              </ul>
            </div>
          </article>
        </div>
      </div>
      <div class="contact-section__listing-item">
        <span>Professor of Medicine and of Neuroscience</span>
      </div>
      <p>Our group studies cancer biology in solid tumors.</p>`;
    const result = deriveCanonicalResearchAreasFromPage(canonicalizer, html);
    expect(result.areas).toEqual(['Cancer Biology']);
  });

  it('keeps a labeled research-area section that is not a listing item (#2734)', () => {
    const html = `
      <main>
        <h3>Research Interests</h3>
        <ul>
          <li>Immunology</li>
          <li>Genomics</li>
        </ul>
      </main>`;
    const result = deriveCanonicalResearchAreasFromPage(canonicalizer, html);
    expect(result.areas).toEqual(expect.arrayContaining(['Immunology', 'Genomics']));
    expect(result.labeledBacked).toBe(true);
  });

  it('recovers an ambiguous single-word area from a labeled item but not from bare prose', () => {
    const labeled = deriveCanonicalResearchAreasFromPage(
      canonicalizer,
      '<h3>Research Areas</h3><ul><li>History</li></ul>',
    );
    expect(labeled.areas).toContain('History');

    const prose = deriveCanonicalResearchAreasFromPage(
      canonicalizer,
      '<p>The group has a long history of collaboration across campus.</p>',
    );
    expect(prose.areas).not.toContain('History');
  });
});

describe('researchAreaObservationsFromExtraction', () => {
  it('emits a single researchAreas observation with labeled-backed confidence', () => {
    const observations = researchAreaObservationsFromExtraction(
      { areas: ['Immunology', 'Neuroscience'], labeledBacked: true },
      { entityId: 'entity-1', entityKey: 'lab-1', sourceUrl: 'https://example.edu/research/' },
    );
    expect(observations).toEqual([
      {
        entityType: 'researchEntity',
        entityId: 'entity-1',
        entityKey: 'lab-1',
        sourceUrl: 'https://example.edu/research/',
        field: 'researchAreas',
        value: ['Immunology', 'Neuroscience'],
        confidenceOverride: 0.72,
      },
    ]);
  });

  it('uses a lower confidence for prose-only recovery and emits nothing when empty', () => {
    expect(
      researchAreaObservationsFromExtraction(
        { areas: ['Neuroscience'], labeledBacked: false },
        { sourceUrl: 'https://example.edu/research/' },
      )[0].confidenceOverride,
    ).toBe(0.6);
    expect(
      researchAreaObservationsFromExtraction(
        { areas: [], labeledBacked: false },
        { sourceUrl: 'https://example.edu/research/' },
      ),
    ).toEqual([]);
  });

  it('drops observations sourced from a rejected url', () => {
    expect(
      researchAreaObservationsFromExtraction(
        { areas: ['Neuroscience'], labeledBacked: true },
        { sourceUrl: 'https://reporter.nih.gov/project/1' },
      ),
    ).toEqual([]);
  });
});

describe('ResearchAreaSourceExtractor.run', () => {
  const entity: CandidateAreaEntity = {
    _id: 'entity-1',
    slug: 'synthetic-lab',
    name: 'Synthetic Lab',
    websiteUrl: 'https://synthetic-lab.example.edu/research/',
    sourceUrls: ['https://synthetic-lab.example.edu/research/'],
  };

  it('emits approved areas extracted from a fetched page', async () => {
    const page: FetchedAreaPage = {
      url: 'https://synthetic-lab.example.edu/research/',
      html: '<h3>Research Areas</h3><ul><li>Immunology</li><li>Genomics</li></ul>',
    };
    const extractor = new ResearchAreaSourceExtractor({
      fetchPage: async () => page,
      canonicalizerLoader: async () => canonicalizer,
      entityFinder: async () => [entity],
    });
    const { ctx, emitted } = makeContext();
    const result = await extractor.run(ctx);

    expect(result.entitiesObserved).toBe(1);
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({
      entityType: 'researchEntity',
      entityId: 'entity-1',
      entityKey: 'synthetic-lab',
      field: 'researchAreas',
      value: ['Immunology', 'Genomics'],
    });
  });

  it('is fail-closed when no approved area is found on the page', async () => {
    const extractor = new ResearchAreaSourceExtractor({
      fetchPage: async () => ({
        url: entity.websiteUrl,
        html: '<h3>Research Areas</h3><ul><li>Fictional Studies</li></ul>',
      }),
      canonicalizerLoader: async () => canonicalizer,
      entityFinder: async () => [entity],
    });
    const { ctx, emitted } = makeContext();
    const result = await extractor.run(ctx);
    expect(result.entitiesObserved).toBe(0);
    expect(emitted).toEqual([]);
  });

  describe('areas the row itself rejects (#3836)', () => {
    const psychologyEntity: CandidateAreaEntity = { ...entity, departments: ['Psychology'] };
    const secondUrl = 'https://synthetic-lab.example.edu/research/topics/';
    const pages: Record<string, string> = {
      [entity.websiteUrl]: '<h3>Research Areas</h3><ul><li>Psychology</li><li>Pediatrics</li></ul>',
      [secondUrl]: '<h3>Research Areas</h3><ul><li>Psychology</li><li>Neuroscience</li></ul>',
    };
    const extractorFor = (candidate: CandidateAreaEntity) =>
      new ResearchAreaSourceExtractor({
        fetchPage: async (url) => ({ url, html: pages[url] ?? '' }),
        canonicalizerLoader: async () => canonicalizer,
        entityFinder: async () => [candidate],
      });

    it('asserts nothing when every area is the row own department or a division label', async () => {
      const { ctx, emitted } = makeContext();
      const result = await extractorFor(psychologyEntity).run(ctx);
      expect(result.entitiesObserved).toBe(0);
      expect(emitted).toEqual([]);
    });

    it('reads the next source instead, and keeps only the areas that survive', async () => {
      const { ctx, emitted } = makeContext();
      await extractorFor({
        ...psychologyEntity,
        sourceUrls: [entity.websiteUrl, secondUrl],
      }).run(ctx);
      expect(emitted).toHaveLength(1);
      expect(emitted[0]).toMatchObject({ sourceUrl: secondUrl, value: ['Neuroscience'] });
    });

    it('keeps a department name that is not the row own department', async () => {
      const { ctx, emitted } = makeContext();
      await extractorFor({ ...psychologyEntity, departments: ['Neuroscience'] }).run(ctx);
      expect(emitted).toHaveLength(1);
      expect(emitted[0]).toMatchObject({ value: ['Psychology'] });
    });
  });

  it('skips entities the work planner reports as fresh', async () => {
    let fetchCalls = 0;
    const extractor = new ResearchAreaSourceExtractor({
      fetchPage: async () => {
        fetchCalls += 1;
        return {
          url: entity.websiteUrl,
          html: '<h3>Research Areas</h3><ul><li>Immunology</li></ul>',
        };
      },
      canonicalizerLoader: async () => canonicalizer,
      entityFinder: async () => [entity],
      workPlanLoader: async () => ({
        entityType: 'researchEntity',
        entityId: 'entity-1',
        entityKey: 'synthetic-lab',
        sourceName: 'research-area-source-extractor',
        fields: [{ field: 'researchAreas', shouldFetch: false, reason: 'fresh' }],
        shouldFetch: false,
      }),
    });
    const { ctx, emitted } = makeContext({ ignoreWorkPlanner: false });
    await extractor.run(ctx);
    expect(fetchCalls).toBe(0);
    expect(emitted).toEqual([]);
  });
});

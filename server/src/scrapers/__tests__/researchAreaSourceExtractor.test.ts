import { describe, expect, it } from 'vitest';
import {
  ResearchAreaSourceExtractor,
  candidateAreaEntitiesFromDocs,
  candidateAreaUrlsForDoc,
  deriveCanonicalResearchAreasFromPage,
  extractLabeledResearchAreaItems,
  isRejectedAreaSourceUrl,
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
    expect(isRejectedAreaSourceUrl('https://research.yale.edu/cores?f%5B0%5D=result_type%3A1')).toBe(
      true,
    );
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

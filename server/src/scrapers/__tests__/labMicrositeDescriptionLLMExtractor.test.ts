import { describe, expect, it, vi } from 'vitest';
import {
  LabMicrositeDescriptionLLMExtractor,
  candidateDescriptionLabsFromDocs,
  descriptionExtractionToObservations,
  normalizeDescriptionLlmObjectId,
  type DescriptionExtraction,
} from '../sources/labMicrositeDescriptionLLMExtractor';
import type { ObservationInput, ScraperContext } from '../types';

function makeContext(): { ctx: ScraperContext; emitted: ObservationInput[]; logs: string[] } {
  const emitted: ObservationInput[] = [];
  const logs: string[] = [];
  return {
    emitted,
    logs,
    ctx: {
      scrapeRunId: 'test-run',
      sourceId: 'source-1',
      sourceName: 'lab-microsite-description-llm',
      sourceWeight: 0.5,
      options: {
        dryRun: true,
        useCache: false,
        release: false,
        limit: 10,
        ignoreWorkPlanner: true,
      },
      emit: async (obs) => {
        emitted.push(...(Array.isArray(obs) ? obs : [obs]));
      },
      log: (msg) => logs.push(msg),
    },
  };
}

describe('LabMicrositeDescriptionLLMExtractor', () => {
  it('normalizes description LLM ObjectIds without object-shaped coercion', () => {
    expect(normalizeDescriptionLlmObjectId(' 507f1f77bcf86cd799439011 ')).toBe(
      '507f1f77bcf86cd799439011',
    );
    expect(normalizeDescriptionLlmObjectId('abcdefghijkl')).toBeUndefined();
    expect(
      normalizeDescriptionLlmObjectId({
        toString: () => '507f1f77bcf86cd799439011',
      }),
    ).toBeUndefined();
  });

  it('builds targeted candidates from sourceUrls and visibility queue order', () => {
    const candidates = candidateDescriptionLabsFromDocs(
      [
        {
          _id: 'entity-b',
          slug: 'second-lab',
          name: 'Second Lab',
          websiteUrl: 'https://reporter.nih.gov/project-details/123',
          sourceUrls: ['https://medicine.yale.edu/lab/second/'],
        },
        {
          _id: 'entity-a',
          slug: 'first-lab',
          displayName: 'First Lab',
          website: 'https://medicine.yale.edu/profile/first-person/',
          sourceUrls: ['https://medicine.yale.edu/research/first-lab/'],
        },
      ],
      { queueOrder: ['entity-a', 'entity-b'] },
    );

    expect(candidates).toEqual([
      expect.objectContaining({
        _id: 'entity-a',
        name: 'First Lab',
        websiteUrl: 'https://medicine.yale.edu/research/first-lab/',
        sourceUrls: [
          'https://medicine.yale.edu/research/first-lab/',
          'https://medicine.yale.edu/profile/first-person/',
        ],
      }),
      expect.objectContaining({
        _id: 'entity-b',
        name: 'Second Lab',
        websiteUrl: 'https://medicine.yale.edu/lab/second/',
        sourceUrls: ['https://medicine.yale.edu/lab/second/'],
      }),
    ]);
  });

  it('prefers a non-profile entity website over older profile source URLs', () => {
    const candidates = candidateDescriptionLabsFromDocs([
      {
        _id: 'entity-drc',
        slug: 'nih-pi-gray-metabolism-fixture',
        displayName: 'Diabetes Research Center',
        websiteUrl: 'https://medicine.yale.edu/internal-medicine/drc/',
        sourceUrls: [
          'https://medicine.yale.edu/profile/gray-metabolism-fixture/',
          'https://reporter.nih.gov/project-details/11252534',
        ],
      },
    ]);

    expect(candidates).toEqual([
      expect.objectContaining({
        _id: 'entity-drc',
        websiteUrl: 'https://medicine.yale.edu/internal-medicine/drc/',
      }),
    ]);
  });

  it('adds current Yale profile variants for stale department people URLs', () => {
    const candidates = candidateDescriptionLabsFromDocs([
      {
        _id: 'entity-adams',
        slug: 'adams-ja372',
        displayName: 'Jules Sociology — Research',
        sourceUrls: ['https://sociology.yale.edu/people/jules-sociology-fixture'],
      },
    ]);

    expect(candidates).toEqual([
      expect.objectContaining({
        _id: 'entity-adams',
        websiteUrl: 'https://sociology.yale.edu/profile/jules-sociology-fixture',
        sourceUrls: [
          'https://sociology.yale.edu/profile/jules-sociology-fixture',
          'https://sociology.yale.edu/people/jules-sociology-fixture',
        ],
      }),
    ]);
  });

  it('honors only and offset when running targeted extraction', async () => {
    const { ctx, emitted } = makeContext();
    ctx.options.only = ['target-lab'];
    ctx.options.offset = 1;
    ctx.options.limit = 1;
    const fetchPage = vi.fn().mockResolvedValue({
      url: 'https://medicine.yale.edu/lab/target-two/',
      html: '<main><p>The target lab studies cellular signaling, immune response, translational biomarkers, and computational modeling for patient care.</p></main>',
    });
    const scraper = new LabMicrositeDescriptionLLMExtractor({
      apiKey: 'test-key',
      labFinder: async () => [
        {
          _id: 'skip-1',
          slug: 'other-lab',
          name: 'Other Lab',
          websiteUrl: 'https://medicine.yale.edu/lab/other/',
        },
        {
          _id: 'target-1',
          slug: 'target-lab',
          name: 'Target Lab',
          websiteUrl: 'https://medicine.yale.edu/lab/target-one/',
        },
        {
          _id: 'target-2',
          slug: 'target-lab',
          name: 'Target Lab',
          websiteUrl: 'https://medicine.yale.edu/lab/target-two/',
        },
      ],
      fetchPage,
      callLLM: vi.fn().mockResolvedValue({
        fullDescription:
          'The target lab studies cellular signaling, immune response, translational biomarkers, and computational modeling for patient care.',
        shortDescription:
          'Studies cellular signaling, immune response, translational biomarkers, and computational modeling.',
        topics: [],
        methods: [],
      } satisfies DescriptionExtraction),
    });

    const result = await scraper.run(ctx);

    expect(result).toMatchObject({ observationCount: 2, entitiesObserved: 1 });
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(fetchPage).toHaveBeenCalledWith('https://medicine.yale.edu/lab/target-two/');
    expect(emitted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ entityId: 'target-2', field: 'fullDescription' }),
      ]),
    );
  });

  it('falls back to the next trusted source URL when the preferred website is unreachable', async () => {
    const { ctx, emitted, logs } = makeContext();
    ctx.options.only = ['dept-statistics-john-lafferty'];
    ctx.options.limit = 1;
    const fetchPage = vi
      .fn()
      .mockRejectedValueOnce(new Error('getaddrinfo ENOTFOUND statml.yale.edu'))
      .mockResolvedValueOnce({
        url: 'https://statistics.yale.edu/profile/john-lafferty',
        html: '<main><p>John Lafferty works on statistical machine learning, high-dimensional statistics, network models, and the foundations of data science.</p></main>',
      });
    const scraper = new LabMicrositeDescriptionLLMExtractor({
      apiKey: 'test-key',
      labFinder: async () => [
        {
          _id: 'entity-lafferty',
          slug: 'dept-statistics-john-lafferty',
          name: 'John Lafferty Faculty Research',
          websiteUrl: 'https://statml.yale.edu/',
          sourceUrls: [
            'https://statml.yale.edu/',
            'https://statistics.yale.edu/profile/john-lafferty',
          ],
        },
      ],
      fetchPage,
      callLLM: vi.fn().mockResolvedValue({
        fullDescription:
          'John Lafferty works on statistical machine learning, high-dimensional statistics, network models, and the foundations of data science.',
        shortDescription:
          'Works on statistical machine learning, high-dimensional statistics, network models, and data science foundations.',
        topics: ['Statistical machine learning'],
        methods: ['High-dimensional statistics'],
      } satisfies DescriptionExtraction),
    });

    const result = await scraper.run(ctx);

    expect(result).toMatchObject({ observationCount: 4, entitiesObserved: 1 });
    expect(fetchPage).toHaveBeenNthCalledWith(1, 'https://statml.yale.edu/');
    expect(fetchPage).toHaveBeenNthCalledWith(
      2,
      'https://statistics.yale.edu/profile/john-lafferty',
    );
    expect(logs.join('\n')).toContain('Description extraction source failed');
    expect(emitted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityId: 'entity-lafferty',
          field: 'fullDescription',
          sourceUrl: 'https://statistics.yale.edu/profile/john-lafferty',
        }),
      ]),
    );
  });

  it('rejects unsafe runtime bounds before fetching lab pages', async () => {
    for (const [option, message] of [
      [{ offset: 9007199254740992 }, /--offset must be a safe non-negative integer/],
      [{ limit: 9007199254740992 }, /--limit must be a safe positive integer/],
    ] as const) {
      const { ctx } = makeContext();
      Object.assign(ctx.options, option);
      const fetchPage = vi.fn();
      const callLLM = vi.fn();
      const scraper = new LabMicrositeDescriptionLLMExtractor({
        apiKey: 'test-key',
        labFinder: async () => [
          {
            _id: 'target-1',
            slug: 'target-lab',
            name: 'Target Lab',
            websiteUrl: 'https://medicine.yale.edu/lab/target-one/',
          },
        ],
        fetchPage,
        callLLM,
      });

      await expect(scraper.run(ctx)).rejects.toThrow(message);
      expect(fetchPage).not.toHaveBeenCalled();
      expect(callLLM).not.toHaveBeenCalled();
    }
  });

  it('skips fresh description observations through the work planner', async () => {
    const { ctx, emitted, logs } = makeContext();
    ctx.options.ignoreWorkPlanner = false;
    const fetchPage = vi.fn();
    const callLLM = vi.fn();
    const scraper = new LabMicrositeDescriptionLLMExtractor({
      apiKey: 'test-key',
      labFinder: async () => [
        {
          _id: 'fresh-1',
          slug: 'fresh-lab',
          name: 'Fresh Lab',
          websiteUrl: 'https://medicine.yale.edu/lab/fresh/',
        },
      ],
      fetchPage,
      callLLM,
      workPlanLoader: async (lab, policy) => ({
        entityType: policy.entityType,
        entityId: String(lab._id),
        entityKey: lab.slug,
        sourceName: policy.sourceName,
        shouldFetch: false,
        fields: policy.targetFields.map((field) => ({
          field,
          shouldFetch: false,
          reason: 'fresh' as const,
          lastObservedAt: '2026-06-06T00:00:00.000Z',
        })),
      }),
    });

    const result = await scraper.run(ctx);

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
    expect(fetchPage).not.toHaveBeenCalled();
    expect(callLLM).not.toHaveBeenCalled();
    expect(emitted).toEqual([]);
    expect(logs.join('\n')).toContain('skipped by WorkPlanner');
  });

  it('skips an unreachable page without aborting the remaining batch', async () => {
    const { ctx, emitted, logs } = makeContext();
    const fetchPage = vi
      .fn()
      .mockRejectedValueOnce(new Error('404 Not Found'))
      .mockResolvedValueOnce({
        url: 'https://medicine.yale.edu/lab/reachable/',
        html: '<main><p>The reachable lab studies cellular signaling, immune response, translational biomarkers, and computational modeling for patient care.</p></main>',
      });
    const callLLM = vi.fn().mockResolvedValue({
      fullDescription:
        'The reachable lab studies cellular signaling, immune response, translational biomarkers, and computational modeling for patient care.',
      shortDescription:
        'Studies cellular signaling, immune response, translational biomarkers, and computational modeling.',
      topics: [],
      methods: [],
    } satisfies DescriptionExtraction);
    const scraper = new LabMicrositeDescriptionLLMExtractor({
      apiKey: 'test-key',
      labFinder: async () => [
        {
          _id: 'unreachable-1',
          slug: 'unreachable-lab',
          name: 'Unreachable Lab',
          websiteUrl: 'https://medicine.yale.edu/lab/unreachable/',
        },
        {
          _id: 'reachable-1',
          slug: 'reachable-lab',
          name: 'Reachable Lab',
          websiteUrl: 'https://medicine.yale.edu/lab/reachable/',
        },
      ],
      fetchPage,
      callLLM,
    });

    const result = await scraper.run(ctx);

    expect(result).toMatchObject({ observationCount: 2, entitiesObserved: 1 });
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(callLLM).toHaveBeenCalledTimes(1);
    expect(emitted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ entityId: 'reachable-1', field: 'fullDescription' }),
      ]),
    );
    expect(logs.join('\n')).toContain('Skipping description extraction for Unreachable Lab');
  });

  it('emits source-backed full and short description observations without access claims', async () => {
    const { ctx, emitted } = makeContext();
    const scraper = new LabMicrositeDescriptionLLMExtractor({
      apiKey: 'test-key',
      labFinder: async () => [
        {
          _id: 'entity-1',
          slug: 'example-lab',
          name: 'Example Lab',
          websiteUrl: 'https://medicine.yale.edu/lab/example/',
          manuallyLockedFields: [],
        },
      ],
      fetchPage: vi.fn().mockResolvedValue({
        url: 'https://medicine.yale.edu/lab/example/',
        html: '<main><h1>Example Lab</h1><p>The Example Lab studies immune mechanisms, tumor biology, translational biomarkers, and computational methods for understanding treatment response.</p></main>',
      }),
      callLLM: vi.fn().mockResolvedValue({
        fullDescription:
          'The Example Lab studies immune mechanisms, tumor biology, translational biomarkers, and computational methods for understanding treatment response.',
        shortDescription:
          'Studies immune mechanisms, tumor biology, translational biomarkers, and computational treatment response methods.',
        topics: ['tumor biology'],
        methods: ['computational methods'],
      } satisfies DescriptionExtraction),
    });

    const result = await scraper.run(ctx);

    expect(result).toMatchObject({ observationCount: 4, entitiesObserved: 1 });
    expect(emitted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityType: 'researchEntity',
          entityId: 'entity-1',
          field: 'fullDescription',
          sourceUrl: 'https://medicine.yale.edu/lab/example/',
        }),
        expect.objectContaining({ field: 'shortDescription' }),
        expect.objectContaining({ field: 'researchAreas', value: ['tumor biology'] }),
        expect.objectContaining({ field: 'methods', value: ['computational methods'] }),
      ]),
    );
    expect(emitted.map((obs) => obs.field)).not.toContain('acceptingUndergrads');
    expect(emitted.map((obs) => obs.field)).not.toContain('joinPageUrl');
  });

  it('normalizes known acronym splits in emitted descriptions', () => {
    const observations = descriptionExtractionToObservations(
      {
        fullDescription:
          'The Car DS Lab studies cardiovascular care through data science and AI with clinical research methods.',
        shortDescription:
          'The Car DS Lab focuses on cardiovascular care through data science and AI.',
        topics: [],
        methods: [],
      },
      { entityKey: 'cards-lab', sourceUrl: 'https://www.cards-lab.org/' },
    );

    expect(observations.find((obs) => obs.field === 'fullDescription')?.value).toContain(
      'CarDS Lab',
    );
    expect(observations.find((obs) => obs.field === 'shortDescription')?.value).not.toContain(
      'Car DS',
    );
  });

  it('drops thin descriptions and rejected hosts', () => {
    expect(
      descriptionExtractionToObservations(
        {
          fullDescription: 'Studies cancer.',
          shortDescription: 'Cancer.',
          topics: ['cancer'],
          methods: [],
        },
        {
          entityId: 'entity-1',
          entityKey: 'thin-lab',
          sourceUrl: 'https://medicine.yale.edu/lab/thin/',
        },
      ),
    ).toEqual([]);
    expect(
      descriptionExtractionToObservations(
        {
          fullDescription:
            'The lab studies immune mechanisms, tumor biology, translational biomarkers, and computational methods for understanding treatment response.',
          shortDescription: 'Studies immune mechanisms and tumor biology.',
          topics: [],
          methods: [],
        },
        {
          entityId: 'entity-1',
          entityKey: 'grant-lab',
          sourceUrl: 'https://reporter.nih.gov/project-details/123',
        },
      ),
    ).toEqual([]);
  });

  it('derives a card-safe short description when LLM short copy is first-person', () => {
    const observations = descriptionExtractionToObservations(
      {
        fullDescription:
          'Life perpetuates through successful fertilization. We study membrane receptors, ion channels, and their downstream signaling molecules that regulate sperm motility and fertility in mammals. The lab focuses on the calcium channel CatSper and its accessory subunits to understand successful fertilization.',
        shortDescription:
          'We study membrane receptors and ion channels that regulate sperm motility and fertility in mammals, focusing on the calcium channel CatSper.',
        topics: [],
        methods: [],
      },
      {
        entityId: 'entity-chung',
        entityKey: 'nih-pi-jean-ju-chung',
        sourceUrl: 'https://www.jeanjuchunglab.org/',
      },
    );

    expect(observations.find((obs) => obs.field === 'shortDescription')).toMatchObject({
      value:
        'Studies membrane receptors and ion channels that regulate sperm motility and fertility in mammals, focusing on the calcium channel CatSper.',
    });
  });

  it('assigns higher confidence to official non-profile website descriptions', () => {
    const extraction = {
      fullDescription:
        'The center supports research in metabolic disease, diabetes, mitochondrial biology, insulin resistance, and translational medicine.',
      shortDescription:
        'The center supports research in metabolic disease, diabetes, mitochondrial biology, and insulin resistance.',
      topics: [],
      methods: [],
    };

    expect(
      descriptionExtractionToObservations(extraction, {
        entityId: 'entity-1',
        entityKey: 'diabetes-research-center',
        sourceUrl: 'https://medicine.yale.edu/internal-medicine/drc/',
      })[0],
    ).toEqual(expect.objectContaining({ confidenceOverride: 0.82 }));
    expect(
      descriptionExtractionToObservations(extraction, {
        entityId: 'entity-1',
        entityKey: 'diabetes-research-center',
        sourceUrl: 'https://medicine.yale.edu/profile/gray-metabolism-fixture/',
      })[0],
    ).toEqual(expect.objectContaining({ confidenceOverride: 0.55 }));
  });
});

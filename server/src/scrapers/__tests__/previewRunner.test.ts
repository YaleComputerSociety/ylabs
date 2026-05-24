import { describe, expect, it } from 'vitest';
import { runScraperPreview } from '../previewRunner';
import type { IScraper } from '../types';

describe('runScraperPreview', () => {
  it('captures emitted observations in memory without persisting them', async () => {
    const scraper: IScraper = {
      name: 'test-source',
      displayName: 'Test Source',
      async run(context) {
        await context.emit({
          entityType: 'researchEntity',
          entityKey: 'example-lab',
          field: 'fullDescription',
          value: 'The Example Lab studies decision making.',
          sourceUrl: 'https://example.yale.edu/lab',
        });
        return { observationCount: 1, entitiesObserved: 1 };
      },
    };

    const result = await runScraperPreview({
      scraper,
      source: {
        id: '507f1f77bcf86cd799439011',
        name: 'test-source',
        defaultWeight: 0.55,
      },
      options: {
        dryRun: true,
        useCache: false,
        release: false,
        only: ['example-lab'],
        ignoreWorkPlanner: true,
      },
    });

    expect(result.observations).toEqual([
      {
        entityType: 'researchEntity',
        entityKey: 'example-lab',
        field: 'fullDescription',
        value: 'The Example Lab studies decision making.',
        sourceName: 'test-source',
        sourceUrl: 'https://example.yale.edu/lab',
        confidence: 0.55,
      },
    ]);
    expect(result.scraperResult).toEqual({ observationCount: 1, entitiesObserved: 1 });
  });
});

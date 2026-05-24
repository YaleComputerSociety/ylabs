import { describe, expect, it } from 'vitest';
import {
  applyScraperPromotionGuards,
  parseAcceptedReviewArtifact,
} from '../scraperPromotionGuards';

describe('parseAcceptedReviewArtifact', () => {
  it('parses approved slugs from JSON and plain-text artifacts', () => {
    expect(parseAcceptedReviewArtifact('["lab-a", " lab-b "]')).toEqual(['lab-a', 'lab-b']);
    expect(parseAcceptedReviewArtifact(JSON.stringify({ slugs: ['lab-c', 'lab-d'] }))).toEqual([
      'lab-c',
      'lab-d',
    ]);
    expect(
      parseAcceptedReviewArtifact(JSON.stringify({ scraperOnlyValues: ['netid1', 'netid2'] })),
    ).toEqual(['netid1', 'netid2']);
    expect(parseAcceptedReviewArtifact('lab-e\n# comment\nlab-f, lab-g')).toEqual([
      'lab-e',
      'lab-f',
      'lab-g',
    ]);
  });
});

describe('applyScraperPromotionGuards', () => {
  const writableBeta = {
    environment: 'beta' as const,
    autoMaterialize: true,
  };

  it('blocks broad non-dry LLM apply without an accepted review artifact', () => {
    expect(() =>
      applyScraperPromotionGuards({
        ...writableBeta,
        sourceName: 'lab-microsite-description-llm',
        options: {
          dryRun: false,
          useCache: false,
          release: false,
          limit: 100,
        },
      }),
    ).toThrow('accepted review artifact');
  });

  it('constrains LLM apply to reviewed slugs from the accepted artifact', () => {
    const guarded = applyScraperPromotionGuards({
      ...writableBeta,
      sourceName: 'lab-microsite-undergrad-llm',
      acceptedReviewSlugs: ['lab-a', 'lab-b'],
      options: {
        dryRun: false,
        useCache: false,
        release: false,
        limit: 100,
      },
    });

    expect(guarded.options.only).toEqual(['lab-a', 'lab-b']);
    expect(guarded.options.limit).toBe(2);
  });

  it('blocks OpenAlex name discovery for non-dry beta or production apply', () => {
    expect(() =>
      applyScraperPromotionGuards({
        ...writableBeta,
        sourceName: 'openalex',
        options: {
          dryRun: false,
          useCache: false,
          release: false,
          discoverOpenAlexAuthors: true,
        },
      }),
    ).toThrow('OpenAlex name discovery');
  });

  it('requires accepted arXiv --only targets for non-dry beta or production apply', () => {
    expect(() =>
      applyScraperPromotionGuards({
        ...writableBeta,
        sourceName: 'arxiv',
        options: {
          dryRun: false,
          useCache: false,
          release: false,
        },
      }),
    ).toThrow('arXiv');

    expect(() =>
      applyScraperPromotionGuards({
        ...writableBeta,
        sourceName: 'arxiv',
        options: {
          dryRun: false,
          useCache: false,
          release: false,
          only: ['smith'],
        },
      }),
    ).toThrow('accepted review artifact');
  });

  it('constrains arXiv apply to accepted review artifact targets', () => {
    const guarded = applyScraperPromotionGuards({
      ...writableBeta,
      sourceName: 'arxiv',
      acceptedReviewSlugs: ['ab123', 'cd456'],
      options: {
        dryRun: false,
        useCache: false,
        release: false,
      },
    });

    expect(guarded.options.only).toEqual(['ab123', 'cd456']);
    expect(guarded.options.limit).toBe(2);
  });

  it('blocks non-dry department roster apply when CS would be included', () => {
    expect(() =>
      applyScraperPromotionGuards({
        ...writableBeta,
        sourceName: 'dept-faculty-roster',
        options: {
          dryRun: false,
          useCache: false,
          release: false,
          only: ['econ', 'cs'],
        },
      }),
    ).toThrow('CS roster');

    expect(() =>
      applyScraperPromotionGuards({
        ...writableBeta,
        sourceName: 'dept-faculty-roster',
        options: {
          dryRun: false,
          useCache: false,
          release: false,
        },
      }),
    ).toThrow('CS roster');
  });

  it('allows reviewed CS department roster apply when accepted explicitly', () => {
    const guarded = applyScraperPromotionGuards({
      ...writableBeta,
      sourceName: 'dept-faculty-roster',
      acceptedReviewSlugs: ['cs'],
      options: {
        dryRun: false,
        useCache: false,
        release: false,
        only: ['cs'],
        limit: 10,
      },
    });

    expect(guarded.options.only).toEqual(['cs']);
    expect(guarded.options.limit).toBe(10);
  });

  it('does not block dry-run exploratory audits', () => {
    const guarded = applyScraperPromotionGuards({
      environment: 'beta',
      sourceName: 'openalex',
      autoMaterialize: false,
      options: {
        dryRun: true,
        useCache: false,
        release: false,
        discoverOpenAlexAuthors: true,
      },
    });

    expect(guarded.options.discoverOpenAlexAuthors).toBe(true);
  });
});

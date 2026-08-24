import { describe, expect, it } from 'vitest';
import {
  isResearchAreaFacetGraftObservation,
  planUnbackedResearchAreaClear,
} from '../fix1580CenterResearchAreaFacetGraftCore';

const isListingUrl = (value: unknown) =>
  typeof value === 'string' && /^https:\/\/research\.yale\.edu\/(cores|centers-institutes)(\?.*)?$/i.test(value);

describe('isResearchAreaFacetGraftObservation', () => {
  it('flags an active research-area-source-extractor observation sourced from a listing page', () => {
    expect(
      isResearchAreaFacetGraftObservation(
        {
          entityType: 'researchEntity',
          field: 'researchAreas',
          sourceName: 'research-area-source-extractor',
          sourceUrl: 'https://research.yale.edu/cores?f%5B0%5D=result_type%3A1',
          superseded: false,
        },
        isListingUrl,
      ),
    ).toBe(true);
  });

  it('leaves an already-superseded observation alone', () => {
    expect(
      isResearchAreaFacetGraftObservation(
        {
          entityType: 'researchEntity',
          field: 'researchAreas',
          sourceName: 'research-area-source-extractor',
          sourceUrl: 'https://research.yale.edu/cores?f%5B0%5D=result_type%3A1',
          superseded: true,
        },
        isListingUrl,
      ),
    ).toBe(false);
  });

  it('leaves a genuine per-entity extraction from the same scraper alone', () => {
    expect(
      isResearchAreaFacetGraftObservation(
        {
          entityType: 'researchEntity',
          field: 'researchAreas',
          sourceName: 'research-area-source-extractor',
          sourceUrl: 'https://research.yale.edu/cores/cytof',
          superseded: false,
        },
        isListingUrl,
      ),
    ).toBe(false);
  });

  it('leaves a different source name alone even from the same listing url', () => {
    expect(
      isResearchAreaFacetGraftObservation(
        {
          entityType: 'researchEntity',
          field: 'researchAreas',
          sourceName: 'yale-research-official',
          sourceUrl: 'https://research.yale.edu/centers-institutes',
          superseded: false,
        },
        isListingUrl,
      ),
    ).toBe(false);
  });

  it('ignores a different field', () => {
    expect(
      isResearchAreaFacetGraftObservation(
        {
          entityType: 'researchEntity',
          field: 'fullDescription',
          sourceName: 'research-area-source-extractor',
          sourceUrl: 'https://research.yale.edu/cores?f%5B0%5D=result_type%3A1',
          superseded: false,
        },
        isListingUrl,
      ),
    ).toBe(false);
  });
});

describe('planUnbackedResearchAreaClear', () => {
  it('clears an unbacked non-empty value with no active observation', () => {
    expect(
      planUnbackedResearchAreaClear({
        slug: 'leaderer-lab-bpl2',
        currentResearchAreas: ['Lymphoma Diagnosis and Treatment'],
        activeResearchAreaObservationCount: 0,
      }),
    ).toEqual({
      slug: 'leaderer-lab-bpl2',
      shouldClear: true,
      reason: 'unbacked value with no active observation',
    });
  });

  it('does not clear when a backing observation exists', () => {
    const result = planUnbackedResearchAreaClear({
      slug: 'center-ycga',
      currentResearchAreas: ['Genomics'],
      activeResearchAreaObservationCount: 1,
    });
    expect(result.shouldClear).toBe(false);
  });

  it('does not clear an already-empty value', () => {
    const result = planUnbackedResearchAreaClear({
      slug: 'some-center',
      currentResearchAreas: [],
      activeResearchAreaObservationCount: 0,
    });
    expect(result.shouldClear).toBe(false);
  });
});

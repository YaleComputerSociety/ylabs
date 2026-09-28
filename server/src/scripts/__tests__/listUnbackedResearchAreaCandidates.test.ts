import { describe, expect, it } from 'vitest';
import {
  parseListUnbackedResearchAreaArgs,
  storedResearchAreasAreDerivable,
  unbackedResearchAreaCandidateReport,
} from '../listUnbackedResearchAreaCandidates';

const deriveNeuroscienceOnly = (text: string) =>
  /neuro/i.test(text) ? ['Neuroscience'] : [];

describe('parseListUnbackedResearchAreaArgs', () => {
  it('requires a json report under a temp root', () => {
    expect(() => parseListUnbackedResearchAreaArgs([])).toThrow(/--output/);
    expect(() => parseListUnbackedResearchAreaArgs(['--output', '/tmp/example.txt'])).toThrow(
      /\.json/,
    );
    expect(parseListUnbackedResearchAreaArgs(['--output', '/tmp/example-list.json'])).toEqual({
      output: expect.stringMatching(/example-list\.json$/),
      includeUnserved: false,
      includeDerivable: false,
    });
  });
});

describe('storedResearchAreasAreDerivable', () => {
  it('counts recorded derivation provenance as derivable', () => {
    expect(
      storedResearchAreasAreDerivable(
        {
          researchAreas: ['Genomics'],
          fieldProvenance: { researchAreas: { sourceName: 'description-derived-research-area' } },
        },
        deriveNeuroscienceOnly,
      ),
    ).toBe(true);
  });

  it('is derivable only when derivation reproduces every stored area', () => {
    const base = { entityType: 'LAB', fullDescription: 'A neuroscience group.' };
    expect(
      storedResearchAreasAreDerivable(
        { ...base, researchAreas: ['neuroscience'] },
        deriveNeuroscienceOnly,
      ),
    ).toBe(true);
    expect(
      storedResearchAreasAreDerivable(
        { ...base, researchAreas: ['Neuroscience', 'Petroleum Geology'] },
        deriveNeuroscienceOnly,
      ),
    ).toBe(false);
    expect(
      storedResearchAreasAreDerivable(
        { ...base, entityType: 'CORE_FACILITY', researchAreas: ['Neuroscience'] },
        deriveNeuroscienceOnly,
      ),
    ).toBe(false);
  });
});

describe('unbackedResearchAreaCandidateReport', () => {
  const docs = [
    {
      _id: 'a',
      slug: 'example-unbacked',
      entityType: 'LAB',
      fullDescription: 'Studies rock formation.',
      websiteUrl: 'https://example.edu/research/a',
      researchAreas: ['Petroleum Geology'],
    },
    {
      _id: 'b',
      slug: 'example-backed',
      websiteUrl: 'https://example.edu/research/b',
      researchAreas: ['Neuroscience'],
    },
    {
      _id: 'c',
      slug: 'example-derivable',
      entityType: 'LAB',
      fullDescription: 'A neuroscience group.',
      websiteUrl: 'https://example.edu/research/c',
      researchAreas: ['Neuroscience'],
    },
    { _id: 'd', slug: 'example-no-url', researchAreas: ['Neuroscience'] },
  ];
  const context = {
    generatedAt: new Date('2026-01-01T00:00:00Z'),
    includeUnserved: false,
    deriveResearchAreasFromText: deriveNeuroscienceOnly,
  };

  it('lists unbacked, non-derivable rows with a usable url, by slug', () => {
    const report = unbackedResearchAreaCandidateReport(docs, new Set(['b']), {
      ...context,
      includeDerivable: false,
    });
    expect(report).toMatchObject({
      storedNonEmptyRows: 4,
      unbackedRows: 3,
      derivableUnbackedRows: 1,
      candidateCount: 1,
      only: 'example-unbacked',
    });
  });

  it('adds derivable rows when asked', () => {
    const report = unbackedResearchAreaCandidateReport(docs, new Set(['b']), {
      ...context,
      includeDerivable: true,
    });
    expect(report.only.split(',').sort()).toEqual(['example-derivable', 'example-unbacked']);
  });
});

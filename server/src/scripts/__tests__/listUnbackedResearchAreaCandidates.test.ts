import { describe, expect, it } from 'vitest';
import {
  parseListUnbackedResearchAreaArgs,
  unbackedResearchAreaCandidateReport,
} from '../listUnbackedResearchAreaCandidates';

describe('parseListUnbackedResearchAreaArgs', () => {
  it('requires a json report under a temp root', () => {
    expect(() => parseListUnbackedResearchAreaArgs([])).toThrow(/--output/);
    expect(() => parseListUnbackedResearchAreaArgs(['--output', '/tmp/example.txt'])).toThrow(
      /\.json/,
    );
    expect(parseListUnbackedResearchAreaArgs(['--output', '/tmp/example-list.json'])).toEqual({
      output: expect.stringMatching(/example-list\.json$/),
    });
  });

  it('rejects an unknown argument', () => {
    expect(() =>
      parseListUnbackedResearchAreaArgs(['--output', '/tmp/example-list.json', '--extra']),
    ).toThrow(/Unknown/);
  });
});

describe('unbackedResearchAreaCandidateReport', () => {
  const docs = [
    {
      _id: 'a',
      slug: 'example-unbacked',
      websiteUrl: 'https://example.edu/research/a',
      researchAreas: ['Petroleum Geology'],
    },
    {
      _id: 'b',
      slug: 'example-backed',
      websiteUrl: 'https://example.edu/research/b',
      researchAreas: ['Neuroscience'],
    },
    { _id: 'd', slug: 'example-no-url', researchAreas: ['Neuroscience'] },
  ];

  it('lists unbacked rows with a usable url, by slug', () => {
    const report = unbackedResearchAreaCandidateReport(
      docs,
      new Set(['b']),
      new Date('2026-01-01T00:00:00Z'),
    );
    expect(report).toMatchObject({
      generatedAt: '2026-01-01T00:00:00.000Z',
      storedNonEmptyRows: 3,
      unbackedRows: 2,
      candidateCount: 1,
      only: 'example-unbacked',
    });
  });
});

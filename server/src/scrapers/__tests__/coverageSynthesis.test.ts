import { describe, expect, it } from 'vitest';
import {
  gatherCoverageSnippets,
  synthesizeCoverageDescription,
  type CoverageSnippet,
  type CoverageSynthesisLLMFn,
} from '../coverageSynthesis';

const SNIPPETS: CoverageSnippet[] = [
  {
    text:
      'The laboratory develops single-cell sequencing methods and computational models of gene regulatory networks controlling immune cell differentiation.',
    sourceUrl: 'https://example.edu/lab',
    sourceName: 'lab-page',
  },
  {
    text:
      'Recent projects apply CRISPR screens and machine learning to predict transcription factor activity in immune cells.',
    sourceUrl: 'https://example.edu/research',
    sourceName: 'research-page',
  },
];

const stub = (result: unknown): CoverageSynthesisLLMFn => async () => result as never;

describe('synthesizeCoverageDescription', () => {
  it('accepts a grounded, useful description and returns its cited source urls', async () => {
    const result = await synthesizeCoverageDescription({
      snippets: SNIPPETS,
      entityName: 'Immunology Lab',
      callLLM: stub({
        fullDescription:
          'Develops single-cell sequencing methods and computational models of gene regulatory networks controlling immune cell differentiation, using CRISPR screens and machine learning to predict transcription factor activity in immune cells.',
        usedSnippetIndexes: [0, 1],
      }),
    });
    expect(result).not.toBeNull();
    expect(result?.sourceUrls).toEqual(['https://example.edu/lab', 'https://example.edu/research']);
  });

  it('rejects fluent off-topic text (overlap gate)', async () => {
    const result = await synthesizeCoverageDescription({
      snippets: SNIPPETS,
      entityName: 'Immunology Lab',
      callLLM: stub({
        fullDescription:
          'Studies medieval European history and the economics of trade routes across the Mediterranean during the fourteenth century.',
        usedSnippetIndexes: [0],
      }),
    });
    expect(result).toBeNull();
  });

  it('redacts contact info from the output and never leaks an email', async () => {
    const result = await synthesizeCoverageDescription({
      snippets: SNIPPETS,
      entityName: 'Immunology Lab',
      callLLM: stub({
        fullDescription:
          'Develops single-cell sequencing methods and computational models of gene regulatory networks controlling immune cell differentiation. Email labpi@example.edu.',
        usedSnippetIndexes: [0],
      }),
    });
    // Fail-closed OR redacted - either way an email can never reach the output.
    if (result) expect(result.description).not.toMatch(/@/);
  });

  it('returns null when no snippets cited', async () => {
    const result = await synthesizeCoverageDescription({
      snippets: SNIPPETS,
      entityName: 'Immunology Lab',
      callLLM: stub({
        fullDescription:
          'Develops single-cell sequencing methods and computational models of gene regulatory networks controlling immune cell differentiation.',
        usedSnippetIndexes: [],
      }),
    });
    expect(result).toBeNull();
  });

  it('is fail-closed on empty, malformed, and throwing LLM output', async () => {
    expect(
      await synthesizeCoverageDescription({ snippets: SNIPPETS, entityName: 'X', callLLM: stub({ fullDescription: '', usedSnippetIndexes: [] }) }),
    ).toBeNull();
    expect(
      await synthesizeCoverageDescription({ snippets: SNIPPETS, entityName: 'X', callLLM: stub({}) }),
    ).toBeNull();
    expect(
      await synthesizeCoverageDescription({ snippets: SNIPPETS, entityName: 'X', callLLM: stub(undefined) }),
    ).toBeNull();
    const thrower: CoverageSynthesisLLMFn = async () => {
      throw new Error('boom');
    };
    expect(
      await synthesizeCoverageDescription({ snippets: SNIPPETS, entityName: 'X', callLLM: thrower }),
    ).toBeNull();
  });

  it('returns null with no snippets to work from', async () => {
    const result = await synthesizeCoverageDescription({
      snippets: [],
      entityName: 'X',
      callLLM: stub({ fullDescription: 'anything', usedSnippetIndexes: [0] }),
    });
    expect(result).toBeNull();
  });
});

describe('gatherCoverageSnippets', () => {
  it('keeps description-like fields, redacts contact, drops rejected sources, and dedupes', () => {
    const snippets = gatherCoverageSnippets([
      { field: 'fullDescription', value: 'Studies coral reef resilience under ocean warming and acidification.', sourceUrl: 'https://example.edu/a', sourceName: 'a' },
      { field: 'fullDescription', value: 'Studies coral reef resilience under ocean warming and acidification.', sourceUrl: 'https://example.edu/dup', sourceName: 'dup' },
      { field: 'shortDescription', value: 'Contact the reef ecology group at reef@example.edu for details on projects.', sourceUrl: 'https://example.edu/b', sourceName: 'b' },
      { field: 'websiteUrl', value: 'https://example.edu', sourceUrl: 'https://example.edu' },
    ]);
    expect(snippets.length).toBe(2);
    expect(snippets.some((s) => s.text.includes('reef@example.edu'))).toBe(false);
  });
});

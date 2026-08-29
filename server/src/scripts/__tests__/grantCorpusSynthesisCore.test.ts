import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GRANT_CORPUS_SYNTHESIS_LIMIT,
  GRANT_CORPUS_DESCRIPTION_CONFIDENCE,
  GRANT_CORPUS_SYNTHESIS_SOURCE_NAME,
  assertGrantCorpusSynthesisApplyAllowed,
  buildGrantCorpusSnippets,
  entityHasBetterSourcedDescription,
  parseGrantCorpusSynthesisArgs,
} from '../grantCorpusSynthesisCore';

describe('parseGrantCorpusSynthesisArgs', () => {
  it('defaults to dry-run with a bounded limit', () => {
    const args = parseGrantCorpusSynthesisArgs([]);
    expect(args.apply).toBe(false);
    expect(args.confirm).toBe(false);
    expect(args.limit).toBe(DEFAULT_GRANT_CORPUS_SYNTHESIS_LIMIT);
  });

  it('parses apply, confirm, limit, and slugs', () => {
    const args = parseGrantCorpusSynthesisArgs([
      '--apply',
      '--confirm-grant-corpus-synthesis',
      '--limit=5',
      '--slugs=a,b',
    ]);
    expect(args.apply).toBe(true);
    expect(args.confirm).toBe(true);
    expect(args.limit).toBe(5);
    expect(args.slugs).toEqual(['a', 'b']);
  });

  it('falls back to the default limit for non-positive values', () => {
    expect(parseGrantCorpusSynthesisArgs(['--limit=0']).limit).toBe(
      DEFAULT_GRANT_CORPUS_SYNTHESIS_LIMIT,
    );
  });
});

describe('assertGrantCorpusSynthesisApplyAllowed', () => {
  const dev = 'cluster/development';

  it('allows dry-run anywhere', () => {
    expect(() =>
      assertGrantCorpusSynthesisApplyAllowed(parseGrantCorpusSynthesisArgs([]), 'cluster/prod'),
    ).not.toThrow();
  });

  it('requires the confirm flag to apply', () => {
    expect(() =>
      assertGrantCorpusSynthesisApplyAllowed(parseGrantCorpusSynthesisArgs(['--apply']), dev),
    ).toThrow(/--confirm-grant-corpus-synthesis/);
  });

  it('restricts apply to a development database', () => {
    expect(() =>
      assertGrantCorpusSynthesisApplyAllowed(
        parseGrantCorpusSynthesisArgs(['--apply', '--confirm-grant-corpus-synthesis']),
        'cluster/beta',
      ),
    ).toThrow(/Development database/);
  });

  it('allows a confirmed apply against development', () => {
    expect(() =>
      assertGrantCorpusSynthesisApplyAllowed(
        parseGrantCorpusSynthesisArgs(['--apply', '--confirm-grant-corpus-synthesis']),
        dev,
      ),
    ).not.toThrow();
  });
});

describe('buildGrantCorpusSnippets', () => {
  it('fuses each grant title and abstract into a deduped snippet with source metadata', () => {
    const snippets = buildGrantCorpusSnippets([
      {
        agency: 'NIH',
        title: 'Neural circuits of memory',
        abstract: 'Studies how hippocampal circuits encode spatial memory in mammals.',
        url: 'https://reporter.nih.gov/project/1',
      },
      {
        agency: 'NSF',
        title: 'Synaptic plasticity models',
        abstract: 'Builds computational models of synaptic plasticity.',
        url: 'https://nsf.gov/award/2',
      },
    ]);
    expect(snippets).toHaveLength(2);
    expect(snippets[0].text).toContain('Neural circuits of memory');
    expect(snippets[0].text).toContain('hippocampal circuits');
    expect(snippets[0].sourceName).toBe('NIH grant');
    expect(snippets[0].sourceUrl).toBe('https://reporter.nih.gov/project/1');
  });

  it('drops grants with no usable text and dedupes identical corpus entries', () => {
    const snippets = buildGrantCorpusSnippets([
      { agency: 'NIH', title: '', abstract: '' },
      { agency: 'NIH', title: 'Same', abstract: 'Repeated grant abstract text here.' },
      { agency: 'NIH', title: 'Same', abstract: 'Repeated grant abstract text here.' },
    ]);
    expect(snippets).toHaveLength(1);
  });

  it('returns nothing when recentGrants is absent or malformed', () => {
    expect(buildGrantCorpusSnippets(undefined)).toEqual([]);
    expect(buildGrantCorpusSnippets('nope')).toEqual([]);
  });
});

describe('entityHasBetterSourcedDescription', () => {
  const usefulProse =
    'Develops single-cell sequencing methods to map how immune cells respond to infection across tissues.';

  it('skips synthesis when an official (non-grant) source already has a useful description', () => {
    expect(
      entityHasBetterSourcedDescription(
        [{ value: usefulProse, sourceName: 'lab-microsite-description-llm' }],
        [],
        'LAB',
      ),
    ).toBe(true);
  });

  it('does not treat a grant-sourced description as better sourced', () => {
    expect(
      entityHasBetterSourcedDescription(
        [{ value: usefulProse, sourceName: 'nih-reporter' }],
        [],
        'LAB',
      ),
    ).toBe(false);
  });

  it('ignores the grant-corpus synthesis source itself', () => {
    expect(
      entityHasBetterSourcedDescription(
        [{ value: usefulProse, sourceName: GRANT_CORPUS_SYNTHESIS_SOURCE_NAME }],
        [],
        'LAB',
      ),
    ).toBe(false);
  });
});

describe('grant-corpus synthesis confidence band', () => {
  it('sits above the single-abstract fallback and below official-profile sources', () => {
    expect(GRANT_CORPUS_DESCRIPTION_CONFIDENCE).toBeGreaterThan(0.35);
    expect(GRANT_CORPUS_DESCRIPTION_CONFIDENCE).toBeLessThan(0.55);
  });
});

import { describe, expect, it } from 'vitest';
import {
  MAX_COVERAGE_SNIPPETS,
  MAX_COVERAGE_SNIPPET_CHARS,
} from '../../scrapers/coverageSynthesis';
import {
  assertWriterCacheModeAllowed,
  buildWriterEvidenceSnippets,
  coverageSynthesisModeOf,
  parseCoverageSynthesisArgs,
  writerEvidenceRank,
} from '../coverageSynthesisCore';

const SITE = 'https://reef.example.edu/';
const pageTextObservation = (text: string, observedAt: string, url = `${SITE}research`) => ({
  field: 'researchPageText',
  value: [{ url, text }],
  sourceName: 'research-page-text',
  sourceUrl: url,
  confidence: 0.85,
  observedAt: new Date(observedAt),
});
const siteProse = {
  field: 'fullDescription',
  value: 'The reef lab website describes coral reef recovery after marine heatwaves.',
  sourceName: 'yale-research-official',
  sourceUrl: SITE,
  confidence: 0.95,
};

describe('research page text is the first writer evidence (#5537)', () => {
  it('ranks the research page text ahead of the row site', () => {
    expect(writerEvidenceRank(pageTextObservation('x', '2026-11-01'), SITE)).toBe(0);
    expect(writerEvidenceRank(siteProse, SITE)).toBe(1);
  });

  it('reads only the current reading, ahead of every other kind', () => {
    const snippets = buildWriterEvidenceSnippets(
      [
        siteProse,
        pageTextObservation('An older reading about kelp forests and sea urchins.', '2026-09-01'),
        pageTextObservation(
          'Coral Reef Recovery\nWe study how coral reefs recover after marine heatwaves.',
          '2026-11-01',
        ),
      ],
      undefined,
      { websiteUrl: SITE },
    );
    expect(snippets.map((snippet) => [snippet.sourceName, snippet.text])).toEqual([
      [
        'research-page-text',
        'Coral Reef Recovery\nWe study how coral reefs recover after marine heatwaves.',
      ],
      ['yale-research-official', siteProse.value],
    ]);
  });

  it('splits a long page into whole-line snippets within the snippet caps', () => {
    const line = (index: number) =>
      `Coral reef transect ${index} records recovery of colonies after marine heatwaves in detail.`;
    const text = Array.from({ length: 400 }, (_, index) => line(index)).join('\n');
    const snippets = buildWriterEvidenceSnippets(
      [pageTextObservation(text, '2026-11-01')],
      undefined,
    );
    expect(snippets).toHaveLength(MAX_COVERAGE_SNIPPETS);
    for (const snippet of snippets) {
      expect(snippet.text.length).toBeLessThanOrEqual(MAX_COVERAGE_SNIPPET_CHARS);
      expect(
        snippet.text.split('\n').every((piece) => /^Coral reef transect \d+ /.test(piece)),
      ).toBe(true);
    }
  });

  it('never leaves a heading as the last line of a snippet', () => {
    const exactly = (length: number, lead: string) =>
      `${lead} ${'x'.repeat(length - lead.length - 2)}.`;
    const lines = Array.from({ length: 11 }, (_, index) => exactly(99, `Transect ${index}`));
    const heading = 'Algae Competition';
    const next = exactly(100, 'We test how algae compete with coral');
    expect(lines.join('\n').length + 1 + heading.length).toBeLessThanOrEqual(
      MAX_COVERAGE_SNIPPET_CHARS,
    );
    expect(lines.join('\n').length + heading.length + next.length + 2).toBeGreaterThan(
      MAX_COVERAGE_SNIPPET_CHARS,
    );
    const snippets = buildWriterEvidenceSnippets(
      [pageTextObservation([...lines, heading, next].join('\n'), '2026-11-01')],
      undefined,
    );
    expect(snippets.map((snippet) => snippet.text)).toEqual([
      lines.join('\n'),
      `${heading}\n${next}`,
    ]);
  });

  it('admits page text without the model-text grounding check', () => {
    const snippets = buildWriterEvidenceSnippets(
      [pageTextObservation('We study how coral reefs recover after heatwaves.', '2026-11-01')],
      undefined,
      { storedPageText: () => undefined },
    );
    expect(snippets).toHaveLength(1);
  });
});

describe('evaluate, capture and import modes (#5537)', () => {
  const mode = (argv: string[]) => coverageSynthesisModeOf(parseCoverageSynthesisArgs(argv));

  it('requires a named row set for evaluate and capture', () => {
    expect(() => mode(['--evaluate'])).toThrow(/requires --slugs, --slugs-file or --evidence-file/);
    expect(mode(['--evaluate', '--slugs=reef-lab'])).toBe('evaluate');
    expect(mode(['--evaluate', '--slugs-file', '/tmp/rows.txt'])).toBe('evaluate');
    expect(mode(['--evaluate', '--evidence-file=/tmp/evidence.json'])).toBe('evaluate');
    expect(() => mode(['--capture-evidence=/tmp/e.json'])).toThrow(/requires --slugs/);
    expect(mode(['--capture-evidence', '/tmp/e.json', '--slugs=reef-lab'])).toBe(
      'capture-evidence',
    );
  });

  it('refuses the flags that would write observations or fields', () => {
    expect(() => mode(['--evaluate', '--slugs=reef-lab', '--apply'])).toThrow(
      /refused with --apply/,
    );
    expect(() => mode(['--import-derivations=/tmp/d.json', '--all'])).toThrow(/refused with --all/);
    expect(() => mode(['--validate-only'])).toThrow(/requires --import-derivations/);
    expect(() => mode(['--evaluate', '--capture-evidence=/tmp/e.json', '--slugs=a'])).toThrow(
      /choose one/,
    );
  });

  it('restricts the cache-writing modes to a Development database', () => {
    expect(() => assertWriterCacheModeAllowed('evaluate', 'cluster/Prod')).toThrow(/Development/);
    expect(() => assertWriterCacheModeAllowed('import-derivations', 'cluster/Beta')).toThrow(
      /Development/,
    );
    expect(() => assertWriterCacheModeAllowed('evaluate', 'cluster/Development')).not.toThrow();
    expect(() => assertWriterCacheModeAllowed('capture-evidence', 'cluster/Prod')).not.toThrow();
  });

  it('prints the writer prompt without any other mode', () => {
    expect(mode(['--print-writer-prompt'])).toBe('print-writer-prompt');
  });
});

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COVERAGE_SYNTHESIS_CONCURRENCY,
  buildWriterEvidenceSnippets,
  parseCoverageSynthesisArgs,
  planWriterStep,
  storedWriterEvidenceHash,
  writerWritesAfterBodyAttempt,
  writerWritesFor,
  writtenBodyCardRepairFilter,
} from '../coverageSynthesisCore';
import { writerInputHash } from '../writtenDescriptionDerivationCore';

const LAB =
  'The laboratory develops single-cell sequencing methods for immune cell differentiation.';
const PROFILE =
  'Research applies CRISPR screens and machine learning to transcription factor activity.';

const observation = (value: string, sourceName: string, confidence: number) => ({
  field: 'fullDescription',
  value,
  sourceName,
  confidence,
  sourceUrl: `https://example.edu/research/${confidence}`,
});

describe('the writer lane runs over every live row (#4788)', () => {
  it('parses --all and a bounded --concurrency', () => {
    const args = parseCoverageSynthesisArgs(['--all', '--concurrency=50']);
    expect(args.all).toBe(true);
    expect(args.concurrency).toBe(8);
    expect(parseCoverageSynthesisArgs([]).concurrency).toBe(DEFAULT_COVERAGE_SYNTHESIS_CONCURRENCY);
  });

  it('orders evidence so the hash does not depend on read order', () => {
    const a = observation(LAB, 'ysm-atoz-index', 0.82);
    const b = observation(PROFILE, 'ysm-faculty-directory', 0.55);
    const forward = buildWriterEvidenceSnippets([a, b], undefined);
    const reversed = buildWriterEvidenceSnippets([b, a], undefined);
    expect(forward.map((snippet) => snippet.text)).toEqual([PROFILE, LAB]);
    expect(writerInputHash(forward)).toBe(writerInputHash(reversed));
  });

  it('changes the hash when the evidence changes', () => {
    const before = buildWriterEvidenceSnippets(
      [observation(LAB, 'ysm-atoz-index', 0.82)],
      undefined,
    );
    const after = buildWriterEvidenceSnippets(
      [
        observation(LAB, 'ysm-atoz-index', 0.82),
        observation(PROFILE, 'ysm-faculty-directory', 0.55),
      ],
      undefined,
    );
    expect(writerInputHash(before)).not.toBe(writerInputHash(after));
  });

  it("ignores the writer's own body when hashing, so writing it never re-triggers a call", () => {
    const evidence = [observation(LAB, 'ysm-atoz-index', 0.82)];
    const withOwnBody = [
      ...evidence,
      observation('Develops single-cell sequencing methods.', 'coverage-synthesis-llm', 0.5),
    ];
    expect(writerInputHash(buildWriterEvidenceSnippets(withOwnBody, undefined))).toBe(
      writerInputHash(buildWriterEvidenceSnippets(evidence, undefined)),
    );
  });

  it('skips a row only when its evidence is unchanged', () => {
    const snippets = buildWriterEvidenceSnippets(
      [observation(LAB, 'ysm-atoz-index', 0.82)],
      undefined,
    );
    const freshHash = writerInputHash(snippets);
    expect(planWriterStep({ snippets, storedHash: freshHash, freshHash })).toBe(
      'evidence-unchanged',
    );
    expect(planWriterStep({ snippets, storedHash: 'older', freshHash })).toBe('synthesize');
    expect(planWriterStep({ snippets, storedHash: undefined, freshHash })).toBe('synthesize');
    expect(planWriterStep({ snippets: [], storedHash: undefined, freshHash })).toBe('no-evidence');
  });

  it('reads the newest stored hash of this lane only', () => {
    const hashes = [
      {
        field: 'sourceContentHash',
        value: 'old',
        sourceName: 'coverage-synthesis-llm',
        observedAt: new Date('2026-09-01'),
      },
      {
        field: 'sourceContentHash',
        value: 'new',
        sourceName: 'coverage-synthesis-llm',
        observedAt: new Date('2026-10-01'),
      },
      {
        field: 'sourceContentHash',
        value: 'other',
        sourceName: 'lab-microsite-description-llm',
        observedAt: new Date('2026-10-02'),
      },
    ];
    expect(storedWriterEvidenceHash(hashes, 'coverage-synthesis-llm')).toBe('new');
  });

  it('adds a body on an accepted draft and never retires the served one', () => {
    const accepted = {
      result: { description: 'Studies immune cells.', usedSnippetIndexes: [0], sourceUrls: [] },
      refusal: null,
    };
    expect(writerWritesFor('synthesize', accepted)).toEqual({
      writeBody: true,
      recordHash: true,
    });
    expect(writerWritesFor('synthesize', { result: null, refusal: 'quality-bar' })).toEqual({
      writeBody: false,
      recordHash: true,
    });
    expect(writerWritesFor('no-evidence', null)).toEqual({
      writeBody: false,
      recordHash: false,
    });
  });

  it('keeps the prior body and records no hash when the store refuses the new body', () => {
    const accepted = writerWritesFor('synthesize', {
      result: { description: 'Studies immune cells.', usedSnippetIndexes: [0], sourceUrls: [] },
      refusal: null,
    });
    expect(writerWritesAfterBodyAttempt(accepted, false)).toEqual({
      writeBody: false,
      recordHash: false,
    });
    expect(writerWritesAfterBodyAttempt(accepted, true)).toEqual(accepted);
  });

  it('records nothing after a failed call, so the next run retries', () => {
    expect(writerWritesFor('synthesize', { result: null, refusal: 'llm-call-failed' })).toEqual({
      writeBody: false,
      recordHash: false,
    });
    expect(writerWritesFor('evidence-unchanged', null)).toEqual({
      writeBody: false,
      recordHash: false,
    });
  });
});

describe('re-deriving written-body cards (#4788 follow-up)', () => {
  it('parses --rederive-cards', () => {
    expect(parseCoverageSynthesisArgs(['--rederive-cards']).rederiveCards).toBe(true);
    expect(parseCoverageSynthesisArgs([]).rederiveCards).toBe(false);
  });

  it('selects live rows serving the written body and held on a missing card', () => {
    expect(writtenBodyCardRepairFilter('coverage-synthesis-llm')).toEqual({
      archived: { $ne: true },
      'fieldProvenance.fullDescription.sourceName': 'coverage-synthesis-llm',
      studentVisibilityReasons: 'missing_card_description',
    });
  });

  it('selects every live written row with --all', () => {
    expect(writtenBodyCardRepairFilter('coverage-synthesis-llm', { allWrittenRows: true })).toEqual(
      {
        archived: { $ne: true },
        'fieldProvenance.fullDescription.sourceName': 'coverage-synthesis-llm',
      },
    );
  });
});

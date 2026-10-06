import { describe, expect, it } from 'vitest';
import {
  adoptedWrittenBodyStillSupported,
  coverageSynthesisDecision,
} from '../../scrapers/coverageSynthesis';
import {
  assertIgnoreEvidenceHashScoped,
  liveWrittenBody,
  parseCoverageSynthesisArgs,
  planWriterStep,
  reinstateStepFor,
  writerStoredHashFor,
  writerWritesFor,
} from '../coverageSynthesisCore';

const SNIPPETS = [
  {
    text: 'The laboratory develops single-cell sequencing methods to study immune cell differentiation in human lymph node tissue, combining spatial transcriptomics with lineage tracing.',
    sourceUrl: 'https://example.edu/lab/research',
    sourceName: 'lab-microsite-description-llm',
  },
];
const ADOPTED =
  'Develops single-cell sequencing methods to study immune cell differentiation in human lymph node tissue, combining spatial transcriptomics with lineage tracing.';
const REFUSED = { result: null, refusal: 'quality-bar' as const };

describe('a refused draft does not retire the body already adopted', () => {
  it('keeps the adopted body when it still clears every content arm', () => {
    expect(adoptedWrittenBodyStillSupported({ body: ADOPTED, snippets: SNIPPETS })).toBe(true);
    expect(writerWritesFor('synthesize', REFUSED, { adoptedBodyStillSupported: true })).toEqual({
      writeBody: false,
      retireBody: false,
      recordHash: true,
    });
  });

  it('still retires an adopted body the current evidence no longer supports', () => {
    const unrelated = [{ text: 'Studies medieval Latin manuscripts and their scribal hands.' }];
    expect(adoptedWrittenBodyStillSupported({ body: ADOPTED, snippets: unrelated })).toBe(false);
    expect(adoptedWrittenBodyStillSupported({ body: ADOPTED, snippets: [] })).toBe(false);
    expect(adoptedWrittenBodyStillSupported({ body: '', snippets: SNIPPETS })).toBe(false);
    expect(writerWritesFor('synthesize', REFUSED, { adoptedBodyStillSupported: false })).toEqual({
      writeBody: false,
      retireBody: true,
      recordHash: true,
    });
    expect(writerWritesFor('no-evidence', null, { adoptedBodyStillSupported: true })).toEqual({
      writeBody: false,
      retireBody: true,
      recordHash: false,
    });
  });

  it('judges an adopted body with the same arms as a fresh draft', async () => {
    const decision = await coverageSynthesisDecision({
      snippets: SNIPPETS,
      entityName: 'Synthetic Lab',
      callLLM: async () => ({ fullDescription: ADOPTED, usedSnippetIndexes: [0] }),
    });
    expect(decision.refusal).toBeNull();
    expect(decision.result?.description).toBe(ADOPTED);
  });

  it('reads the newest live body this lane wrote', () => {
    const observations = [
      {
        field: 'fullDescription',
        value: 'old body',
        sourceName: 'coverage-synthesis-llm',
        observedAt: new Date('2026-10-01'),
      },
      {
        field: 'fullDescription',
        value: 'new body',
        sourceName: 'coverage-synthesis-llm',
        observedAt: new Date('2026-10-05'),
      },
      {
        field: 'fullDescription',
        value: 'copied',
        sourceName: 'lab-microsite-description-llm',
        observedAt: new Date('2026-10-06'),
      },
    ];
    expect(liveWrittenBody(observations, 'coverage-synthesis-llm')).toBe('new body');
    expect(liveWrittenBody([], 'coverage-synthesis-llm')).toBeUndefined();
  });
});

describe('reinstating a body retired only because a later draft was refused', () => {
  it('reinstates a retired body that still clears the arms and nothing else', () => {
    expect(
      reinstateStepFor({
        liveBody: undefined,
        retiredBody: ADOPTED,
        retiredBodyStillSupported: true,
      }),
    ).toBe('reinstated');
    expect(
      reinstateStepFor({
        liveBody: undefined,
        retiredBody: ADOPTED,
        retiredBodyStillSupported: false,
      }),
    ).toBe('reinstate-refused');
    expect(
      reinstateStepFor({ liveBody: 'live', retiredBody: ADOPTED, retiredBodyStillSupported: true }),
    ).toBe('nothing-to-reinstate');
    expect(
      reinstateStepFor({
        liveBody: undefined,
        retiredBody: undefined,
        retiredBodyStillSupported: false,
      }),
    ).toBe('nothing-to-reinstate');
  });

  it('requires a named slug set', () => {
    expect(() =>
      assertIgnoreEvidenceHashScoped(parseCoverageSynthesisArgs(['--reinstate-retired-bodies'])),
    ).toThrow(/requires --slugs/);
    expect(() =>
      assertIgnoreEvidenceHashScoped(
        parseCoverageSynthesisArgs(['--reinstate-retired-bodies', '--slugs=a,b']),
      ),
    ).not.toThrow();
  });
});

describe('--ignore-evidence-hash re-judges only a named set', () => {
  it('is refused with --all and without --slugs', () => {
    expect(() =>
      assertIgnoreEvidenceHashScoped(
        parseCoverageSynthesisArgs(['--all', '--ignore-evidence-hash']),
      ),
    ).toThrow(/refused with --all/);
    expect(() =>
      assertIgnoreEvidenceHashScoped(parseCoverageSynthesisArgs(['--ignore-evidence-hash'])),
    ).toThrow(/requires --slugs/);
    expect(() =>
      assertIgnoreEvidenceHashScoped(
        parseCoverageSynthesisArgs(['--ignore-evidence-hash', '--slugs=a']),
      ),
    ).not.toThrow();
  });

  it('turns an unchanged-evidence row into a call only when asked', () => {
    const snippets = [{ text: 'x' }];
    const plain = parseCoverageSynthesisArgs(['--slugs=a']);
    const forced = parseCoverageSynthesisArgs(['--slugs=a', '--ignore-evidence-hash']);
    expect(
      planWriterStep({ snippets, storedHash: writerStoredHashFor(plain, 'h'), freshHash: 'h' }),
    ).toBe('evidence-unchanged');
    expect(
      planWriterStep({ snippets, storedHash: writerStoredHashFor(forced, 'h'), freshHash: 'h' }),
    ).toBe('synthesize');
  });
});

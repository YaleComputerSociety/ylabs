import { describe, expect, it } from 'vitest';
import { partitionAttestedEmptyReadsByVocabulary } from '../refuseUnassertedDescriptionsCore';

const read = (runId: string, entityKey = 'fixture-row') => ({
  entityKey,
  sourceUrl: 'https://example.edu/lab/fixture/',
  runId,
});

describe('the refusal pass counts only attestations recorded with the refusal vocabulary (#3739)', () => {
  it('excludes every attestation from a run that predates the vocabulary', () => {
    const reads = [read('pre-1'), read('pre-2'), read('post-1'), read('post-1', 'other-row')];

    const { counted, excludedPreVocabulary } = partitionAttestedEmptyReadsByVocabulary(
      reads,
      new Set(['post-1']),
    );

    expect(counted.map((entry) => entry.runId)).toEqual(['post-1', 'post-1']);
    expect(excludedPreVocabulary).toBe(2);
  });

  it('counts nothing when no run recorded the vocabulary, so two stale reads cannot plan a refusal', () => {
    const { counted, excludedPreVocabulary } = partitionAttestedEmptyReadsByVocabulary(
      [read('pre-1'), read('pre-2')],
      new Set(),
    );

    expect(counted).toEqual([]);
    expect(excludedPreVocabulary).toBe(2);
  });
});

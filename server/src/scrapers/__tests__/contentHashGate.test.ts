import { afterEach, describe, it, expect, vi } from 'vitest';
import mongoose from 'mongoose';
import { Observation } from '../../models/observation';
import {
  computeContentHash,
  computeVersionedContentHash,
  contentHashObservation,
  contentUnchanged,
  descriptionHashObservations,
  loadStoredLaneDescription,
  SOURCE_CONTENT_HASH_FIELD,
} from '../contentHashGate';

describe('computeContentHash', () => {
  it('is deterministic for identical input', () => {
    expect(computeContentHash('<html>lab</html>')).toBe(computeContentHash('<html>lab</html>'));
  });

  it('differs when content changes', () => {
    expect(computeContentHash('<html>lab a</html>')).not.toBe(
      computeContentHash('<html>lab b</html>'),
    );
  });
});

describe('computeVersionedContentHash', () => {
  const bytes = '<html>lab</html>';

  it('skips when bytes, prompt version, and model are all unchanged', () => {
    const stored = computeVersionedContentHash(bytes, 'v1', 'gpt-5-mini');
    const fresh = computeVersionedContentHash(bytes, 'v1', 'gpt-5-mini');
    expect(contentUnchanged(stored, fresh, false)).toBe(true);
  });

  it('re-runs when only the prompt version changes', () => {
    const stored = computeVersionedContentHash(bytes, 'v1', 'gpt-5-mini');
    const fresh = computeVersionedContentHash(bytes, 'v2', 'gpt-5-mini');
    expect(fresh).not.toBe(stored);
    expect(contentUnchanged(stored, fresh, false)).toBe(false);
  });

  it('re-runs when only the model changes', () => {
    const stored = computeVersionedContentHash(bytes, 'v1', 'gpt-5-mini');
    const fresh = computeVersionedContentHash(bytes, 'v1', 'gpt-4o-mini');
    expect(fresh).not.toBe(stored);
    expect(contentUnchanged(stored, fresh, false)).toBe(false);
  });

  it('force-llm bypasses even when the versioned hash matches', () => {
    const hash = computeVersionedContentHash(bytes, 'v1', 'gpt-5-mini');
    expect(contentUnchanged(hash, hash, true)).toBe(false);
  });

  it('differs from the bytes-only hash so pre-versioning rows re-extract once', () => {
    expect(computeVersionedContentHash(bytes, 'v1', 'gpt-5-mini')).not.toBe(
      computeContentHash(bytes),
    );
  });
});

describe('contentUnchanged', () => {
  const hash = computeContentHash('page');

  it('skips when a matching stored hash exists and not forced', () => {
    expect(contentUnchanged(hash, hash, false)).toBe(true);
  });

  it('does not skip when no prior hash was stored', () => {
    expect(contentUnchanged(undefined, hash, false)).toBe(false);
  });

  it('does not skip when the fresh hash differs', () => {
    expect(contentUnchanged(computeContentHash('old'), hash, false)).toBe(false);
  });

  it('never skips under forceLlm even when hashes match', () => {
    expect(contentUnchanged(hash, hash, true)).toBe(false);
  });
});

describe('contentHashObservation', () => {
  it('builds a bookkeeping observation carrying the entity ref and hash', () => {
    const hash = computeContentHash('page');
    const observation = contentHashObservation(
      { entityType: 'researchEntity', entityKey: 'smith-lab' },
      'https://example.edu/lab',
      hash,
    );
    expect(observation).toEqual({
      entityType: 'researchEntity',
      entityId: undefined,
      entityKey: 'smith-lab',
      field: SOURCE_CONTENT_HASH_FIELD,
      value: hash,
      sourceUrl: 'https://example.edu/lab',
    });
  });
});

describe('descriptionHashObservations', () => {
  const hash = [
    contentHashObservation(
      { entityType: 'researchEntity', entityKey: 'smith-lab' },
      'https://example.edu/lab',
      'abc',
    ),
  ];
  const observation = (field: string, value: unknown) => ({
    entityType: 'researchEntity' as const,
    entityKey: 'smith-lab',
    sourceUrl: 'https://example.edu/lab',
    field,
    value,
  });

  it('records the hash when the run produced both description fields', () => {
    const emitted = [
      observation('fullDescription', 'The lab studies protein folding kinetics in living cells.'),
      observation('shortDescription', 'Studies protein folding kinetics.'),
    ];
    expect(descriptionHashObservations(emitted, hash)).toEqual(hash);
  });

  it('withholds the hash when a full description was produced without a card', () => {
    const emitted = [
      observation('fullDescription', 'The lab studies protein folding kinetics in living cells.'),
    ];
    expect(descriptionHashObservations(emitted, hash)).toEqual([]);
  });

  it('withholds the hash when the card is present but blank', () => {
    const emitted = [
      observation('fullDescription', 'The lab studies protein folding kinetics in living cells.'),
      observation('shortDescription', '   '),
    ];
    expect(descriptionHashObservations(emitted, hash)).toEqual([]);
  });

  it('records the hash when the run produced no description at all, so unchanged content is not re-read', () => {
    expect(descriptionHashObservations([observation('methods', ['western blot'])], hash)).toEqual(
      hash,
    );
    expect(descriptionHashObservations([], hash)).toEqual(hash);
  });

  // The open retry was unbounded, so a row whose card never succeeds paid for a page read and a
  // model call on every sweep forever: 362 rows on Development carried no stored hash at all
  // (#3840). The bound is the description rather than a counter, because an identical value is
  // diff-skipped and writes nothing, so the observation log cannot count attempts.
  const PROSE = 'The lab studies protein folding kinetics in living cells.';

  it('closes the retry when the run re-derived the same description and still produced no card', () => {
    const emitted = [observation('fullDescription', PROSE)];
    expect(descriptionHashObservations(emitted, hash, PROSE)).toEqual(hash);
  });

  it('keeps the retry open when the description changed, which is the case a card retry can fix', () => {
    const emitted = [observation('fullDescription', PROSE)];
    expect(descriptionHashObservations(emitted, hash, 'Something the lab used to say.')).toEqual(
      [],
    );
  });

  // Fail open: a lookup that cannot answer must not close a decision on the row's behalf, which
  // is the same contract `loadStoredContentHash` keeps.
  it('keeps the retry open on a first-seen description', () => {
    const emitted = [observation('fullDescription', PROSE)];
    expect(descriptionHashObservations(emitted, hash, undefined)).toEqual([]);
    expect(descriptionHashObservations(emitted, hash, '   ')).toEqual([]);
  });

  it('compares on trimmed text, so whitespace alone does not reopen a closed retry', () => {
    const emitted = [observation('fullDescription', `  ${PROSE}  `)];
    expect(descriptionHashObservations(emitted, hash, PROSE)).toEqual(hash);
  });

  it('compares against the stored form, so paragraph breaks do not keep the retry open', () => {
    const emitted = [
      observation(
        'fullDescription',
        'The lab studies protein folding kinetics.\n\nIt also studies living cells.',
      ),
    ];
    const stored = 'The lab studies protein folding kinetics. It also studies living cells.';
    expect(descriptionHashObservations(emitted, hash, stored)).toEqual(hash);
  });

  it('still records the hash when a card was produced, whatever the stored description says', () => {
    const emitted = [
      observation('fullDescription', PROSE),
      observation('shortDescription', 'Studies protein folding kinetics.'),
    ];
    expect(descriptionHashObservations(emitted, hash, 'Something else entirely.')).toEqual(hash);
  });

  it('passes an already-withheld hash through unchanged', () => {
    const emitted = [
      observation('fullDescription', 'The lab studies protein folding kinetics in living cells.'),
      observation('shortDescription', 'Studies protein folding kinetics.'),
    ];
    expect(descriptionHashObservations(emitted, [])).toEqual([]);
  });
});

describe('loadStoredLaneDescription', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('answers undefined instead of throwing when the lookup fails, so paid output is still emitted', async () => {
    vi.spyOn(mongoose.connection, 'readyState', 'get').mockReturnValue(1);
    vi.spyOn(Observation, 'findOne').mockReturnValue({
      sort: () => ({
        select: () => ({ lean: () => Promise.reject(new Error('connection reset')) }),
      }),
    } as unknown as ReturnType<typeof Observation.findOne>);

    await expect(
      loadStoredLaneDescription('lab-microsite-description-llm', {
        entityType: 'researchEntity',
        entityId: 'entity-1',
      }),
    ).resolves.toBeUndefined();
  });
});

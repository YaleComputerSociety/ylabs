import { describe, it, expect } from 'vitest';
import {
  computeContentHash,
  contentHashObservation,
  contentUnchanged,
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

import { describe, expect, it } from 'vitest';
import { normalizeDuplicateAccessSignalObjectId } from '../repairDuplicateAccessSignals';

describe('repairDuplicateAccessSignals', () => {
  it('normalizes duplicate access-signal ObjectIds without object-shaped coercion', () => {
    expect(normalizeDuplicateAccessSignalObjectId(' 507f1f77bcf86cd799439011 ')).toBe(
      '507f1f77bcf86cd799439011',
    );
    expect(normalizeDuplicateAccessSignalObjectId('abcdefghijkl')).toBeUndefined();
    expect(
      normalizeDuplicateAccessSignalObjectId({
        toString: () => '507f1f77bcf86cd799439011',
      }),
    ).toBeUndefined();
  });
});

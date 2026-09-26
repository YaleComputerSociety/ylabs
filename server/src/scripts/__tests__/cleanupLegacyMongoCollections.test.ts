import { describe, expect, it } from 'vitest';

import {
  normalizeLegacyCleanupObjectId,
  retiredIndexKeyMatches,
} from '../cleanupLegacyMongoCollections';

describe('cleanupLegacyMongoCollections id handling', () => {
  it('rejects object-shaped ids without coercion', () => {
    const objectShapedId = {
      toString: () => '507f1f77bcf86cd799439011',
    };

    expect(normalizeLegacyCleanupObjectId(objectShapedId)).toBeUndefined();
    expect(normalizeLegacyCleanupObjectId(' 507f1f77bcf86cd799439011 ')?.toHexString()).toBe(
      '507f1f77bcf86cd799439011',
    );
  });
});

describe('retiredIndexKeyMatches', () => {
  const declared = { parentTermId: 1, kind: 1, status: 1, archived: 1 };

  it('matches only the exact declared key, in order', () => {
    expect(retiredIndexKeyMatches({ ...declared }, declared)).toBe(true);
    expect(
      retiredIndexKeyMatches({ kind: 1, parentTermId: 1, status: 1, archived: 1 }, declared),
    ).toBe(false);
  });

  it('refuses a same-named index that gained, lost, or reversed a field', () => {
    expect(retiredIndexKeyMatches({ parentTermId: 1, kind: 1, status: 1 }, declared)).toBe(false);
    expect(
      retiredIndexKeyMatches(
        { parentTermId: 1, kind: 1, status: 1, archived: 1, extra: 1 },
        declared,
      ),
    ).toBe(false);
    expect(
      retiredIndexKeyMatches({ parentTermId: -1, kind: 1, status: 1, archived: 1 }, declared),
    ).toBe(false);
  });

  it('refuses a missing index document', () => {
    expect(retiredIndexKeyMatches(undefined, declared)).toBe(false);
  });
});

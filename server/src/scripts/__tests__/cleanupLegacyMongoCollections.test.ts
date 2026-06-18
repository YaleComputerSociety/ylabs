import { describe, expect, it } from 'vitest';

import { normalizeLegacyCleanupObjectId } from '../cleanupLegacyMongoCollections';

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

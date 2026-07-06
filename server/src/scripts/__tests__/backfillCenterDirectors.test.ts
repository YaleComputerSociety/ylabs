import { describe, expect, it } from 'vitest';

import { normalizeCenterDirectorBackfillObjectId } from '../backfillCenterDirectors';

describe('backfillCenterDirectors id handling', () => {
  it('rejects object-shaped ids without coercion', () => {
    const objectShapedId = {
      toString: () => '507f1f77bcf86cd799439011',
    };

    expect(normalizeCenterDirectorBackfillObjectId(objectShapedId)).toBeUndefined();
    expect(
      normalizeCenterDirectorBackfillObjectId(' 507f1f77bcf86cd799439011 ')?.toHexString(),
    ).toBe('507f1f77bcf86cd799439011');
  });
});

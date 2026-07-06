import { describe, expect, it } from 'vitest';
import { normalizeUserIdentityDedupeObjectId } from '../dedupeUsersByIdentity';

describe('normalizeUserIdentityDedupeObjectId', () => {
  it('rejects object-shaped ids without coercion', () => {
    const objectShapedId = {
      toString: () => '507f1f77bcf86cd799439011',
    };

    expect(normalizeUserIdentityDedupeObjectId(objectShapedId)).toBeUndefined();
    expect(
      normalizeUserIdentityDedupeObjectId(' 507f1f77bcf86cd799439011 ')?.toHexString(),
    ).toBe('507f1f77bcf86cd799439011');
  });
});

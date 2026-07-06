import { describe, expect, it } from 'vitest';

import { normalizePathwayQualityAuditObjectId } from '../pathwayQualityAudit';

describe('pathwayQualityAudit id handling', () => {
  it('rejects object-shaped ids without coercion', () => {
    const objectShapedId = {
      toString: () => '507f1f77bcf86cd799439011',
    };

    expect(normalizePathwayQualityAuditObjectId(objectShapedId)).toBeUndefined();
    expect(normalizePathwayQualityAuditObjectId(' 507f1f77bcf86cd799439011 ')?.toHexString()).toBe(
      '507f1f77bcf86cd799439011',
    );
  });
});

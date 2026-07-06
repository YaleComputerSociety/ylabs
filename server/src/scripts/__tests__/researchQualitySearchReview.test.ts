import { describe, expect, it } from 'vitest';

import { normalizeResearchQualitySearchReviewObjectId } from '../researchQualitySearchReview';

describe('researchQualitySearchReview id handling', () => {
  it('rejects object-shaped ids without coercion', () => {
    const objectShapedId = {
      toString: () => '507f1f77bcf86cd799439011',
    };

    expect(normalizeResearchQualitySearchReviewObjectId(objectShapedId)).toBeUndefined();
    expect(
      normalizeResearchQualitySearchReviewObjectId(' 507f1f77bcf86cd799439011 ')?.toHexString(),
    ).toBe('507f1f77bcf86cd799439011');
  });
});

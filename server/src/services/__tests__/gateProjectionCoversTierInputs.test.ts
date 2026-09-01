import { describe, expect, it } from 'vitest';

import { researchEntityGateProjection } from '../studentVisibilityGateService';

// Pins the #2242 bug class: a field the tier computation reads but the gate
// projection omits arrives as `undefined`, so the branch depending on it silently
// never fires and the gate still reports a clean result. That is how both
// operator suppression markers were inert.
describe('the gate projection covers every field the tier computation reads', () => {
  const projected = new Set(researchEntityGateProjection.split(/\s+/).filter(Boolean));

  const REQUIRED = [
    // operator suppression markers - research_infrastructure_only and
    // permanently_closed (#2284) both read this single field
    'studentVisibilitySuppressionReason',
    'studentVisibilityOverrideTier',
    'activeAtYaleCache',
    'yaleStatusCache',
    // description and card inputs
    'shortDescription',
    'fullDescription',
    'descriptionSource',
    'researchAreas',
    // identity and duplicate-risk inputs
    'websiteUrl',
    'sourceUrls',
    'entityType',
    'kind',
    'name',
    'displayName',
    'slug',
  ];

  it.each(REQUIRED)('projects %s', (field) => {
    expect(projected.has(field)).toBe(true);
  });

  it('projects studentVisibilitySuppressionReason, without which both markers are inert', () => {
    expect(researchEntityGateProjection).toContain('studentVisibilitySuppressionReason');
  });
});

import { describe, expect, it } from 'vitest';

import { buildResearchEntityQualitySummary } from '../researchEntityQuality';

describe('buildResearchEntityQualitySummary', () => {
  it('flags a sparse profile with no lead as the highest-priority repair case', () => {
    const summary = buildResearchEntityQualitySummary({
      entity: {
        description: '',
        shortDescription: '',
        fullDescription: '',
        profileSynthesisDescription: '',
        sourceUrls: [],
      },
      leadMembers: [],
    });

    expect(summary.descriptionState).toBe('missing');
    expect(summary.leadState).toBe('lead_missing');
    expect(summary.repairFlags).toEqual([
      'missing_description',
      'missing_lead',
      'missing_source_url',
    ]);
    expect(summary.score).toBeGreaterThanOrEqual(90);
  });

  it('treats profile synthesis with an attached lead as useful but still repairable', () => {
    const summary = buildResearchEntityQualitySummary({
      entity: {
        fullDescription: '',
        shortDescription: '',
        description: '',
        profileSynthesisDescription:
          'It appears to center on American decorative arts, material culture, and furniture history.',
        sourceUrls: ['https://historyofart.yale.edu/people/edward-cooke'],
      },
      leadMembers: [{ role: 'pi', userId: 'user-1', sourceUrl: 'https://example.yale.edu' }],
    });

    expect(summary.descriptionState).toBe('profile_synthesis');
    expect(summary.leadState).toBe('lead_attached');
    expect(summary.repairFlags).toEqual(['profile_fallback_only']);
    expect(summary.score).toBeLessThan(90);
  });
});

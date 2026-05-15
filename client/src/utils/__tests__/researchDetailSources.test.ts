import { describe, expect, it } from 'vitest';

import { buildResearchDetailSources } from '../researchDetailSources';

describe('buildResearchDetailSources', () => {
  it('deduplicates repeated evidence, pathway, and route URLs into one source row', () => {
    const sources = buildResearchDetailSources({
      group: {
        name: 'Wu Tsai Institute',
        websiteUrl: 'https://wti.yale.edu/humans/faculty',
        sourceUrls: ['https://wti.yale.edu/initiatives/undergraduate'],
      },
      pathways: [
        {
          _id: 'pathway-1',
          sourceUrls: [
            'https://wti.yale.edu/initiatives/undergraduate',
            'https://wti.yale.edu/initiatives/undergraduate/',
          ],
        },
      ],
      accessSignals: [
        {
          _id: 'signal-1',
          signalType: 'REACH_OUT_PLAUSIBLE',
          sourceUrl: 'https://wti.yale.edu/initiatives/undergraduate',
        },
      ],
      contactRoutes: [
        {
          _id: 'route-1',
          routeType: 'OFFICIAL_APPLICATION',
          label: 'Official Application',
          url: 'https://wti.yale.edu/initiatives/undergraduate',
          sourceUrl: 'https://wti.yale.edu/initiatives/undergraduate',
        },
      ],
      postedOpportunities: [],
    });

    expect(sources.map((source) => source.url)).toEqual([
      'https://wti.yale.edu/humans/faculty',
      'https://wti.yale.edu/initiatives/undergraduate',
    ]);
    expect(sources[1].label).toBe('Undergraduate initiatives page');
    expect(sources[1].contexts).toEqual([
      'Profile source',
      'Pathway source',
      'Reach Out Plausible evidence',
      'Official Application route',
    ]);
  });
});

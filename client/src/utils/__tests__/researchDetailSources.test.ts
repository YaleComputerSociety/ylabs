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

  it('prefers the research website over department roster provenance in public sources', () => {
    const sources = buildResearchDetailSources({
      group: {
        websiteUrl: 'https://campuspress.yale.edu/stucci/',
        sourceUrls: [
          'https://eeb.yale.edu/people/faculty',
          'https://eeb.yale.edu/people/faculty-affiliated/serena-tucci',
          'https://campuspress.yale.edu/stucci/',
        ],
      },
      pathways: [
        {
          sourceUrls: [
            'https://eeb.yale.edu/people/faculty-affiliated/serena-tucci',
            'https://campuspress.yale.edu/stucci/',
          ],
        },
      ],
      accessSignals: [
        {
          signalType: 'REACH_OUT_PLAUSIBLE',
          sourceUrl: 'https://eeb.yale.edu/people/faculty-affiliated/serena-tucci',
        },
      ],
      contactRoutes: [
        {
          routeType: 'FACULTY_PI',
          label: 'Serena Tucci',
          url: 'https://eeb.yale.edu/people/faculty-affiliated/serena-tucci',
          sourceUrl: 'https://eeb.yale.edu/people/faculty-affiliated/serena-tucci',
        },
      ],
      postedOpportunities: [],
    });

    expect(sources.map((source) => source.url)).toEqual([
      'https://campuspress.yale.edu/stucci',
    ]);
    expect(sources[0].label).toBe('Research website');
    expect(sources[0].contexts).toEqual(['Profile website', 'Profile source', 'Pathway source']);
  });

  it('keeps the lab website and official profile while hiding the faculty roster list', () => {
    const sources = buildResearchDetailSources({
      group: {
        websiteUrl: 'https://emonet.biology.yale.edu/',
        sourceUrls: [
          'https://mcdb.yale.edu/people/faculty',
          'https://mcdb.yale.edu/profile/thierry-emonet-phd',
          'https://emonet.biology.yale.edu/',
        ],
      },
      pathways: [],
      accessSignals: [],
      contactRoutes: [],
      postedOpportunities: [],
    });

    expect(sources.map((source) => source.url)).toEqual([
      'https://emonet.biology.yale.edu',
      'https://mcdb.yale.edu/profile/thierry-emonet-phd',
    ]);
    expect(sources.map((source) => source.label)).toEqual([
      'Research website',
      'Thierry Emonet Phd page',
    ]);
  });

  it('renders decoded PDF source labels instead of URL-encoded page headings', () => {
    const sources = buildResearchDetailSources({
      group: {
        websiteUrl: '',
        sourceUrls: ['https://stars.yale.edu/files/2025%20stars2%20symposium.pdf'],
      },
    });

    expect(sources[0].label).toBe('2025 Stars2 Symposium PDF');
  });

  it('never surfaces department faculty roster pages as detail sources', () => {
    const sources = buildResearchDetailSources({
      group: {
        websiteUrl: '',
        sourceUrls: ['https://egc.yale.edu/people/faculty'],
      },
    });

    expect(sources).toEqual([]);
  });

  it('never surfaces Engineering load_faculty roster endpoints as detail sources', () => {
    const sources = buildResearchDetailSources({
      group: {
        websiteUrl: 'https://www.cs.yale.edu/homes/wibisono/',
        sourceUrls: [
          'https://engineering.yale.edu/academic-study/departments/computer-science/faculty/load_faculty/4841',
          'https://www.cs.yale.edu/homes/wibisono/',
        ],
      },
    });

    expect(sources.map((source) => source.url)).toEqual([
      'https://www.cs.yale.edu/homes/wibisono',
    ]);
  });

  it('never surfaces forbidden Engineering faculty-directory profile pages as detail sources', () => {
    const sources = buildResearchDetailSources({
      group: {
        websiteUrl: 'https://quanquancliu.com/',
        sourceUrls: [
          'https://engineering.yale.edu/research-and-faculty/faculty-directory/quanquan-liu',
          'https://quanquancliu.com/',
        ],
      },
      pathways: [
        {
          sourceUrls: [
            'https://engineering.yale.edu/research-and-faculty/faculty-directory/quanquan-liu',
          ],
        },
      ],
      accessSignals: [
        {
          signalType: 'REACH_OUT_PLAUSIBLE',
          sourceUrl: 'https://engineering.yale.edu/research-and-faculty/faculty-directory/quanquan-liu',
        },
      ],
      contactRoutes: [
        {
          routeType: 'FACULTY_PI',
          label: 'Quanquan Liu',
          url: 'https://engineering.yale.edu/research-and-faculty/faculty-directory/quanquan-liu',
          sourceUrl: 'https://engineering.yale.edu/research-and-faculty/faculty-directory/quanquan-liu',
        },
      ],
    });

    expect(sources.map((source) => source.url)).toEqual(['https://quanquancliu.com']);
    expect(sources[0].contexts).toEqual(['Profile website', 'Profile source']);
  });
});

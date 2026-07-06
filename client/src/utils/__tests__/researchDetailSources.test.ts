import { describe, expect, it } from 'vitest';

import { buildResearchDetailSources } from '../researchDetailSources';

describe('buildResearchDetailSources', () => {
  it('deduplicates repeated evidence, pathway, and route URLs into one source row', () => {
    const profileUrl = 'https://research-home.example.test/faculty';
    const pathwayUrl = 'https://program.example.test/initiatives/undergraduate';

    const sources = buildResearchDetailSources({
      group: {
        name: 'Example Institute',
        websiteUrl: profileUrl,
        sourceUrls: [pathwayUrl],
      },
      pathways: [
        {
          _id: 'pathway-1',
          sourceUrls: [pathwayUrl, `${pathwayUrl}/`],
        },
      ],
      accessSignals: [
        {
          _id: 'signal-1',
          signalType: 'REACH_OUT_PLAUSIBLE',
          sourceUrl: pathwayUrl,
        },
      ],
      contactRoutes: [
        {
          _id: 'route-1',
          routeType: 'OFFICIAL_APPLICATION',
          label: 'Official Application',
          url: pathwayUrl,
          sourceUrl: pathwayUrl,
        },
      ],
      postedOpportunities: [],
    });

    expect(sources.map((source) => source.url)).toEqual([profileUrl, pathwayUrl]);
    expect(sources[1].label).toBe('program.example.test source');
    expect(sources[1].contexts).toHaveLength(4);
    expect(sources[1].contexts).toEqual(
      expect.arrayContaining([
        'Profile source',
        'Pathway source',
        'Reach Out Plausible evidence',
        'Official Application route',
      ]),
    );
  });

  it('prefers the research website over department roster provenance in public sources', () => {
    const researchWebsite = 'https://research-home.example.test';
    const facultyProfileUrl = 'https://example.yale.edu/people/faculty-affiliated/example-person';

    const sources = buildResearchDetailSources({
      group: {
        websiteUrl: `${researchWebsite}/`,
        sourceUrls: [
          'https://example.yale.edu/people/faculty',
          facultyProfileUrl,
          `${researchWebsite}/`,
        ],
      },
      pathways: [
        {
          sourceUrls: [facultyProfileUrl, `${researchWebsite}/`],
        },
      ],
      accessSignals: [
        {
          signalType: 'REACH_OUT_PLAUSIBLE',
          sourceUrl: facultyProfileUrl,
        },
      ],
      contactRoutes: [
        {
          routeType: 'FACULTY_PI',
          label: 'Faculty contact',
          url: facultyProfileUrl,
          sourceUrl: facultyProfileUrl,
        },
      ],
      postedOpportunities: [],
    });

    expect(sources.map((source) => source.url)).toEqual([researchWebsite]);
    expect(sources[0].label).toBe('Research website');
    expect(sources[0].contexts).toHaveLength(3);
    expect(sources[0].contexts).toEqual(
      expect.arrayContaining(['Profile website', 'Profile source', 'Pathway source']),
    );
  });

  it('keeps the lab website and official profile while hiding the faculty roster list', () => {
    const sources = buildResearchDetailSources({
      group: {
        websiteUrl: 'https://lab.example.test/',
        sourceUrls: [
          'https://example.yale.edu/people/faculty',
          'https://example.yale.edu/profile/example-person',
          'https://lab.example.test/',
        ],
      },
      pathways: [],
      accessSignals: [],
      contactRoutes: [],
      postedOpportunities: [],
    });

    expect(sources.map((source) => source.url)).toEqual([
      'https://lab.example.test',
      'https://example.yale.edu/profile/example-person',
    ]);
    expect(sources.map((source) => source.label)).toEqual([
      'Research website',
      'Example Person page',
    ]);
  });

  it('renders decoded PDF source labels instead of URL-encoded page headings', () => {
    const sources = buildResearchDetailSources({
      group: {
        websiteUrl: '',
        sourceUrls: ['https://example.yale.edu/files/2025%20student%20symposium.pdf'],
      },
    });

    expect(sources[0].label).toBe('2025 Student Symposium PDF');
  });

  it('never surfaces department faculty roster pages as detail sources', () => {
    const sources = buildResearchDetailSources({
      group: {
        websiteUrl: '',
        sourceUrls: ['https://example.yale.edu/people/faculty'],
      },
    });

    expect(sources).toHaveLength(0);
  });

  it('drops non-HTTP source URL schemes before rendering public source links', () => {
    const sources = buildResearchDetailSources({
      group: {
        websiteUrl: 'javascript:alert(1)',
        sourceUrls: ['data:text/html,<script>alert(1)</script>', 'https://safe.example.edu/source'],
      },
      pathways: [
        {
          sourceUrls: ['mailto:advisor@yale.edu'],
        },
      ],
    });

    expect(sources.map((source) => source.url)).toEqual(['https://safe.example.edu/source']);
  });

  it('never surfaces Engineering load_faculty roster endpoints as detail sources', () => {
    const sources = buildResearchDetailSources({
      group: {
        websiteUrl: 'https://research-home.example.test/',
        sourceUrls: [
          'https://example.yale.edu/academic-study/departments/example/faculty/load_faculty/1234',
          'https://research-home.example.test/',
        ],
      },
    });

    expect(sources.map((source) => source.url)).toEqual(['https://research-home.example.test']);
  });

  it('never surfaces forbidden Engineering faculty-directory profile pages as detail sources', () => {
    const forbiddenProfileUrl =
      'https://engineering.yale.edu/research-and-faculty/faculty-directory/example-person';

    const sources = buildResearchDetailSources({
      group: {
        websiteUrl: 'https://research-home.example.test/',
        sourceUrls: [forbiddenProfileUrl, 'https://research-home.example.test/'],
      },
      pathways: [
        {
          sourceUrls: [forbiddenProfileUrl],
        },
      ],
      accessSignals: [
        {
          signalType: 'REACH_OUT_PLAUSIBLE',
          sourceUrl: forbiddenProfileUrl,
        },
      ],
      contactRoutes: [
        {
          routeType: 'FACULTY_PI',
          label: 'Faculty contact',
          url: forbiddenProfileUrl,
          sourceUrl: forbiddenProfileUrl,
        },
      ],
    });

    expect(sources.map((source) => source.url)).toEqual(['https://research-home.example.test']);
    expect(sources[0].contexts).toHaveLength(2);
    expect(sources[0].contexts).toEqual(
      expect.arrayContaining(['Profile website', 'Profile source']),
    );
  });
});

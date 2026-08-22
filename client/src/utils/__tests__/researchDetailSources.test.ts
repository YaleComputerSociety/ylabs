import { describe, expect, it } from 'vitest';

import {
  buildResearchDetailSources,
  isLikelyUnavailableSourceLink,
} from '../researchDetailSources';

describe('buildResearchDetailSources', () => {
  it('deduplicates repeated evidence URLs into one source row', () => {
    const profileUrl = 'https://research-home.example.test/faculty';
    const evidenceUrl = 'https://program.example.test/initiatives/undergraduate';

    const sources = buildResearchDetailSources({
      group: {
        name: 'Example Institute',
        websiteUrl: profileUrl,
        sourceUrls: [evidenceUrl],
      },
      accessSignals: [
        {
          _id: 'signal-1',
          signalType: 'REACH_OUT_PLAUSIBLE',
          sourceUrl: evidenceUrl,
        },
      ],
    });

    expect(sources.map((source) => source.url)).toEqual([profileUrl, evidenceUrl]);
    expect(sources[1].label).toBe('program.example.test source');
    expect(sources[1].contexts).toHaveLength(2);
    expect(sources[1].contexts).toEqual(
      expect.arrayContaining(['Profile source', 'Reach Out Plausible evidence']),
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
      accessSignals: [
        {
          signalType: 'REACH_OUT_PLAUSIBLE',
          sourceUrl: facultyProfileUrl,
        },
      ],
    });

    expect(sources.map((source) => source.url)).toEqual([researchWebsite]);
    expect(sources[0].label).toBe('Research website');
    expect(sources[0].contexts).toHaveLength(2);
    expect(sources[0].contexts).toEqual(
      expect.arrayContaining(['Profile website', 'Profile source']),
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
      accessSignals: [],
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

  it('never surfaces our own site as a source, only the real external source', () => {
    const sources = buildResearchDetailSources({
      group: {
        websiteUrl: 'https://medicine.yale.edu/lab/qin-yan/',
        sourceUrls: [
          'https://medicine.yale.edu/lab/qin-yan/',
          'https://yalelabs.io/api/research',
          'https://www.yalelabs.io/research/qin-yan-lab',
        ],
      },
      accessSignals: [
        {
          signalType: 'REACH_OUT_PLAUSIBLE',
          sourceUrl: 'https://yalelabs.io/api/research',
        },
      ],
    });

    expect(sources.map((source) => source.url)).toEqual(['https://medicine.yale.edu/lab/qin-yan']);
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
      accessSignals: [
        {
          signalType: 'REACH_OUT_PLAUSIBLE',
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

  it('preserves the query string so award links keep their identifier', () => {
    const awardUrl = 'https://www.nsf.gov/awardsearch/showAward?AWD_ID=2535171';

    const sources = buildResearchDetailSources({
      group: {
        websiteUrl: '',
        sourceUrls: [awardUrl],
      },
    });

    expect(sources.map((source) => source.url)).toEqual([awardUrl]);
  });

  it('keeps distinct award identifiers on separate source rows', () => {
    const firstAward = 'https://www.nsf.gov/awardsearch/showAward?AWD_ID=2535171';
    const secondAward = 'https://www.nsf.gov/awardsearch/showAward?AWD_ID=2521471';

    const sources = buildResearchDetailSources({
      group: {
        websiteUrl: '',
        sourceUrls: [firstAward, secondAward],
      },
    });

    expect(sources.map((source) => source.url)).toEqual([firstAward, secondAward]);
  });

  it('preserves a trailing slash inside a query value and keeps such links distinct', () => {
    const firstUrl = 'https://redirect.example.test/go?next=https://x.example.test/path/';
    const secondUrl = 'https://redirect.example.test/go?next=https://x.example.test/other/';

    const sources = buildResearchDetailSources({
      group: {
        websiteUrl: '',
        sourceUrls: [firstUrl, secondUrl],
      },
    });

    expect(sources.map((source) => source.url)).toEqual([firstUrl, secondUrl]);
  });

  it('hides raw funding-data API endpoints while keeping the specific award page', () => {
    const apiEndpoint = 'https://api.nsf.gov/services/v1/awards.json';
    const awardPage = 'https://www.nsf.gov/awardsearch/showAward?AWD_ID=2535171';

    const sources = buildResearchDetailSources({
      group: {
        websiteUrl: '',
        sourceUrls: [awardPage],
      },
      accessSignals: [
        {
          signalType: 'REACH_OUT_PLAUSIBLE',
          sourceUrl: apiEndpoint,
        },
      ],
    });

    expect(sources.map((source) => source.url)).toEqual([awardPage]);
  });

  it('drops a raw RePORTER API endpoint from the source ledger', () => {
    const sources = buildResearchDetailSources({
      group: {
        websiteUrl: '',
        sourceUrls: ['https://api.reporter.nih.gov/v2/projects/search'],
      },
    });

    expect(sources).toHaveLength(0);
  });

  it('labels the kept NSF award page as NSF Award Search rather than a bare host', () => {
    const awardPage = 'https://www.nsf.gov/awardsearch/showAward?AWD_ID=2535171';

    const sources = buildResearchDetailSources({
      group: {
        websiteUrl: '',
        sourceUrls: [awardPage],
      },
    });

    expect(sources.map((source) => source.label)).toEqual(['NSF Award Search']);
  });

  it('collapses www and bare-host variants of one page into a single source row', () => {
    const sources = buildResearchDetailSources({
      group: {
        websiteUrl: 'https://lab.example.yale.edu/research',
        sourceUrls: ['https://www.lab.example.yale.edu/research/'],
      },
      accessSignals: [
        {
          signalType: 'REACH_OUT_PLAUSIBLE',
          sourceUrl: 'https://www.lab.example.yale.edu/research',
        },
      ],
    });

    expect(sources).toHaveLength(1);
    expect(sources[0].url).toBe('https://lab.example.yale.edu/research');
    expect(sources[0].contexts).toEqual(
      expect.arrayContaining(['Profile website', 'Profile source', 'Reach Out Plausible evidence']),
    );
  });

  it('collapses http and https variants of one page and prefers the https link', () => {
    const sources = buildResearchDetailSources({
      group: {
        websiteUrl: '',
        sourceUrls: ['http://lab.example.yale.edu/join', 'https://lab.example.yale.edu/join'],
      },
    });

    expect(sources).toHaveLength(1);
    expect(sources[0].url).toBe('https://lab.example.yale.edu/join');
  });

  it('dedupes known logistics evidence into the official source ledger', () => {
    const sources = buildResearchDetailSources({
      group: {
        websiteUrl: 'https://example.yale.edu/join',
        sourceUrls: [],
      },
      undergraduateLogistics: {
        claims: [
          {
            claimType: 'COMPENSATION',
            state: 'known',
            evidence: { sourceUrl: 'https://example.yale.edu/join/' },
          },
          {
            claimType: 'MODALITY',
            state: 'conflicting_withheld',
            evidence: { sourceUrl: 'https://private.example.test/conflict' },
          },
        ],
      },
    });

    expect(sources).toHaveLength(1);
    expect(sources[0].contexts).toEqual(['Profile website', 'Compensation logistics evidence']);
    expect(JSON.stringify(sources)).not.toContain('private.example.test');
  });

  it('defaults every source to available when no liveness signal is joined', () => {
    const sources = buildResearchDetailSources({
      group: {
        websiteUrl: 'https://lab.example.test/',
        sourceUrls: ['https://program.example.test/apply'],
      },
    });

    expect(sources.map((source) => source.url)).toEqual([
      'https://lab.example.test',
      'https://program.example.test/apply',
    ]);
    expect(sources.every((source) => source.isLikelyUnavailable === false)).toBe(true);
  });

  it('sorts an UNAVAILABLE link last and marks it while preserving the healthy order', () => {
    const deadUrl = 'https://dead.example.test/lab';
    const liveUrl = 'https://live.example.test/lab';

    const sources = buildResearchDetailSources({
      group: {
        websiteUrl: deadUrl,
        sourceUrls: [liveUrl],
      },
      sourceLinkHealth: [
        { url: deadUrl, healthStatus: 'UNAVAILABLE' },
        { url: liveUrl, healthStatus: 'HEALTHY', httpStatusCode: 200 },
      ],
    });

    expect(sources.map((source) => source.url)).toEqual([liveUrl, deadUrl]);
    expect(sources[0].isLikelyUnavailable).toBe(false);
    expect(sources[1].isLikelyUnavailable).toBe(true);
    expect(sources[1].healthStatus).toBe('UNAVAILABLE');
  });

  it('treats a clearly-dead http status at or above 400 as likely unavailable', () => {
    const notFoundUrl = 'https://gone.example.test/lab';
    const okUrl = 'https://ok.example.test/lab';

    const sources = buildResearchDetailSources({
      group: {
        websiteUrl: notFoundUrl,
        sourceUrls: [okUrl],
      },
      sourceLinkHealth: [
        { url: notFoundUrl, healthStatus: 'UNKNOWN', httpStatusCode: 404 },
        { url: okUrl, healthStatus: 'HEALTHY', httpStatusCode: 200 },
      ],
    });

    expect(sources.map((source) => source.url)).toEqual([okUrl, notFoundUrl]);
    expect(sources[1].isLikelyUnavailable).toBe(true);
    expect(sources[1].httpStatusCode).toBe(404);
  });

  it('keeps REDIRECTED and UNKNOWN links in their original order without a marker', () => {
    const redirectUrl = 'https://redirect.example.test/lab';
    const unknownUrl = 'https://unknown.example.test/lab';

    const sources = buildResearchDetailSources({
      group: {
        websiteUrl: redirectUrl,
        sourceUrls: [unknownUrl],
      },
      sourceLinkHealth: [
        { url: redirectUrl, healthStatus: 'REDIRECTED', httpStatusCode: 302 },
        { url: unknownUrl, healthStatus: 'UNKNOWN' },
      ],
    });

    expect(sources.map((source) => source.url)).toEqual([redirectUrl, unknownUrl]);
    expect(sources.every((source) => source.isLikelyUnavailable === false)).toBe(true);
  });

  it('matches liveness to sources across scheme, www, and trailing-slash differences', () => {
    const sources = buildResearchDetailSources({
      group: {
        websiteUrl: 'https://lab.example.test/research',
        sourceUrls: [],
      },
      sourceLinkHealth: [
        { url: 'http://www.lab.example.test/research/', healthStatus: 'UNAVAILABLE' },
      ],
    });

    expect(sources).toHaveLength(1);
    expect(sources[0].isLikelyUnavailable).toBe(true);
  });
});

describe('isLikelyUnavailableSourceLink', () => {
  it('flags UNAVAILABLE health or any status at or above 400', () => {
    expect(isLikelyUnavailableSourceLink({ healthStatus: 'UNAVAILABLE' })).toBe(true);
    expect(isLikelyUnavailableSourceLink({ httpStatusCode: 500 })).toBe(true);
  });

  it('does not flag healthy, redirected, unknown, or missing health', () => {
    expect(isLikelyUnavailableSourceLink({ healthStatus: 'HEALTHY', httpStatusCode: 200 })).toBe(
      false,
    );
    expect(isLikelyUnavailableSourceLink({ healthStatus: 'REDIRECTED', httpStatusCode: 302 })).toBe(
      false,
    );
    expect(isLikelyUnavailableSourceLink(undefined)).toBe(false);
  });
});

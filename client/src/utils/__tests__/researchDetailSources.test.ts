import { describe, expect, it } from 'vitest';

import {
  buildResearchDetailSources,
  isLikelyUnavailableSourceLink,
  isNonContactableIdentifierSourceUrl,
  isOrgInvolvementSourceUrl,
  isOrgUmbrellaEntity,
  isSuppressedResearchWebsiteCtaUrl,
  resolveOutreachOfficialSource,
  ResearchDetailSource,
} from '../researchDetailSources';

const outreachSource = (
  url: string,
  overrides: Partial<ResearchDetailSource> = {},
): ResearchDetailSource => ({
  url,
  label: 'Official source',
  contexts: ['Profile source'],
  isLikelyUnavailable: false,
  ...overrides,
});

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

  it('surfaces named Engineering faculty-directory person profiles as detail sources', () => {
    const namedProfileUrl =
      'https://engineering.yale.edu/research-and-faculty/faculty-directory/example-person';

    const sources = buildResearchDetailSources({
      group: {
        websiteUrl: 'https://research-home.example.test/',
        sourceUrls: [namedProfileUrl, 'https://research-home.example.test/'],
      },
      accessSignals: [
        {
          signalType: 'REACH_OUT_PLAUSIBLE',
          sourceUrl: namedProfileUrl,
        },
      ],
    });

    expect(sources.map((source) => source.url)).toEqual(
      expect.arrayContaining([namedProfileUrl, 'https://research-home.example.test']),
    );
  });

  it('never surfaces the Engineering faculty-directory root or loader endpoints as detail sources', () => {
    const sources = buildResearchDetailSources({
      group: {
        websiteUrl: 'https://research-home.example.test/',
        sourceUrls: [
          'https://engineering.yale.edu/research-and-faculty/faculty-directory',
          'https://engineering.yale.edu/research-and-faculty/faculty-directory/load_faculty/172',
          'https://research-home.example.test/',
        ],
      },
    });

    expect(sources.map((source) => source.url)).toEqual(['https://research-home.example.test']);
  });

  it('never surfaces research.yale.edu Drupal facet or section-index root URLs as detail sources', () => {
    const sources = buildResearchDetailSources({
      group: {
        websiteUrl: 'https://research.yale.edu/cores/keck-microarray',
        sourceUrls: [
          'https://research.yale.edu/cores?f%5B0%5D=result_type%3A1',
          'https://research.yale.edu/cores',
          'https://research.yale.edu/centers-institutes',
          'https://research.yale.edu/cores/keck-microarray',
        ],
      },
    });

    expect(sources.map((source) => source.url)).toEqual([
      'https://research.yale.edu/cores/keck-microarray',
    ]);
  });

  it('never surfaces multi-host section-index roots as detail sources (#569)', () => {
    const sources = buildResearchDetailSources({
      group: {
        websiteUrl: 'https://jackson.yale.edu/centers-initiatives/kerry-initiative',
        sourceUrls: [
          'https://environment.yale.edu/research/centers',
          'https://jackson.yale.edu/centers-initiatives',
          'https://jackson.yale.edu/centers-initiatives/kerry-initiative',
        ],
      },
    });

    expect(sources.map((source) => source.url)).toEqual([
      'https://jackson.yale.edu/centers-initiatives/kerry-initiative',
    ]);
  });

  it('never surfaces generic CMS/platform boilerplate hosts as detail sources (#572)', () => {
    const sources = buildResearchDetailSources({
      group: {
        websiteUrl: 'http://wordpress.org/',
        sourceUrls: ['http://wordpress.org/', 'https://example-computing-lab.example.org/'],
      },
    });

    expect(sources.map((source) => source.url)).toEqual([
      'https://example-computing-lab.example.org',
    ]);
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

describe('isSuppressedResearchWebsiteCtaUrl', () => {
  it('suppresses directory faculty-roster roots as a website CTA (#569)', () => {
    expect(
      isSuppressedResearchWebsiteCtaUrl('https://isps.yale.edu/team/directory/faculty-fellows'),
    ).toBe(true);
    expect(
      isSuppressedResearchWebsiteCtaUrl('https://environment.yale.edu/directory/faculty'),
    ).toBe(true);
    expect(isSuppressedResearchWebsiteCtaUrl('https://research.yale.edu/centers-institutes/')).toBe(
      true,
    );
    expect(isSuppressedResearchWebsiteCtaUrl('http://wordpress.org/')).toBe(true);
  });

  it('keeps a named per-person directory profile as a website CTA (#556)', () => {
    expect(
      isSuppressedResearchWebsiteCtaUrl(
        'https://environment.yale.edu/directory/faculty/jordan-example',
      ),
    ).toBe(false);
    expect(isSuppressedResearchWebsiteCtaUrl('https://example-computing-lab.example.org/')).toBe(
      false,
    );
  });
});

describe('buildResearchDetailSources directory-roster roots (#569)', () => {
  it('drops a faculty-roster-root websiteUrl but keeps a named per-person profile source', () => {
    const sources = buildResearchDetailSources({
      group: {
        websiteUrl: 'https://isps.yale.edu/team/directory/faculty-fellows',
        sourceUrls: ['https://environment.yale.edu/directory/faculty/jordan-example'],
      },
    });

    expect(sources.map((source) => source.url)).toEqual([
      'https://environment.yale.edu/directory/faculty/jordan-example',
    ]);
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

describe('isNonContactableIdentifierSourceUrl (#651)', () => {
  it('flags ORCID, NIH RePORTER, NSF award search, and Google Scholar hosts', () => {
    expect(isNonContactableIdentifierSourceUrl('https://orcid.org/0000-0000-0000-0000')).toBe(true);
    expect(isNonContactableIdentifierSourceUrl('https://www.orcid.org/0000-0000-0000-0000')).toBe(
      true,
    );
    expect(
      isNonContactableIdentifierSourceUrl('https://reporter.nih.gov/project-details/11163335'),
    ).toBe(true);
    expect(
      isNonContactableIdentifierSourceUrl('https://api.reporter.nih.gov/v2/projects/search'),
    ).toBe(true);
    expect(
      isNonContactableIdentifierSourceUrl('https://www.nsf.gov/awardsearch/showAward?AWD_ID=2535171'),
    ).toBe(true);
    expect(
      isNonContactableIdentifierSourceUrl('https://scholar.google.com/citations?user=example'),
    ).toBe(true);
  });

  it('does not flag a genuine research home or an NSF page outside award search', () => {
    expect(isNonContactableIdentifierSourceUrl('https://neuro.example.yale.edu/lab')).toBe(false);
    expect(isNonContactableIdentifierSourceUrl('https://www.nsf.gov/news/example-item')).toBe(false);
    expect(isNonContactableIdentifierSourceUrl('https://center.example.yale.edu/get-involved')).toBe(
      false,
    );
    expect(isNonContactableIdentifierSourceUrl(undefined)).toBe(false);
  });
});

describe('isOrgInvolvementSourceUrl', () => {
  it('recognizes org-level get-involved, join, contact, and opportunity pages', () => {
    expect(isOrgInvolvementSourceUrl('https://center.example.yale.edu/get-involved')).toBe(true);
    expect(isOrgInvolvementSourceUrl('https://center.example.yale.edu/join-us')).toBe(true);
    expect(isOrgInvolvementSourceUrl('https://center.example.yale.edu/contact-us')).toBe(true);
    expect(isOrgInvolvementSourceUrl('https://center.example.yale.edu/opportunities')).toBe(true);
  });

  it('does not treat a director profile or a plain about page as an involvement page', () => {
    expect(isOrgInvolvementSourceUrl('https://center.example.yale.edu/people/director-jane')).toBe(
      false,
    );
    expect(isOrgInvolvementSourceUrl('https://center.example.yale.edu/about')).toBe(false);
  });
});

describe('isOrgUmbrellaEntity', () => {
  it('treats centers, institutes, and initiatives as umbrella homes', () => {
    expect(isOrgUmbrellaEntity({ entityType: 'CENTER' })).toBe(true);
    expect(isOrgUmbrellaEntity({ entityType: 'INITIATIVE' })).toBe(true);
    expect(isOrgUmbrellaEntity({ kind: 'institute' })).toBe(true);
  });

  it('does not treat labs or faculty research as umbrella homes', () => {
    expect(isOrgUmbrellaEntity({ entityType: 'LAB', kind: 'lab' })).toBe(false);
    expect(isOrgUmbrellaEntity({ kind: 'individual' })).toBe(false);
    expect(isOrgUmbrellaEntity(null)).toBe(false);
  });
});

describe('resolveOutreachOfficialSource (#651)', () => {
  it('falls through to no official source when the only source is an ORCID page', () => {
    const result = resolveOutreachOfficialSource(
      [outreachSource('https://orcid.org/0000-0000-0000-0000')],
      [undefined, undefined],
      false,
    );

    expect(result).toBeUndefined();
  });

  it('falls through when the only sources are NIH RePORTER and NSF award pages', () => {
    const result = resolveOutreachOfficialSource(
      [
        outreachSource('https://reporter.nih.gov/project-details/11163335'),
        outreachSource('https://www.nsf.gov/awardsearch/showAward?AWD_ID=2535171'),
      ],
      [undefined, undefined],
      false,
    );

    expect(result).toBeUndefined();
  });

  it('skips a non-contactable identifier host and returns the contactable page', () => {
    const contactable = outreachSource('https://neuro.example.yale.edu/lab');
    const result = resolveOutreachOfficialSource(
      [outreachSource('https://orcid.org/0000-0000-0000-0000'), contactable],
      [undefined, undefined],
      false,
    );

    expect(result?.url).toBe(contactable.url);
  });

  it('prefers an org-level get-involved page over a director profile for umbrella homes', () => {
    const directorProfile = outreachSource('https://center.example.yale.edu/people/director-jane');
    const getInvolved = outreachSource('https://center.example.yale.edu/get-involved');
    const result = resolveOutreachOfficialSource(
      [directorProfile, getInvolved],
      [undefined, undefined],
      false,
      { prefersOrgLevelPage: true },
    );

    expect(result?.url).toBe(getInvolved.url);
  });

  it('returns the director profile for an umbrella home with no get-involved page', () => {
    const directorProfile = outreachSource('https://center.example.yale.edu/people/director-jane');
    const result = resolveOutreachOfficialSource([directorProfile], [undefined, undefined], false, {
      prefersOrgLevelPage: true,
    });

    expect(result?.url).toBe(directorProfile.url);
  });

  it('keeps first-eligible order for non-umbrella homes', () => {
    const first = outreachSource('https://lab.example.yale.edu/people/pi-jane');
    const getInvolved = outreachSource('https://lab.example.yale.edu/join-us');
    const result = resolveOutreachOfficialSource(
      [first, getInvolved],
      [undefined, undefined],
      false,
    );

    expect(result?.url).toBe(first.url);
  });

  it('skips claimed destinations and likely-unavailable sources', () => {
    const claimed = outreachSource('https://lab.example.yale.edu/home');
    const next = outreachSource('https://lab.example.yale.edu/about');
    const result = resolveOutreachOfficialSource([claimed, next], [claimed.url], false);

    expect(result?.url).toBe(next.url);

    const unavailable = resolveOutreachOfficialSource(
      [outreachSource('https://lab.example.yale.edu/about', { isLikelyUnavailable: true })],
      [undefined, undefined],
      false,
    );

    expect(unavailable).toBeUndefined();
  });

  it('skips a profile-like page when the lead identity is under review', () => {
    const result = resolveOutreachOfficialSource(
      [outreachSource('https://lab.example.yale.edu/people/pi-jane')],
      [undefined, undefined],
      true,
    );

    expect(result).toBeUndefined();
  });
});

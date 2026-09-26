import { describe, expect, it } from 'vitest';

import {
  buildResearchDetailSources,
  firstCitedResearchDetailSource,
  isCitableAccessSignal,
  isDepartmentRosterProvenanceUrl,
  isFileShareSourceUrl,
  isIdentifierOrGrantDbSourceUrl,
  isLikelyOfficialPersonProfileUrl,
  isLikelyUnavailableSourceLink,
  isOrgEngagementSourceUrl,
  isRosterNestedPersonPageUrl,
  isSuppressedResearchWebsiteCtaUrl,
  isUnavailableResearchWebsiteCtaUrl,
  isUnreachableResearchWebsiteCtaUrl,
  officialProfileMirrorKey,
  prefersOrgEngagementOutreach,
  resolveDecisionProfileUrl,
  resolveOutreachOfficialSource,
  ResearchDetailSource,
} from '../researchDetailSources';

const makeSource = (
  url: string,
  overrides: Partial<ResearchDetailSource> = {},
): ResearchDetailSource => ({
  url,
  label: 'Official source',
  contexts: ['Profile source'],
  isLikelyUnavailable: false,
  isPrivateNetworkOnly: false,
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
      'Department profile',
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

  it('collapses one person profile mirrored across department path prefixes into a single row', () => {
    const canonicalProfile = 'https://medicine.yale.edu/profile/zeynep-erson/';
    const labMirror = 'https://medicine.yale.edu/lab/erson/profile/zeynep-erson/';
    const cancerMirror = 'https://medicine.yale.edu/cancer/profile/zeynep-erson/';

    const sources = buildResearchDetailSources({
      group: {
        websiteUrl: 'https://ersonlab.org/',
        sourceUrls: [labMirror, cancerMirror, canonicalProfile, 'https://ersonlab.org/'],
      },
      accessSignals: [
        {
          signalType: 'CURRENT_UNDERGRADS',
          confidence: 'MEDIUM',
          confidenceScore: 0.55,
          sourceUrl: canonicalProfile,
        },
        {
          signalType: 'CONTACT_INSTRUCTIONS_EXIST',
          confidence: 'HIGH',
          confidenceScore: 0.86,
          sourceUrl: canonicalProfile,
        },
      ],
    });

    const profileRows = sources.filter((source) => source.label === 'School directory profile');
    expect(profileRows).toHaveLength(1);
    expect(profileRows[0].url).toBe('https://medicine.yale.edu/profile/zeynep-erson');
    expect(profileRows[0].contexts).toEqual(
      expect.arrayContaining([
        'Profile source',
        'Current Undergrads evidence',
        'Contact Instructions Exist evidence',
      ]),
    );
  });

  it('prefers the shortest-path profile mirror as the canonical displayed URL', () => {
    const sources = buildResearchDetailSources({
      group: {
        websiteUrl: '',
        sourceUrls: [
          'https://medicine.yale.edu/lab/erson/profile/zeynep-erson/',
          'https://medicine.yale.edu/profile/zeynep-erson/',
        ],
      },
    });

    expect(sources.map((source) => source.url)).toEqual([
      'https://medicine.yale.edu/profile/zeynep-erson',
    ]);
  });

  it('keeps distinct people apart even when their profiles share a host', () => {
    const sources = buildResearchDetailSources({
      group: {
        websiteUrl: '',
        sourceUrls: [
          'https://medicine.yale.edu/profile/zeynep-erson/',
          'https://medicine.yale.edu/lab/other/profile/other-person/',
        ],
      },
    });

    expect(sources).toHaveLength(2);
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

  it('never cites a LOW-confidence access signal whose source belongs to an unrelated person (#997)', () => {
    const labWebsite = 'https://medicine.yale.edu/profile/david-glahn';
    const unrelatedPersonUrl = 'https://music.yale.edu/people/david-lang';

    const sources = buildResearchDetailSources({
      group: {
        websiteUrl: labWebsite,
        sourceUrls: [],
      },
      accessSignals: [
        {
          signalType: 'REACH_OUT_PLAUSIBLE',
          confidence: 'LOW',
          confidenceScore: 0.35,
          sourceUrl: unrelatedPersonUrl,
        },
      ],
    });

    expect(sources.map((source) => source.url)).toEqual([labWebsite]);
    expect(JSON.stringify(sources)).not.toContain('music.yale.edu');
  });

  it('drops an access signal whose confidenceScore is below the citable threshold even when labelled MEDIUM', () => {
    const sources = buildResearchDetailSources({
      group: {
        websiteUrl: 'https://lab.example.test/',
        sourceUrls: [],
      },
      accessSignals: [
        {
          signalType: 'REACH_OUT_PLAUSIBLE',
          confidence: 'MEDIUM',
          confidenceScore: 0.3,
          sourceUrl: 'https://unrelated.example.test/person',
        },
      ],
    });

    expect(sources.map((source) => source.url)).toEqual(['https://lab.example.test']);
  });

  it('still cites a corroborating access signal at or above the confidence threshold', () => {
    const evidenceUrl = 'https://lab.example.test/join';

    const sources = buildResearchDetailSources({
      group: {
        websiteUrl: 'https://lab.example.test/',
        sourceUrls: [],
      },
      accessSignals: [
        {
          signalType: 'REACH_OUT_PLAUSIBLE',
          confidence: 'HIGH',
          confidenceScore: 0.9,
          sourceUrl: evidenceUrl,
        },
      ],
    });

    expect(sources.map((source) => source.url)).toEqual(['https://lab.example.test', evidenceUrl]);
  });
});

describe('isCitableAccessSignal', () => {
  it('rejects LOW confidence and sub-threshold scores, accepts stronger or unspecified signals', () => {
    expect(isCitableAccessSignal({ confidence: 'LOW', confidenceScore: 0.35 })).toBe(false);
    expect(isCitableAccessSignal({ confidence: 'low' })).toBe(false);
    expect(isCitableAccessSignal({ confidence: 'MEDIUM', confidenceScore: 0.49 })).toBe(false);
    expect(isCitableAccessSignal({ confidence: 'MEDIUM', confidenceScore: 0.5 })).toBe(true);
    expect(isCitableAccessSignal({ confidence: 'HIGH' })).toBe(true);
    expect(isCitableAccessSignal({ signalType: 'REACH_OUT_PLAUSIBLE' })).toBe(true);
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

  it('does not suppress a well-formed lab website on URL shape alone (#934)', () => {
    expect(
      isSuppressedResearchWebsiteCtaUrl(
        'https://jackson.yale.edu/leitner-program-on-effective-democratic-governance/',
      ),
    ).toBe(false);
  });

  it('suppresses file-share and document URLs as a website CTA (#730)', () => {
    expect(isSuppressedResearchWebsiteCtaUrl('https://drive.google.com/open/')).toBe(true);
    expect(
      isSuppressedResearchWebsiteCtaUrl('https://drive.google.com/open?id=abc123&usp=drive_copy'),
    ).toBe(true);
    expect(
      isSuppressedResearchWebsiteCtaUrl('https://docs.google.com/document/d/abc123/edit'),
    ).toBe(true);
    expect(
      isSuppressedResearchWebsiteCtaUrl(
        'https://history.yale.edu/sites/default/files/files/2010-rankin-suburbs.pdf',
      ),
    ).toBe(true);
  });

  it('keeps Google Sites and navigable lab pages as a website CTA (#730)', () => {
    expect(isSuppressedResearchWebsiteCtaUrl('https://sites.google.com/view/example-lab')).toBe(
      false,
    );
    expect(isSuppressedResearchWebsiteCtaUrl('https://chemistry.yale.edu/research/davis-lab')).toBe(
      false,
    );
  });
});

describe('isUnavailableResearchWebsiteCtaUrl (#934)', () => {
  const health = [
    {
      url: 'https://jackson.yale.edu/leitner-program-on-effective-democratic-governance/',
      healthStatus: 'UNAVAILABLE',
      httpStatusCode: 404,
    },
    {
      url: 'https://jackson.yale.edu/centers-initiatives/',
      healthStatus: 'HEALTHY',
      httpStatusCode: 200,
    },
  ];

  it('flags a websiteUrl whose source-link health is UNAVAILABLE', () => {
    expect(
      isUnavailableResearchWebsiteCtaUrl(
        'https://jackson.yale.edu/leitner-program-on-effective-democratic-governance/',
        health,
      ),
    ).toBe(true);
  });

  it('matches health entries regardless of trailing slash or scheme differences', () => {
    expect(
      isUnavailableResearchWebsiteCtaUrl(
        'http://www.jackson.yale.edu/leitner-program-on-effective-democratic-governance',
        health,
      ),
    ).toBe(true);
  });

  it('keeps a healthy websiteUrl usable', () => {
    expect(
      isUnavailableResearchWebsiteCtaUrl('https://jackson.yale.edu/centers-initiatives/', health),
    ).toBe(false);
  });

  it('does not flag when there is no matching health entry or no health data', () => {
    expect(isUnavailableResearchWebsiteCtaUrl('https://example-lab.example.org/', health)).toBe(
      false,
    );
    expect(
      isUnavailableResearchWebsiteCtaUrl(
        'https://jackson.yale.edu/leitner-program-on-effective-democratic-governance/',
      ),
    ).toBe(false);
    expect(isUnavailableResearchWebsiteCtaUrl(undefined, health)).toBe(false);
  });
});

describe('isFileShareSourceUrl (#730)', () => {
  it('flags cloud file-share hosts but keeps Google Sites', () => {
    expect(isFileShareSourceUrl('https://drive.google.com/open/')).toBe(true);
    expect(isFileShareSourceUrl('https://docs.google.com/document/d/abc123/edit')).toBe(true);
    expect(isFileShareSourceUrl('https://www.dropbox.com/s/abc123/file')).toBe(true);
    expect(isFileShareSourceUrl('https://sites.google.com/view/example-lab')).toBe(false);
    expect(isFileShareSourceUrl('https://example-computing-lab.example.org/')).toBe(false);
    expect(isFileShareSourceUrl(undefined)).toBe(false);
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

describe('isIdentifierOrGrantDbSourceUrl', () => {
  it('flags ORCID, NIH RePORTER, NSF, and other identifier/grant-DB hosts', () => {
    expect(isIdentifierOrGrantDbSourceUrl('https://orcid.org/0000-0000-0000-0000')).toBe(true);
    expect(
      isIdentifierOrGrantDbSourceUrl('https://reporter.nih.gov/project-details/10000000'),
    ).toBe(true);
    expect(
      isIdentifierOrGrantDbSourceUrl('https://www.nsf.gov/awardsearch/showAward?AWD_ID=2535171'),
    ).toBe(true);
    expect(isIdentifierOrGrantDbSourceUrl('https://scholar.google.com/citations?user=abc')).toBe(
      true,
    );
    expect(isIdentifierOrGrantDbSourceUrl('https://doi.org/10.1000/example')).toBe(true);
  });

  it('does not flag a genuine research-home website', () => {
    expect(isIdentifierOrGrantDbSourceUrl('https://lab.example.yale.edu/join')).toBe(false);
    expect(isIdentifierOrGrantDbSourceUrl('https://quantuminstitute.yale.edu/get-involved')).toBe(
      false,
    );
    expect(isIdentifierOrGrantDbSourceUrl('')).toBe(false);
  });
});

describe('isOrgEngagementSourceUrl', () => {
  it('recognizes get-involved, join, contact, and membership pages', () => {
    expect(isOrgEngagementSourceUrl('https://institute.example.yale.edu/get-involved')).toBe(true);
    expect(isOrgEngagementSourceUrl('https://institute.example.yale.edu/join-us')).toBe(true);
    expect(isOrgEngagementSourceUrl('https://institute.example.yale.edu/about/contact')).toBe(true);
    expect(isOrgEngagementSourceUrl('https://institute.example.yale.edu/membership')).toBe(true);
  });

  it('does not treat a person profile or plain research page as an engagement page', () => {
    expect(isOrgEngagementSourceUrl('https://institute.example.yale.edu/people/jane-doe')).toBe(
      false,
    );
    expect(isOrgEngagementSourceUrl('https://institute.example.yale.edu/research')).toBe(false);
  });
});

describe('resolveOutreachOfficialSource', () => {
  it('never offers a cross-school mirror as the official page beside a claimed department profile (#2835)', () => {
    const source = resolveOutreachOfficialSource(
      [
        makeSource('http://example.yale.edu/people/fixture-scholar'),
        makeSource('https://medicine.yale.edu/profile/fixture-scholar'),
      ],
      ['http://example.yale.edu/people/fixture-scholar'],
      false,
      'FACULTY_RESEARCH_AREA',
      { schools: ['Faculty of Arts and Sciences'] },
    );

    expect(source).toBeUndefined();
  });

  /**
   * Superseded #2835's narrower rule, which demoted a second profile only when it
   * was another school's mirror. The school it belongs to was never the reason: a
   * second profile is the wrong KIND of thing for a slot that means "this
   * research's own website", so a same-school one is refused too (#2854).
   */
  it('refuses a same-school directory profile beside a claimed profile', () => {
    const source = resolveOutreachOfficialSource(
      [
        makeSource('http://example.yale.edu/people/fixture-scholar'),
        makeSource('https://medicine.yale.edu/profile/fixture-scholar'),
      ],
      ['http://example.yale.edu/people/fixture-scholar'],
      false,
      'FACULTY_RESEARCH_AREA',
      { schools: ['School of Medicine'] },
    );

    expect(source).toBeUndefined();
  });

  /**
   * A roster leaf under a host's person-page prefix is the shared page, not a
   * person's own, so claiming it must not suppress the row's genuine profile source
   * (#2912).
   */
  it('keeps a genuine profile source beside a claimed roster page on a mapped prefix', () => {
    const source = resolveOutreachOfficialSource(
      [makeSource('https://medicine.yale.edu/profile/fixture-scholar')],
      ['https://jackson.yale.edu/directory/faculty-affiliates'],
      false,
      'FACULTY_RESEARCH_AREA',
      { schools: ['School of Medicine'] },
      ['Fixture Scholar'],
    );

    expect(source?.url).toBe('https://medicine.yale.edu/profile/fixture-scholar');
  });

  it('never promotes an ORCID-only home as the primary outreach CTA', () => {
    const source = resolveOutreachOfficialSource(
      [makeSource('https://orcid.org/0000-0000-0000-0000')],
      [],
      false,
    );

    expect(source).toBeUndefined();
  });

  it('never promotes a NIH RePORTER-only home as the primary outreach CTA', () => {
    const source = resolveOutreachOfficialSource(
      [makeSource('https://reporter.nih.gov/project-details/10000000')],
      [],
      false,
    );

    expect(source).toBeUndefined();
  });

  it('never promotes an NSF award-only home as the primary outreach CTA', () => {
    const source = resolveOutreachOfficialSource(
      [makeSource('https://www.nsf.gov/awardsearch/showAward?AWD_ID=2535171')],
      [],
      false,
    );

    expect(source).toBeUndefined();
  });

  it('never promotes a downloadable document as the outreach official source', () => {
    const source = resolveOutreachOfficialSource(
      [makeSource('https://science.yalecollege.yale.edu/sites/default/files/2025%20Symposium.pdf')],
      [],
      false,
    );

    expect(source).toBeUndefined();
  });

  it('prefers a contactable page over a downloadable document', () => {
    const source = resolveOutreachOfficialSource(
      [
        makeSource('https://science.yalecollege.yale.edu/sites/default/files/2025%20Symposium.pdf'),
        makeSource('https://lab.example.yale.edu/contact'),
      ],
      [],
      false,
    );

    expect(source?.url).toBe('https://lab.example.yale.edu/contact');
  });

  // The four refusals below are the shapes the corpus actually holds on the
  // affected rows: two the mirror key collapses, two that only a categorical
  // rule can reach.
  it('treats a sub-path spelling of the claimed profile as already claimed (#2854)', () => {
    const source = resolveOutreachOfficialSource(
      [makeSource('https://medicine.yale.edu/bbs/profile/fixture-scholar/')],
      ['https://medicine.yale.edu/profile/fixture-scholar/'],
      false,
    );

    expect(source).toBeUndefined();
  });

  it('treats a trailing-slash spelling of the claimed profile as already claimed', () => {
    const source = resolveOutreachOfficialSource(
      [makeSource('https://sociology.example.yale.edu/profile/fixture-scholar/')],
      ['https://sociology.example.yale.edu/profile/fixture-scholar'],
      false,
    );

    expect(source).toBeUndefined();
  });

  it('refuses a renamed cohort spelling of the claimed profile', () => {
    const source = resolveOutreachOfficialSource(
      [
        makeSource(
          'http://english.yale.edu/people/tenured-and-tenure-track-faculty-professors-staff/fixture-scholar',
        ),
      ],
      [
        'https://english.yale.edu/people/tenured-and-tenure-track-faculty-professors/fixture-scholar',
      ],
      false,
      'FACULTY_RESEARCH_AREA',
      {},
      ['Fixture Scholar'],
    );

    expect(source).toBeUndefined();
  });

  it('refuses a different cohort page for the same person', () => {
    const source = resolveOutreachOfficialSource(
      [makeSource('https://english.yale.edu/people/professors-emeritus/fixture-scholar')],
      ['https://english.yale.edu/people/tenured-and-tenure-track-faculty-professors/other-scholar'],
      false,
      'FACULTY_RESEARCH_AREA',
      {},
      ['Other Scholar'],
    );

    expect(source).toBeUndefined();
  });

  it('still offers the lab site beside a cohort-nested claimed profile', () => {
    const source = resolveOutreachOfficialSource(
      [makeSource('https://english.yale.edu/fixture-lab')],
      ['https://english.yale.edu/people/professors-emeritus/fixture-scholar'],
      false,
      'FACULTY_RESEARCH_AREA',
      {},
      ['Fixture Scholar'],
    );

    expect(source?.url).toBe('https://english.yale.edu/fixture-lab');
  });

  it('refuses a second path type for the same person, which no dedupe key collapses', () => {
    const source = resolveOutreachOfficialSource(
      [makeSource('https://sociology.example.yale.edu/people/fixture-scholar')],
      ['https://sociology.example.yale.edu/profile/fixture-scholar'],
      false,
    );

    expect(source).toBeUndefined();
  });

  it('refuses a second host for the same person, the joint-appointment case', () => {
    const source = resolveOutreachOfficialSource(
      [makeSource('https://medicine.yale.edu/profile/fixture-scholar/')],
      ['https://eall.example.yale.edu/people/fixture-scholar'],
      false,
    );

    expect(source).toBeUndefined();
  });

  it('still offers a person profile when the page claims none, because it is the only way in', () => {
    const source = resolveOutreachOfficialSource(
      [makeSource('https://medicine.yale.edu/profile/fixture-scholar/')],
      [],
      false,
    );

    expect(source?.url).toBe('https://medicine.yale.edu/profile/fixture-scholar/');
  });

  it("still offers the research's own website beside a claimed profile", () => {
    const source = resolveOutreachOfficialSource(
      [makeSource('https://lab.example.yale.edu/contact')],
      ['https://medicine.yale.edu/profile/fixture-scholar/'],
      false,
    );

    expect(source?.url).toBe('https://lab.example.yale.edu/contact');
  });

  it('falls through to a contactable source when an identifier page is also present', () => {
    const source = resolveOutreachOfficialSource(
      [
        makeSource('https://orcid.org/0000-0000-0000-0000'),
        makeSource('https://lab.example.yale.edu/contact'),
      ],
      [],
      false,
    );

    expect(source?.url).toBe('https://lab.example.yale.edu/contact');
  });

  it('excludes an already-claimed action destination', () => {
    const source = resolveOutreachOfficialSource(
      [makeSource('https://lab.example.yale.edu/')],
      ['https://lab.example.yale.edu'],
      false,
    );

    expect(source).toBeUndefined();
  });

  it('skips a profile-like source while the lead identity is under review', () => {
    const source = resolveOutreachOfficialSource(
      [makeSource('https://example.yale.edu/profile/jane-doe')],
      [],
      true,
    );

    expect(source).toBeUndefined();
  });

  it('prefers an org-level get-involved page over a director profile for an umbrella home', () => {
    const source = resolveOutreachOfficialSource(
      [
        makeSource('https://institute.example.yale.edu/people/director'),
        makeSource('https://institute.example.yale.edu/get-involved'),
      ],
      [],
      false,
      'INSTITUTE',
    );

    expect(source?.url).toBe('https://institute.example.yale.edu/get-involved');
  });

  it('falls back to the director profile for an umbrella home with no get-involved page', () => {
    const source = resolveOutreachOfficialSource(
      [makeSource('https://institute.example.yale.edu/people/director')],
      [],
      false,
      'INSTITUTE',
    );

    expect(source?.url).toBe('https://institute.example.yale.edu/people/director');
  });

  it('does not reorder sources for a non-umbrella entity type', () => {
    const source = resolveOutreachOfficialSource(
      [
        makeSource('https://lab.example.yale.edu/people/pi'),
        makeSource('https://lab.example.yale.edu/get-involved'),
      ],
      [],
      false,
      'LAB',
    );

    expect(source?.url).toBe('https://lab.example.yale.edu/people/pi');
  });

  it('surfaces an official person profile source when no lead PI is attached (#646)', () => {
    const source = resolveOutreachOfficialSource(
      [
        makeSource('https://medicine.yale.edu/lab/tumor-neuroimmunology-lab/'),
        makeSource('https://medicine.yale.edu/profile/benjamin-lu'),
      ],
      [],
      false,
      'LAB',
    );

    expect(source?.url).toBe('https://medicine.yale.edu/profile/benjamin-lu');
  });

  it('does not surface an official person profile source while the lead identity is under review', () => {
    const source = resolveOutreachOfficialSource(
      [makeSource('https://medicine.yale.edu/profile/benjamin-lu')],
      [],
      true,
    );

    expect(source).toBeUndefined();
  });

  it('excludes an already-claimed person profile so it is not surfaced twice', () => {
    const source = resolveOutreachOfficialSource(
      [makeSource('https://medicine.yale.edu/profile/benjamin-lu')],
      ['https://medicine.yale.edu/profile/benjamin-lu/'],
      false,
    );

    expect(source).toBeUndefined();
  });

  it('never offers a research group host root as one person research official page (#2579)', () => {
    const source = resolveOutreachOfficialSource(
      [makeSource('http://het.yale.edu/')],
      [],
      false,
      'FACULTY_RESEARCH_AREA',
    );

    expect(source).toBeUndefined();
  });

  it('refuses the group host root on a row still carrying the retired faculty type', () => {
    const source = resolveOutreachOfficialSource(
      [makeSource('http://het.yale.edu/index.html')],
      [],
      false,
      'FACULTY_RESEARCH',
    );

    expect(source).toBeUndefined();
  });

  it('never offers a department audience recruitment page as one person research official page', () => {
    const source = resolveOutreachOfficialSource(
      [makeSource('http://economics.yale.edu/undergraduate/employment-opportunities')],
      [],
      false,
      'LAB',
    );

    expect(source).toBeUndefined();
  });

  it('never offers a press article as the official page once the website slot is empty (#2532)', () => {
    const source = resolveOutreachOfficialSource(
      [makeSource('https://www.wsj.com/personal-finance/example-24057ac4')],
      [],
      false,
      'LAB',
    );

    expect(source).toBeUndefined();
  });

  it('never offers a dated university news article as the official page (#2532)', () => {
    const source = resolveOutreachOfficialSource(
      [makeSource('https://news.yale.edu/2024/06/05/example-headline')],
      [],
      false,
      'LAB',
    );

    expect(source).toBeUndefined();
  });

  it('prefers a research home over a press article cited by the same row (#2532)', () => {
    const source = resolveOutreachOfficialSource(
      [
        makeSource('https://news.yale.edu/2024/06/05/example-headline'),
        makeSource('https://examplelab.yale.edu/'),
      ],
      [],
      false,
      'LAB',
    );

    expect(source?.url).toBe('https://examplelab.yale.edu/');
  });

  it('keeps a research home whose own path merely reads like news (#2532)', () => {
    const source = resolveOutreachOfficialSource(
      [makeSource('https://examplelab.yale.edu/news/2024/update/')],
      [],
      false,
      'LAB',
    );

    expect(source?.url).toBe('https://examplelab.yale.edu/news/2024/update/');
  });

  it('prefers a page the person research owns over a department audience page', () => {
    const source = resolveOutreachOfficialSource(
      [
        makeSource('http://economics.yale.edu/undergraduate/employment-opportunities'),
        makeSource('https://examplecognitionlab.yale.edu/'),
      ],
      [],
      false,
      'LAB',
    );

    expect(source?.url).toBe('https://examplecognitionlab.yale.edu/');
  });

  it('keeps the group host root for the collective row that owns it', () => {
    const source = resolveOutreachOfficialSource(
      [makeSource('http://het.yale.edu/')],
      [],
      false,
      'CENTER',
    );

    expect(source?.url).toBe('http://het.yale.edu/');
  });

  it('keeps a lab own audience page however the lab organizes its site', () => {
    const source = resolveOutreachOfficialSource(
      [makeSource('https://belieflab.yale.edu/undergraduate/employment-opportunities')],
      [],
      false,
      'LAB',
    );

    expect(source?.url).toBe('https://belieflab.yale.edu/undergraduate/employment-opportunities');
  });
});

describe('resolveDecisionProfileUrl', () => {
  it('refuses a press host carrying a profile path token (#2532)', () => {
    const url = resolveDecisionProfileUrl('https://theconversation.com/profiles/example-author-1', {
      websiteUrl: '',
      sourceUrls: ['https://theconversation.com/profiles/example-author-1'],
    });

    expect(url).toBeUndefined();
  });

  it('keeps the department profile when a press profile token also cites the row (#2532)', () => {
    const url = resolveDecisionProfileUrl('https://theconversation.com/profiles/example-author-1', {
      websiteUrl: '',
      school: 'School of Medicine',
      schools: ['School of Medicine'],
      sourceUrls: [
        'https://theconversation.com/profiles/example-author-1',
        'https://medicine.yale.edu/profile/fixture-scholar/',
      ],
    });

    expect(url).toBe('https://medicine.yale.edu/profile/fixture-scholar');
  });

  it('refuses a press host recorded as the lead official profile (#2532)', () => {
    const url = resolveDecisionProfileUrl(
      'https://nytimes.com/2024/06/05/example-headline.html',
      {
        websiteUrl: '',
        sourceUrls: ['https://nytimes.com/2024/06/05/example-headline.html'],
      },
      'https://nytimes.com/2024/06/05/example-headline.html',
    );

    expect(url).toBeUndefined();
  });

  it('prefers the department profile over a cross-school directory mirror (#2835)', () => {
    const url = resolveDecisionProfileUrl('https://orcid.org/0000-0002-0000-0000', {
      websiteUrl: '',
      school: 'Faculty of Arts and Sciences',
      schools: ['Faculty of Arts and Sciences'],
      sourceUrls: [
        'https://orcid.org/0000-0002-0000-0000',
        'https://medicine.yale.edu/profile/fixture-scholar/',
        'http://example.yale.edu/people/fixture-scholar/',
      ],
    });

    expect(url).toBe('http://example.yale.edu/people/fixture-scholar');
  });

  it('keeps the school directory profile when the row claims that school', () => {
    const url = resolveDecisionProfileUrl('https://medicine.yale.edu/profile/fixture-scholar/', {
      websiteUrl: '',
      school: 'School of Medicine',
      schools: ['School of Medicine', 'Faculty of Arts and Sciences'],
      sourceUrls: [
        'https://medicine.yale.edu/profile/fixture-scholar/',
        'http://example.yale.edu/people/fixture-scholar/',
      ],
    });

    expect(url).toBe('https://medicine.yale.edu/profile/fixture-scholar');
  });

  it('prefers the corroborated lead profile over a mismatched entity website profile (#776)', () => {
    const url = resolveDecisionProfileUrl(
      'https://medicine.yale.edu/profile/david-song/',
      {
        websiteUrl: 'https://medicine.yale.edu/profile/david-song/',
        sourceUrls: [
          'https://medicine.yale.edu/profile/david-song/',
          'https://jackson.yale.edu/person/david-simon/',
        ],
      },
      'https://jackson.yale.edu/person/david-simon/',
    );

    expect(url).toBe('https://jackson.yale.edu/person/david-simon/');
  });

  it('keeps the entity profile when the lead profile is not corroborated by an entity source', () => {
    const url = resolveDecisionProfileUrl(
      'https://profile.example.test/profile/sample-faculty',
      {
        websiteUrl: 'https://profile.example.test/profile/sample-faculty',
        sourceUrls: [],
      },
      'https://medicine.yale.edu/profile/fixture-scholar/',
    );

    expect(url).toBe('https://profile.example.test/profile/sample-faculty');
  });

  it('falls back to the corroborated lead profile when the entity has no profile source', () => {
    const url = resolveDecisionProfileUrl(
      'https://medicine.yale.edu/lab/fixture-steele/',
      {
        websiteUrl: 'https://medicine.yale.edu/lab/fixture-steele/',
        sourceUrls: ['https://medicine.yale.edu/lab/fixture-steele/'],
      },
      'https://medicine.yale.edu/profile/fixture-steele/',
    );

    expect(url).toBe('https://medicine.yale.edu/profile/fixture-steele/');
  });

  it('falls back to the entity profile source when no corroborated lead profile exists', () => {
    const url = resolveDecisionProfileUrl(
      'https://lab.example.yale.edu/',
      {
        websiteUrl: 'https://lab.example.yale.edu/',
        sourceUrls: ['https://example.yale.edu/faculty/jane-doe'],
      },
      undefined,
    );

    expect(url).toBe('https://example.yale.edu/faculty/jane-doe');
  });

  it('fills the profile slot from a host-root person page the row already cites (#2912)', () => {
    const personPage = 'https://law.yale.edu/fixture-ashby';

    const url = resolveDecisionProfileUrl(
      personPage,
      { websiteUrl: personPage, sourceUrls: [personPage] },
      undefined,
      ['Fixture Ashby'],
    );

    expect(url).toBe(personPage);
  });

  it('fills the profile slot from a www-prefixed citation on a mapped host (#2912)', () => {
    const personPage = 'https://www.law.yale.edu/fixture-ashby';

    const url = resolveDecisionProfileUrl(
      personPage,
      { websiteUrl: personPage, sourceUrls: [personPage] },
      undefined,
      ['Fixture Ashby'],
    );

    expect(url).toBe(personPage);
  });

  it("keeps the lead's own recorded profile ahead of a root-mapped personal site (#2912)", () => {
    const personalSite = 'https://campuspress.yale.edu/fixture-ashby';
    const leadOfficialProfile = 'https://wgss.yale.edu/people/fixture-ashby';

    const url = resolveDecisionProfileUrl(
      personalSite,
      { websiteUrl: personalSite, sourceUrls: [personalSite] },
      leadOfficialProfile,
      ['Fixture Ashby'],
    );

    expect(url).toBe(leadOfficialProfile);
  });

  it('keeps a department profile ahead of a personal site on a root-mapped host (#2912)', () => {
    const personalSite = 'https://campuspress.yale.edu/fixture-ashby';
    const departmentProfile = 'https://wgss.yale.edu/people/fixture-ashby';

    const url = resolveDecisionProfileUrl(
      personalSite,
      { websiteUrl: personalSite, sourceUrls: [personalSite, departmentProfile] },
      undefined,
      ['Fixture Ashby'],
    );

    expect(url).toBe(departmentProfile);
  });

  it('leaves the profile slot empty when a host-root page names nobody on the row (#2912)', () => {
    const institutionalPage = 'https://law.yale.edu/ashby-center-global-policy';

    const url = resolveDecisionProfileUrl(
      institutionalPage,
      { websiteUrl: institutionalPage, sourceUrls: [institutionalPage] },
      undefined,
      ['Fixture Ashby'],
    );

    expect(url).toBeUndefined();
  });

  it('leaves the profile slot empty when the row names no lead for a host-root page (#2912)', () => {
    const personPage = 'https://law.yale.edu/fixture-ashby';

    const url = resolveDecisionProfileUrl(personPage, {
      websiteUrl: personPage,
      sourceUrls: [personPage],
    });

    expect(url).toBeUndefined();
  });

  it('fills the profile slot when the lead display name carries a degree suffix (#2912)', () => {
    const personPage = 'https://law.yale.edu/fixture-ashby';

    const url = resolveDecisionProfileUrl(
      personPage,
      { websiteUrl: personPage, sourceUrls: [personPage] },
      undefined,
      ['Fixture Ashby, PhD'],
    );

    expect(url).toBe(personPage);
  });

  it('fills the profile slot from a mapped non-root prefix without a name match (#2912)', () => {
    const personPage = 'https://jackson.yale.edu/directory/a-researcher';

    const url = resolveDecisionProfileUrl(personPage, {
      websiteUrl: personPage,
      sourceUrls: [personPage],
    });

    expect(url).toBe(personPage);
  });

  it('returns no decision profile while the lead identity is under review', () => {
    const url = resolveDecisionProfileUrl(
      'https://example.yale.edu/profile/jane-doe',
      {
        leadIdentityStatus: 'under_review',
        sourceUrls: ['https://example.yale.edu/profile/jane-doe'],
      },
      'https://example.yale.edu/profile/jane-doe',
    );

    expect(url).toBeUndefined();
  });

  it('skips a department roster provenance url when selecting the entity profile', () => {
    const url = resolveDecisionProfileUrl(
      'https://example.yale.edu/people/faculty',
      {
        sourceUrls: [
          'https://example.yale.edu/people/faculty',
          'https://example.yale.edu/profile/jane-doe',
        ],
      },
      undefined,
    );

    expect(url).toBe('https://example.yale.edu/profile/jane-doe');
  });

  it('skips a department-scoped roster slug and serves the person their own profile', () => {
    const url = resolveDecisionProfileUrl(
      'https://ling.yale.edu/people/linguistics-faculty',
      {
        websiteUrl: 'https://sample-researcher.example.test/',
        sourceUrls: [
          'https://ling.yale.edu/profile/sample-researcher',
          'https://ling.yale.edu/people/linguistics-faculty',
          'https://sample-researcher.example.test/',
        ],
      },
      undefined,
    );

    expect(url).toBe('https://ling.yale.edu/profile/sample-researcher');
  });

  it('offers no profile rather than a shared roster when the entity has no own profile', () => {
    const url = resolveDecisionProfileUrl(
      'https://sample-researcher.example.test/',
      {
        websiteUrl: 'https://sample-researcher.example.test/',
        sourceUrls: [
          'https://ling.yale.edu/people/linguistics-faculty',
          'https://sample-researcher.example.test/',
        ],
      },
      undefined,
    );

    expect(url).toBeUndefined();
  });
});

describe('isDepartmentRosterProvenanceUrl', () => {
  it('flags department-scoped and rank-scoped roster slugs, not person profiles', () => {
    expect(
      isDepartmentRosterProvenanceUrl('https://ling.yale.edu/people/linguistics-faculty'),
    ).toBe(true);
    expect(isDepartmentRosterProvenanceUrl('https://english.yale.edu/people/ladder-faculty')).toBe(
      true,
    );
    expect(isDepartmentRosterProvenanceUrl('https://french.yale.edu/people/professors')).toBe(true);
    expect(isDepartmentRosterProvenanceUrl('https://whc.yale.edu/people/our-people')).toBe(true);
    expect(isDepartmentRosterProvenanceUrl('https://ling.yale.edu/profile/tom-example')).toBe(
      false,
    );
    expect(isDepartmentRosterProvenanceUrl('https://ling.yale.edu/people/claire-example')).toBe(
      false,
    );
  });

  it('does not read a long article slug as a roster', () => {
    expect(
      isDepartmentRosterProvenanceUrl(
        'https://law.yale.edu/yls-today/news/professor-alex-example-aims-to-foster-connection',
      ),
    ).toBe(false);
  });
});

describe('prefersOrgEngagementOutreach', () => {
  const engagementSource = makeSource('https://institute.example.yale.edu/get-involved');
  const profileSource = makeSource('https://institute.example.yale.edu/people/director');

  it('prefers the org get-involved page for an umbrella home with no genuine PI lead', () => {
    expect(prefersOrgEngagementOutreach('INSTITUTE', engagementSource, false)).toBe(true);
    expect(prefersOrgEngagementOutreach('CENTER', engagementSource, false)).toBe(true);
    expect(prefersOrgEngagementOutreach('INITIATIVE', engagementSource, false)).toBe(true);
  });

  it('defers to a genuine single PI lead even on an umbrella home', () => {
    expect(prefersOrgEngagementOutreach('INSTITUTE', engagementSource, true)).toBe(false);
  });

  it('does not fire for a non-umbrella entity type', () => {
    expect(prefersOrgEngagementOutreach('LAB', engagementSource, false)).toBe(false);
    expect(prefersOrgEngagementOutreach(undefined, engagementSource, false)).toBe(false);
  });

  it('does not fire when the official source is not an org engagement page', () => {
    expect(prefersOrgEngagementOutreach('INSTITUTE', profileSource, false)).toBe(false);
    expect(prefersOrgEngagementOutreach('INSTITUTE', undefined, false)).toBe(false);
  });
});

describe('isLikelyOfficialPersonProfileUrl (#646)', () => {
  it('accepts an official Yale person profile', () => {
    expect(isLikelyOfficialPersonProfileUrl('https://medicine.yale.edu/profile/benjamin-lu/')).toBe(
      true,
    );
    expect(
      isLikelyOfficialPersonProfileUrl('https://psychology.yale.edu/people/nick-turk-browne'),
    ).toBe(true);
  });

  it('rejects roster, index, and listing pages', () => {
    expect(isLikelyOfficialPersonProfileUrl('https://medicine.yale.edu/people/faculty')).toBe(
      false,
    );
    expect(
      isLikelyOfficialPersonProfileUrl(
        'https://medicine.yale.edu/research-and-faculty/faculty-directory/',
      ),
    ).toBe(false);
    expect(isLikelyOfficialPersonProfileUrl('https://medicine.yale.edu/profile/')).toBe(false);
  });

  it('rejects identifier and grant-database hosts', () => {
    expect(isLikelyOfficialPersonProfileUrl('https://orcid.org/0000-0000-0000-0000')).toBe(false);
    expect(isLikelyOfficialPersonProfileUrl('https://scholar.google.com/citations?user=abc')).toBe(
      false,
    );
    expect(
      isLikelyOfficialPersonProfileUrl('https://reporter.nih.gov/project-details/10000000'),
    ).toBe(false);
    expect(
      isLikelyOfficialPersonProfileUrl('https://www.nsf.gov/awardsearch/showAward?AWD_ID=1'),
    ).toBe(false);
  });

  it('rejects a non-Yale profile host', () => {
    expect(isLikelyOfficialPersonProfileUrl('https://example.com/profile/someone')).toBe(false);
  });
});

describe('officialProfileMirrorKey', () => {
  it('maps mirrored profiles of one person on a host to the same key', () => {
    const key = officialProfileMirrorKey('https://medicine.yale.edu/profile/zeynep-erson/');
    expect(key).not.toBeNull();
    expect(
      officialProfileMirrorKey('https://medicine.yale.edu/lab/erson/profile/zeynep-erson/'),
    ).toBe(key);
    expect(
      officialProfileMirrorKey('https://www.medicine.yale.edu/cancer/profile/zeynep-erson'),
    ).toBe(key);
  });

  it('separates different people and roster or index leaves', () => {
    expect(officialProfileMirrorKey('https://medicine.yale.edu/profile/zeynep-erson/')).not.toBe(
      officialProfileMirrorKey('https://medicine.yale.edu/profile/other-person/'),
    );
    expect(officialProfileMirrorKey('https://medicine.yale.edu/people/faculty')).toBeNull();
    expect(officialProfileMirrorKey('https://medicine.yale.edu/lab/erson/join')).toBeNull();
    expect(officialProfileMirrorKey('https://orcid.org/0000-0000-0000-0000')).toBeNull();
  });

  it('collapses the cohort-nested variants of one person page onto one key', () => {
    const key = officialProfileMirrorKey(
      'https://english.yale.edu/people/tenured-and-tenure-track-faculty-professors/ada-fixture',
    );
    expect(key).not.toBeNull();
    expect(
      officialProfileMirrorKey(
        'http://english.yale.edu/people/tenured-and-tenure-track-faculty-professors-staff/ada-fixture',
      ),
    ).toBe(key);
    expect(
      officialProfileMirrorKey('https://english.yale.edu/people/professors-emeritus/ada-fixture'),
    ).toBe(key);
    expect(officialProfileMirrorKey('https://english.yale.edu/people/ada-fixture')).toBe(key);
    expect(
      officialProfileMirrorKey('https://english.yale.edu/people/professors-emeritus/bo-sample'),
    ).not.toBe(key);
  });
});

describe('isRosterNestedPersonPageUrl', () => {
  it('accepts a person page nested under a rank-named cohort segment', () => {
    expect(
      isRosterNestedPersonPageUrl(
        'https://english.yale.edu/people/tenured-and-tenure-track-faculty-professors/ada-fixture',
      ),
    ).toBe(true);
    expect(
      isRosterNestedPersonPageUrl('https://german.yale.edu/who-we-are/faculty-officers/bo-sample'),
    ).toBe(true);
    expect(
      isRosterNestedPersonPageUrl(
        'https://english.yale.edu/people/adjunct-professors-and-senior-lecturers-creative-writers/cy-placeholder',
      ),
    ).toBe(true);
  });

  it('refuses a roster page, a non-person subtree, and a flat path', () => {
    expect(
      isRosterNestedPersonPageUrl('https://english.yale.edu/people/professors-emeritus/faculty'),
    ).toBe(false);
    expect(isRosterNestedPersonPageUrl('https://english.yale.edu/people/news/ada-fixture')).toBe(
      false,
    );
    expect(isRosterNestedPersonPageUrl('https://english.yale.edu/research/labs/ada-fixture')).toBe(
      false,
    );
    expect(isRosterNestedPersonPageUrl('https://english.yale.edu/people/ada-fixture')).toBe(false);
    expect(
      isRosterNestedPersonPageUrl('https://example.com/people/faculty-officers/ada-fixture'),
    ).toBe(false);
  });
});

describe('isLikelyUnavailableSourceLink', () => {
  it('flags UNAVAILABLE health or a status asserting the resource is gone', () => {
    expect(isLikelyUnavailableSourceLink({ healthStatus: 'UNAVAILABLE' })).toBe(true);
    expect(isLikelyUnavailableSourceLink({ httpStatusCode: 404 })).toBe(true);
    expect(isLikelyUnavailableSourceLink({ httpStatusCode: 410 })).toBe(true);
  });

  // Mirrors the server contract in server/src/services/__tests__/sourceLinkHealth.test.ts:
  // access control, throttling, and outages are inconclusive and never hide a link.
  it.each([401, 403, 429, 500, 503])(
    'does not flag an inconclusive %i status',
    (httpStatusCode) => {
      expect(isLikelyUnavailableSourceLink({ httpStatusCode })).toBe(false);
    },
  );

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

describe('buildResearchDetailSources source attribution', () => {
  const LAB = 'https://example.yale.edu/lab/fixture/';
  const PROFILE = 'https://example.yale.edu/profile/fixture/';
  const MIRROR = 'https://other.yale.edu/profile/fixture/';

  it('says what each source contributed instead of labelling both the same', () => {
    const sources = buildResearchDetailSources({
      group: { sourceUrls: [LAB, PROFILE] },
      sourceFieldContributions: [
        { sourceUrl: LAB, contributions: ['Methods', 'Research summary'] },
        { sourceUrl: PROFILE, contributions: ['Lead identity', 'Undergrad access'] },
      ],
    });

    const contextsFor = (fragment: string) =>
      sources.find((source) => source.url.includes(fragment))?.contexts;
    expect(contextsFor('/lab/fixture')).toEqual(['Methods', 'Research summary']);
    expect(contextsFor('/profile/fixture')).toEqual(['Lead identity', 'Undergrad access']);
  });

  it('distinguishes two profiles of one person, which previously read identically', () => {
    const sources = buildResearchDetailSources({
      group: { sourceUrls: [PROFILE, MIRROR] },
      sourceFieldContributions: [
        { sourceUrl: PROFILE, contributions: ['Lead identity'] },
        { sourceUrl: MIRROR, contributions: ['Research summary'] },
      ],
    });

    expect(sources).toHaveLength(2);
    const contextsFor = (host: string) =>
      sources.find((source) => source.url.includes(host))?.contexts;
    expect(contextsFor('example.yale.edu')).toEqual(['Lead identity']);
    expect(contextsFor('other.yale.edu')).toEqual(['Research summary']);
  });

  it('keeps the generic context for a citation no provenance names', () => {
    const sources = buildResearchDetailSources({
      group: { sourceUrls: [PROFILE] },
      sourceFieldContributions: [],
    });

    expect(sources[0].contexts).toEqual(['Profile source']);
  });

  it('leaves a website or evidence context alone, since those already say what they are', () => {
    const sources = buildResearchDetailSources({
      group: { websiteUrl: LAB, sourceUrls: [] },
      sourceFieldContributions: [{ sourceUrl: LAB, contributions: ['Research summary'] }],
    });

    expect(sources[0].contexts).toEqual(['Profile website']);
    expect(sources[0].label).toBe('Research website');
  });

  it('ignores an attribution entry with no usable label', () => {
    const sources = buildResearchDetailSources({
      group: { sourceUrls: [PROFILE] },
      sourceFieldContributions: [
        { sourceUrl: PROFILE, contributions: [] },
        { sourceUrl: PROFILE, contributions: ['  '] },
      ],
    });

    expect(sources[0].contexts).toEqual(['Profile source']);
  });

  it('matches attribution across a trailing-slash difference, as the ledger key does', () => {
    const sources = buildResearchDetailSources({
      group: { sourceUrls: ['https://example.yale.edu/profile/fixture'] },
      sourceFieldContributions: [{ sourceUrl: PROFILE, contributions: ['Lead identity'] }],
    });

    expect(sources[0].contexts).toEqual(['Lead identity']);
  });
});

/**
 * #2556. A host that resolves only into Yale's private address space is alive and
 * unopenable at the same time, so the website CTA must not offer it while the
 * citation itself stays listed as provenance.
 */
describe('isUnreachableResearchWebsiteCtaUrl', () => {
  const PRIVATE_URL = 'https://internal.example.edu/lab/';
  const PUBLIC_URL = 'https://medicine.yale.edu/lab/a-lab/';
  const health = [
    { url: PRIVATE_URL, healthStatus: 'UNKNOWN', privateAddressHost: true },
    { url: PUBLIC_URL, healthStatus: 'HEALTHY', httpStatusCode: 200 },
  ];

  it('refuses a CTA whose host resolves only into private address space', () => {
    expect(isUnreachableResearchWebsiteCtaUrl(PRIVATE_URL, health)).toBe(true);
    expect(isUnreachableResearchWebsiteCtaUrl('http://www.internal.example.edu/lab', health)).toBe(
      true,
    );
  });

  // The page is not gone, and claiming so would be a different and false statement.
  it('does not read a private-address host as unavailable', () => {
    expect(isUnavailableResearchWebsiteCtaUrl(PRIVATE_URL, health)).toBe(false);
  });

  it('keeps a healthy public Yale host usable', () => {
    expect(isUnreachableResearchWebsiteCtaUrl(PUBLIC_URL, health)).toBe(false);
  });

  it('keeps a merely inconclusive verdict usable', () => {
    expect(
      isUnreachableResearchWebsiteCtaUrl(PUBLIC_URL, [
        { url: PUBLIC_URL, healthStatus: 'UNKNOWN', httpStatusCode: 403 },
      ]),
    ).toBe(false);
  });

  it('fails open with no health data at all', () => {
    expect(isUnreachableResearchWebsiteCtaUrl(PRIVATE_URL)).toBe(false);
    expect(isUnreachableResearchWebsiteCtaUrl(undefined, health)).toBe(false);
  });

  it('qualifies the source row instead of dropping the citation', () => {
    const sources = buildResearchDetailSources({
      group: { websiteUrl: PRIVATE_URL, sourceUrls: [PUBLIC_URL] },
      sourceLinkHealth: health,
    });
    const privateRow = sources.find((source) => source.url.includes('internal.example.edu'));
    expect(privateRow).toBeDefined();
    expect(privateRow?.isPrivateNetworkOnly).toBe(true);
    expect(privateRow?.isLikelyUnavailable).toBe(false);
    const publicRow = sources.find((source) => source.url.includes('medicine.yale.edu'));
    expect(publicRow).toBeDefined();
    expect(publicRow?.isPrivateNetworkOnly).toBe(false);
  });

  it('never offers a private-address citation as the outreach official source', () => {
    const sources = buildResearchDetailSources({
      group: { websiteUrl: PRIVATE_URL },
      sourceLinkHealth: health,
    });
    expect(
      resolveOutreachOfficialSource(sources, [], false, 'LAB', { schools: [] }),
    ).toBeUndefined();
  });
});

describe('served attribution with no citation of its own (#3341)', () => {
  const CITED = 'https://medicine.yale.edu/lab/fixture-lab';
  const CONTRIBUTOR = 'https://medicine.yale.edu/profile/fixture-scholar';

  const build = () =>
    buildResearchDetailSources({
      group: { sourceUrls: [CITED] },
      sourceFieldContributions: [
        { sourceUrl: CONTRIBUTOR, contributions: ['Research summary', 'Topics'] },
      ],
    });

  it('gives the contributing URL a row instead of discarding the contribution', () => {
    const sources = build();

    expect(sources.map((source) => source.url)).toEqual([CITED, CONTRIBUTOR]);
    const contributor = sources[1];
    expect(contributor.isAttributionOnly).toBe(true);
    expect(contributor.contexts).toEqual(expect.arrayContaining(['Research summary', 'Topics']));
  });

  it('never offers an attribution-only row as the official page', () => {
    // The cited row is claimed, so the attribution-only row is the only candidate left.
    expect(resolveOutreachOfficialSource(build(), [CITED, undefined], false)).toBeUndefined();
  });

  it('keeps an attribution-only row out of the profile resolver fallback', () => {
    expect(firstCitedResearchDetailSource(build())?.url).toBe(CITED);
  });

  it('leaves a cited URL a full citation when a contribution also names it', () => {
    const sources = buildResearchDetailSources({
      group: { sourceUrls: [CITED] },
      sourceFieldContributions: [{ sourceUrl: CITED, contributions: ['Research summary'] }],
    });

    expect(sources).toHaveLength(1);
    expect(sources[0].isAttributionOnly).toBeUndefined();
  });

  it('applies the ordinary source refusals to a contributing URL', () => {
    const sources = buildResearchDetailSources({
      group: { sourceUrls: [CITED] },
      sourceFieldContributions: [
        { sourceUrl: 'https://example.yale.edu/people/faculty', contributions: ['Topics'] },
        { sourceUrl: 'https://api.nsf.gov/awards/123', contributions: ['Topics'] },
        { sourceUrl: 'javascript:alert(1)', contributions: ['Topics'] },
      ],
    });

    expect(sources.map((source) => source.url)).toEqual([CITED]);
  });

  it('adds no row when a contribution carries no label', () => {
    const sources = buildResearchDetailSources({
      group: { sourceUrls: [CITED] },
      sourceFieldContributions: [{ sourceUrl: CONTRIBUTOR, contributions: [] }],
    });

    expect(sources.map((source) => source.url)).toEqual([CITED]);
  });
});

describe('a contribution naming a mirror of a cited page (#3341)', () => {
  const CITED = 'https://medicine.yale.edu/profile/fixture-scholar';
  const MIRROR = 'https://medicine.yale.edu/bbs/profile/fixture-scholar';

  it('attaches its labels to the cited row instead of losing them', () => {
    const sources = buildResearchDetailSources({
      group: { sourceUrls: [CITED] },
      sourceFieldContributions: [{ sourceUrl: MIRROR, contributions: ['Methods', 'Topics'] }],
    });

    expect(sources).toHaveLength(1);
    expect(sources[0].url).toBe(CITED);
    expect(sources[0].isAttributionOnly).toBeUndefined();
    expect(sources[0].contexts).toEqual(['Methods', 'Topics']);
  });

  it('still keys a cohort-renamed spelling onto the cited row', () => {
    const cited =
      'https://english.yale.edu/people/tenured-and-tenure-track-faculty-professors/fixture-scholar';
    const renamed =
      'http://english.yale.edu/people/tenured-and-tenure-track-faculty-professors-staff/fixture-scholar';
    const sources = buildResearchDetailSources({
      group: { sourceUrls: [cited] },
      sourceFieldContributions: [{ sourceUrl: renamed, contributions: ['Research summary'] }],
    });

    expect(sources).toHaveLength(1);
    expect(sources[0].contexts).toEqual(['Research summary']);
  });

  it('keeps a genuinely different page as its own attribution-only row', () => {
    const sources = buildResearchDetailSources({
      group: { sourceUrls: [CITED] },
      sourceFieldContributions: [
        { sourceUrl: 'https://medicine.yale.edu/lab/fixture-lab', contributions: ['Topics'] },
      ],
    });

    expect(sources.map((source) => source.url)).toEqual([
      CITED,
      'https://medicine.yale.edu/lab/fixture-lab',
    ]);
    expect(sources[1].isAttributionOnly).toBe(true);
  });
});

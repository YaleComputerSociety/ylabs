import { describe, expect, it } from 'vitest';

import {
  buildResearchDetailSources,
  isCitableAccessSignal,
  isDepartmentRosterProvenanceUrl,
  isFileShareSourceUrl,
  isIdentifierOrGrantDbSourceUrl,
  isLikelyOfficialPersonProfileUrl,
  isLikelyUnavailableSourceLink,
  isOrgEngagementSourceUrl,
  isSuppressedResearchWebsiteCtaUrl,
  isUnavailableResearchWebsiteCtaUrl,
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

    const profileRows = sources.filter((source) => source.label === 'Zeynep Erson page');
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
});

describe('resolveDecisionProfileUrl', () => {
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
    expect(isDepartmentRosterProvenanceUrl('https://ling.yale.edu/people/linguistics-faculty')).toBe(
      true,
    );
    expect(isDepartmentRosterProvenanceUrl('https://english.yale.edu/people/ladder-faculty')).toBe(
      true,
    );
    expect(isDepartmentRosterProvenanceUrl('https://french.yale.edu/people/professors')).toBe(true);
    expect(isDepartmentRosterProvenanceUrl('https://whc.yale.edu/people/our-people')).toBe(true);
    expect(isDepartmentRosterProvenanceUrl('https://ling.yale.edu/profile/tom-example')).toBe(false);
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

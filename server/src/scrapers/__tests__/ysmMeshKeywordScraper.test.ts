import { describe, expect, it } from 'vitest';
import {
  YsmMeshKeywordScraper,
  candidateEntityFromDoc,
  facultyNameMatchKey,
  isYsmListingOrFacetUrl,
  isYsmProfileUrl,
  normalizeYsmProfileUrl,
  parseYsmMeshKeywordIndex,
  parseYsmProfileResearch,
  parseYsmResultsPageFaculty,
  selectYsmLeadProfileUrls,
  ysmMeshResearchAreaObservations,
  type FetchedYsmPage,
  type YsmFacultyDirectory,
  type YsmMeshCandidateEntity,
} from '../sources/ysmMeshKeywordScraper';
import {
  buildResearchAreaResolverIndex,
  createResearchAreaCanonicalizer,
} from '../researchAreaCanonicalization';
import { buildEntityWorkPlan } from '../workPlanner';
import type { ObservationInput, ScraperContext } from '../types';

const KEYWORD_INDEX_HTML = `
  <ul>
    <li><a href="/research-profiles/?orgId=113592&meshId=101" class="hyperlink">Neoplasms</a></li>
    <li><a href="/research-profiles/?orgId=113592&meshId=202" class="hyperlink">Biliary Tract</a></li>
    <li><a href="/research-profiles/?orgId=113592&meshId=202" class="hyperlink">Biliary Tract</a></li>
    <li><a href="/research-profiles/?orgId=999&meshId=303" class="hyperlink">Some Other School Topic</a></li>
    <li><a href="/research-profiles/?orgId=113592&meshId=abc" class="hyperlink">Not A Number</a></li>
  </ul>`;

function resultsPageHtml(
  collection: Array<{ name: string; url: string; researchMeshes?: Array<{ text: string }> }>,
): string {
  const pageData = {
    mainComponents: [
      {
        key: 'ResearchProfileListing',
        model: {
          meshId: 101,
          profiles: {
            pageNumber: 1,
            pageSize: 20,
            totalItemCount: collection.length,
            collection: collection.map((item) => ({
              id: 1000,
              name: item.name,
              url: item.url,
              researchMeshes: item.researchMeshes ?? [],
            })),
          },
        },
      },
    ],
  };
  return `<html><body><script id="page-data" type="application/json">${JSON.stringify(
    pageData,
  )}</script></body></html>`;
}

function profilePageHtml(options: {
  fullName: string;
  meshKeywords: string[];
  email?: string;
  includeResearchSection?: boolean;
}): string {
  const sections: Record<string, unknown>[] = [{ sectionType: 'about', bio: 'Synthetic bio.' }];
  if (options.includeResearchSection !== false) {
    sections.push({
      sectionType: 'research',
      fullName: options.fullName,
      researchDescription: '<p>Synthetic research description.</p>',
      meshKeywords: options.meshKeywords.map((name, index) => ({ id: 1500 + index, name })),
      publicHealthKeywords: [],
    });
  }
  sections.push({
    sectionType: 'getInTouch',
    email: options.email ?? 'synthetic.person@example.edu',
    phones: [],
  });
  const pageData = {
    mainComponents: [
      {
        key: 'ProfileDetails',
        model: { pageName: 'synthetic', fullName: options.fullName, sections },
      },
    ],
  };
  return `<html><body><script id="page-data" type="application/json">${JSON.stringify(
    pageData,
  )}</script></body></html>`;
}

function makeContext(options: Partial<ScraperContext['options']> = {}): {
  ctx: ScraperContext;
  emitted: ObservationInput[];
  logs: string[];
} {
  const emitted: ObservationInput[] = [];
  const logs: string[] = [];
  return {
    emitted,
    logs,
    ctx: {
      scrapeRunId: 'test-run',
      sourceId: 'source-1',
      sourceName: 'ysm-mesh-keyword',
      sourceWeight: 0.65,
      options: {
        dryRun: true,
        useCache: false,
        release: false,
        ignoreWorkPlanner: true,
        ...options,
      },
      emit: async (obs) => {
        emitted.push(...(Array.isArray(obs) ? obs : [obs]));
      },
      log: (msg) => logs.push(msg),
    },
  };
}

const emptyDirectory: YsmFacultyDirectory = {
  keywords: [],
  profileUrlByNameKey: new Map(),
};

describe('URL hygiene guards', () => {
  it('accepts an individual profile URL and rejects facet/listing URLs', () => {
    expect(isYsmProfileUrl('https://medicine.yale.edu/profile/test-faculty/')).toBe(true);
    expect(isYsmProfileUrl('https://medicine.yale.edu/profile/test-faculty')).toBe(true);
    expect(
      isYsmProfileUrl('https://medicine.yale.edu/research-profiles/?orgId=113592&meshId=101'),
    ).toBe(false);
    expect(isYsmProfileUrl('https://example.edu/profile/test-faculty/')).toBe(false);
    expect(isYsmProfileUrl('https://medicine.yale.edu/profile/test?tab=x')).toBe(false);
  });

  it('flags the keyword index, dept index, and every meshId/orgId facet page as a listing', () => {
    expect(
      isYsmListingOrFacetUrl(
        'https://medicine.yale.edu/research-profiles/?orgId=113592&meshId=101',
      ),
    ).toBe(true);
    expect(isYsmListingOrFacetUrl('https://medicine.yale.edu/research/research-by-keyword/')).toBe(
      true,
    );
    expect(isYsmListingOrFacetUrl('https://medicine.yale.edu/research/researchbydept/')).toBe(true);
    expect(isYsmListingOrFacetUrl('https://medicine.yale.edu/profile/test-faculty/')).toBe(false);
  });

  it('normalizes profile hrefs to a canonical individual profile URL', () => {
    expect(normalizeYsmProfileUrl('/profile/Test-Faculty/')).toBe(
      'https://medicine.yale.edu/profile/test-faculty/',
    );
    expect(normalizeYsmProfileUrl('https://medicine.yale.edu/profile/test-faculty/?foo=bar')).toBe(
      'https://medicine.yale.edu/profile/test-faculty/',
    );
    expect(normalizeYsmProfileUrl('/research-profiles/?orgId=113592&meshId=101')).toBe('');
  });
});

describe('parseYsmMeshKeywordIndex', () => {
  it('extracts YSM-scoped (meshId, term) pairs, deduped, ignoring other orgs and non-numeric ids', () => {
    const keywords = parseYsmMeshKeywordIndex(KEYWORD_INDEX_HTML);
    expect(keywords).toEqual([
      { meshId: '101', term: 'Neoplasms' },
      { meshId: '202', term: 'Biliary Tract' },
    ]);
  });
});

describe('parseYsmResultsPageFaculty', () => {
  it('collects faculty profile refs from the embedded listing JSON, deduped by profile URL', () => {
    const html = resultsPageHtml([
      { name: 'Marlow Riverstone, MD', url: '/profile/marlow-riverstone/' },
      { name: 'Duplicate Row', url: '/profile/marlow-riverstone/' },
      { name: 'Aster Quill, PhD', url: 'https://medicine.yale.edu/profile/aster-quill/' },
      { name: 'No URL', url: '' },
    ]);
    const faculty = parseYsmResultsPageFaculty(html);
    expect(faculty.map((ref) => ref.profileUrl)).toEqual([
      'https://medicine.yale.edu/profile/marlow-riverstone/',
      'https://medicine.yale.edu/profile/aster-quill/',
    ]);
    expect(faculty[0].profileSlug).toBe('marlow-riverstone');
  });

  it('returns nothing when there is no embedded listing data', () => {
    expect(parseYsmResultsPageFaculty('<html><body>no data</body></html>')).toEqual([]);
  });
});

describe('parseYsmProfileResearch', () => {
  const profileUrl = 'https://medicine.yale.edu/profile/marlow-riverstone/';

  it('reads governed MeSH keywords and full name from the research section', () => {
    const html = profilePageHtml({
      fullName: 'Marlow Riverstone',
      meshKeywords: ['Neoplasms', 'Biliary Tract', 'Neoplasms'],
      email: 'marlow.riverstone@example.edu',
    });
    const research = parseYsmProfileResearch(html, profileUrl);
    expect(research).toEqual({
      profileUrl,
      fullName: 'Marlow Riverstone',
      meshTerms: ['Neoplasms', 'Biliary Tract'],
    });
  });

  it('never surfaces contact data from the profile page', () => {
    const html = profilePageHtml({
      fullName: 'Marlow Riverstone',
      meshKeywords: ['Neoplasms'],
      email: 'marlow.riverstone@example.edu',
    });
    const research = parseYsmProfileResearch(html, profileUrl);
    expect(JSON.stringify(research)).not.toContain('@');
    expect(JSON.stringify(research)).not.toContain('example.edu');
  });

  it('is fail-closed when the profile has no research section or no MeSH keywords', () => {
    expect(
      parseYsmProfileResearch(
        profilePageHtml({ fullName: 'X', meshKeywords: [], includeResearchSection: false }),
        profileUrl,
      ),
    ).toBeNull();
    expect(
      parseYsmProfileResearch(profilePageHtml({ fullName: 'X', meshKeywords: [] }), profileUrl),
    ).toBeNull();
  });
});

describe('ysmMeshResearchAreaObservations', () => {
  const profileUrl = 'https://medicine.yale.edu/profile/marlow-riverstone/';

  it('emits one researchAreas observation cited to the individual profile page', () => {
    const observations = ysmMeshResearchAreaObservations(
      { profileUrl, fullName: 'Marlow Riverstone', meshTerms: ['Neoplasms', 'Biliary Tract'] },
      { entityId: 'entity-1', entityKey: 'ysm-riverstone' },
    );
    expect(observations).toEqual([
      {
        entityType: 'researchEntity',
        entityId: 'entity-1',
        entityKey: 'ysm-riverstone',
        sourceUrl: profileUrl,
        field: 'researchAreas',
        value: ['Neoplasms', 'Biliary Tract'],
        confidenceOverride: 0.7,
      },
    ]);
  });

  it('fails closed and never cites a results/facet or keyword-index URL as the source', () => {
    expect(
      ysmMeshResearchAreaObservations(
        {
          profileUrl: 'https://medicine.yale.edu/research-profiles/?orgId=113592&meshId=101',
          fullName: 'Marlow Riverstone',
          meshTerms: ['Neoplasms'],
        },
        { entityId: 'entity-1', entityKey: 'ysm-riverstone' },
      ),
    ).toEqual([]);
    expect(
      ysmMeshResearchAreaObservations(
        {
          profileUrl: 'https://medicine.yale.edu/research/research-by-keyword/',
          fullName: 'X',
          meshTerms: ['Neoplasms'],
        },
        { entityKey: 'ysm-riverstone' },
      ),
    ).toEqual([]);
  });

  it('emits nothing without an entity identifier or with no MeSH terms', () => {
    expect(
      ysmMeshResearchAreaObservations({ profileUrl, fullName: 'X', meshTerms: ['Neoplasms'] }, {}),
    ).toEqual([]);
    expect(
      ysmMeshResearchAreaObservations(
        { profileUrl, fullName: 'X', meshTerms: [] },
        { entityKey: 'ysm-riverstone' },
      ),
    ).toEqual([]);
  });
});

describe('MeSH -> governed TaxonomyTerm mapping', () => {
  const canonicalizer = createResearchAreaCanonicalizer(
    buildResearchAreaResolverIndex([
      { name: 'Neoplasms', aliases: ['Cancer'] },
      { name: 'Immunology' },
    ]),
  );

  it('maps a MeSH term to an approved TaxonomyTerm and leaves an unapproved term as an UNREVIEWED-pending raw value', () => {
    const result = canonicalizer.canonicalizeResearchAreas(['Cancer', 'Biliary Tract']);
    expect(result.values).toEqual(['Neoplasms', 'Biliary Tract']);
    expect(result.unmatched).toEqual(['Biliary Tract']);
  });

  it('never invents an approved area: an unmatched MeSH term is reported, not promoted', () => {
    const result = canonicalizer.canonicalizeResearchAreas(['Biliary Tract']);
    expect(result.values).toEqual(['Biliary Tract']);
    expect(result.unmatched).toEqual(['Biliary Tract']);
  });
});

describe('candidateEntityFromDoc', () => {
  it('keeps only individual YSM profile URLs from the entity source URLs', () => {
    const candidate = candidateEntityFromDoc({
      _id: 'entity-1',
      slug: 'ysm-riverstone',
      displayName: 'Riverstone Lab',
      contactName: 'Marlow Riverstone',
      websiteUrl: 'https://riverstone-lab.example.edu/',
      sourceUrls: [
        'https://medicine.yale.edu/profile/marlow-riverstone/',
        'https://medicine.yale.edu/research-profiles/?orgId=113592&meshId=101',
      ],
    });
    expect(candidate.profileUrls).toEqual(['https://medicine.yale.edu/profile/marlow-riverstone/']);
    expect(candidate.name).toBe('Riverstone Lab');
  });
});

describe('facultyNameMatchKey', () => {
  it('slugifies the whole name after dropping credentials, never reducing to a surname', () => {
    expect(facultyNameMatchKey('Riverstone, Marlow, MD, PhD')).toBe('riverstone-marlow');
    expect(facultyNameMatchKey('Marlow Riverstone, MD')).toBe('marlow-riverstone');
    expect(facultyNameMatchKey('Marlow Riverstone')).toBe('marlow-riverstone');
  });
});

describe('YsmMeshKeywordScraper.run', () => {
  const profileUrl = 'https://medicine.yale.edu/profile/marlow-riverstone/';
  const entity: YsmMeshCandidateEntity = {
    _id: 'entity-1',
    slug: 'ysm-riverstone',
    name: 'Riverstone Lab',
    contactName: 'Marlow Riverstone',
    profileUrls: [profileUrl],
  };

  it('attaches governed MeSH areas to a YSM entity, cited to the individual profile', async () => {
    const fetched: string[] = [];
    const scraper = new YsmMeshKeywordScraper({
      directoryLoader: async () => emptyDirectory,
      entityFinder: async () => [entity],
      leadProfileUrlLoader: async () => [],
      fetchPage: async (url) => {
        fetched.push(url);
        return {
          url,
          html: profilePageHtml({
            fullName: 'Marlow Riverstone',
            meshKeywords: ['Neoplasms', 'Biliary Tract'],
          }),
        } satisfies FetchedYsmPage;
      },
    });
    const { ctx, emitted } = makeContext();
    const result = await scraper.run(ctx);

    expect(result.entitiesObserved).toBe(1);
    expect(fetched).toEqual([profileUrl]);
    expect(emitted).toEqual([
      {
        entityType: 'researchEntity',
        entityId: 'entity-1',
        entityKey: 'ysm-riverstone',
        sourceUrl: profileUrl,
        field: 'researchAreas',
        value: ['Neoplasms', 'Biliary Tract'],
        confidenceOverride: 0.7,
      },
    ]);
    for (const observation of emitted) {
      expect(isYsmListingOrFacetUrl(observation.sourceUrl)).toBe(false);
      expect(isYsmProfileUrl(observation.sourceUrl)).toBe(true);
    }
  });

  it('resolves a profile via the directory name-match when the entity has no stored profile URL', async () => {
    const directory: YsmFacultyDirectory = {
      keywords: [{ meshId: '101', term: 'Neoplasms' }],
      profileUrlByNameKey: new Map([[facultyNameMatchKey('Marlow Riverstone'), profileUrl]]),
    };
    const scraper = new YsmMeshKeywordScraper({
      directoryLoader: async () => directory,
      entityFinder: async () => [{ ...entity, profileUrls: [] }],
      leadProfileUrlLoader: async () => [],
      fetchPage: async (url) => ({
        url,
        html: profilePageHtml({ fullName: 'Marlow Riverstone', meshKeywords: ['Neoplasms'] }),
      }),
    });
    const { ctx, emitted } = makeContext();
    await scraper.run(ctx);
    expect(emitted).toHaveLength(1);
    expect(emitted[0].sourceUrl).toBe(profileUrl);
  });

  it('does not emit when a profile carries no MeSH keywords', async () => {
    const scraper = new YsmMeshKeywordScraper({
      directoryLoader: async () => emptyDirectory,
      entityFinder: async () => [entity],
      leadProfileUrlLoader: async () => [],
      fetchPage: async (url) => ({
        url,
        html: profilePageHtml({ fullName: 'Marlow Riverstone', meshKeywords: [] }),
      }),
    });
    const { ctx, emitted } = makeContext();
    const result = await scraper.run(ctx);
    expect(result.entitiesObserved).toBe(0);
    expect(emitted).toEqual([]);
  });

  it('skips entities the work planner reports as fresh', async () => {
    let fetchCalls = 0;
    const scraper = new YsmMeshKeywordScraper({
      directoryLoader: async () => emptyDirectory,
      entityFinder: async () => [entity],
      leadProfileUrlLoader: async () => [],
      fetchPage: async (url) => {
        fetchCalls += 1;
        return { url, html: profilePageHtml({ fullName: 'X', meshKeywords: ['Neoplasms'] }) };
      },
      workPlanLoader: async () => ({
        entityType: 'researchEntity',
        entityId: 'entity-1',
        entityKey: 'ysm-riverstone',
        sourceName: 'ysm-mesh-keyword',
        fields: [{ field: 'researchAreas', shouldFetch: false, reason: 'fresh' }],
        shouldFetch: false,
      }),
    });
    const { ctx, emitted } = makeContext({ ignoreWorkPlanner: false });
    await scraper.run(ctx);
    expect(fetchCalls).toBe(0);
    expect(emitted).toEqual([]);
  });

  it('skips an entity whose researchAreas field is manually locked', async () => {
    let fetchCalls = 0;
    const scraper = new YsmMeshKeywordScraper({
      directoryLoader: async () => emptyDirectory,
      entityFinder: async () => [
        candidateEntityFromDoc({
          _id: 'entity-1',
          slug: 'ysm-riverstone',
          displayName: 'Riverstone Lab',
          contactName: 'Marlow Riverstone',
          sourceUrls: [profileUrl],
          manuallyLockedFields: ['researchAreas'],
        }),
      ],
      leadProfileUrlLoader: async () => [],
      fetchPage: async (url) => {
        fetchCalls += 1;
        return {
          url,
          html: profilePageHtml({ fullName: 'Marlow Riverstone', meshKeywords: ['Neoplasms'] }),
        };
      },
      workPlanLoader: async (candidate, policy) =>
        buildEntityWorkPlan({
          entityType: policy.entityType,
          entityId: 'entity-1',
          entityKey: candidate.slug,
          sourceName: policy.sourceName,
          targetFields: policy.targetFields,
          manuallyLockedFields: candidate.manuallyLockedFields,
          freshnessWindowMs: policy.freshnessWindowMs,
          observations: [],
        }),
    });
    const { ctx, emitted } = makeContext({ ignoreWorkPlanner: false });
    const result = await scraper.run(ctx);
    expect(fetchCalls).toBe(0);
    expect(emitted).toEqual([]);
    expect(result.entitiesObserved).toBe(0);
  });

  it('does not build the directory when every candidate resolves via a direct profile URL', async () => {
    let directoryCalls = 0;
    const scraper = new YsmMeshKeywordScraper({
      directoryLoader: async () => {
        directoryCalls += 1;
        return emptyDirectory;
      },
      entityFinder: async () => [entity],
      leadProfileUrlLoader: async () => [],
      fetchPage: async (url) => ({
        url,
        html: profilePageHtml({ fullName: 'Marlow Riverstone', meshKeywords: ['Neoplasms'] }),
      }),
    });
    const { ctx, emitted } = makeContext();
    await scraper.run(ctx);
    expect(directoryCalls).toBe(0);
    expect(emitted).toHaveLength(1);
  });

  it('builds the directory once when candidates fall through to the name-match fallback', async () => {
    let directoryCalls = 0;
    const directory: YsmFacultyDirectory = {
      keywords: [{ meshId: '101', term: 'Neoplasms' }],
      profileUrlByNameKey: new Map([[facultyNameMatchKey('Marlow Riverstone'), profileUrl]]),
    };
    const scraper = new YsmMeshKeywordScraper({
      directoryLoader: async () => {
        directoryCalls += 1;
        return directory;
      },
      entityFinder: async () => [
        { ...entity, profileUrls: [] },
        {
          ...entity,
          _id: 'entity-2',
          slug: 'ysm-quill',
          name: 'Quill Lab',
          contactName: 'Aster Quill',
          profileUrls: [],
        },
      ],
      leadProfileUrlLoader: async () => [],
      fetchPage: async (url) => ({
        url,
        html: profilePageHtml({ fullName: 'Marlow Riverstone', meshKeywords: ['Neoplasms'] }),
      }),
    });
    const { ctx } = makeContext();
    await scraper.run(ctx);
    expect(directoryCalls).toBe(1);
  });
});

describe('selectYsmLeadProfileUrls', () => {
  it('resolves the lead profile from the joined Researcher YALE_OFFICIAL profile link', () => {
    const urls = selectYsmLeadProfileUrls(
      [{ personId: 'a', rosterProvenance: {} }],
      [
        {
          profileLinks: [
            { kind: 'YALE_OFFICIAL', url: 'https://medicine.yale.edu/profile/lead-alpha/' },
          ],
        },
      ],
    );
    expect(urls).toEqual(['https://medicine.yale.edu/profile/lead-alpha/']);
  });

  it('ignores non-official links and non-YSM profile urls', () => {
    const urls = selectYsmLeadProfileUrls(
      [],
      [
        {
          profileLinks: [
            { kind: 'PERSONAL_SITE', url: 'https://medicine.yale.edu/profile/lead-gamma/' },
            { kind: 'YALE_OFFICIAL', url: 'https://example.com/profile/lead-gamma/' },
            { kind: 'YALE_OFFICIAL', url: 'https://medicine.yale.edu/lab/example-lab/' },
          ],
        },
      ],
    );
    expect(urls).toEqual([]);
  });

  it('falls back to rosterProvenance when no Researcher profile link is present', () => {
    const urls = selectYsmLeadProfileUrls(
      [
        {
          personId: 'a',
          rosterProvenance: { profileUrl: 'https://medicine.yale.edu/profile/lead-beta/' },
        },
      ],
      [{ profileLinks: [] }],
    );
    expect(urls).toEqual(['https://medicine.yale.edu/profile/lead-beta/']);
  });

  it('prefers the official link first and dedupes overlapping sources', () => {
    const shared = 'https://medicine.yale.edu/profile/lead-alpha/';
    const urls = selectYsmLeadProfileUrls(
      [{ personId: 'a', rosterProvenance: { profileUrl: shared } }],
      [{ profileLinks: [{ kind: 'YALE_OFFICIAL', url: shared }] }],
    );
    expect(urls).toEqual([shared]);
  });

  it('returns an empty list when no valid YSM profile url exists', () => {
    expect(selectYsmLeadProfileUrls([{ rosterProvenance: {} }], [{ profileLinks: [] }])).toEqual([]);
  });
});

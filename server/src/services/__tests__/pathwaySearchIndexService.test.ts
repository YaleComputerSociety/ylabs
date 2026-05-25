import { describe, expect, it } from 'vitest';
import {
  buildPathwaySearchIndexDocument,
  buildPathwaySearchIndexDocuments,
  getPathwaySearchIndexSettings,
  PATHWAY_SEARCH_INDEX_NAME,
  PATHWAY_SEARCH_INDEX_PRIMARY_KEY,
  rebuildPathwaySearchIndex,
  searchPathwaysViaMeili,
} from '../pathwaySearchIndexService';

const forbiddenEngineeringProfileUrl =
  'https://engineering.yale.edu/research-and-faculty/faculty-directory/example-person';
const safeExternalLabUrl = 'https://example-lab.test/';

describe('pathwaySearchIndexService', () => {
  it('builds a Meilisearch-ready pathway document with filterable and sortable fields', () => {
    const doc = buildPathwaySearchIndexDocument({
      _id: { toString: () => 'pathway-1' },
      pathwayType: 'POSTED_ROLE',
      status: 'ACTIVE',
      evidenceStrength: 'DIRECT',
      studentFacingLabel: 'Summer RA role: hidden@example.edu',
      explanation: 'Work with the lab on imaging analysis. Questions: hidden@example.edu',
      bestNextStep: 'Apply through the official form or call 203-555-1212.',
      bestNextStepCategory: 'apply',
      compensation: 'PAID',
      confidence: 0.91,
      sourceUrls: ['https://example.edu/pathway', 'mailto:hidden@example.edu'],
      lastObservedAt: new Date('2026-02-03T04:05:06.000Z'),
      createdAt: '2026-01-02T03:04:05.000Z',
      researchEntity: {
        _id: { toString: () => 'entity-1' },
        slug: 'example-lab',
        name: 'Example Lab',
        displayName: 'Example Methods Lab',
        kind: 'lab',
        entityType: 'LAB',
        shortDescription: 'A concise lab description for pathway cards.',
        description: 'Studies visual cortex circuits with imaging analysis.',
        fullDescription:
          'A fuller lab description with methods, model systems, and student-facing context.',
        departments: ['Psychology', 'Psychology', 'Neuroscience'],
        researchAreas: ['Neuroimaging'],
        school: 'Faculty of Arts and Sciences',
        websiteUrl: safeExternalLabUrl,
      },
      activePostedOpportunity: {
        _id: { toString: () => 'opportunity-1' },
        title: 'Summer Research Assistant',
        deadline: '2026-03-15T12:00:00.000Z',
        status: 'OPEN',
        term: 'Summer 2026',
        provenance: 'LISTING_BRIDGED',
      },
      evidence: [
        {
          signalType: 'POSTED_OPENING',
          confidence: 'HIGH',
          confidenceScore: 0.95,
          excerpt: 'Apply by emailing hidden@example.edu or calling 203-555-1212.',
          sourceUrl: 'https://example.edu/pathway',
          observedAt: '2026-02-01T00:00:00.000Z',
        },
      ],
      contactRoute: {
        routeType: 'OFFICIAL_APPLICATION',
        label: 'Official form, not hidden@example.edu',
        url: 'https://example.edu/apply',
        contactPolicy: 'APPLICATION_ONLY',
        visibility: 'PUBLIC',
        rationale: 'Use the form; questions at 203-555-1212 are not indexed.',
      },
    });

    expect(doc).toMatchObject({
      id: 'pathway-1',
      pathwayId: 'pathway-1',
      pathwayType: 'POSTED_ROLE',
      status: 'ACTIVE',
      evidenceStrength: 'DIRECT',
      compensation: 'PAID',
      bestNextStepCategory: 'apply',
      confidence: 0.91,
      lastObservedAt: '2026-02-03T04:05:06.000Z',
      createdAt: '2026-01-02T03:04:05.000Z',
      entityId: 'entity-1',
      entitySlug: 'example-lab',
      entityName: 'Example Lab',
      entityShortDescription: 'A concise lab description for pathway cards.',
      entityDescription: 'Studies visual cortex circuits with imaging analysis.',
      entityFullDescription:
        'A fuller lab description with methods, model systems, and student-facing context.',
      entityType: 'LAB',
      entityDepartments: ['Psychology', 'Neuroscience'],
      hasActivePostedOpportunity: true,
      postedOpportunityId: 'opportunity-1',
      postedOpportunityTitle: 'Summer Research Assistant',
      postedOpportunityDeadline: '2026-03-15T12:00:00.000Z',
      postedOpportunityStatus: 'OPEN',
      postedOpportunityProvenance: 'LISTING_BRIDGED',
      publicContactRouteType: 'OFFICIAL_APPLICATION',
      publicContactPolicy: 'APPLICATION_ONLY',
      evidenceCount: 1,
      hasMicrositeEvidence: false,
      hasFellowshipEvidence: false,
      isProfileFallback: false,
    });
    expect(doc.qualityScore).toBeGreaterThan(100);
    expect(doc.lastObservedAtTimestamp).toBe(
      new Date('2026-02-03T04:05:06.000Z').getTime(),
    );
    expect(doc.postedOpportunityDeadlineTimestamp).toBe(
      new Date('2026-03-15T12:00:00.000Z').getTime(),
    );
    expect(doc.sourceUrls).toEqual(['https://example.edu/pathway']);
    expect(doc.studentFacingLabel).toBe('Summer RA role: [email redacted]');
    expect(doc.explanation).toContain('[email redacted]');
    expect(doc.bestNextStep).toContain('[phone redacted]');
    expect(doc.evidenceSnippets[0]).toContain('[email redacted]');
    expect(doc.evidenceSnippets[0]).toContain('[phone redacted]');
    expect(doc.publicContactRoute?.label).toBe(
      'Official form, not [email redacted]',
    );
    expect(doc.publicContactRoute?.url).toBe('https://example.edu/apply');
    expect(doc.publicContactRoute?.rationale).toContain('[phone redacted]');
  });

  it('drops non-public routes, no-direct-contact routes, and mailto URLs from the index document', () => {
    const authenticatedRouteDoc = buildPathwaySearchIndexDocument({
      _id: 'pathway-auth',
      researchEntity: { departments: [] },
      contactRoute: {
        routeType: 'FACULTY_PI',
        label: 'Private PI email pi@example.edu',
        url: 'mailto:pi@example.edu',
        contactPolicy: 'DIRECT_CONTACT_OK',
        visibility: 'AUTHENTICATED',
      },
    });
    const noDirectContactDoc = buildPathwaySearchIndexDocument({
      _id: 'pathway-no-direct',
      researchEntity: { departments: [] },
      contactRoute: {
        routeType: 'FACULTY_PI',
        label: 'Do not contact',
        url: 'mailto:pi@example.edu',
        contactPolicy: 'NO_DIRECT_CONTACT',
        visibility: 'PUBLIC',
      },
    });
    const publicMailtoDoc = buildPathwaySearchIndexDocument({
      _id: 'pathway-mailto',
      researchEntity: { departments: [] },
      contactRoute: {
        routeType: 'FACULTY_PI',
        label: 'Official contact route',
        url: 'mailto:pi@example.edu',
        contactPolicy: 'DIRECT_CONTACT_OK',
        visibility: 'PUBLIC',
      },
    });

    expect(authenticatedRouteDoc.publicContactRoute).toBeUndefined();
    expect(authenticatedRouteDoc.publicContactRouteType).toBeUndefined();
    expect(noDirectContactDoc.publicContactRoute).toBeUndefined();
    expect(noDirectContactDoc.publicContactRouteType).toBeUndefined();
    expect(publicMailtoDoc.publicContactRoute?.url).toBeUndefined();
  });

  it('drops forbidden Engineering faculty-directory URLs from indexed public sources and routes', () => {
    const doc = buildPathwaySearchIndexDocument({
      _id: 'pathway-public-source-boundary',
      pathwayType: 'EXPLORATORY_CONTACT',
      sourceUrls: [forbiddenEngineeringProfileUrl, safeExternalLabUrl],
      researchEntity: {
        departments: ['Computer Science'],
        websiteUrl: forbiddenEngineeringProfileUrl,
      },
      evidence: [
        {
          signalType: 'REACH_OUT_PLAUSIBLE',
          sourceUrl: forbiddenEngineeringProfileUrl,
        },
      ],
      contactRoute: {
        routeType: 'FACULTY_PI',
        label: 'Example PI',
        url: forbiddenEngineeringProfileUrl,
        contactPolicy: 'OFFICIAL_ROUTE_PREFERRED',
        visibility: 'PUBLIC',
      },
    });

    expect(doc.sourceUrls).toEqual([safeExternalLabUrl]);
    expect(doc.entityWebsiteUrl).toBeUndefined();
    expect(doc.evidence[0].sourceUrl).toBeUndefined();
    expect(doc.publicContactRoute).toBeUndefined();
    expect(doc.publicContactRouteType).toBeUndefined();
  });

  it('uses public research-area normalization for pathway index documents', () => {
    const doc = buildPathwaySearchIndexDocument({
      _id: 'pathway-fixture-areas',
      researchEntity: {
        departments: ['Medicine'],
        researchAreas: [
          'Synthetic ORCID profile token',
          'Synthetic Inflammation40 ResearchersView 5 Related Publications',
          'SyntheticChrome View 5 Related Publications',
          'Synthetic Inflammation',
        ],
      },
    });

    expect(doc.entityResearchAreas).toEqual(['Synthetic Inflammation']);
  });

  it('uses public research-area normalization for Meili pathway result DTOs', async () => {
    const fakeIndex = {
      updateSettings: async () => undefined,
      addDocuments: async () => undefined,
      search: async () => ({
        estimatedTotalHits: 1,
        hits: [
          {
            id: 'pathway-fixture-areas',
            pathwayId: 'pathway-fixture-areas',
            pathwayType: 'EXPLORATORY_CONTACT',
            status: 'PLAUSIBLE',
            evidenceStrength: 'MODERATE',
            studentFacingLabel: 'Exploratory outreach',
            bestNextStepCategory: 'plan-outreach',
            sourceUrls: [],
            entityId: 'entity-1',
            entitySlug: 'fixture-profile-lab',
            entityName: 'Synthetic Fixture Lab',
            entityDepartments: ['Medicine'],
            entityResearchAreas: [
              'Synthetic ORCID profile token',
              'Synthetic Inflammation40 ResearchersView 5 Related Publications',
              'SyntheticChrome View 5 Related Publications',
              'Synthetic Inflammation',
            ],
            hasActivePostedOpportunity: false,
            evidence: [],
            evidenceSnippets: [],
            qualityScore: 1,
            evidenceCount: 0,
            hasMicrositeEvidence: false,
            hasFellowshipEvidence: false,
            isProfileFallback: false,
          },
        ],
      }),
    };

    const result = await searchPathwaysViaMeili(
      { page: 1, pageSize: 5 },
      async () => fakeIndex as any,
    );

    expect(result.hits[0].researchEntity.researchAreas).toEqual([
      'Synthetic Inflammation',
    ]);
  });

  it('filters out inputs without ids and exposes clone-safe index settings', () => {
    const docs = buildPathwaySearchIndexDocuments([
      { _id: 'pathway-1', researchEntity: { departments: [] } },
      { researchEntity: { departments: [] } },
    ]);
    const settings = getPathwaySearchIndexSettings();

    settings.filterableAttributes.push('mutated');

    expect(PATHWAY_SEARCH_INDEX_NAME).toBe('pathways');
    expect(PATHWAY_SEARCH_INDEX_PRIMARY_KEY).toBe('id');
    expect(docs).toHaveLength(1);
    expect(docs[0].id).toBe('pathway-1');
    expect(getPathwaySearchIndexSettings().filterableAttributes).toEqual(
      expect.arrayContaining([
        'pathwayType',
        'status',
        'evidenceStrength',
        'compensation',
        'bestNextStepCategory',
        'entityId',
        'entityDepartments',
        'hasActivePostedOpportunity',
        'postedOpportunityStatus',
        'hasMicrositeEvidence',
        'hasFellowshipEvidence',
        'isProfileFallback',
      ]),
    );
    expect(getPathwaySearchIndexSettings().filterableAttributes).not.toContain(
      'mutated',
    );
    expect(getPathwaySearchIndexSettings().searchableAttributes).toContain(
      'entityDescription',
    );
    expect(getPathwaySearchIndexSettings().sortableAttributes).toEqual(
      expect.arrayContaining([
        'qualityScore',
        'evidenceCount',
        'confidence',
        'lastObservedAtTimestamp',
        'createdAtTimestamp',
        'postedOpportunityDeadlineTimestamp',
      ]),
    );
  });

  it('creates missing indexes, applies settings before documents, and waits for tasks', async () => {
    const calls: Array<{ kind: string; payload?: unknown }> = [];
    const fakeIndex = {
      updateSettings: async (settings: unknown) => {
        calls.push({ kind: 'settings', payload: settings });
        return { taskUid: 3 };
      },
      deleteAllDocuments: async () => {
        calls.push({ kind: 'clear' });
        return { taskUid: 1 };
      },
      addDocuments: async (documents: unknown, options: unknown) => {
        calls.push({ kind: 'documents', payload: { documents, options } });
        return { taskUid: 2 };
      },
      getStats: async () => {
        calls.push({ kind: 'stats' });
        return { numberOfDocuments: 2, isIndexing: false };
      },
    };
    const fetchPage = async (page: number) => ({
      estimatedTotalHits: 2,
      hits:
        page === 1
          ? [
              {
                _id: 'pathway-1',
                studentFacingLabel: 'Pathway one',
                sourceUrls: [],
                researchEntity: { departments: [] },
                evidence: [],
              } as any,
            ]
          : page === 2
            ? [
                {
                  _id: 'pathway-2',
                  studentFacingLabel: 'Pathway two',
                  sourceUrls: [],
                  researchEntity: { departments: [] },
                  evidence: [],
                } as any,
              ]
            : [],
    });

    const result = await rebuildPathwaySearchIndex(fetchPage, {
      pageSize: 1,
      clearExisting: true,
      ensureIndex: async (indexName, primaryKey) => {
        calls.push({ kind: 'ensure', payload: { indexName, primaryKey } });
        return fakeIndex;
      },
      waitForTaskResponse: async (response: unknown) => {
        calls.push({ kind: 'wait', payload: (response as { taskUid?: number }).taskUid });
      },
    });

    expect(result).toEqual({
      indexName: PATHWAY_SEARCH_INDEX_NAME,
      resolvedIndexName: PATHWAY_SEARCH_INDEX_NAME,
      strategy: 'direct',
      pageSize: 1,
      fetchedHitCount: 2,
      indexedDocumentCount: 2,
      pageCount: 2,
      clearedExisting: true,
      meiliDocumentCount: 2,
      meiliIsIndexing: false,
    });
    expect(calls.map((call) => call.kind)).toEqual([
      'ensure',
      'settings',
      'wait',
      'clear',
      'wait',
      'documents',
      'wait',
      'documents',
      'wait',
      'stats',
    ]);
    expect(calls[0].payload).toEqual({
      indexName: PATHWAY_SEARCH_INDEX_NAME,
      primaryKey: PATHWAY_SEARCH_INDEX_PRIMARY_KEY,
    });
    expect(calls[5].payload).toMatchObject({
      options: { primaryKey: PATHWAY_SEARCH_INDEX_PRIMARY_KEY },
    });
    expect(calls.filter((call) => call.kind === 'wait').map((call) => call.payload)).toEqual([
      3,
      1,
      2,
      2,
    ]);
  });

  it('can rebuild pathways through a temporary index and swap into the live index', async () => {
    const calls: Array<{ kind: string; payload?: unknown }> = [];
    const fakeIndex = {
      updateSettings: async () => {
        calls.push({ kind: 'settings' });
        return { taskUid: 11 };
      },
      addDocuments: async () => {
        calls.push({ kind: 'documents' });
        return { taskUid: 12 };
      },
      getStats: async () => ({ numberOfDocuments: 1, isIndexing: false }),
    };

    const result = await rebuildPathwaySearchIndex(
      async (page) => ({
        estimatedTotalHits: 1,
        hits:
          page === 1
            ? [
                {
                  _id: 'pathway-1',
                  studentFacingLabel: 'Pathway one',
                  sourceUrls: [],
                  researchEntity: { departments: [] },
                  evidence: [],
                } as any,
              ]
            : [],
      }),
      {
        strategy: 'swap',
        clearExisting: true,
        resolveIndexName: (name) => `beta_${name}`,
        createIndex: async (indexName, primaryKey) => {
          calls.push({ kind: 'create', payload: { indexName, primaryKey } });
          return fakeIndex;
        },
        ensureIndex: async (indexName, primaryKey) => {
          calls.push({ kind: 'ensure', payload: { indexName, primaryKey } });
          return fakeIndex;
        },
        swapIndexes: async (sourceIndexName, targetIndexName) => {
          calls.push({ kind: 'swap', payload: { sourceIndexName, targetIndexName } });
        },
        deleteIndex: async (indexName) => {
          calls.push({ kind: 'delete', payload: indexName });
        },
        waitForTaskResponse: async (response: unknown) => {
          calls.push({ kind: 'wait', payload: (response as { taskUid?: number }).taskUid });
        },
        tempIndexName: 'beta_pathways_rebuild_test',
      },
    );

    expect(result).toMatchObject({
      indexName: PATHWAY_SEARCH_INDEX_NAME,
      resolvedIndexName: 'beta_pathways',
      strategy: 'swap',
      indexedDocumentCount: 1,
      clearedExisting: true,
    });
    expect(calls.map((call) => call.kind)).toEqual([
      'create',
      'settings',
      'wait',
      'documents',
      'wait',
      'ensure',
      'swap',
      'delete',
      'ensure',
    ]);
    expect(calls[6].payload).toEqual({
      sourceIndexName: 'beta_pathways_rebuild_test',
      targetIndexName: 'beta_pathways',
    });
  });

  it('uses Meili filters and sorts that preserve the Mongo pathway search contract', async () => {
    const searches: Array<{ query: string; params: Record<string, unknown> }> = [];
    const fakeIndex = {
      updateSettings: async () => undefined,
      addDocuments: async () => undefined,
      search: async (query: string, params: Record<string, unknown>) => {
        searches.push({ query, params });
        return {
          estimatedTotalHits: 1,
          hits: [
            {
              ...buildPathwaySearchIndexDocument({
                _id: 'pathway-1',
                pathwayType: 'EXPLORATORY_CONTACT',
                status: 'PLAUSIBLE',
                evidenceStrength: 'STRONG',
                compensation: 'UNKNOWN',
                studentFacingLabel: 'Exploratory outreach',
                bestNextStepCategory: 'plan-outreach',
                sourceUrls: [forbiddenEngineeringProfileUrl, 'https://example.edu/source'],
                researchEntity: {
                  _id: 'entity-1',
                  slug: 'example-lab',
                  name: 'Example Lab',
                  description: 'Studies mentor-driven machine learning research.',
                  entityType: 'LAB',
                  departments: ['Computer Science'],
                  researchAreas: ['Machine Learning'],
                  websiteUrl: forbiddenEngineeringProfileUrl,
                },
                evidence: [
                  {
                    signalType: 'REACH_OUT_PLAUSIBLE',
                    sourceUrl: forbiddenEngineeringProfileUrl,
                  },
                ],
                contactRoute: {
                  routeType: 'FACULTY_PI',
                  url: forbiddenEngineeringProfileUrl,
                  visibility: 'PUBLIC',
                  contactPolicy: 'OFFICIAL_ROUTE_PREFERRED',
                },
              }),
              sourceUrls: [
                forbiddenEngineeringProfileUrl,
                'https://example.edu/source',
              ],
              entityWebsiteUrl: forbiddenEngineeringProfileUrl,
              evidence: [
                {
                  signalType: 'REACH_OUT_PLAUSIBLE',
                  sourceUrl: forbiddenEngineeringProfileUrl,
                },
              ],
              publicContactRoute: {
                routeType: 'FACULTY_PI',
                url: forbiddenEngineeringProfileUrl,
                visibility: 'PUBLIC',
                contactPolicy: 'OFFICIAL_ROUTE_PREFERRED',
              },
            },
          ],
        };
      },
    };

    const result = await searchPathwaysViaMeili(
      {
        q: 'mentor',
        page: 2,
        pageSize: 10,
        filters: {
          pathwayType: ['COURSE_CREDIT' as any, 'EXPLORATORY_CONTACT' as any],
          departments: ['Computer Science'],
          researchAreas: ['Machine Learning'],
          bestNextStepCategory: ['plan-outreach'],
          hasActivePostedOpportunity: false,
        },
        sort: { sortBy: 'confidence', sortOrder: 'asc' },
      },
      async () => fakeIndex as any,
    );

    expect(searches).toEqual([
      {
        query: 'mentor',
        params: expect.objectContaining({
          limit: 10,
          offset: 10,
          sort: ['confidence:asc', 'qualityScore:desc', 'lastObservedAtTimestamp:desc'],
        }),
      },
    ]);
    expect(searches[0].params).not.toHaveProperty('hybrid');
    expect(String(searches[0].params.filter)).toContain(
      'pathwayType = "EXPLORATORY_CONTACT"',
    );
    expect(String(searches[0].params.filter)).not.toContain('COURSE_CREDIT');
    expect(String(searches[0].params.filter)).toContain(
      'entityDepartments = "Computer Science"',
    );
    expect(String(searches[0].params.filter)).toContain(
      'entityResearchAreas = "Machine Learning"',
    );
    expect(String(searches[0].params.filter)).toContain(
      'hasActivePostedOpportunity = false',
    );
    expect(result.hits[0]).toMatchObject({
      _id: 'pathway-1',
      bestNextStepCategory: 'plan-outreach',
      sourceUrls: ['https://example.edu/source'],
      contactRoute: undefined,
      researchEntity: {
        slug: 'example-lab',
        description: 'Studies mentor-driven machine learning research.',
        departments: ['Computer Science'],
        websiteUrl: undefined,
      },
    });
    expect(result.hits[0].evidence[0].sourceUrl).toBeUndefined();
  });

  it('uses hybrid semantic search only for multi-word pathway queries', async () => {
    const searches: Array<{ query: string; params: Record<string, unknown> }> = [];
    const fakeIndex = {
      updateSettings: async () => undefined,
      addDocuments: async () => undefined,
      search: async (query: string, params: Record<string, unknown>) => {
        searches.push({ query, params });
        return { estimatedTotalHits: 0, hits: [] };
      },
    };

    await searchPathwaysViaMeili(
      { q: 'paid summer data research', page: 1, pageSize: 5 },
      async () => fakeIndex as any,
    );
    await searchPathwaysViaMeili(
      { q: 'summer', page: 1, pageSize: 5 },
      async () => fakeIndex as any,
    );
    await searchPathwaysViaMeili(
      { q: '', page: 1, pageSize: 5 },
      async () => fakeIndex as any,
    );

    expect(searches[0]).toMatchObject({
      query: 'paid summer data research',
      params: expect.objectContaining({
        hybrid: { semanticRatio: 0.75, embedder: 'default' },
      }),
    });
    expect(searches[1].params).not.toHaveProperty('hybrid');
    expect(searches[2].params).not.toHaveProperty('hybrid');
    expect(searches[2].params).toMatchObject({
      sort: ['qualityScore:desc', 'evidenceCount:desc', 'confidence:desc', 'lastObservedAtTimestamp:desc'],
    });
  });

  it('exposes equivalent quality fields for richer and fallback pathway documents', () => {
    const fallback = buildPathwaySearchIndexDocument({
      _id: 'fallback-pathway',
      pathwayType: 'EXPLORATORY_CONTACT',
      status: 'PLAUSIBLE',
      evidenceStrength: 'WEAK',
      confidence: 0.8,
      derivationKey: 'pathway:EXPLORATORY_CONTACT:OFFICIAL_PROFILE:user-1',
      researchEntity: { departments: [] },
      evidence: [{ signalType: 'REACH_OUT_PLAUSIBLE', sourceName: 'dept-faculty-roster' }],
      contactRoute: {
        routeType: 'FACULTY_PI',
        visibility: 'PUBLIC',
        contactPolicy: 'DIRECT_CONTACT_OK',
      },
    });
    const richer = buildPathwaySearchIndexDocument({
      _id: 'richer-pathway',
      pathwayType: 'EXPLORATORY_CONTACT',
      status: 'PLAUSIBLE',
      evidenceStrength: 'STRONG',
      confidence: 0.7,
      derivationKey: 'pathway:EXPLORATORY_CONTACT:PAST_UNDERGRADS',
      researchEntity: { departments: [] },
      evidence: [
        {
          signalType: 'PAST_UNDERGRADS',
          sourceName: 'lab-microsite-undergrad-llm',
          derivationKey: 'signal:PAST_UNDERGRADS',
        },
        { signalType: 'FELLOWSHIP_COMPATIBLE', sourceName: 'fellowship-recipients' },
      ],
      contactRoute: {
        routeType: 'LAB_MANAGER',
        visibility: 'PUBLIC',
        contactPolicy: 'DIRECT_CONTACT_OK',
      },
    });

    expect(richer.qualityScore).toBeGreaterThan(fallback.qualityScore);
    expect(richer.evidenceCount).toBe(2);
    expect(richer.hasMicrositeEvidence).toBe(true);
    expect(richer.hasFellowshipEvidence).toBe(true);
    expect(fallback.isProfileFallback).toBe(true);
  });

  it('retries keyword-only when the pathway index lacks the configured embedder', async () => {
    const searches: Array<{ query: string; params: Record<string, unknown> }> = [];
    const fakeIndex = {
      updateSettings: async () => undefined,
      addDocuments: async () => undefined,
      search: async (query: string, params: Record<string, unknown>) => {
        searches.push({ query, params });
        if (searches.length === 1) {
          const error = new Error('Cannot find embedder with name `default`.');
          (error as any).code = 'invalid_search_embedder';
          throw error;
        }
        return {
          estimatedTotalHits: 1,
          hits: [
            buildPathwaySearchIndexDocument({
              _id: 'pathway-1',
              pathwayType: 'EXPLORATORY_CONTACT',
              status: 'PLAUSIBLE',
              studentFacingLabel: 'Exploratory outreach',
              bestNextStepCategory: 'plan-outreach',
              researchEntity: {
                _id: 'entity-1',
                slug: 'example-lab',
                name: 'Example Lab',
                departments: ['Computer Science'],
              },
              evidence: [],
            }),
          ],
        };
      },
    };

    const result = await searchPathwaysViaMeili(
      { q: 'paid summer data research', page: 1, pageSize: 5 },
      async () => fakeIndex as any,
    );

    expect(searches).toHaveLength(2);
    expect(searches[0].params).toMatchObject({
      hybrid: { semanticRatio: 0.75, embedder: 'default' },
    });
    expect(searches[1].params).not.toHaveProperty('hybrid');
    expect(result.hits[0]).toMatchObject({
      _id: 'pathway-1',
      researchEntity: { slug: 'example-lab' },
    });
  });

  it('throws non-embedder Meili errors from pathway search', async () => {
    const fakeIndex = {
      updateSettings: async () => undefined,
      addDocuments: async () => undefined,
      search: async () => {
        throw new Error('meili unavailable');
      },
    };

    await expect(
      searchPathwaysViaMeili(
        { q: 'paid summer data research', page: 1, pageSize: 5 },
        async () => fakeIndex as any,
      ),
    ).rejects.toThrow('meili unavailable');
  });

  it('does not return stale listing-bridged Meili documents as public pathways', async () => {
    const fakeIndex = {
      updateSettings: async () => undefined,
      addDocuments: async () => undefined,
      search: async () => ({
        estimatedTotalHits: 1,
        hits: [
          buildPathwaySearchIndexDocument({
            _id: 'legacy-listing-pathway',
            pathwayType: 'POSTED_ROLE',
            status: 'ACTIVE',
            evidenceStrength: 'DIRECT',
            studentFacingLabel: 'Posted research role',
            bestNextStepCategory: 'apply',
            researchEntity: {
              _id: 'entity-1',
              slug: 'example-lab',
              name: 'Example Lab',
              departments: ['Psychology'],
            },
            activePostedOpportunity: {
              _id: 'legacy-opportunity',
              title: 'Legacy listing',
              status: 'ROLLING',
              provenance: 'LISTING_BRIDGED',
            },
            evidence: [
              {
                signalType: 'POSTED_OPENING',
                sourceUrl: 'https://example.edu/listing',
              },
            ],
          }),
        ],
      }),
    };

    const result = await searchPathwaysViaMeili({}, async () => fakeIndex as any);

    expect(result.hits).toEqual([]);
    expect(result.estimatedTotalHits).toBe(0);
  });

  it('keeps formalization-only pathway types out of default and explicit Meili searches', async () => {
    const filters: unknown[] = [];
    const fakeIndex = {
      updateSettings: async () => undefined,
      addDocuments: async () => undefined,
      search: async (_query: string, params: Record<string, unknown>) => {
        filters.push(params.filter);
        return { estimatedTotalHits: 0, hits: [] };
      },
    };

    await searchPathwaysViaMeili({}, async () => fakeIndex as any);
    await searchPathwaysViaMeili(
      { filters: { pathwayType: ['COURSE_CREDIT' as any] } },
      async () => fakeIndex as any,
    );

    expect(String(filters[0])).toContain('pathwayType != "COURSE_CREDIT"');
    expect(String(filters[0])).toContain('pathwayType != "SENIOR_THESIS"');
    expect(String(filters[0])).toContain('pathwayType != "FELLOWSHIP_FUNDED_PROJECT"');
    expect(String(filters[1])).toContain(
      'pathwayId = "__formalization_only_pathway_filter_miss__"',
    );
  });
});

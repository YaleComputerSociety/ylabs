import { describe, expect, it, vi } from 'vitest';
import {
  buildPathwaySearchIndexDocument,
  buildPathwaySearchIndexDocuments,
  getPathwaySearchIndexSettings,
  PATHWAY_SEARCH_INDEX_NAME,
  PATHWAY_SEARCH_INDEX_PRIMARY_KEY,
  rebuildPathwaySearchIndex,
  searchPathwaysViaMeili,
} from '../pathwaySearchIndexService';

describe('pathwaySearchIndexService', () => {
  it('builds a Meilisearch-ready pathway document with filterable and sortable fields', () => {
    const doc = buildPathwaySearchIndexDocument({
      _id: 'pathway-1',
      pathwayType: 'POSTED_ROLE',
      status: 'ACTIVE',
      evidenceStrength: 'DIRECT',
      studentFacingLabel: 'Summer RA role with questions to jane.doe@yale.edu',
      explanation: 'Work with the lab on imaging analysis. Call 203-555-1212 first.',
      bestNextStep: 'Apply through the official form, not jane.doe@yale.edu.',
      bestNextStepCategory: 'apply',
      compensation: 'PAID',
      confidence: 0.91,
      sourceUrls: ['https://example.yale.edu/pathway', 'mailto:hidden@yale.edu'],
      lastObservedAt: new Date('2026-02-03T04:05:06.000Z'),
      createdAt: '2026-01-02T03:04:05.000Z',
      researchEntity: {
        _id: 'entity-1',
        slug: 'smith-lab',
        name: 'Smith Lab',
        displayName: 'Smith Neuroimaging Lab',
        kind: 'lab',
        entityType: 'LAB',
        studentVisibilityTier: 'student_ready',
        departments: ['Psychology', 'Psychology', 'Neuroscience'],
        researchAreas: ['Neuroimaging'],
        school: 'Faculty of Arts and Sciences',
        websiteUrl: 'https://smithlab.yale.edu',
      },
      activePostedOpportunity: {
        _id: 'opportunity-1',
        title: 'Summer Research Assistant',
        deadline: '2026-03-15T12:00:00.000Z',
        status: 'OPEN',
        term: 'Summer 2026',
      },
      evidence: [
        {
          signalType: 'POSTED_OPENING',
          confidence: 'HIGH',
          confidenceScore: 0.95,
          excerpt: 'Apply by emailing jane.doe@yale.edu or calling 203-555-1212.',
          sourceUrl: 'https://example.yale.edu/pathway',
          observedAt: '2026-02-01T00:00:00.000Z',
        },
      ],
      contactRoute: {
        routeType: 'OFFICIAL_APPLICATION',
        label: 'Official form, not jane.doe@yale.edu',
        url: 'https://example.yale.edu/apply',
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
      entityId: 'entity-1',
      entitySlug: 'smith-lab',
      entityName: 'Smith Lab',
      entityType: 'LAB',
      entityStudentVisibilityTier: 'student_ready',
      entityDepartments: ['Psychology', 'Neuroscience'],
      hasActivePostedOpportunity: true,
      postedOpportunityId: 'opportunity-1',
      postedOpportunityTitle: 'Summer Research Assistant',
      postedOpportunityDeadline: '2026-03-15T12:00:00.000Z',
      postedOpportunityStatus: 'OPEN',
      publicContactRouteType: 'OFFICIAL_APPLICATION',
      publicContactPolicy: 'APPLICATION_ONLY',
    });
    expect(doc.studentFacingLabel).toBe(
      'Summer RA role with questions to [email redacted]',
    );
    expect(doc.explanation).toBe(
      'Work with the lab on imaging analysis. Call [phone redacted] first.',
    );
    expect(doc.bestNextStep).toBe(
      'Apply through the official form, not [email redacted].',
    );
    expect(doc.lastObservedAtTimestamp).toBe(
      new Date('2026-02-03T04:05:06.000Z').getTime(),
    );
    expect(doc.postedOpportunityDeadlineTimestamp).toBe(
      new Date('2026-03-15T12:00:00.000Z').getTime(),
    );
    expect(doc.sourceUrls).toEqual(['https://example.yale.edu/pathway']);
    expect(doc.evidenceSnippets[0]).toContain('[email redacted]');
    expect(doc.evidenceSnippets[0]).toContain('[phone redacted]');
    expect(doc.publicContactRoute?.label).toBe(
      'Official form, not [email redacted]',
    );
    expect(doc.publicContactRoute?.url).toBe('https://example.yale.edu/apply');
    expect(doc.publicContactRoute?.rationale).toContain('[phone redacted]');
  });

  it('does not invoke object-shaped id conversion hooks while building index documents', () => {
    const unsafeId = {
      toString: () => {
        throw new Error('stringified arbitrary pathway index id');
      },
      toHexString: () => {
        throw new Error('called arbitrary pathway index id toHexString');
      },
    };

    const doc = buildPathwaySearchIndexDocument({
      _id: unsafeId,
      researchEntity: { _id: unsafeId, departments: [] },
      activePostedOpportunity: { _id: unsafeId },
    });

    expect(doc.id).toBe('');
    expect(doc.pathwayId).toBe('');
    expect(doc.entityId).toBeUndefined();
    expect(doc.postedOpportunityId).toBeUndefined();
    expect(buildPathwaySearchIndexDocuments([{ _id: unsafeId }])).toEqual([]);
  });

  it('drops non-public routes, no-direct-contact routes, and mailto URLs from the index document', () => {
    const authenticatedRouteDoc = buildPathwaySearchIndexDocument({
      _id: 'pathway-auth',
      researchEntity: { departments: [] },
      contactRoute: {
        routeType: 'FACULTY_PI',
        label: 'Private PI email pi@yale.edu',
        url: 'mailto:pi@yale.edu',
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
        url: 'mailto:pi@yale.edu',
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
        url: 'mailto:pi@yale.edu',
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

  it('indexes only HTTP(S) entity website URLs for public pathway search hits', async () => {
    const doc = buildPathwaySearchIndexDocument({
      _id: 'pathway-unsafe-entity-url',
      researchEntity: {
        _id: 'entity-unsafe-entity-url',
        name: 'Unsafe URL Lab',
        websiteUrl: 'javascript:alert(document.cookie)',
        website: 'https://safe.example.edu/lab',
        departments: [],
      },
    });
    const fakeIndex = {
      updateSettings: async () => undefined,
      addDocuments: async () => undefined,
      search: async () => ({ estimatedTotalHits: 1, hits: [doc] }),
    };

    const result = await searchPathwaysViaMeili({}, async () => fakeIndex as any);

    expect(doc.entityWebsiteUrl).toBe('https://safe.example.edu/lab');
    expect(result.hits[0].researchEntity.websiteUrl).toBe('https://safe.example.edu/lab');
    expect(JSON.stringify(result.hits[0])).not.toContain('javascript:');
  });

  it('does not independently publish an opportunity-managed pathway to Meilisearch', () => {
    const doc = buildPathwaySearchIndexDocument({
      _id: 'faculty-opportunity-pathway',
      derivationKey: 'faculty-opportunity:64f555555555555555555555',
      pathwayType: 'POSTED_ROLE',
      status: 'ACTIVE',
      evidenceStrength: 'DIRECT',
      confidence: 1,
      sourceUrls: ['https://research.yale.edu/forms/apply'],
      review: { status: 'approved' },
      researchEntity: {
        _id: 'faculty-opportunity-entity',
        name: 'Verified Lab',
        studentVisibilityTier: 'student_ready',
      },
    });

    expect(doc.studentPublishable).toBe(false);
  });

  it('publishes an approved faculty pathway only with a current linked opportunity', () => {
    const [doc] = buildPathwaySearchIndexDocuments([
      {
        _id: 'faculty-opportunity-pathway',
        derivationKey: 'faculty-opportunity:64f555555555555555555555',
        status: 'ACTIVE',
        evidenceStrength: 'DIRECT',
        confidence: 1,
        sourceUrls: ['https://example.edu/apply'],
        review: { status: 'approved' },
        researchEntity: {
          _id: 'faculty-opportunity-entity',
          departments: [],
          researchAreas: [],
        },
        activePostedOpportunity: {
          _id: '64f666666666666666666666',
          title: 'Research assistant',
          status: 'OPEN',
        },
      },
    ]);

    expect(doc.studentPublishable).toBe(true);
  });

  it('indexes public entity visibility tiers and gates Meili searches to those tiers', async () => {
    const studentReadyDoc = buildPathwaySearchIndexDocument({
      _id: 'pathway-student-ready',
      researchEntity: {
        _id: 'entity-student-ready',
        name: 'Student Ready Lab',
        studentVisibilityTier: 'student_ready',
      },
    });
    const limitedSafeDoc = buildPathwaySearchIndexDocument({
      _id: 'pathway-limited-safe',
      researchEntity: {
        _id: 'entity-limited-safe',
        name: 'Limited Safe Center',
        studentVisibilityTier: 'limited_but_safe',
      },
    });
    const searches: Array<{ params: Record<string, unknown> }> = [];
    const fakeIndex = {
      updateSettings: async () => undefined,
      addDocuments: async () => undefined,
      search: async (_query: string, params: Record<string, unknown>) => {
        searches.push({ params });
        return { estimatedTotalHits: 0, hits: [] };
      },
    };

    await searchPathwaysViaMeili({}, async () => fakeIndex as any);

    expect(studentReadyDoc.entityStudentVisibilityTier).toBe('student_ready');
    expect(limitedSafeDoc.entityStudentVisibilityTier).toBe('limited_but_safe');
    expect(String(searches[0].params.filter)).toContain(
      'entityStudentVisibilityTier = "student_ready"',
    );
    expect(String(searches[0].params.filter)).not.toContain(
      'entityStudentVisibilityTier = "limited_but_safe"',
    );
    expect(String(searches[0].params.filter)).not.toContain('operator_review');
    expect(String(searches[0].params.filter)).not.toContain('suppressed');
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
        'entityStudentVisibilityTier',
        'entityDepartments',
        'hasActivePostedOpportunity',
        'postedOpportunityStatus',
      ]),
    );
    expect(getPathwaySearchIndexSettings().filterableAttributes).not.toContain(
      'mutated',
    );
    expect(getPathwaySearchIndexSettings().sortableAttributes).toEqual(
      expect.arrayContaining([
        'confidence',
        'lastObservedAtTimestamp',
        'postedOpportunityDeadlineTimestamp',
      ]),
    );
  });

  it('rebuilds the index in pages without switching live pathway search traffic', async () => {
    const calls: Array<{ kind: string; payload?: unknown }> = [];
    const fakeIndex = {
      updateSettings: async (settings: unknown) => {
        calls.push({ kind: 'settings', payload: settings });
      },
      deleteAllDocuments: async () => {
        calls.push({ kind: 'clear' });
      },
      addDocuments: async (documents: unknown, options: unknown) => {
        calls.push({ kind: 'documents', payload: { documents, options } });
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
      getIndex: async () => fakeIndex,
    });

    expect(result).toEqual({
      indexName: PATHWAY_SEARCH_INDEX_NAME,
      pageSize: 1,
      fetchedHitCount: 2,
      indexedDocumentCount: 2,
      pageCount: 2,
      clearedExisting: true,
    });
    expect(calls.map((call) => call.kind)).toEqual(['settings', 'clear', 'documents', 'documents']);
    expect(calls[2].payload).toMatchObject({
      options: { primaryKey: PATHWAY_SEARCH_INDEX_PRIMARY_KEY },
    });
  });

  it('rejects unsafe rebuild page sizes before configuring the index', async () => {
    let getIndexCalls = 0;

    await expect(
      rebuildPathwaySearchIndex(async () => ({ hits: [], estimatedTotalHits: 0 }), {
        pageSize: 9007199254740992,
        getIndex: async () => {
          getIndexCalls += 1;
          throw new Error('unexpected index setup');
        },
      }),
    ).rejects.toThrow('--page-size must be a safe positive integer');

    expect(getIndexCalls).toBe(0);
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
            buildPathwaySearchIndexDocument({
              _id: 'pathway-1',
              pathwayType: 'EXPLORATORY_CONTACT',
              status: 'PLAUSIBLE',
              evidenceStrength: 'STRONG',
              compensation: 'UNKNOWN',
              studentFacingLabel: 'Exploratory outreach',
              bestNextStepCategory: 'plan-outreach',
              sourceUrls: ['https://example.yale.edu/source'],
              researchEntity: {
                _id: 'entity-1',
                slug: 'smith-lab',
                name: 'Smith Lab',
                entityType: 'LAB',
                studentVisibilityTier: 'student_ready',
                departments: ['Computer Science'],
                researchAreas: ['Machine Learning'],
              },
              evidence: [],
            }),
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
          sort: ['confidence:asc', 'lastObservedAtTimestamp:desc'],
        }),
      },
    ]);
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
      'entityStudentVisibilityTier = "student_ready"',
    );
    expect(String(searches[0].params.filter)).not.toContain(
      'entityStudentVisibilityTier = "limited_but_safe"',
    );
    expect(String(searches[0].params.filter)).toContain(
      'hasActivePostedOpportunity = false',
    );
    expect(result.hits[0]).toMatchObject({
      _id: 'pathway-1',
      bestNextStepCategory: 'plan-outreach',
      researchEntity: {
        slug: 'smith-lab',
        departments: ['Computer Science'],
      },
    });
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

  it('bounds direct Meili pathway search query and filter inputs before search', async () => {
    const searches: Array<{ query: string; params: Record<string, unknown> }> = [];
    const fakeIndex = {
      search: async (query: string, params: Record<string, unknown>) => {
        searches.push({ query, params });
        return { estimatedTotalHits: 0, hits: [] };
      },
    };
    const longResearchArea = 'x'.repeat(200);

    await searchPathwaysViaMeili(
      {
        q: ` ${'q'.repeat(700)} `,
        page: 1,
        pageSize: 24,
        filters: {
          departments: Array.from({ length: 60 }, (_, index) => `Department ${index}`),
          researchAreas: [longResearchArea],
        },
      },
      async () => fakeIndex as any,
    );

    const filter = String(searches[0].params.filter);
    expect(searches[0].query).toBe('q'.repeat(512));
    expect(filter).toContain('entityDepartments = "Department 49"');
    expect(filter).not.toContain('Department 50');
    expect(filter).toContain(`entityResearchAreas = "${'x'.repeat(120)}"`);
    expect(filter).not.toContain(longResearchArea);
  });

  it('drops non-string direct Meili pathway filter values before search', async () => {
    const searches: Array<{ query: string; params: Record<string, unknown> }> = [];
    const fakeIndex = {
      search: async (query: string, params: Record<string, unknown>) => {
        searches.push({ query, params });
        return { estimatedTotalHits: 0, hits: [] };
      },
    };
    const badFilter = { toString: vi.fn(() => 'Injected') };

    await searchPathwaysViaMeili(
      {
        filters: {
          departments: [badFilter as any, 'Computer Science'],
        },
      },
      async () => fakeIndex as any,
    );

    expect(badFilter.toString).not.toHaveBeenCalled();
    const filter = String(searches[0].params.filter);
    expect(filter).toContain('entityDepartments = "Computer Science"');
    expect(filter).not.toContain('Injected');
  });

  it('caps page before computing Meili pathway search offsets', async () => {
    const searches: Array<{ query: string; params: Record<string, unknown> }> = [];
    const fakeIndex = {
      search: async (query: string, params: Record<string, unknown>) => {
        searches.push({ query, params });
        return { estimatedTotalHits: 0, hits: [] };
      },
    };

    const result = await searchPathwaysViaMeili(
      {
        q: '',
        page: 999_999_999,
        pageSize: 500,
        filters: {},
        sort: {},
      },
      async () => fakeIndex as any,
    );

    expect(searches[0].params).toEqual(
      expect.objectContaining({
        limit: 100,
        offset: 99_900,
      }),
    );
    expect(result).toMatchObject({
      hits: [],
      estimatedTotalHits: 0,
      page: 1000,
      pageSize: 100,
    });
  });
});

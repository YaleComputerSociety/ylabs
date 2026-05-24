import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  search: vi.fn(),
  listAccessSummariesForResearchEntities: vi.fn(),
  departmentFindOne: vi.fn(),
  researchGroupMemberFindOne: vi.fn(),
  researchGroupMemberFind: vi.fn(),
  researchGroupMemberUpdateOne: vi.fn(),
  userFind: vi.fn(),
  researchEntityAggregate: vi.fn(),
  researchEntityFind: vi.fn(),
  researchEntityFindOneAndUpdate: vi.fn(),
  listWaysInForResearchEntities: vi.fn(),
}));

vi.mock('../../utils/meiliClient', () => ({
  getMeiliIndex: vi.fn(async () => ({
    search: mocks.search,
  })),
}));

vi.mock('../../models/department', () => ({
  DepartmentCategory: {
    SOCIAL_SCIENCES: 'social-sciences',
    HUMANITIES_ARTS: 'humanities-arts',
    ECONOMICS: 'economics',
  },
  Department: {
    findOne: mocks.departmentFindOne,
  },
}));

vi.mock('../../models/researchGroupMember', () => ({
  ResearchGroupMember: {
    findOne: mocks.researchGroupMemberFindOne,
    find: mocks.researchGroupMemberFind,
    updateOne: mocks.researchGroupMemberUpdateOne,
  },
}));

vi.mock('../../models/user', () => ({
  User: {
    find: mocks.userFind,
  },
}));

vi.mock('../../models/researchEntity', () => ({
  ResearchEntity: {
    aggregate: mocks.researchEntityAggregate,
    find: mocks.researchEntityFind,
    findOneAndUpdate: mocks.researchEntityFindOneAndUpdate,
  },
}));

vi.mock('../accessSummaryService', () => ({
  getAccessSummaryForResearchEntity: vi.fn(),
  listAccessSummariesForResearchEntities: mocks.listAccessSummariesForResearchEntities,
}));

vi.mock('../pathwaySearchService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../pathwaySearchService')>();
  return {
    ...actual,
    listWaysInForResearchEntities: mocks.listWaysInForResearchEntities,
  };
});

import {
  applyPrincipalInvestigatorWebsiteFallback,
  applyProfileResearchAreaFallback,
  buildProfileSynthesisDescription,
  findOrCreateForOwner,
  listResearchSearchSuggestions,
  sanitizeResearchEntityDescription,
  searchResearchGroupsViaMeili,
  selectVisibleResearchEntityMemberRows,
  sortEntryPathwaysByQuality,
} from '../researchGroupService';

const originalNodeEnv = process.env.NODE_ENV;

beforeEach(() => {
  process.env.NODE_ENV = originalNodeEnv;
  mocks.search.mockReset();
  mocks.listAccessSummariesForResearchEntities.mockReset();
  mocks.departmentFindOne.mockReset();
  mocks.researchGroupMemberFindOne.mockReset();
  mocks.researchGroupMemberFind.mockReset();
  mocks.researchGroupMemberUpdateOne.mockReset();
  mocks.userFind.mockReset();
  mocks.researchEntityAggregate.mockReset();
  mocks.researchEntityFind.mockReset();
  mocks.researchEntityFindOneAndUpdate.mockReset();
  mocks.listWaysInForResearchEntities.mockReset();
  mocks.listAccessSummariesForResearchEntities.mockResolvedValue(new Map());
  mocks.departmentFindOne.mockReturnValue({ lean: vi.fn().mockResolvedValue(null) });
  mocks.researchGroupMemberFindOne.mockReturnValue({ lean: vi.fn().mockResolvedValue(null) });
  mocks.researchGroupMemberFind.mockReturnValue({
    select: vi.fn().mockReturnValue({
      lean: vi.fn().mockResolvedValue([]),
    }),
  });
  mocks.researchGroupMemberUpdateOne.mockResolvedValue({});
  mocks.userFind.mockReturnValue({
    select: vi.fn().mockReturnValue({
      lean: vi.fn().mockResolvedValue([]),
    }),
  });
  mocks.researchEntityAggregate.mockResolvedValue([]);
  mocks.researchEntityFind.mockImplementation((query: any) => ({
    lean: vi.fn().mockResolvedValue(
      (query?._id?.$in || []).map((id: unknown) => ({
        _id: id,
      })),
    ),
  }));
  mocks.researchEntityFindOneAndUpdate.mockReturnValue({
    lean: vi.fn().mockResolvedValue({
      _id: '67d8928150621bcef434a1df',
      slug: 'synthetic-lab-pi1',
      name: 'Synthetic Lab',
      kind: 'lab',
    }),
  });
  mocks.listWaysInForResearchEntities.mockResolvedValue(new Map());
  delete process.env.RESEARCH_SEARCH_SEMANTIC;
  delete process.env.OPENAI_API_KEY;
});

describe('searchResearchGroupsViaMeili', () => {
  it('uses curated familiar search suggestions before metadata-derived areas', async () => {
    mocks.researchEntityAggregate.mockResolvedValueOnce([
      { _id: 'Machine Learning', count: 8 },
      { _id: 'Public Health', count: 6 },
      { _id: 'AI', count: 5 },
      { _id: 'Molecular Biology', count: 4 },
      { _id: 'Archival Research', count: 3 },
      { _id: 'Climate Policy', count: 2 },
      { _id: 'Social Science Data', count: 1 },
    ]);

    const suggestions = await listResearchSearchSuggestions(4);

    const pipeline = mocks.researchEntityAggregate.mock.calls[0][0];
    expect(pipeline).toEqual(
      expect.arrayContaining([
        { $match: { archived: { $ne: true } } },
        { $unwind: '$researchAreas' },
        expect.objectContaining({ $group: expect.objectContaining({ _id: '$area' }) }),
        { $limit: 24 },
      ]),
    );
    expect(suggestions).toEqual([
      { label: 'machine learning', query: 'machine learning' },
      { label: 'public health', query: 'public health' },
      { label: 'archival research', query: 'archival research' },
      { label: 'climate policy', query: 'climate policy' },
    ]);
  });

  it('does not derive research search suggestions from source chrome or narrow metadata labels', async () => {
    mocks.researchEntityAggregate.mockResolvedValueOnce([
      { _id: 'View Lab Website', count: 24 },
      { _id: 'View Related Publication', count: 20 },
      { _id: '2 YSM Researchers', count: 18 },
      { _id: 'View 3 Related Publications', count: 16 },
      { _id: 'YSM Researcher', count: 14 },
      { _id: 'Publications', count: 12 },
      { _id: 'Neuroscience and Neuropharmacology Research', count: 10 },
      { _id: 'Machine Learning', count: 8 },
      { _id: 'Public Health', count: 6 },
    ]);

    const suggestions = await listResearchSearchSuggestions(8);

    expect(suggestions).toEqual([
      { label: 'machine learning', query: 'machine learning' },
      { label: 'public health', query: 'public health' },
      { label: 'archival research', query: 'archival research' },
      { label: 'climate policy', query: 'climate policy' },
      { label: 'social science data', query: 'social science data' },
      { label: 'wet lab', query: 'wet lab' },
    ]);
  });

  it('creates owner fallback research entities with evidence-neutral access defaults', async () => {
    await findOrCreateForOwner({
      _id: '67d8928150621bcef434a1de',
      netid: 'pi1',
      fname: 'Fixture',
      lname: 'Synthetic',
      primaryDepartment: 'Computer Science',
    });

    const [, update] = mocks.researchEntityFindOneAndUpdate.mock.calls[0];
    expect(update.$setOnInsert).toMatchObject({
      slug: 'synthetic-lab-pi1',
      name: 'Synthetic Lab',
      kind: 'lab',
      openness: 'unknown',
    });
    expect(update.$setOnInsert).not.toHaveProperty('acceptingUndergrads');
  });

  it('does not query retired listings when building research search results', async () => {
    const entityId = '67d8928150621bcef434a1dd';
    mocks.search.mockResolvedValue({
      hits: [
        {
          id: entityId,
          slug: 'no-listing-fixture',
          name: 'No Listing Fixture',
          kind: 'lab',
          departments: ['Computer Science'],
          researchAreas: [],
          sourceUrls: [],
        },
      ],
      estimatedTotalHits: 1,
    });

    const result = await searchResearchGroupsViaMeili('systems', {}, 1, 1);

    expect(result.researchEntities[0]).not.toHaveProperty('hasActiveListing');
  });

  it('drops stale Meilisearch hits that no longer resolve to active research entities', async () => {
    const staleId = '67d8928150621bcef434a1dd';
    const activeId = '67d8928150621bcef434a1de';
    mocks.search.mockImplementation(async (query: string) => ({
      hits: [
        {
          id: staleId,
          slug: 'stale-deleted-fixture',
          name: 'Stale Deleted Fixture',
          kind: 'lab',
          departments: ['Computer Science'],
          researchAreas: [],
          sourceUrls: [],
        },
        {
          id: activeId,
          slug: 'old-index-slug',
          name: 'Old Indexed Name',
          kind: 'lab',
          departments: ['Statistics & Data Science'],
          researchAreas: ['Machine Learning'],
          sourceUrls: [],
        },
      ],
      estimatedTotalHits: query === 'machine learning' ? 2 : 0,
    }));
    mocks.researchEntityFind.mockReturnValueOnce({
      lean: vi.fn().mockResolvedValue([
        {
          _id: activeId,
          slug: 'current-active-slug',
          name: 'Current Active Name',
          kind: 'lab',
          departments: ['Statistics & Data Science'],
          researchAreas: ['Machine Learning'],
          sourceUrls: [],
        },
      ]),
    });

    const result = await searchResearchGroupsViaMeili('machine learning', {}, 1, 2);

    expect(result.researchEntities).toHaveLength(1);
    expect(result.researchEntities[0]).toMatchObject({
      _id: activeId,
      slug: 'current-active-slug',
      name: 'Current Active Name',
    });
  });

  it('uses evidence-first ordering for the default unfiltered research browse', async () => {
    const sourceBackedId = '67d8928150621bcef434a1dd';
    const sparseId = '67d8928150621bcef434a1de';
    const accessSummary = {
      status: 'evidence-backed',
      confidence: 0.8,
      evidence: [
        {
          signalType: 'CURRENT_UNDERGRADS',
          confidence: 'HIGH',
          sourceUrl: 'https://example.yale.edu/source-backed',
        },
      ],
      signalTypes: ['CURRENT_UNDERGRADS'],
      entryPathwayTypes: ['EXPLORATORY_CONTACT'],
      hasActivePostedOpportunity: false,
      bestNextStep: 'Plan exploratory outreach',
    };
    const wayIn = {
      _id: '67d8928150621bcef434a1ef',
      pathwayType: 'EXPLORATORY_CONTACT',
      status: 'PLAUSIBLE',
      evidenceStrength: 'MODERATE',
      studentFacingLabel: 'Plan targeted outreach',
      researchEntity: {
        _id: sourceBackedId,
        slug: 'source-backed-fixture',
        name: 'Source Backed Fixture',
      },
      evidence: [{ signalType: 'CURRENT_UNDERGRADS' }],
    };
    mocks.researchEntityAggregate.mockResolvedValueOnce([
      {
        data: [
          {
            _id: sourceBackedId,
            slug: 'source-backed-fixture',
            name: 'Source Backed Fixture',
            kind: 'lab',
            departments: ['Computer Science'],
            researchAreas: [],
            sourceUrls: ['https://example.yale.edu/source-backed'],
          },
          {
            _id: sparseId,
            slug: 'sparse-fixture',
            name: 'Sparse Fixture',
            kind: 'lab',
            departments: ['History'],
            researchAreas: [],
            sourceUrls: [],
          },
        ],
        total: [{ count: 2 }],
      },
    ]);
    mocks.listAccessSummariesForResearchEntities.mockResolvedValueOnce(
      new Map([[sourceBackedId, accessSummary]]),
    );
    mocks.listWaysInForResearchEntities.mockResolvedValueOnce(new Map([[sourceBackedId, [wayIn]]]));

    const result = await searchResearchGroupsViaMeili('', {}, 1, 24);

    expect(mocks.search).not.toHaveBeenCalled();
    expect(mocks.researchEntityAggregate).toHaveBeenCalledTimes(1);
    const pipeline = mocks.researchEntityAggregate.mock.calls[0][0];
    expect(pipeline).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          $lookup: expect.objectContaining({ from: 'access_signals' }),
        }),
        expect.objectContaining({
          $lookup: expect.objectContaining({ from: 'entry_pathways' }),
        }),
        expect.objectContaining({
          $lookup: expect.objectContaining({ from: 'posted_opportunities' }),
        }),
        expect.objectContaining({
          $sort: expect.objectContaining({
            _evidenceScore: -1,
            _accessSignalCount: -1,
            _officialYaleSourceCount: -1,
          }),
        }),
      ]),
    );
    expect(mocks.listAccessSummariesForResearchEntities).toHaveBeenCalledWith([
      sourceBackedId,
      sparseId,
    ]);
    expect(mocks.listWaysInForResearchEntities).toHaveBeenCalledWith([sourceBackedId, sparseId]);
    expect(result).toMatchObject({ estimatedTotalHits: 2, page: 1, pageSize: 24 });
    expect(result.researchEntities).toHaveLength(2);
    expect(result.researchEntities[0]).toMatchObject({
      _id: sourceBackedId,
      slug: 'source-backed-fixture',
      accessSummary,
      waysIn: [wayIn],
    });
    expect(result.researchEntities[1]).toMatchObject({
      _id: sparseId,
      slug: 'sparse-fixture',
      waysIn: [],
    });
  });

  it('enriches sparse browse results with cautious linked PI profile context', async () => {
    const sparseId = '67d8928150621bcef434a1de';
    mocks.researchEntityAggregate.mockResolvedValueOnce([
      {
        data: [
          {
            _id: sparseId,
            slug: 'fixture-scholar-profile',
            name: 'Fixture Scholar — Research',
            kind: 'individual',
            entityType: 'INDIVIDUAL_RESEARCH',
            departments: ['ANTH - Anthropology'],
            researchAreas: [],
            sourceUrls: [],
            description: '',
            shortDescription: '',
            fullDescription: '',
          },
        ],
        total: [{ count: 1 }],
      },
    ]);
    mocks.researchGroupMemberFind.mockReturnValueOnce({
      select: vi.fn().mockReturnValue({
        lean: vi.fn().mockResolvedValue([
          {
            _id: 'member-1',
            researchEntityId: sparseId,
            userId: '67d891f350621bcef4348431',
            role: 'pi',
          },
        ]),
      }),
    });
    mocks.userFind.mockReturnValueOnce({
      select: vi.fn().mockReturnValue({
        lean: vi.fn().mockResolvedValue([
          {
            _id: '67d891f350621bcef4348431',
            website: '',
            profileUrls: {
              anthropology: 'https://anthropology.yale.edu/profile/fixture-scholar',
              lookalike: 'https://external.example.net/profile/fixture-scholar',
            },
            bio: 'Ethnography and public humanities are central to this faculty research profile. It examines cultural practice and public writing.',
            topics: ['Ethnography', 'Public Humanities'],
            researchInterests: [],
          },
        ]),
      }),
    });

    const result = await searchResearchGroupsViaMeili('', {}, 1, 24);

    expect(result.researchEntities[0]).toMatchObject({
      slug: 'fixture-scholar-profile',
      sourceUrls: ['https://anthropology.yale.edu/profile/fixture-scholar'],
      profileSynthesisDescription:
        'Ethnography and public humanities are central to this faculty research profile. It examines cultural practice and public writing.',
      descriptionSource: 'PI_PROFILE_SYNTHESIS',
      profileResearchAreas: ['Ethnography', 'Public Humanities'],
    });
  });

  it('can invert default browse ordering for admin data-quality repair', async () => {
    process.env.NODE_ENV = 'development';
    mocks.researchEntityAggregate.mockResolvedValueOnce([
      {
        data: [
          {
            _id: '67d8928150621bcef434a1de',
            slug: 'sparse-fixture',
            name: 'Sparse Fixture',
            kind: 'lab',
            departments: ['History'],
            researchAreas: [],
            sourceUrls: [],
          },
        ],
        total: [{ count: 1 }],
      },
    ]);

    await searchResearchGroupsViaMeili('', {}, 1, 24, {}, { lowQualityFirst: true });

    expect(mocks.search).not.toHaveBeenCalled();
    const pipeline = mocks.researchEntityAggregate.mock.calls[0][0];
    expect(pipeline).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          $sort: expect.objectContaining({
            _evidenceScore: 1,
            _postedOpportunityCount: 1,
            _accessSignalCount: 1,
            _actionablePathwayCount: 1,
            _officialYaleSourceCount: 1,
            lastObservedAt: 1,
          }),
        }),
      ]),
    );
  });

  it('keeps evidence-first browse ordering in production even when low-quality order is requested', async () => {
    process.env.NODE_ENV = 'production';
    mocks.researchEntityAggregate.mockResolvedValueOnce([
      {
        data: [],
        total: [{ count: 0 }],
      },
    ]);

    await searchResearchGroupsViaMeili('', {}, 1, 24, {}, { lowQualityFirst: true });

    const pipeline = mocks.researchEntityAggregate.mock.calls[0][0];
    expect(pipeline).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          $sort: expect.objectContaining({
            _evidenceScore: -1,
            _postedOpportunityCount: -1,
            _accessSignalCount: -1,
            _actionablePathwayCount: -1,
            _officialYaleSourceCount: -1,
            lastObservedAt: -1,
          }),
        }),
      ]),
    );
  });

  it('enriches research search results with ways-in summaries from EntryPathway data', async () => {
    const entityId = '67d8928150621bcef434a1dd';
    const wayIn = {
      _id: '67d8928150621bcef434a1ee',
      pathwayType: 'EXPLORATORY_CONTACT',
      status: 'PLAUSIBLE',
      evidenceStrength: 'MODERATE',
      studentFacingLabel: 'Plan targeted outreach',
      bestNextStepCategory: 'plan-outreach',
      sourceUrls: ['https://example.yale.edu/ways-in'],
      researchEntity: {
        _id: entityId,
        slug: 'ways-in-fixture',
        name: 'Ways In Fixture',
        departments: ['Computer Science'],
        researchAreas: [],
      },
      evidence: [],
    };
    mocks.search.mockResolvedValueOnce({
      hits: [
        {
          id: entityId,
          slug: 'ways-in-fixture',
          name: 'Ways In Fixture',
          kind: 'lab',
          departments: ['Computer Science'],
          researchAreas: [],
          sourceUrls: [],
        },
      ],
      estimatedTotalHits: 1,
    });
    mocks.listWaysInForResearchEntities.mockResolvedValueOnce(new Map([[entityId, [wayIn]]]));

    const result = await searchResearchGroupsViaMeili('systems', {}, 1, 1);

    expect(mocks.listWaysInForResearchEntities).toHaveBeenCalledWith([entityId]);
    expect(result.researchEntities[0].waysIn).toHaveLength(1);
    expect(result.researchEntities[0].waysIn?.[0]).toMatchObject({
      _id: '67d8928150621bcef434a1ee',
      pathwayType: 'EXPLORATORY_CONTACT',
      researchEntity: expect.objectContaining({ _id: entityId }),
    });
  });

  it('does not replace a copied PI bio with a research-area placeholder description', () => {
    const sanitized = sanitizeResearchEntityDescription(
      {
        description:
          'Dr. Fixture is an Associate Professor whose biography appears on the faculty profile.',
        shortDescription: 'Research areas include cancer biology and RNA therapeutics.',
        fullDescription:
          'Dr. Fixture is an Associate Professor whose biography appears on the faculty profile.',
      },
      [
        {
          user: {
            bio: 'Dr. Fixture is an Associate Professor whose biography appears on the faculty profile.',
          },
          role: 'pi',
        },
      ],
    );

    expect(sanitized.description).toBe('');
    expect(sanitized.fullDescription).toBe('');
  });

  it('removes synthetic indexed-metadata descriptions so profile synthesis can be used', () => {
    const sanitized = sanitizeResearchEntityDescription(
      {
        name: 'Fixture Scholar — Research',
        entityType: 'INDIVIDUAL_RESEARCH',
        kind: 'individual',
        description: '',
        shortDescription: 'Research home connected to ANTH - Anthropology and .',
        fullDescription:
          'Fixture Scholar — Research is a Yale research home connected to ANTH - Anthropology and . This context is synthesized from indexed Yale metadata and should be checked against official sources before outreach.',
      },
      [
        {
          role: 'pi',
          user: {
            bio: 'Questions about what ethnography is and does are at the center of this scholarly work.',
          },
        },
      ],
    );

    expect(sanitized.shortDescription).toBe('');
    expect(sanitized.fullDescription).toBe('');

    const synthesis = buildProfileSynthesisDescription(sanitized, [
      {
        role: 'pi',
        user: {
          bio: 'Questions about what ethnography is and does are at the center of this scholarly work.',
        },
      },
    ]);

    expect(synthesis?.description).toBe(
      'Questions about what ethnography is and does are at the center of this scholarly work.',
    );
  });

  it('does not replace a copied PI bio with a truncated prefix of the same profile bio', () => {
    const profileBio =
      'My research interests focus on intra- and interpersonal processes that allow people to initiate and maintain mutually supportive close interpersonal relationships generally as well as on obstacles to so doing. An overlapping interest is in the nature of emotion and the interpersonal functions it serves.';

    const sanitized = sanitizeResearchEntityDescription(
      {
        description: profileBio,
        shortDescription:
          'My research interests focus on intra- and interpersonal processes that allow people to initiate and maintain mutually supportive close interpersonal relationships generally as well as on obstacles to so doing.',
        fullDescription: profileBio,
      },
      [
        {
          user: {
            bio: profileBio,
          },
          role: 'pi',
        },
      ],
    );

    expect(sanitized.description).toBe('');
    expect(sanitized.shortDescription).toBe('');
    expect(sanitized.fullDescription).toBe('');
  });

  it('can replace a copied PI bio with a real lab short description', () => {
    const sanitized = sanitizeResearchEntityDescription(
      {
        description: 'Dr. Example is a professor whose biography appears on the faculty profile.',
        shortDescription: 'Studies DNA repair mechanisms using molecular and cellular assays.',
        fullDescription: 'Dr. Example is a professor whose biography appears on the faculty profile.',
      },
      [
        {
          user: {
            bio: 'Dr. Example is a professor whose biography appears on the faculty profile.',
          },
          role: 'pi',
        },
      ],
    );

    expect(sanitized.description).toBe(
      'Studies DNA repair mechanisms using molecular and cellular assays.',
    );
    expect(sanitized.fullDescription).toBe('');
  });

  it('preserves lab-authored descriptions even when the PI profile bio copied the same lab text', () => {
    const labDescription =
      'My lab focuses on intergroup social cognition. My lab addresses this question by studying how knowledge of social groups is acquired.';

    const sanitized = sanitizeResearchEntityDescription(
      {
        description: labDescription,
        shortDescription: 'My lab focuses on intergroup social cognition.',
        fullDescription: labDescription,
      },
      [
        {
          user: {
            bio: labDescription,
          },
          role: 'pi',
        },
      ],
    );

    expect(sanitized.description).toBe(labDescription);
    expect(sanitized.fullDescription).toBe(labDescription);
  });

  it('moves copied PI research interests into a labeled detail fallback', () => {
    const group = applyProfileResearchAreaFallback(
      {
        name: 'Synthetic Delivery Fixture',
        researchAreas: ['Nanoparticle-Based Drug Delivery', 'RNA Interference and Gene Delivery'],
      },
      [
        {
          role: 'pi',
          user: {
            netid: 'pi2',
            researchInterests: [
              'Nanoparticle-Based Drug Delivery',
              'RNA Interference and Gene Delivery',
            ],
            topics: [],
          },
        },
      ],
    );

    expect(group.researchAreas).toEqual([]);
    expect(group.profileResearchAreas).toEqual([
      'Nanoparticle-Based Drug Delivery',
      'RNA Interference and Gene Delivery',
    ]);
    expect(group.researchAreaSource).toBe('PI_PROFILE_FALLBACK');
  });

  it('builds a cautious PI-profile synthesis from interests and paper titles', () => {
    const synthesis = buildProfileSynthesisDescription(
      {
        name: 'Synthetic Statistics Fixture',
        description: '',
        shortDescription: '',
        fullDescription: '',
      },
      [
        {
          role: 'pi',
          user: {
            fname: 'Fixture',
            lname: 'Statistician',
            topics: ['High-Dimensional Statistics', 'Machine Learning'],
            researchInterests: ['Probability Theory', 'Computational Biology'],
          },
        },
      ],
      [
        { title: 'Spectral methods for high-dimensional inference' },
        { title: 'Statistical limits in computational biology' },
      ],
    );

    expect(synthesis?.source).toBe('PI_PROFILE_SYNTHESIS');
    expect(synthesis?.description).toContain('It appears to center on');
    expect(synthesis?.description).toContain('High-Dimensional Statistics');
    expect(synthesis?.description).toContain('Probability Theory');
    expect(synthesis?.description).toContain('Spectral methods for high-dimensional inference');
    expect(synthesis?.description).not.toContain('faculty research profile');
    expect(synthesis?.description).not.toContain('has not found a separate lab description');
    expect(synthesis?.description).not.toContain('accepts undergraduates');
  });

  it('keeps PI-profile synthesis on complete research sentences instead of cutting off mid-sentence', () => {
    const synthesis = buildProfileSynthesisDescription(
      {
        name: 'Fixture Scholar — Research',
        entityType: 'INDIVIDUAL_RESEARCH',
        kind: 'individual',
        description: '',
        shortDescription: '',
        fullDescription: '',
      },
      [
        {
          role: 'pi',
          user: {
            bio: 'Questions about what ethnography is and does—as an aesthetic genre, political practice, and interpersonal field of knowledge construction—are at the center of my teaching and scholarly work. Trained as an anthropologist, I am committed to a transdisciplinary vision of ethnography as a mode of inquiry at the cutting edges of queer theory, black, indigenous, and ethnic studies, environmental studies, and public humanities. In this spirit, my courses are conducted as writing workshops that focus on social problematics at the intersection between anthropology and cultural studies. My books explore the production of embodied knowledge and social trauma under regimes of labor marginalized by transformations in global capitalism. My current research tracks the unfolding impact of federal policy, anthropogenic climate change, and industrial resource extraction on wild horses on America’s public lands.',
          },
        },
      ],
      [],
    );

    expect(synthesis?.source).toBe('PI_PROFILE_SYNTHESIS');
    expect(synthesis?.description).toContain('Questions about what ethnography is and does');
    expect(synthesis?.description).toContain(
      'black, indigenous, and ethnic studies, environmental studies, and public humanities.',
    );
    expect(synthesis?.description).toContain(
      'My current research tracks the unfolding impact of federal policy',
    );
    expect(synthesis?.description).not.toContain('...');
    expect(synthesis?.description).not.toContain('my courses are conducted');
  });

  it('does not treat an honorific abbreviation as the whole PI-profile synthesis', () => {
    const synthesis = buildProfileSynthesisDescription(
      {
        name: 'Fixture Honorific Research',
        entityType: 'INDIVIDUAL_RESEARCH',
        kind: 'individual',
        description: '',
        shortDescription: '',
        fullDescription: '',
      },
      [
        {
          role: 'pi',
          user: {
            bio: 'Dr. Fixture then went on to decipher the molecular mechanisms of how telomere dysfunction initiates premature aging phenotypes in the laboratory mouse. Dr. Fixture is currently using this novel mouse model to explore the roles that cellular senescence play in initiating premature aging phenotypes.',
          },
        },
      ],
      [],
    );

    expect(synthesis?.source).toBe('PI_PROFILE_SYNTHESIS');
    expect(synthesis?.description).not.toBe('Dr.');
    expect(synthesis?.description).toContain('telomere dysfunction');
    expect(synthesis?.description).toContain('cellular senescence');
  });

  it('uses lab-profile synthesis wording when a sparse profile has a lab website', () => {
    const synthesis = buildProfileSynthesisDescription(
      {
        name: 'Fixture Materials Lab',
        kind: 'lab',
        entityType: 'LAB',
        websiteUrl: 'https://fixture-materials.example.edu/',
        description: '',
        shortDescription: '',
        fullDescription: '',
      },
      [
        {
          role: 'pi',
          user: {
            fname: 'Fixture',
            lname: 'Engineer',
            topics: ['Soft Robotics'],
            researchInterests: ['Multifunctional Materials'],
          },
        },
      ],
      [],
    );

    expect(synthesis?.source).toBe('PI_PROFILE_SYNTHESIS');
    expect(synthesis?.description).toContain('It appears to center on Soft Robotics');
    expect(synthesis?.description).not.toContain('faculty research profile');
    expect(synthesis?.description).not.toContain('lab profile');
  });

  it('builds PI-profile synthesis from entity research areas when title fragments are the only descriptions', () => {
    const synthesis = buildProfileSynthesisDescription(
      {
        name: 'Synthetic Statistics Fixture',
        description: '',
        shortDescription: 'Co-Director of Graduate Studies',
        fullDescription: '',
        researchAreas: ['Mathematical Statistics', 'Probability Theory', 'Machine Learning'],
      },
      [
        {
          role: 'pi',
          user: {
            fname: 'Fixture',
            lname: 'Statistician',
            topics: ['Vestibular and auditory disorders'],
            researchInterests: [],
          },
        },
      ],
      [],
    );

    expect(synthesis?.source).toBe('PI_PROFILE_SYNTHESIS');
    expect(synthesis?.description).toContain('Mathematical Statistics');
    expect(synthesis?.description).toContain('Probability Theory');
    expect(synthesis?.description).not.toContain('Vestibular and auditory disorders');
    expect(synthesis?.description).not.toContain('has not found a separate lab description');
  });

  it('cleans split PI research-area prose before deciding whether entity areas are copied profile interests', () => {
    const splitProfileAreas = [
      'Research Areas: Our work is interdisciplinary and combines elements of biogeography',
      'community ecology',
      'landscape ecology',
      'macroecology',
      'global change ecology',
      'evolution',
      'comparative biology',
    ];

    const group = applyProfileResearchAreaFallback(
      {
        name: 'Synthetic Ecology Fixture',
        researchAreas: splitProfileAreas,
      },
      [
        {
          role: 'pi',
          user: {
            netid: 'pi3',
            researchInterests: splitProfileAreas,
            topics: [],
          },
        },
      ],
    );

    expect(group.researchAreas).toEqual([]);
    expect(group.profileResearchAreas).toEqual([
      'biogeography',
      'community ecology',
      'landscape ecology',
      'macroecology',
      'global change ecology',
      'evolution',
      'comparative biology',
    ]);
    expect(group.researchAreaSource).toBe('PI_PROFILE_FALLBACK');
  });

  it('keeps entity-specific research areas when they are not only PI profile interests', () => {
    const group = applyProfileResearchAreaFallback(
      {
        name: 'Synthetic Delivery Fixture',
        researchAreas: ['Lab-specific nanomedicine', 'RNA Interference and Gene Delivery'],
      },
      [
        {
          role: 'pi',
          user: {
            researchInterests: ['RNA Interference and Gene Delivery'],
            topics: [],
          },
        },
      ],
    );

    expect(group.researchAreas).toEqual([
      'Lab-specific nanomedicine',
      'RNA Interference and Gene Delivery',
    ]);
    expect(group.profileResearchAreas).toBeUndefined();
    expect(group.researchAreaSource).toBeUndefined();
  });

  it('uses a principal investigator website when an entity has no website', () => {
    const group = applyPrincipalInvestigatorWebsiteFallback(
      {
        name: 'Synthetic Website Fixture',
        websiteUrl: '',
        sourceUrls: ['https://example.edu/source/synthetic-website-fixture'],
      },
      [
        {
          role: 'pi',
          user: {
            website: 'https://pi-website.example.edu/',
          },
        },
      ],
    );

    expect(group.websiteUrl).toBe('https://pi-website.example.edu/');
  });

  it('keeps an entity website instead of replacing it with the PI website', () => {
    const group = applyPrincipalInvestigatorWebsiteFallback(
      {
        name: 'Existing Website Fixture',
        websiteUrl: 'https://research-home.example.edu/',
      },
      [
        {
          role: 'pi',
          user: {
            website: 'https://pi.example.edu/',
          },
        },
      ],
    );

    expect(group.websiteUrl).toBe('https://research-home.example.edu/');
  });

  it('hides retired duplicate membership rows from public detail payloads', () => {
    const visible = selectVisibleResearchEntityMemberRows([
      {
        _id: 'current-pi',
        userId: 'user-1',
        role: 'pi',
        isCurrentMember: true,
      },
      {
        _id: 'retired-pi',
        userId: 'user-1',
        role: 'pi',
        isCurrentMember: false,
      },
      {
        _id: 'duplicate-current-pi',
        userId: 'user-1',
        role: 'pi',
        isCurrentMember: true,
      },
    ]);

    expect(visible).toHaveLength(1);
    expect(visible[0]).toMatchObject({
      _id: 'current-pi',
      userId: 'user-1',
      role: 'pi',
      isCurrentMember: true,
    });
  });

  it('keeps source-backed name-only member rows visible', () => {
    const visible = selectVisibleResearchEntityMemberRows([
      {
        _id: 'name-only-pi',
        name: 'Fixture Nameonly',
        role: 'pi',
        isCurrentMember: true,
      },
      {
        _id: 'duplicate-name-only-pi',
        name: 'Fixture Nameonly',
        role: 'pi',
        isCurrentMember: true,
      },
      {
        _id: 'retired-name-only-pi',
        name: 'Fixture Nameonly',
        role: 'pi',
        isCurrentMember: false,
      },
    ]);

    expect(visible).toHaveLength(1);
    expect(visible[0]).toMatchObject({
      _id: 'name-only-pi',
      name: 'Fixture Nameonly',
      role: 'pi',
      isCurrentMember: true,
    });
  });

  it('orders detail entry pathways by evidence-backed quality before profile fallbacks', () => {
    const sorted = sortEntryPathwaysByQuality([
      {
        _id: 'fallback',
        pathwayType: 'EXPLORATORY_CONTACT',
        evidenceStrength: 'WEAK',
        confidence: 0.9,
        derivationKey: 'pathway:EXPLORATORY_CONTACT:OFFICIAL_PROFILE:user-1',
      },
      {
        _id: 'undergrad',
        pathwayType: 'EXPLORATORY_CONTACT',
        evidenceStrength: 'STRONG',
        confidence: 0.7,
        derivationKey: 'pathway:EXPLORATORY_CONTACT:CURRENT_UNDERGRADS',
      },
      {
        _id: 'posted',
        pathwayType: 'POSTED_ROLE',
        status: 'ACTIVE',
        evidenceStrength: 'DIRECT',
        confidence: 0.6,
      },
    ]);

    expect(sorted.map((pathway) => pathway._id)).toEqual(['posted', 'undergrad', 'fallback']);
  });

  it('uses keyword search by default when semantic search is not configured', async () => {
    const entityId = '67d8928150621bcef434a1d5';
    mocks.search.mockResolvedValueOnce({
      hits: [
        {
          id: entityId,
          slug: 'keyword-fixture-home',
          name: 'Keyword Fixture Home',
          kind: 'lab',
          departments: ['Chemistry'],
          researchAreas: [],
          sourceUrls: [],
        },
      ],
      estimatedTotalHits: 1,
    });

    const result = await searchResearchGroupsViaMeili('fixture', {}, 1, 1);

    expect(mocks.search).toHaveBeenCalledTimes(1);
    expect(mocks.search).toHaveBeenCalledWith(
      'fixture',
      expect.not.objectContaining({ hybrid: expect.anything() }),
    );
    expect(result.researchEntities[0]).toMatchObject({
      _id: entityId,
      slug: 'keyword-fixture-home',
      name: 'Keyword Fixture Home',
      searchMatch: expect.objectContaining({ mode: 'expanded-keyword' }),
    });
  });

  it('falls back to keyword search when configured semantic search lacks the hybrid embedder', async () => {
    process.env.RESEARCH_SEARCH_SEMANTIC = 'true';
    process.env.OPENAI_API_KEY = 'test-key';
    const entityId = '67d8928150621bcef434a1d5';
    mocks.search
      .mockRejectedValueOnce({
        cause: {
          code: 'invalid_search_embedder',
          message: 'Cannot find embedder with name `default`.',
        },
      })
      .mockResolvedValueOnce({
        hits: [
          {
            id: entityId,
            slug: 'keyword-fixture-home',
            name: 'Keyword Fixture Home',
            kind: 'lab',
            departments: ['Chemistry'],
            researchAreas: [],
            sourceUrls: [],
          },
        ],
        estimatedTotalHits: 1,
      });

    const result = await searchResearchGroupsViaMeili('fixture', {}, 1, 1);

    expect(mocks.search).toHaveBeenCalledTimes(2);
    expect(mocks.search).toHaveBeenNthCalledWith(
      1,
      'fixture',
      expect.objectContaining({
        hybrid: { semanticRatio: 0.65, embedder: 'default' },
      }),
    );
    expect(mocks.search).toHaveBeenNthCalledWith(
      2,
      'fixture',
      expect.not.objectContaining({ hybrid: expect.anything() }),
    );
    expect(result).toMatchObject({ estimatedTotalHits: 1, page: 1, pageSize: 1 });
    expect(result.researchEntities).toHaveLength(1);
    expect(result.researchEntities[0]).toMatchObject({
      _id: entityId,
      slug: 'keyword-fixture-home',
    });
  });

  it('expands common student method phrases before giving up on literal keyword search', async () => {
    const entityId = '67d8928150621bcef434a1d6';
    mocks.search.mockImplementation(async (query: string) => {
      if (query === 'wet lab') {
        return { hits: [], estimatedTotalHits: 0 };
      }
      if (query.includes('molecular biology')) {
        return {
          hits: [
            {
              id: entityId,
              slug: 'method-fixture-home',
              name: 'Method Fixture Home',
              kind: 'lab',
              departments: ['Molecular, Cellular and Developmental Biology'],
              researchAreas: ['Molecular biology'],
              description:
                'Studies molecular biology, cellular systems, and experimental bench research.',
              sourceUrls: [],
            },
          ],
          estimatedTotalHits: 1,
        };
      }
      return { hits: [], estimatedTotalHits: 0 };
    });

    const result = await searchResearchGroupsViaMeili('wet lab', {}, 1, 5);

    expect(mocks.search).toHaveBeenCalledWith('wet lab', expect.any(Object));
    expect(mocks.search).toHaveBeenCalledWith(
      expect.stringContaining('molecular biology'),
      expect.any(Object),
    );
    expect(result.researchEntities).toEqual([
      expect.objectContaining({
        _id: entityId,
        name: 'Method Fixture Home',
        searchMatch: expect.objectContaining({
          mode: 'expanded-keyword',
          methods: expect.arrayContaining(['wet lab']),
        }),
      }),
    ]);
  });

  it('reranks richer direct research-home matches above weaker text coincidences', async () => {
    mocks.search.mockResolvedValue({
      hits: [
        {
          id: '67d8928150621bcef434a1d7',
          slug: 'weak-policy-hit',
          name: 'Weak Policy Hit',
          kind: 'lab',
          departments: ['Economics'],
          researchAreas: [],
          description: 'Uses public policy tools for market design.',
          sourceUrls: [],
        },
        {
          id: '67d8928150621bcef434a1d8',
          slug: 'climate-policy-center',
          name: 'Fixture Climate Policy Center',
          kind: 'center',
          departments: ['Environmental Studies'],
          researchAreas: ['Climate policy'],
          description:
            'Studies climate policy, environmental governance, and public decision making.',
          sourceUrls: ['https://example.edu/climate-policy'],
        },
      ],
      estimatedTotalHits: 2,
    });

    const result = await searchResearchGroupsViaMeili('climate policy', {}, 1, 2);

    expect(result.researchEntities.map((entity) => entity.slug)).toEqual([
      'climate-policy-center',
      'weak-policy-hit',
    ]);
    expect(result.researchEntities[0].searchMatch).toMatchObject({
      mode: 'expanded-keyword',
      concepts: expect.arrayContaining(['climate policy']),
    });
  });

  it('paginates after merging expanded exploratory query results', async () => {
    mocks.search.mockImplementation(async (query: string) => {
      if (query === 'wet lab') {
        return {
          hits: [
            {
              id: '67d8928150621bcef434a1d9',
              slug: 'method-fixture-one',
              name: 'Method Fixture One',
              description: 'Exploratory experimental biology.',
              researchAreas: ['experimental biology'],
            },
          ],
          estimatedTotalHits: 1,
        };
      }
      if (query.includes('molecular biology')) {
        return {
          hits: [
            {
              id: '67d8928150621bcef434a1da',
              slug: 'method-fixture-two',
              name: 'Method Fixture Two',
              description: 'Molecular biology bench research.',
              researchAreas: ['molecular biology'],
            },
          ],
          estimatedTotalHits: 1,
        };
      }
      return { hits: [], estimatedTotalHits: 0 };
    });

    const result = await searchResearchGroupsViaMeili('wet lab', {}, 2, 1);

    expect(mocks.search).toHaveBeenCalledWith(
      expect.stringContaining('molecular biology'),
      expect.any(Object),
    );
    expect(result.page).toBe(2);
    expect(result.researchEntities).toHaveLength(1);
    expect(result.researchEntities[0].slug).toBe('method-fixture-one');
  });

  it('does not apply the page offset twice for explicit sorted unmerged browse results', async () => {
    mocks.search.mockResolvedValue({
      hits: [
        {
          id: '67d8928150621bcef434a1dd',
          slug: 'browse-page-two',
          name: 'Browse Page Two',
          description: 'Second page browse result.',
          departments: ['Medicine'],
        },
      ],
      estimatedTotalHits: 1000,
    });

    const result = await searchResearchGroupsViaMeili('', {}, 2, 1, { sortBy: 'lastObservedAt' });

    expect(mocks.search).toHaveBeenCalledWith(
      '',
      expect.objectContaining({
        limit: 1,
        offset: 1,
        sort: ['lastObservedAt:desc'],
      }),
    );
    expect(result.page).toBe(2);
    expect(result.estimatedTotalHits).toBe(1000);
    expect(result.researchEntities).toHaveLength(1);
    expect(result.researchEntities[0].slug).toBe('browse-page-two');
  });

  it('keeps distinct same-name research homes when they have different stable ids', async () => {
    mocks.search.mockResolvedValue({
      hits: [
        {
          id: '67d8928150621bcef434a1db',
          slug: 'shared-fixture-home-chemistry',
          name: 'Shared Fixture Home',
          description: 'Chemistry materials research.',
          departments: ['Chemistry'],
        },
        {
          id: '67d8928150621bcef434a1dc',
          slug: 'shared-fixture-home-biology',
          name: 'Shared Fixture Home',
          description: 'Cell biology research.',
          departments: ['Biology'],
        },
      ],
      estimatedTotalHits: 2,
    });

    const result = await searchResearchGroupsViaMeili('Shared Fixture Home', {}, 1, 5);

    expect(result.researchEntities.map((entity) => entity.slug)).toEqual([
      'shared-fixture-home-chemistry',
      'shared-fixture-home-biology',
    ]);
  });
});

import mongoose from 'mongoose';
import { describe, expect, it, vi } from 'vitest';
import {
  addPostMaterializationMetrics,
  buildOfficialProfileCoverageInputs,
  buildScholarlyAttributionWriteModels,
  buildUserProfileUrlLookupClauses,
  isMaterializableUserBioCandidate,
  buildFellowshipLookupClauses,
  buildScholarlyLinkLookupClauses,
  buildFellowshipUpdateFromObservations,
  buildPaperUpdateFromObservations,
  buildResearchEntityProfileSupplementObservations,
  buildUserBioObservationScore,
  countListingBackedPostedOpportunitiesForRun,
  emptyPostMaterializationMetrics,
  findExistingResearchEntityByFacultyResearchAreaIdentity,
  findExistingResearchEntityByOfficialDirectoryExactName,
  findExistingResearchEntityByOfficialLabUrl,
  findExistingResearchEntityByPiAndName,
  filterUserObservationsWithMismatchedProfileUrl,
  resolveArchivedEntityDocToCanonical,
  loadPiProfileContextFromCurrentMembership,
  materializeEntity,
  mergeUniqueArrayValues,
  materializedFieldValue,
  normalizeDoiForMaterialization,
  shouldClearIgnoredAccessClaimForEntity,
  shouldIgnoreObservationForEntityMaterialization,
  shouldMaterializeAccessForRunObservations,
  syncInferredPiMembership,
  syncProfileBackedFacultyResearchAreaMemberFromIdentity,
  syncResolvedRelationshipFromObservationFields,
  syncResolvedMemberFromObservationFields,
  uniqueKeyValueForIdentifier,
} from '../entityMaterializer';
import { resolveField } from '../confidenceResolver';
import { publicAccessExcerpt } from '../accessMaterializer';
import { redactDirectContactInfo } from '../../utils/contactRedaction';
import { User } from '../../models/user';
import { ResearchGroupMember } from '../../models/researchGroupMember';
import { Observation } from '../../models/observation';
import { ResearchEntity } from '../../models/researchEntity';

describe('entityMaterializer post-materialization metrics', () => {
  it('drops profile-derived user observations when the official profile URL names a different person', () => {
    const observations = filterUserObservationsWithMismatchedProfileUrl([
      {
        field: 'fname',
        value: 'Fixture',
        sourceUrl: 'https://example.yale.edu/people/fixture-example',
      },
      {
        field: 'lname',
        value: 'Example',
        sourceUrl: 'https://example.yale.edu/people/fixture-example',
      },
      {
        field: 'profileUrls',
        value: { medicine: 'https://medicine.yale.edu/profile/different-example/' },
        sourceUrl: 'https://medicine.yale.edu/profile/different-example/',
      },
      {
        field: 'orcid',
        value: '0000-0000-0000-0000',
        sourceUrl: 'https://medicine.yale.edu/profile/different-example/',
      },
      {
        field: 'topics',
        value: ['Protein Structure and Dynamics'],
        sourceUrl: 'https://medicine.yale.edu/profile/different-example/',
      },
      {
        field: 'title',
        value: 'Professor of Example Studies',
        sourceUrl: 'https://example.yale.edu/people/fixture-example',
      },
    ]);

    expect(observations).toEqual([
      expect.objectContaining({ field: 'fname' }),
      expect.objectContaining({ field: 'lname' }),
      expect.objectContaining({ field: 'title' }),
    ]);
  });

  it('keeps profile-derived user observations when the official profile URL matches the user name', () => {
    const observations = filterUserObservationsWithMismatchedProfileUrl([
      { field: 'fname', value: 'Fixture' },
      { field: 'lname', value: 'Example' },
      {
        field: 'profileUrls',
        value: { department: 'https://example.yale.edu/people/fixture-example' },
        sourceUrl: 'https://example.yale.edu/people/fixture-example',
      },
      {
        field: 'topics',
        value: ['Example topic'],
        sourceUrl: 'https://example.yale.edu/people/fixture-example',
      },
    ]);

    expect(observations).toHaveLength(4);
  });

  it('keeps netid and first-initial official profile URL patterns', () => {
    const initialProfile = filterUserObservationsWithMismatchedProfileUrl([
      { field: 'netid', value: 'example-netid' },
      { field: 'fname', value: 'Example' },
      { field: 'lname', value: 'Person' },
      {
        field: 'profileUrls',
        value: { medicine: 'https://medicine.yale.edu/profile/e-person/' },
        sourceUrl: 'https://medicine.yale.edu/profile/e-person/',
      },
    ]);
    const netidProfile = filterUserObservationsWithMismatchedProfileUrl([
      { field: 'netid', value: 'EX44' },
      { field: 'fname', value: 'Example' },
      { field: 'lname', value: 'Identifier' },
      {
        field: 'profileUrls',
        value: { medicine: 'https://medicine.yale.edu/profile/EX44/' },
        sourceUrl: 'https://medicine.yale.edu/profile/EX44/',
      },
    ]);

    expect(initialProfile).toHaveLength(4);
    expect(netidProfile).toHaveLength(4);
  });

  it('keeps compact multi-part name profile URL patterns', () => {
    const observations = filterUserObservationsWithMismatchedProfileUrl([
      { field: 'fname', value: 'J' },
      { field: 'lname', value: 'Example Person' },
      {
        field: 'profileUrls',
        value: { medicine: 'https://medicine.yale.edu/profile/jexample-person/' },
        sourceUrl: 'https://medicine.yale.edu/profile/jexample-person/',
      },
    ]);

    expect(observations).toHaveLength(3);
  });


  it('does not rederive access artifacts for description-only research entity runs', () => {
    expect(
      shouldMaterializeAccessForRunObservations({
        entityType: 'researchEntity',
        sourceNames: ['lab-microsite-description-llm'],
        fields: ['fullDescription', 'shortDescription', 'researchAreas'],
      }),
    ).toBe(false);
  });

  it('rederives access artifacts for access-producing research entity runs', () => {
    expect(
      shouldMaterializeAccessForRunObservations({
        entityType: 'researchEntity',
        sourceNames: ['lab-microsite-undergrad-llm'],
        fields: ['undergradAccessEvidence', 'undergradEvidenceQuote'],
      }),
    ).toBe(true);
    expect(
      shouldMaterializeAccessForRunObservations({
        entityType: 'researchEntity',
        sourceNames: ['dept-faculty-roster'],
        fields: ['name', 'websiteUrl'],
      }),
    ).toBe(true);
  });

  it('does not rederive access artifacts for non-research entities', () => {
    expect(
      shouldMaterializeAccessForRunObservations({
        entityType: 'user',
        sourceNames: ['dept-faculty-roster'],
        fields: ['contactEmail'],
      }),
    ).toBe(false);
  });

  it('resolves faculty research-area shell observations to an existing PI-led lab', async () => {
    const userFind = vi.spyOn(User, 'find').mockReturnValue({
      select: () => ({
        limit: () => ({
          lean: async () => [{ _id: '6650000000000000000000aa', fname: 'Fixture', lname: 'Lead' }],
        }),
      }),
    } as any);
    const memberFind = vi.spyOn(ResearchGroupMember, 'find').mockReturnValue({
      select: () => ({
        lean: async () => [{ researchEntityId: '6650000000000000000000bb' }],
      }),
    } as any);
    const researchEntityModel = {
      find: vi.fn().mockReturnValue({
        select: () => ({
          lean: async () => [
            {
              _id: '6650000000000000000000bb',
              slug: 'dept-cs-fixture-lead',
              name: 'Fixture Lead Lab',
            },
          ],
        }),
      }),
      findById: vi.fn().mockReturnValue({
        lean: async () => ({
          _id: '6650000000000000000000bb',
          slug: 'dept-cs-fixture-lead',
          name: 'Fixture Lead Lab',
        }),
      }),
    };

    try {
      await expect(
        findExistingResearchEntityByFacultyResearchAreaIdentity(researchEntityModel as any, {
          entityKey: 'faculty-research-area-fixture-lead',
          name: 'Fixture Lead Research',
          entityType: 'FACULTY_RESEARCH_AREA',
        }),
      ).resolves.toMatchObject({
        _id: '6650000000000000000000bb',
        slug: 'dept-cs-fixture-lead',
      });
      expect(researchEntityModel.findById).toHaveBeenCalledWith('6650000000000000000000bb');
    } finally {
      userFind.mockRestore();
      memberFind.mockRestore();
    }
  });

  it('resolves official Yale lab URL observations to an existing research entity', async () => {
    const researchEntityModel = {
      find: vi.fn().mockReturnValue({
        limit: () => ({
          lean: async () => [
            {
              _id: '6650000000000000000000aa',
              slug: 'dept-mcdb-example-cell-biology',
              name: 'Example Cell Biology Lab',
              websiteUrl: 'https://medicine.yale.edu/lab/example-cell-biology/',
            },
          ],
        }),
      }),
    };

    await expect(
      findExistingResearchEntityByOfficialLabUrl(researchEntityModel as any, [
        {
          field: 'websiteUrl',
          value: 'https://medicine.yale.edu/lab/example-cell-biology/',
        },
      ]),
    ).resolves.toMatchObject({
      _id: '6650000000000000000000aa',
      slug: 'dept-mcdb-example-cell-biology',
    });
    expect(researchEntityModel.find).toHaveBeenCalledWith({
      archived: { $ne: true },
      $or: [
        { websiteUrl: { $in: ['https://medicine.yale.edu/lab/example-cell-biology/'] } },
        { sourceUrls: { $in: ['https://medicine.yale.edu/lab/example-cell-biology/'] } },
      ],
    });
  });

  it('does not resolve generic Yale lab directory URLs as entity identity', async () => {
    const researchEntityModel = {
      find: vi.fn().mockReturnValue({
        limit: () => ({
          lean: async () => [{ _id: 'wrong' }],
        }),
      }),
    };

    await expect(
      findExistingResearchEntityByOfficialLabUrl(researchEntityModel as any, [
        {
          field: 'sourceUrls',
          value: ['https://medicine.yale.edu/about/a-to-z-index/atoz/lab-websites/'],
        },
      ]),
    ).resolves.toBeNull();
    expect(researchEntityModel.find).not.toHaveBeenCalled();
  });

  it('resolves official Yale research directory center observations to a unique exact-name entity', async () => {
    const researchEntityModel = {
      find: vi.fn().mockReturnValue({
        select: () => ({
          limit: () => ({
            lean: async () => [
              {
                _id: '6650000000000000000000aa',
                slug: 'yse-geospatial-solutions',
                name: 'Yale Center for Geospatial Solutions',
                entityType: 'CENTER',
              },
            ],
          }),
        }),
      }),
      findById: vi.fn().mockReturnValue({
        lean: async () => ({
          _id: '6650000000000000000000aa',
          slug: 'yse-geospatial-solutions',
          name: 'Yale Center for Geospatial Solutions',
          entityType: 'CENTER',
        }),
      }),
    };

    await expect(
      findExistingResearchEntityByOfficialDirectoryExactName(researchEntityModel as any, [
        {
          field: 'name',
          value: 'Yale Center for Geospatial Solutions',
          sourceName: 'yale-research-official',
        },
        {
          field: 'entityType',
          value: 'CENTER',
          sourceName: 'yale-research-official',
        },
      ]),
    ).resolves.toMatchObject({
      _id: '6650000000000000000000aa',
      slug: 'yse-geospatial-solutions',
    });
    expect(researchEntityModel.findById).toHaveBeenCalledWith('6650000000000000000000aa');
  });

  it('does not exact-name resolve non-official or ambiguous research directory observations', async () => {
    const researchEntityModel = {
      find: vi.fn().mockReturnValue({
        select: () => ({
          limit: () => ({
            lean: async () => [
              { _id: 'one', name: 'Yale Example Center' },
              { _id: 'two', displayName: 'Yale Example Center' },
            ],
          }),
        }),
      }),
      findById: vi.fn(),
    };

    await expect(
      findExistingResearchEntityByOfficialDirectoryExactName(researchEntityModel as any, [
        { field: 'name', value: 'Yale Example Center', sourceName: 'dept-faculty-roster' },
        { field: 'entityType', value: 'CENTER', sourceName: 'dept-faculty-roster' },
      ]),
    ).resolves.toBeNull();
    expect(researchEntityModel.find).not.toHaveBeenCalled();

    await expect(
      findExistingResearchEntityByOfficialDirectoryExactName(researchEntityModel as any, [
        { field: 'name', value: 'Yale Example Center', sourceName: 'yale-research-official' },
        { field: 'entityType', value: 'CENTER', sourceName: 'yale-research-official' },
      ]),
    ).resolves.toBeNull();
    expect(researchEntityModel.findById).not.toHaveBeenCalled();
  });

  it('redirects archived research-entity materialization targets to their canonical entity', async () => {
    const model = {
      findById: vi.fn().mockReturnValue({
        lean: async () => ({
          _id: '6650000000000000000000cc',
          slug: 'dept-math-taylor-chen',
        }),
      }),
    };

    await expect(
      resolveArchivedEntityDocToCanonical(
        {
          _id: '6650000000000000000000bb',
          slug: 'nsf-pi-taylor-chen',
          archived: true,
          canonicalGroupId: '6650000000000000000000cc',
        },
        model as any,
      ),
    ).resolves.toMatchObject({
      _id: '6650000000000000000000cc',
      slug: 'dept-math-taylor-chen',
    });
  });

  it('preserves canonical labs when an archived faculty research-area shell redirects there', async () => {
    const canonicalId = '6650000000000000000000ee';
    const observedAt = new Date('2026-05-22T12:00:00Z');
    const observationFind = vi.spyOn(Observation, 'find').mockReturnValue({
      lean: async () => [
        {
          entityType: 'researchEntity',
          entityKey: 'faculty-research-area-fixture-archive',
          field: 'slug',
          value: 'faculty-research-area-fixture-archive',
          sourceName: 'centers-institutes-index',
          confidence: 0.8,
          observedAt,
        },
        {
          entityType: 'researchEntity',
          entityKey: 'faculty-research-area-fixture-archive',
          field: 'name',
          value: 'Fixture Archive Research',
          sourceName: 'centers-institutes-index',
          confidence: 0.8,
          observedAt,
        },
        {
          entityType: 'researchEntity',
          entityKey: 'faculty-research-area-fixture-archive',
          field: 'entityType',
          value: 'FACULTY_RESEARCH_AREA',
          sourceName: 'centers-institutes-index',
          confidence: 0.8,
          observedAt,
        },
      ],
    } as any);
    const entityFindOne = vi.spyOn(ResearchEntity, 'findOne').mockReturnValue({
      lean: async () => ({
        _id: '6650000000000000000000dd',
        slug: 'faculty-research-area-fixture-archive',
        archived: true,
        canonicalGroupId: canonicalId,
      }),
    } as any);
    const entityFindById = vi.spyOn(ResearchEntity, 'findById').mockReturnValue({
      lean: async () => ({
        _id: canonicalId,
        slug: 'fixture-archive-lab',
        name: 'Fixture Archive Lab',
        archived: false,
      }),
    } as any);
    const entityUpdateOne = vi.spyOn(ResearchEntity, 'updateOne').mockImplementation(() => {
      throw new Error('should not rewrite the canonical lab with generated shell fields');
    });
    const memberFindOne = vi.spyOn(ResearchGroupMember, 'findOne').mockReturnValue({
      lean: async () => null,
    } as any);

    try {
      await expect(
        materializeEntity(
          'researchEntity',
          { entityKey: 'faculty-research-area-fixture-archive' },
          { syncMeilisearch: false, skipAccessMaterialization: true },
        ),
      ).resolves.toMatchObject({
        entityType: 'researchEntity',
        entityId: canonicalId,
        entityKey: 'faculty-research-area-fixture-archive',
        fieldsWritten: 0,
        conflicts: 0,
        created: false,
        skipped: 'canonical-research-entity-preserved',
      });
      expect(entityUpdateOne).not.toHaveBeenCalled();
    } finally {
      observationFind.mockRestore();
      entityFindOne.mockRestore();
      entityFindById.mockRestore();
      entityUpdateOne.mockRestore();
      memberFindOne.mockRestore();
    }
  });

  it('does not rewrite a canonical research entity slug from archived duplicate observations', async () => {
    const canonicalId = '6650000000000000000000ab';
    const observedAt = new Date('2026-05-22T12:00:00Z');
    const observationFind = vi.spyOn(Observation, 'find').mockReturnValue({
      lean: async () => [
        {
          entityType: 'researchEntity',
          entityKey: 'dept-seas-fixture-canonical',
          field: 'slug',
          value: 'dept-seas-fixture-canonical',
          sourceName: 'dept-faculty-roster',
          confidence: 0.8,
          observedAt,
        },
        {
          entityType: 'researchEntity',
          entityKey: 'dept-seas-fixture-canonical',
          field: 'name',
          value: 'Fixture Canonical — Research',
          sourceName: 'dept-faculty-roster',
          confidence: 0.8,
          observedAt,
        },
      ],
    } as any);
    const entityFindOne = vi.spyOn(ResearchEntity, 'findOne').mockReturnValue({
      lean: async () => ({
        _id: '6650000000000000000000aa',
        slug: 'dept-seas-fixture-canonical',
        archived: true,
        canonicalGroupId: canonicalId,
      }),
    } as any);
    const entityFindById = vi.spyOn(ResearchEntity, 'findById').mockReturnValue({
      lean: async () => ({
        _id: canonicalId,
        slug: 'dept-physics-fixture-canonical',
        name: 'Fixture Canonical Lab',
        archived: false,
      }),
    } as any);
    const entityUpdateOne = vi.spyOn(ResearchEntity, 'updateOne').mockResolvedValue({} as any);
    const memberFindOne = vi.spyOn(ResearchGroupMember, 'findOne').mockReturnValue({
      lean: async () => null,
    } as any);

    try {
      await expect(
        materializeEntity(
          'researchEntity',
          { entityKey: 'dept-seas-fixture-canonical' },
          { syncMeilisearch: false, skipAccessMaterialization: true },
        ),
      ).resolves.toMatchObject({
        entityType: 'researchEntity',
        entityId: canonicalId,
        entityKey: 'dept-seas-fixture-canonical',
        created: false,
      });
      const update = (entityUpdateOne.mock.calls[0] as any[])?.[1] as any;
      expect(update.$set.slug).toBeUndefined();
      expect(update.$set.name).toBe('Fixture Canonical — Research');
    } finally {
      observationFind.mockRestore();
      entityFindOne.mockRestore();
      entityFindById.mockRestore();
      entityUpdateOne.mockRestore();
      memberFindOne.mockRestore();
    }
  });

  it('skips archived research-entity materialization targets without canonical rows', async () => {
    const archivedId = '6650000000000000000000dd';
    const observedAt = new Date('2026-05-22T12:00:00Z');
    const observationFind = vi.spyOn(Observation, 'find').mockReturnValue({
      lean: async () => [
        {
          _id: '6650000000000000000000ee',
          entityType: 'researchEntity',
          entityKey: 'dept-econ-archived-professor',
          field: 'name',
          value: 'Archived Professor',
          sourceName: 'dept-faculty-roster',
          confidence: 0.8,
          observedAt,
        },
      ],
    } as any);
    const entityFindOne = vi.spyOn(ResearchEntity, 'findOne').mockReturnValue({
      lean: async () => ({
        _id: archivedId,
        slug: 'dept-econ-archived-professor',
        name: 'Archived Professor',
        archived: true,
        canonicalGroupId: null,
      }),
    } as any);
    const entityFindById = vi.spyOn(ResearchEntity, 'findById').mockImplementation(() => {
      throw new Error('should not read archived entity for access or search sync');
    });
    const entityUpdateOne = vi.spyOn(ResearchEntity, 'updateOne').mockImplementation(() => {
      throw new Error('should not update archived entity without canonical row');
    });
    const memberFindOne = vi.spyOn(ResearchGroupMember, 'findOne').mockReturnValue({
      lean: async () => null,
    } as any);

    try {
      await expect(
        materializeEntity(
          'researchEntity',
          { entityKey: 'dept-econ-archived-professor' },
          { syncMeilisearch: false },
        ),
      ).resolves.toMatchObject({
        entityType: 'researchEntity',
        entityId: archivedId,
        entityKey: 'dept-econ-archived-professor',
        fieldsWritten: 0,
        conflicts: 0,
        created: false,
        skipped: 'archived-entity-without-canonical',
      });
      expect(entityUpdateOne).not.toHaveBeenCalled();
      expect(entityFindById).not.toHaveBeenCalled();
    } finally {
      observationFind.mockRestore();
      entityFindOne.mockRestore();
      entityFindById.mockRestore();
      entityUpdateOne.mockRestore();
      memberFindOne.mockRestore();
    }
  });

  it('preserves canonical PI labs when generated faculty research-area identity resolves there', async () => {
    const canonicalId = '6650000000000000000000ff';
    const observedAt = new Date('2026-05-22T12:00:00Z');
    const observationFind = vi.spyOn(Observation, 'find').mockReturnValue({
      lean: async () => [
        {
          entityType: 'researchEntity',
          entityKey: 'faculty-research-area-fixture-lead',
          field: 'slug',
          value: 'faculty-research-area-fixture-lead',
          sourceName: 'centers-institutes-index',
          confidence: 0.8,
          observedAt,
        },
        {
          entityType: 'researchEntity',
          entityKey: 'faculty-research-area-fixture-lead',
          field: 'name',
          value: 'Fixture Lead Research',
          sourceName: 'centers-institutes-index',
          confidence: 0.8,
          observedAt,
        },
        {
          entityType: 'researchEntity',
          entityKey: 'faculty-research-area-fixture-lead',
          field: 'entityType',
          value: 'FACULTY_RESEARCH_AREA',
          sourceName: 'centers-institutes-index',
          confidence: 0.8,
          observedAt,
        },
      ],
    } as any);
    const entityFindOne = vi.spyOn(ResearchEntity, 'findOne').mockReturnValue({
      lean: async () => null,
    } as any);
    const userFind = vi.spyOn(User, 'find').mockReturnValue({
      select: () => ({
        limit: () => ({
          lean: async () => [{ _id: '6650000000000000000000aa', fname: 'Fixture', lname: 'Lead' }],
        }),
      }),
    } as any);
    const memberFind = vi.spyOn(ResearchGroupMember, 'find').mockReturnValue({
      select: () => ({
        lean: async () => [{ researchEntityId: canonicalId }],
      }),
    } as any);
    const entityFind = vi.spyOn(ResearchEntity, 'find').mockReturnValue({
      select: () => ({
        lean: async () => [
          {
            _id: canonicalId,
            slug: 'dept-cs-fixture-lead',
            name: 'Fixture Lead Lab',
          },
        ],
      }),
    } as any);
    const entityFindById = vi.spyOn(ResearchEntity, 'findById').mockReturnValue({
      lean: async () => ({
        _id: canonicalId,
        slug: 'dept-cs-fixture-lead',
        name: 'Fixture Lead Lab',
        archived: false,
      }),
    } as any);
    const entityUpdateOne = vi.spyOn(ResearchEntity, 'updateOne').mockImplementation(() => {
      throw new Error('should not rewrite the canonical lab with generated shell fields');
    });
    const memberFindOne = vi.spyOn(ResearchGroupMember, 'findOne').mockReturnValue({
      lean: async () => null,
    } as any);

    try {
      await expect(
        materializeEntity(
          'researchEntity',
          { entityKey: 'faculty-research-area-fixture-lead' },
          { syncMeilisearch: false, skipAccessMaterialization: true },
        ),
      ).resolves.toMatchObject({
        entityType: 'researchEntity',
        entityId: canonicalId,
        entityKey: 'faculty-research-area-fixture-lead',
        fieldsWritten: 0,
        conflicts: 0,
        created: false,
        skipped: 'canonical-research-entity-preserved',
      });
      expect(entityUpdateOne).not.toHaveBeenCalled();
    } finally {
      observationFind.mockRestore();
      entityFindOne.mockRestore();
      userFind.mockRestore();
      memberFind.mockRestore();
      entityFind.mockRestore();
      entityFindById.mockRestore();
      entityUpdateOne.mockRestore();
      memberFindOne.mockRestore();
    }
  });

  it('resolves same-PI lab observations to an existing generated research-area shell with a compatible name', async () => {
    const userId = '6650000000000000000000aa';
    const shellId = '6650000000000000000000bb';
    const observedAt = new Date('2026-05-22T12:00:00Z');
    const userFindById = vi.spyOn(User, 'findById').mockReturnValue({
      lean: async () => ({ _id: userId }),
    } as any);
    const memberFind = vi.spyOn(ResearchGroupMember, 'find').mockReturnValue({
      select: () => ({
        lean: async () => [{ researchEntityId: shellId }],
      }),
    } as any);
    const researchEntityModel = {
      find: vi.fn().mockReturnValue({
        select: () => ({
          lean: async () => [
            {
              _id: shellId,
              slug: 'faculty-research-area-fixture-match',
              name: 'Fixture Match Research',
            },
          ],
        }),
      }),
      findById: vi.fn().mockReturnValue({
        lean: async () => ({
          _id: shellId,
          slug: 'faculty-research-area-fixture-match',
          name: 'Fixture Match Research',
        }),
      }),
    };

    try {
      await expect(
        findExistingResearchEntityByPiAndName(researchEntityModel as any, [
          {
            field: 'name',
            value: 'Fixture Match Lab',
            confidence: 0.7,
            observedAt,
          },
          {
            field: 'inferredPiUserId',
            value: userId,
            confidence: 0.7,
            observedAt,
          },
        ]),
      ).resolves.toMatchObject({
        _id: shellId,
        slug: 'faculty-research-area-fixture-match',
      });
      expect(researchEntityModel.findById).toHaveBeenCalledWith(shellId);
    } finally {
      userFindById.mockRestore();
      memberFind.mockRestore();
    }
  });

  it('does not resolve faculty research areas when more than one compatible PI lab exists', async () => {
    const userFind = vi.spyOn(User, 'find').mockReturnValue({
      select: () => ({
        limit: () => ({
          lean: async () => [
            { _id: '6650000000000000000000aa', fname: 'Fixture', lname: 'Manager' },
          ],
        }),
      }),
    } as any);
    const memberFind = vi.spyOn(ResearchGroupMember, 'find').mockReturnValue({
      select: () => ({
        lean: async () => [
          { researchEntityId: '6650000000000000000000bb' },
          { researchEntityId: '6650000000000000000000cc' },
        ],
      }),
    } as any);
    const researchEntityModel = {
      find: vi.fn().mockReturnValue({
        select: () => ({
          lean: async () => [
            { _id: '6650000000000000000000bb', name: 'Fixture Manager Lab' },
            { _id: '6650000000000000000000cc', name: 'Manager Lab' },
          ],
        }),
      }),
      findById: vi.fn(),
    };

    try {
      await expect(
        findExistingResearchEntityByFacultyResearchAreaIdentity(researchEntityModel as any, {
          entityKey: 'faculty-research-area-fixture-manager',
          entityType: 'FACULTY_RESEARCH_AREA',
        }),
      ).resolves.toBeNull();
      expect(researchEntityModel.findById).not.toHaveBeenCalled();
    } finally {
      userFind.mockRestore();
      memberFind.mockRestore();
    }
  });

  it('prefers richer faculty-controlled research bios over thinner official profile bios', () => {
    const observedAt = new Date('2026-05-18T12:00:00Z');
    const officialBio =
      'My research interests include fixture morphology and comparative signal analysis. I study how synthetic examples differ across related sample groups.';
    const facultySiteBio =
      'My research interests include fixture morphology and comparative signal analysis. I study how synthetic examples differ across related sample groups. My current collaborative project focuses on newly assembled teaching datasets, and this work has implications for validating research-discovery fixtures. I also co-direct example field exercises that train students to document source evidence without copying private profile prose.';

    const resolved = resolveField(
      'bio',
      [
        {
          field: 'bio',
          value: officialBio,
          sourceName: 'official-profile-enrichment',
          sourceUrl: 'https://example.yale.edu/profile/example-person',
          confidence: 0.95,
          observedAt,
        },
        {
          field: 'bio',
          value: facultySiteBio,
          sourceName: 'dept-faculty-roster',
          sourceUrl: 'https://campuspress.yale.edu/example-faculty/research/',
          confidence: 0.7,
          observedAt,
        },
      ],
      {
        now: observedAt,
        observationScore: buildUserBioObservationScore,
      },
    );

    expect(resolved?.value).toBe(facultySiteBio);
  });

  it('upserts research-entity relationships from resolved source and target keys', async () => {
    const observedAt = new Date('2026-05-19T12:00:00Z');
    const source = { _id: '665000000000000000000001' };
    const target = { _id: '665000000000000000000002' };
    const researchEntityModel = {
      findOne: vi
        .fn()
        .mockReturnValueOnce({ lean: vi.fn().mockResolvedValue(source) })
        .mockReturnValueOnce({ lean: vi.fn().mockResolvedValue(target) }),
    };
    const relationshipModel = {
      updateOne: vi.fn().mockResolvedValue({ upsertedCount: 1 }),
    };
    const userFind = vi.spyOn(User, 'find').mockReturnValue({
      select: () => ({
        limit: () => ({
          lean: async () => [],
        }),
      }),
    } as any);

    let result!: Awaited<ReturnType<typeof syncResolvedRelationshipFromObservationFields>>;
    try {
      result = await syncResolvedRelationshipFromObservationFields(
        [
          {
            field: 'sourceEntityKey',
            value: 'center-example-quantum-institute',
            confidence: 0.9,
            observedAt,
            sourceUrl: 'https://example.yale.edu/people/members',
          },
          {
            field: 'targetEntityKey',
            value: 'faculty-research-area-example-theorist',
            confidence: 0.9,
            observedAt,
          },
          {
            field: 'relationshipType',
            value: 'MEMBER_RESEARCH_AREA',
            confidence: 0.9,
            observedAt,
          },
        ],
        { researchEntityModel: researchEntityModel as any, relationshipModel },
      );
    } finally {
      userFind.mockRestore();
    }

    expect(result).toEqual({
      synced: true,
      created: true,
      sourceResearchEntityId: source._id,
      targetResearchEntityId: target._id,
    });
    expect(relationshipModel.updateOne).toHaveBeenCalledWith(
      {
        sourceResearchEntityId: source._id,
        targetResearchEntityId: target._id,
        relationshipType: 'MEMBER_RESEARCH_AREA',
      },
      {
        $set: expect.objectContaining({
          sourceResearchEntityId: source._id,
          targetResearchEntityId: target._id,
          relationshipType: 'MEMBER_RESEARCH_AREA',
          evidenceStrength: 'MODERATE',
          sourceUrl: 'https://example.yale.edu/people/members',
          archived: false,
        }),
      },
      { upsert: true },
    );
  });

  it('prefers a canonical PI-led lab over an existing faculty research-area shell for relationships', async () => {
    const observedAt = new Date('2026-05-20T12:00:00Z');
    const source = { _id: '665000000000000000000001' };
    const shellTarget = { _id: '665000000000000000000002' };
    const canonicalTarget = {
      _id: '665000000000000000000003',
      slug: 'dept-cs-fixture-lead',
      name: 'Fixture Lead Lab',
    };
    const researchEntityModel = {
      findOne: vi
        .fn()
        .mockReturnValueOnce({ lean: vi.fn().mockResolvedValue(source) })
        .mockReturnValueOnce({ lean: vi.fn().mockResolvedValue(shellTarget) }),
      find: vi.fn().mockReturnValue({
        select: () => ({
          lean: async () => [canonicalTarget],
        }),
      }),
      findById: vi.fn().mockReturnValue({
        lean: async () => canonicalTarget,
      }),
    };
    const relationshipModel = {
      updateOne: vi.fn().mockResolvedValue({ upsertedCount: 1 }),
    };
    const userFind = vi.spyOn(User, 'find').mockReturnValue({
      select: () => ({
        limit: () => ({
          lean: async () => [{ _id: '6650000000000000000000aa', fname: 'Fixture', lname: 'Lead' }],
        }),
      }),
    } as any);
    const memberFind = vi.spyOn(ResearchGroupMember, 'find').mockReturnValue({
      select: () => ({
        lean: async () => [{ researchEntityId: canonicalTarget._id }],
      }),
    } as any);

    try {
      const result = await syncResolvedRelationshipFromObservationFields(
        [
          {
            field: 'sourceEntityKey',
            value: 'center-example-institute',
            confidence: 0.9,
            observedAt,
            sourceUrl: 'https://example.yale.edu/people',
          },
          {
            field: 'targetEntityKey',
            value: 'faculty-research-area-fixture-lead',
            confidence: 0.9,
            observedAt,
          },
          {
            field: 'relationshipType',
            value: 'MEMBER_RESEARCH_AREA',
            confidence: 0.9,
            observedAt,
          },
        ],
        { researchEntityModel, relationshipModel },
      );

      expect(result).toMatchObject({
        synced: true,
        targetResearchEntityId: canonicalTarget._id,
      });
      expect(relationshipModel.updateOne).toHaveBeenCalledWith(
        {
          sourceResearchEntityId: source._id,
          targetResearchEntityId: canonicalTarget._id,
          relationshipType: 'MEMBER_RESEARCH_AREA',
        },
        expect.anything(),
        { upsert: true },
      );
    } finally {
      userFind.mockRestore();
      memberFind.mockRestore();
    }
  });

  it('attaches an exact profile user as PI when a faculty research-area has no canonical lab', async () => {
    const created: any[] = [];
    const userFind = vi.spyOn(User, 'find').mockReturnValue({
      select: () => ({
        limit: () => ({
          lean: async () => [
            {
              _id: '6650000000000000000000aa',
              netid: 'fixture-member',
              fname: 'Fixture',
              lname: 'Member',
            },
          ],
        }),
      }),
    } as any);

    try {
      const result = await syncProfileBackedFacultyResearchAreaMemberFromIdentity(
        '6650000000000000000000bb',
        {
          entityKey: 'faculty-research-area-fixture-member',
          name: 'Fixture Member Research',
          entityType: 'FACULTY_RESEARCH_AREA',
          sourceUrl: 'https://example.yale.edu/humans/faculty',
          confidence: 0.8,
        },
        {
          researchGroupMemberModel: {
            findOne: () => ({ lean: async () => null }) as any,
            create: async (doc: any) => {
              created.push(doc);
              return doc;
            },
            updateOne: async () => {
              throw new Error('should create the missing profile-backed member row');
            },
          } as any,
        },
      );

      expect(result).toEqual({
        synced: true,
        created: true,
        researchEntityId: '6650000000000000000000bb',
        userId: '6650000000000000000000aa',
      });
      expect(created[0]).toMatchObject({
        researchEntityId: '6650000000000000000000bb',
        userId: '6650000000000000000000aa',
        role: 'pi',
        isCurrentMember: true,
        name: 'Fixture Member',
        sourceUrl: 'https://example.yale.edu/humans/faculty',
        confidence: 0.8,
      });
    } finally {
      userFind.mockRestore();
    }
  });

  it('uses an already-resolved user id for punctuation-heavy faculty research-area names', async () => {
    const created: any[] = [];

    const result = await syncProfileBackedFacultyResearchAreaMemberFromIdentity(
      '6650000000000000000000cc',
      {
        entityKey: 'faculty-research-area-fixture-u-hyphen-suffix',
        name: 'Fixture U. Hyphen-Suffix Research',
        entityType: 'FACULTY_RESEARCH_AREA',
        userId: '6650000000000000000000dd',
        sourceUrl: 'https://example.yale.edu/humans/faculty',
        confidence: 0.8,
      },
      {
        userModel: {
          findById: () =>
            ({
              select: () => ({
                lean: async () => ({
                  _id: '6650000000000000000000dd',
                  fname: 'Fixture U.',
                  lname: 'Hyphen-Suffix',
                }),
              }),
            }) as any,
        } as any,
        researchGroupMemberModel: {
          findOne: () => ({ lean: async () => null }) as any,
          create: async (doc: any) => {
            created.push(doc);
            return doc;
          },
          updateOne: async () => {
            throw new Error('should create the missing profile-backed member row');
          },
        } as any,
      },
    );

    expect(result).toEqual({
      synced: true,
      created: true,
      researchEntityId: '6650000000000000000000cc',
      userId: '6650000000000000000000dd',
    });
    expect(created[0]).toMatchObject({
      userId: '6650000000000000000000dd',
      name: 'Fixture U. Hyphen-Suffix',
      role: 'pi',
      sourceUrl: 'https://example.yale.edu/humans/faculty',
    });
  });

  it('updates the active profile-backed PI member when an inactive duplicate exists', async () => {
    const updateOne = vi.fn().mockResolvedValue({});
    const findOne = vi.fn((filter: any) => ({
      lean: async () =>
        filter.isCurrentMember
          ? {
              _id: 'active-member',
              researchEntityId: '6650000000000000000000cc',
              userId: '6650000000000000000000dd',
              role: 'pi',
              isCurrentMember: true,
            }
          : {
              _id: 'inactive-member',
              researchEntityId: '6650000000000000000000cc',
              userId: '6650000000000000000000dd',
              role: 'pi',
              isCurrentMember: false,
            },
    }));

    const result = await syncProfileBackedFacultyResearchAreaMemberFromIdentity(
      '6650000000000000000000cc',
      {
        entityKey: 'faculty-research-area-fixture-u-hyphen-suffix',
        entityType: 'FACULTY_RESEARCH_AREA',
        userId: '6650000000000000000000dd',
        sourceUrl: 'https://example.yale.edu/humans/faculty',
        confidence: 0.8,
      },
      {
        userModel: {
          findById: () =>
            ({
              select: () => ({
                lean: async () => ({
                  _id: '6650000000000000000000dd',
                  fname: 'Fixture U.',
                  lname: 'Hyphen-Suffix',
                }),
              }),
            }) as any,
        } as any,
        researchGroupMemberModel: {
          findOne,
          create: async () => {
            throw new Error('should update the active duplicate instead of creating');
          },
          updateOne,
        } as any,
      },
    );

    expect(result.created).toBe(false);
    expect(findOne).toHaveBeenCalledWith({
      researchEntityId: '6650000000000000000000cc',
      userId: '6650000000000000000000dd',
      role: 'pi',
      isCurrentMember: { $ne: false },
    });
    expect(updateOne).toHaveBeenCalledWith(
      { _id: 'active-member' },
      expect.objectContaining({
        $set: expect.objectContaining({
          isCurrentMember: true,
          role: 'pi',
        }),
      }),
    );
  });

  it('rejects contact or office text as user bio materialization candidates', () => {
    expect(
      isMaterializableUserBioCandidate('Fixture Hall123 Example StreetNew Haven, CT 06511'),
    ).toBe(false);
    expect(isMaterializableUserBioCandidate('Room 208 10 Fixture St, New Haven, CT 06511')).toBe(
      false,
    );
    expect(
      isMaterializableUserBioCandidate(
        'AwardFund for Physician-Scientist MentorshipResourcesGrant LibraryGrant Writing CourseMock Study SectionResearch Paper WritingEstablishing a Fixture ProgramFunding OpportunitiesNewsEngage with StudentsJoin Our Team',
      ),
    ).toBe(false);
    expect(
      isMaterializableUserBioCandidate(
        'Voluntary faculty are typically clinicians or others who are employed outside of the School but make significant contributions to department programs at the medical center or at affiliate institutions.',
      ),
    ).toBe(false);
    expect(
      isMaterializableUserBioCandidate(
        'Adjunct faculty typically provide instruction and mentoring but are employed outside of the school.',
      ),
    ).toBe(false);
    expect(
      isMaterializableUserBioCandidate(
        'the services we offer and making an appointment.View Example ProfileContactsEmailexample@yale.eduLocationsService Locations',
      ),
    ).toBe(false);
    expect(
      isMaterializableUserBioCandidate(
        'nothing? Journal Of Fixture Studies 2014, 32: 16-16. DOI: 10.9999/fixture.2014.32.26_suppl.16. Peer-Reviewed Original Research',
      ),
    ).toBe(false);
    expect(
      isMaterializableUserBioCandidate(
        'Assistant Professor of Dermatology Director of Inpatient Dermatology, Dermatology; Director of Grand Rounds, Dermatology',
      ),
    ).toBe(false);
    expect(
      isMaterializableUserBioCandidate(
        'For a list of selected publications, visit the faculty profile. Example Journal coverage and Sample Travel Notes are included.',
      ),
    ).toBe(false);
    expect(
      isMaterializableUserBioCandidate(
        '21cm Radio Instrumentation to measure Large Scale Structure and Dark Energy - Fixture Hydrogen Intensity Mapping Experiment (FHIME), The Hydrogen Intensity Mapping and Real-time Analysis Example (HIRAEX)',
      ),
    ).toBe(false);
    expect(
      isMaterializableUserBioCandidate(
        'My lab focuses on intergroup social cognition and how humans divide individuals into social groups.',
      ),
    ).toBe(true);
  });

  it('normalizes DOI values for paper identity matching', () => {
    expect(normalizeDoiForMaterialization(' https://doi.org/10.1000/ABC ')).toBe(
      '10.1000/abc',
    );
    expect(normalizeDoiForMaterialization('')).toBeNull();
    expect(normalizeDoiForMaterialization(undefined)).toBeNull();
  });

  it('normalizes prefixed user entity keys to the stored netid value', () => {
    expect(
      uniqueKeyValueForIdentifier('user', 'netid:example.netid', [
        { field: 'netid', value: 'example.netid' },
      ]),
    ).toBe('example.netid');
    expect(uniqueKeyValueForIdentifier('user', 'netid:fx123', [])).toBe('fx123');
    expect(uniqueKeyValueForIdentifier('researchEntity', 'dept-cs-example', [])).toBe(
      'dept-cs-example',
    );
    expect(
      uniqueKeyValueForIdentifier(
        'fellowship',
        'yale-college-fellowships-office:example-undergraduate-research-fellowship',
        [],
      ),
    ).toBe('yale-college-fellowships-office:example-undergraduate-research-fellowship');
  });

  it('builds profile URL lookup clauses for user identity matching across alternate netids', () => {
    expect(
      buildUserProfileUrlLookupClauses([
        {
          field: 'profileUrls',
          value: {
            departmental: 'https://physics.yale.edu/people/example-faculty',
          },
        },
      ]),
    ).toEqual(
      expect.arrayContaining([
        { 'profileUrls.departmental': 'https://physics.yale.edu/people/example-faculty' },
        { 'profileUrls.physics': 'https://physics.yale.edu/people/example-faculty' },
      ]),
    );
  });

  it('ignores generic YSM lab index websiteUrl observations for research entities', () => {
    expect(
      shouldIgnoreObservationForEntityMaterialization('researchEntity', {
        field: 'websiteUrl',
        value: 'https://medicine.yale.edu/about/a-to-z-index/atoz/lab-websites/',
        sourceName: 'ysm-atoz-index',
      }),
    ).toBe(true);

    expect(
      shouldIgnoreObservationForEntityMaterialization('researchEntity', {
        field: 'websiteUrl',
        value: 'https://medicine.yale.edu/lab/example-neuroscience/',
        sourceName: 'ysm-atoz-index',
      }),
    ).toBe(false);
  });

  it('ignores lastObservedAt observations because the materializer manages that field', () => {
    expect(
      shouldIgnoreObservationForEntityMaterialization('researchEntity', {
        field: 'lastObservedAt',
        value: '2026-05-21T12:00:00Z',
        sourceName: 'lab-microsite-undergrad-llm',
      }),
    ).toBe(true);
  });

  it('ignores funding-source user observations so grant records do not mint people', () => {
    expect(
      shouldIgnoreObservationForEntityMaterialization('user', {
        field: 'email',
        value: 'pi@yale.edu',
        sourceName: 'nsf-award-search',
      }),
    ).toBe(true);
    expect(
      shouldIgnoreObservationForEntityMaterialization('user', {
        field: 'fname',
        value: 'Fixture',
        sourceName: 'nih-reporter',
      }),
    ).toBe(true);
    expect(
      shouldIgnoreObservationForEntityMaterialization('user', {
        field: 'email',
        value: 'pi@yale.edu',
        sourceName: 'dept-faculty-roster',
      }),
    ).toBe(false);
  });

  it('builds fellowship lookup clauses from source key, official links, and title', () => {
    expect(
      buildFellowshipLookupClauses(
        'yale-college-fellowships-office:example-undergraduate-research-fellowship',
        [
          { field: 'title', value: 'Example Undergraduate Research Fellowship' },
          { field: 'sourceUrl', value: 'https://funding.yale.edu/find-funding/yale-fellowships-offered-through' },
          { field: 'applicationLink', value: 'https://yale.communityforce.com/Funds/FundDetails.aspx?123' },
        ],
      ),
    ).toEqual([
      { sourceKey: 'yale-college-fellowships-office:example-undergraduate-research-fellowship' },
      { sourceUrl: 'https://funding.yale.edu/find-funding/yale-fellowships-offered-through' },
      { applicationLink: 'https://yale.communityforce.com/Funds/FundDetails.aspx?123' },
      { 'links.url': 'https://yale.communityforce.com/Funds/FundDetails.aspx?123' },
      { title: /^Example Undergraduate Research Fellowship$/i },
    ]);
  });

  it('builds scoped scholarly-link lookup clauses from entity id, scoped DOI, and scoped URL', () => {
    expect(
      buildScholarlyLinkLookupClauses(
        '64f000000000000000000111',
        [
          {
            field: 'userId',
            value: '64f000000000000000000001',
          },
          {
            field: 'externalIds',
            value: { doi: '10.1000/example' },
          },
          {
            field: 'url',
            value: 'https://doi.org/10.1000/example',
          },
        ],
      ),
    ).toEqual([
      { _id: '64f000000000000000000111' },
      { userId: '64f000000000000000000001', 'externalIds.doi': '10.1000/example' },
      { userId: '64f000000000000000000001', url: 'https://doi.org/10.1000/example' },
    ]);
  });

  it('builds attribution upserts for user and explicit research-entity scholarly links', () => {
    const scholarlyLinkId = new mongoose.Types.ObjectId('64f000000000000000000222');
    const userId = new mongoose.Types.ObjectId('64f000000000000000000001');
    const researchEntityId = new mongoose.Types.ObjectId('64f000000000000000000002');

    expect(
      buildScholarlyAttributionWriteModels({
        scholarlyLinkId,
        userId,
        researchEntityId,
        sourceName: 'openalex',
        sourceUrl: 'https://api.openalex.org/works?filter=author.id:A123',
        confidence: 0.9,
        observedAt: new Date('2026-05-24T12:00:00Z'),
      }),
    ).toEqual([
      {
        updateOne: {
          filter: {
            scholarlyLinkId,
            targetUserId: userId,
            relationshipBasis: 'identity_authorship',
            derivationKey:
              'scholarly-link:64f000000000000000000222:user:64f000000000000000000001:identity_authorship',
          },
          update: {
            $set: {
              scholarlyLinkId,
              targetUserId: userId,
              relationshipBasis: 'identity_authorship',
              evidenceLabel: 'Authored by a verified Yale faculty identity',
              sourceName: 'openalex',
              sourceUrl: 'https://api.openalex.org/works?filter=author.id:A123',
              confidence: 0.9,
              observedAt: new Date('2026-05-24T12:00:00Z'),
              derivationKey:
                'scholarly-link:64f000000000000000000222:user:64f000000000000000000001:identity_authorship',
              archived: false,
            },
          },
          upsert: true,
        },
      },
      {
        updateOne: {
          filter: {
            scholarlyLinkId,
            targetResearchEntityId: researchEntityId,
            relationshipBasis: 'explicit_entity_link',
            derivationKey:
              'scholarly-link:64f000000000000000000222:researchEntity:64f000000000000000000002:explicit_entity_link',
          },
          update: {
            $set: {
              scholarlyLinkId,
              targetResearchEntityId: researchEntityId,
              relationshipBasis: 'explicit_entity_link',
              evidenceLabel: 'Linked to this research profile',
              sourceName: 'openalex',
              sourceUrl: 'https://api.openalex.org/works?filter=author.id:A123',
              confidence: 0.9,
              observedAt: new Date('2026-05-24T12:00:00Z'),
              derivationKey:
                'scholarly-link:64f000000000000000000222:researchEntity:64f000000000000000000002:explicit_entity_link',
              archived: false,
            },
          },
          upsert: true,
        },
      },
    ]);
  });

  it('builds idempotent fellowship updates from source observations', () => {
    const observedAt = new Date('2026-05-14T12:00:00Z');
    const patch = buildFellowshipUpdateFromObservations(
      'yale-college-fellowships-office:example-undergraduate-research-fellowship',
      [
        {
          field: 'title',
          value: 'Example Undergraduate Research Fellowship',
          sourceName: 'yale-college-fellowships-office',
          confidence: 0.95,
          observedAt,
          sourceUrl: 'https://funding.yale.edu/find-funding/yale-fellowships-offered-through',
        },
        {
          field: 'applicationLink',
          value: 'https://yale.communityforce.com/Funds/FundDetails.aspx?123',
          sourceName: 'yale-college-fellowships-office',
          confidence: 0.95,
          observedAt,
        },
        {
          field: 'deadline',
          value: new Date('2026-02-19T23:59:59.999Z'),
          sourceName: 'yale-college-fellowships-office',
          confidence: 0.95,
          observedAt,
        },
        {
          field: 'sourceFingerprint',
          value: 'fingerprint-v1',
          sourceName: 'yale-college-fellowships-office',
          confidence: 0.95,
          observedAt,
        },
        {
          field: 'reviewRequired',
          value: false,
          sourceName: 'yale-college-fellowships-office',
          confidence: 0.95,
          observedAt,
        },
      ],
      undefined,
      observedAt,
    );

    expect(patch.skipped).toBeUndefined();
    expect(patch.unchanged).toBe(false);
    expect(patch.update.$set).toMatchObject({
      sourceKey: 'yale-college-fellowships-office:example-undergraduate-research-fellowship',
      sourceName: 'yale-college-fellowships-office',
      sourceUrl: 'https://funding.yale.edu/find-funding/yale-fellowships-offered-through',
      sourceFingerprint: 'fingerprint-v1',
      sourceLastVerifiedAt: observedAt,
      sourceLastChangedAt: observedAt,
      title: 'Example Undergraduate Research Fellowship',
      applicationLink: 'https://yale.communityforce.com/Funds/FundDetails.aspx?123',
      deadline: new Date('2026-02-19T23:59:59.999Z'),
      programKind: 'FELLOWSHIP_FUNDING',
      entryMode: 'SECURE_MENTOR_THEN_APPLY',
      studentFacingCategory: 'Funding after mentor',
      requiresMentorBeforeApply: true,
    });
  });

  it('marks unchanged fellowship fingerprints while refreshing verification time', () => {
    const observedAt = new Date('2026-05-14T12:00:00Z');
    const patch = buildFellowshipUpdateFromObservations(
      'yale-college-fellowships-office:example-undergraduate-research-fellowship',
      [
        {
          field: 'title',
          value: 'Example Undergraduate Research Fellowship',
          sourceName: 'yale-college-fellowships-office',
          confidence: 0.95,
          observedAt,
        },
        {
          field: 'sourceFingerprint',
          value: 'fingerprint-v1',
          sourceName: 'yale-college-fellowships-office',
          confidence: 0.95,
          observedAt,
        },
      ],
      {
        sourceFingerprint: 'fingerprint-v1',
        sourceLastChangedAt: new Date('2026-04-01T00:00:00Z'),
      },
      observedAt,
    );

    expect(patch.unchanged).toBe(true);
    expect(patch.update.$set.sourceLastVerifiedAt).toBe(observedAt);
    expect(patch.update.$set.sourceLastChangedAt).toEqual(new Date('2026-04-01T00:00:00Z'));
  });

  it('unions set-like paper fields without duplicating values', () => {
    expect(mergeUniqueArrayValues(['u1', 'u2'], ['u2', 'u3'])).toEqual([
      'u1',
      'u2',
      'u3',
    ]);
    expect(mergeUniqueArrayValues(undefined, 'arxiv')).toEqual(['arxiv']);
  });

  it('builds paper bulk updates that union repeated set-like metadata observations', () => {
    const patch = buildPaperUpdateFromObservations(
      'https://openalex.org/W1',
      [
        {
          field: 'title',
          value: 'Shared paper',
          sourceName: 'openalex',
          confidence: 0.85,
          observedAt: new Date('2026-05-14T00:00:00Z'),
        },
        {
          field: 'authors',
          value: ['Author One'],
          sourceName: 'openalex',
          confidence: 0.85,
          observedAt: new Date('2026-05-14T00:00:00Z'),
        },
        {
          field: 'authors',
          value: ['Author Two'],
          sourceName: 'openalex',
          confidence: 0.85,
          observedAt: new Date('2026-05-14T00:00:00Z'),
        },
        {
          field: 'sources',
          value: ['openalex'],
          sourceName: 'openalex',
          confidence: 0.85,
          observedAt: new Date('2026-05-14T00:00:00Z'),
        },
      ],
      { manuallyLockedFields: [] },
    );

    expect(patch.skipped).toBeUndefined();
    expect(patch.update.$set).toMatchObject({
      openAlexId: 'https://openalex.org/W1',
      title: 'Shared paper',
    });
    expect(patch.update.$addToSet).toMatchObject({
      authors: { $each: ['Author One', 'Author Two'] },
      sources: { $each: ['openalex'] },
    });
  });

  it('ignores untrusted paper-source author ids when building paper updates', () => {
    const patch = buildPaperUpdateFromObservations(
      '2401.01234',
      [
        {
          field: 'arxivId',
          value: '2401.01234',
          sourceName: 'arxiv',
          confidence: 0.85,
          observedAt: new Date('2026-05-14T00:00:00Z'),
        },
        {
          field: 'title',
          value: 'A name-matched preprint',
          sourceName: 'arxiv',
          confidence: 0.85,
          observedAt: new Date('2026-05-14T00:00:00Z'),
        },
        {
          field: 'yaleAuthorIds',
          value: ['64f000000000000000000001'],
          sourceName: 'arxiv',
          confidence: 0.85,
          observedAt: new Date('2026-05-14T00:00:00Z'),
        },
        {
          field: 'yaleAuthorNetIds',
          value: ['fixture-author'],
          sourceName: 'arxiv',
          confidence: 0.85,
          observedAt: new Date('2026-05-14T00:00:00Z'),
        },
      ],
      { manuallyLockedFields: [] },
    );

    expect(patch.skipped).toBeUndefined();
    expect(patch.update.$addToSet || {}).not.toHaveProperty('yaleAuthorIds');
    expect(patch.update.$addToSet || {}).not.toHaveProperty('yaleAuthorNetIds');
  });

  it('derives denormalized paper authors from identity-backed authorship evidence', () => {
    const patch = buildPaperUpdateFromObservations(
      'https://openalex.org/W1',
      [
        {
          field: 'title',
          value: 'An identity-backed paper',
          sourceName: 'openalex',
          confidence: 0.9,
          observedAt: new Date('2026-05-14T00:00:00Z'),
        },
        {
          field: 'paperAuthorshipEvidence',
          value: {
            userId: '64f000000000000000000001',
            netid: 'fixture-author',
            displayName: 'Fixture Author',
            sourceName: 'openalex',
            method: 'openalex-orcid',
            externalAuthorIds: {
              openAlex: 'https://openalex.org/A1',
              orcid: '0000-0001-2345-6789',
            },
          },
          sourceName: 'openalex',
          confidence: 0.95,
          observedAt: new Date('2026-05-14T00:00:00Z'),
        },
      ],
      { manuallyLockedFields: [] },
    );

    expect(patch.skipped).toBeUndefined();
    expect(patch.update.$addToSet).toMatchObject({
      yaleAuthorIds: { $each: ['64f000000000000000000001'] },
      yaleAuthorNetIds: { $each: ['fixture-author'] },
    });
    expect(patch.update.$set).not.toHaveProperty('paperAuthorshipEvidence');
  });

  it('keys arXiv paper bulk updates by arxivId rather than openAlexId', () => {
    const patch = buildPaperUpdateFromObservations(
      '2401.01234',
      [
        {
          field: 'arxivId',
          value: '2401.01234',
          sourceName: 'arxiv',
          confidence: 0.85,
          observedAt: new Date('2026-05-14T00:00:00Z'),
        },
        {
          field: 'title',
          value: 'A careful arXiv paper',
          sourceName: 'arxiv',
          confidence: 0.85,
          observedAt: new Date('2026-05-14T00:00:00Z'),
        },
      ],
      { manuallyLockedFields: [] },
    );

    expect(patch.skipped).toBeUndefined();
    expect(patch.update.$set).toMatchObject({
      arxivId: '2401.01234',
      title: 'A careful arXiv paper',
    });
    expect(patch.update.$set).not.toHaveProperty('openAlexId');
  });

  it('starts with zeroed access artifact counters', () => {
    expect(emptyPostMaterializationMetrics()).toEqual({
      entryPathways: 0,
      accessSignals: 0,
      contactRoutes: 0,
      postedOpportunities: 0,
      guardedContactRoutes: 0,
      staleEvidenceSkipped: 0,
      conflicts: 0,
      errors: 0,
    });
  });

  it('aggregates partial access artifact counters defensively', () => {
    const aggregate = emptyPostMaterializationMetrics();

    addPostMaterializationMetrics(aggregate, {
      entryPathways: 2,
      accessSignals: 3,
      contactRoutes: 1,
      guardedContactRoutes: 1,
    });
    addPostMaterializationMetrics(aggregate, {
      postedOpportunities: 4,
      staleEvidenceSkipped: 2,
      conflicts: 1,
      errors: 1,
    });
    addPostMaterializationMetrics(aggregate);

    expect(aggregate).toEqual({
      entryPathways: 2,
      accessSignals: 3,
      contactRoutes: 1,
      postedOpportunities: 4,
      guardedContactRoutes: 1,
      staleEvidenceSkipped: 2,
      conflicts: 1,
      errors: 1,
    });
  });

  it('counts posted opportunities linked to listing observations in a scrape run', async () => {
    const listingId = '64f000000000000000000099';
    const observationModel = {
      aggregate: async () => [{ _id: listingId }, { _id: undefined }],
    };
    const postedOpportunityModel = {
      countDocuments: async (filter: any) => {
        expect(filter.listingId.$in.map(String)).toEqual([listingId]);
        return 1;
      },
    };

    await expect(
      countListingBackedPostedOpportunitiesForRun('64f000000000000000000001', {
        observationModel: observationModel as any,
        postedOpportunityModel: postedOpportunityModel as any,
      }),
    ).resolves.toBe(1);
  });

  it('returns zero listing-backed posted opportunities when listing ids are missing', async () => {
    const observationModel = {
      aggregate: async () => [{ _id: undefined }, { _id: 'not-an-object-id' }],
    };
    const postedOpportunityModel = {
      countDocuments: async () => {
        throw new Error('should not count without valid listing ids');
      },
    };

    await expect(
      countListingBackedPostedOpportunitiesForRun('64f000000000000000000001', {
        observationModel: observationModel as any,
        postedOpportunityModel: postedOpportunityModel as any,
      }),
    ).resolves.toBe(0);
  });

  it('ignores discovery-only acceptingUndergrads observations for research groups', () => {
    expect(
      shouldIgnoreObservationForEntityMaterialization('researchGroup', {
        field: 'acceptingUndergrads',
        sourceName: 'ysm-atoz-index',
      }),
    ).toBe(true);
    expect(
      shouldIgnoreObservationForEntityMaterialization('researchGroup', {
        field: 'acceptingUndergrads',
        sourceName: 'lab-microsite-undergrad-llm',
      }),
    ).toBe(false);
    expect(
      shouldIgnoreObservationForEntityMaterialization('user', {
        field: 'acceptingUndergrads',
        sourceName: 'ysm-atoz-index',
      }),
    ).toBe(false);
  });

  it('clears legacy discovery-only acceptance claims unless manually locked or supported', () => {
    expect(
      shouldClearIgnoredAccessClaimForEntity('researchGroup', [
        { field: 'acceptingUndergrads', sourceName: 'ysm-atoz-index' },
        { field: 'acceptingUndergrads', sourceName: 'yse-centers-index' },
      ]),
    ).toBe(true);
    expect(
      shouldClearIgnoredAccessClaimForEntity(
        'researchGroup',
        [{ field: 'acceptingUndergrads', sourceName: 'ysm-atoz-index' }],
        ['acceptingUndergrads'],
      ),
    ).toBe(false);
    expect(
      shouldClearIgnoredAccessClaimForEntity('researchGroup', [
        { field: 'acceptingUndergrads', sourceName: 'ysm-atoz-index' },
        { field: 'acceptingUndergrads', sourceName: 'lab-microsite-undergrad-llm' },
      ]),
    ).toBe(false);
  });

  it('redacts and trims direct contact details consistently for materialized public excerpts', () => {
    const raw = '  Email fixture.contact@yale.edu or call 203-432-1234.  ';

    expect(redactDirectContactInfo('Email fixture.contact@yale.edu or call 203-432-1234.')).toBe(
      'Email [email redacted] or call [phone redacted].',
    );
    expect(publicAccessExcerpt(raw)).toBe('Email [email redacted] or call [phone redacted].');
    expect(materializedFieldValue('researchEntity', 'undergradEvidenceQuote', raw)).toBe(
      publicAccessExcerpt(raw),
    );
  });

  it('filters source chrome from materialized research entity research areas', () => {
    expect(
      materializedFieldValue('researchEntity', 'researchAreas', [
        'ORCID0000-0000-0000-001X',
        '0000-0000-0000-001X',
        'Lab Whisk Cup Streamline Icon: https://streamlinehq.comExample LabView Lab Website',
        'View Lab Website',
        'Example Cell Biology10 YSM ResearchersView Related Publication',
        '10 YSM Researchers',
        'View Related Publication',
        'Example Cell Biology',
      ]),
    ).toEqual(['Example Cell Biology']);
  });

  it('syncs inferred PI membership from roster-owned user observations', async () => {
    const created: any[] = [];
    const result = await syncInferredPiMembership(
      '64f0000000000000000000aa',
      [
        {
          field: 'inferredPiUserKey',
          value: 'dept:cs:example-pi',
          sourceUrl: 'https://engineering.yale.edu/faculty/example-pi',
          confidence: 0.7,
          observedAt: new Date('2026-05-14T06:29:01.759Z'),
        },
      ],
      {
        observationModel: {
          find: () =>
            ({
              lean: async () => [
                {
                  field: 'profileUrls',
                  value: { departmental: 'https://statistics.yale.edu/profile/example-pi' },
                },
                {
                  field: 'website',
                  value: 'https://example-pi.test/',
                },
              ],
            }) as any,
        } as any,
        userModel: {
          findById: () => ({ lean: async () => null }) as any,
          findOne: (filter: Record<string, unknown>) =>
            ({
              lean: async () =>
                filter['profileUrls.departmental'] ===
                'https://statistics.yale.edu/profile/example-pi'
                  ? { _id: 'user-example-pi' }
                  : null,
            }) as any,
        } as any,
        researchGroupMemberModel: {
          findOne: () => ({ lean: async () => null }) as any,
          create: async (doc: any) => {
            created.push(doc);
            return doc;
          },
          updateOne: async () => {
            throw new Error('should not update when creating a missing PI row');
          },
        } as any,
      },
    );

    expect(result).toMatchObject({
      synced: true,
      created: true,
      userId: 'user-example-pi',
    });
    expect(created[0]).toMatchObject({
      researchEntityId: '64f0000000000000000000aa',
      userId: 'user-example-pi',
      role: 'pi',
    });
  });

  it('syncs inferred PI membership from synthetic roster keys by unique faculty name', async () => {
    const created: any[] = [];
    const result = await syncInferredPiMembership(
      '64f0000000000000000000aa',
      [
        {
          field: 'inferredPiUserKey',
          value: 'dept:psych:fixture-researcher',
          sourceUrl: 'https://psychology.yale.edu/people/faculty/primary',
          confidence: 0.7,
          observedAt: new Date('2026-05-15T19:35:03.739Z'),
        },
      ],
      {
        observationModel: {
          find: () =>
            ({
              lean: async () => [
                { field: 'fname', value: 'Fixture' },
                { field: 'lname', value: 'Researcher' },
                { field: 'primaryDepartment', value: 'Psychology' },
                {
                  field: 'profileUrls',
                  value: { departmental: 'https://psychology.yale.edu/people/fixture-researcher' },
                },
              ],
            }) as any,
        } as any,
        userModel: {
          findById: () => ({ lean: async () => null }) as any,
          findOne: () => ({ lean: async () => null }) as any,
          find: (filter: Record<string, unknown>) =>
            ({
              limit: () =>
                ({
                  lean: async () =>
                    filter.fname && filter.lname
                      ? [{ _id: 'user-fixture', fname: 'Fixture', lname: 'Researcher' }]
                      : [],
                }) as any,
            }) as any,
        } as any,
        researchGroupMemberModel: {
          findOne: () => ({ lean: async () => null }) as any,
          create: async (doc: any) => {
            created.push(doc);
            return doc;
          },
          updateOne: async () => {
            throw new Error('should not update when creating a missing PI row');
          },
        } as any,
      },
    );

    expect(result).toMatchObject({
      synced: true,
      created: true,
      userId: 'user-fixture',
    });
    expect(created[0]).toMatchObject({
      researchEntityId: '64f0000000000000000000aa',
      userId: 'user-fixture',
      role: 'pi',
    });
  });

  it('syncs inferred PI membership when roster splits a surname particle into first name', async () => {
    const created: any[] = [];
    const result = await syncInferredPiMembership(
      '64f0000000000000000000aa',
      [
        {
          field: 'inferredPiUserKey',
          value: 'dept:cs:fixture-van-sample',
          sourceUrl: 'https://engineering.yale.edu/academic-study/departments/computer-science/faculty/load_faculty/4841',
          confidence: 0.7,
          observedAt: new Date('2026-05-14T06:29:10.471Z'),
        },
      ],
      {
        observationModel: {
          find: () =>
            ({
              lean: async () => [
                { field: 'fname', value: 'Fixture Van' },
                { field: 'lname', value: 'Sample' },
                { field: 'primaryDepartment', value: 'Computer Science' },
                { field: 'website', value: 'https://van-sample-lab.test/' },
              ],
            }) as any,
        } as any,
        userModel: {
          findById: () => ({ lean: async () => null }) as any,
          findOne: () => ({ lean: async () => null }) as any,
          find: (filter: Record<string, unknown>) =>
            ({
              limit: () =>
                ({
                  lean: async () =>
                    filter.fname
                      ? []
                      : [
                          { _id: 'user-other', fname: 'Other', lname: 'van Sample' },
                          { _id: 'user-fixture', fname: 'Fixture', lname: 'van Sample' },
                        ],
                }) as any,
            }) as any,
        } as any,
        researchGroupMemberModel: {
          findOne: () => ({ lean: async () => null }) as any,
          create: async (doc: any) => {
            created.push(doc);
            return doc;
          },
          updateOne: async () => {
            throw new Error('should not update when creating a missing PI row');
          },
        } as any,
      },
    );

    expect(result).toMatchObject({
      synced: true,
      created: true,
      userId: 'user-fixture',
    });
    expect(created[0]).toMatchObject({
      researchEntityId: '64f0000000000000000000aa',
      userId: 'user-fixture',
      role: 'pi',
    });
  });

  it('syncs unresolved inferred PI membership as a source-backed name-only row', async () => {
    const created: any[] = [];
    const result = await syncInferredPiMembership(
      '64f0000000000000000000aa',
      [
        {
          field: 'inferredPiUserKey',
          value: 'nih-pi:fixture-unresolved',
          sourceUrl: 'https://reporter.nih.gov/project-details/123',
          confidence: 0.7,
          observedAt: new Date('2026-05-14T06:29:10.471Z'),
        },
      ],
      {
        observationModel: {
          find: () =>
            ({
              lean: async () => [
                { field: 'fname', value: 'Fixture' },
                { field: 'lname', value: 'Unresolved' },
              ],
            }) as any,
        } as any,
        userModel: {
          findById: () => ({ lean: async () => null }) as any,
          findOne: () => ({ lean: async () => null }) as any,
          find: () =>
            ({
              limit: () => ({ lean: async () => [] }) as any,
            }) as any,
        } as any,
        researchGroupMemberModel: {
          findOne: () => ({ lean: async () => null }) as any,
          create: async (doc: any) => {
            created.push(doc);
            return doc;
          },
          updateOne: async () => {
            throw new Error('should not update when creating a missing PI row');
          },
        } as any,
      },
    );

    expect(result).toMatchObject({
      synced: true,
      created: true,
    });
    expect(created[0]).toMatchObject({
      researchEntityId: '64f0000000000000000000aa',
      name: 'Fixture Unresolved',
      role: 'pi',
    });
    expect(created[0]).not.toHaveProperty('userId');
  });

  it('promotes an existing inferred owner to pi when the role is not locked', async () => {
    const updates: any[] = [];
    const result = await syncInferredPiMembership(
      '64f0000000000000000000aa',
      [
        {
          field: 'inferredPiUserId',
          value: '64f0000000000000000000bb',
          sourceUrl: 'https://nih.example/pi',
          confidence: 0.8,
          observedAt: new Date('2026-05-14T06:29:01.759Z'),
        },
      ],
      {
        userModel: {
          findById: () => ({ lean: async () => ({ _id: '64f0000000000000000000bb' }) }) as any,
          findOne: () => ({ lean: async () => null }) as any,
        } as any,
        observationModel: {
          find: () => ({ lean: async () => [] }) as any,
        } as any,
        researchGroupMemberModel: {
          findOne: () =>
            ({
              lean: async () => ({
                _id: 'member-1',
                researchEntityId: '64f0000000000000000000aa',
                role: 'core-faculty',
                confidence: 0.2,
                manuallyLockedFields: [],
              }),
            }) as any,
          create: async () => {
            throw new Error('should not create when the membership already exists');
          },
          updateOne: async (_filter: any, update: any) => {
            updates.push(update);
            return { acknowledged: true };
          },
        } as any,
      },
    );

    expect(result).toMatchObject({
      synced: true,
      created: false,
      userId: '64f0000000000000000000bb',
    });
    expect(updates[0].$set).toMatchObject({
      role: 'pi',
      researchEntityId: '64f0000000000000000000aa',
    });
  });

  it('syncs multiple inferred PI user ids as current PI memberships', async () => {
    const created: any[] = [];
    const result = await syncInferredPiMembership(
      '64f0000000000000000000aa',
      [
        {
          field: 'inferredPiUserId',
          value: '64f0000000000000000000bb',
          sourceUrl: 'https://medicine.yale.edu/lab/digital/',
          confidence: 0.8,
          observedAt: new Date('2026-05-17T12:00:00.000Z'),
        },
        {
          field: 'inferredPiUserId',
          value: '64f0000000000000000000cc',
          sourceUrl: 'https://medicine.yale.edu/lab/digital/',
          confidence: 0.8,
          observedAt: new Date('2026-05-17T12:00:00.000Z'),
        },
      ],
      {
        userModel: {
          findById: (id: string) =>
            ({
              lean: async () =>
                ['64f0000000000000000000bb', '64f0000000000000000000cc'].includes(String(id))
                  ? { _id: id }
                  : null,
            }) as any,
          findOne: () => ({ lean: async () => null }) as any,
        } as any,
        observationModel: {
          find: () => ({ lean: async () => [] }) as any,
        } as any,
        researchGroupMemberModel: {
          findOne: () => ({ lean: async () => null }) as any,
          create: async (doc: any) => {
            created.push(doc);
            return doc;
          },
          updateOne: async () => {
            throw new Error('should not update when creating missing PI rows');
          },
        } as any,
      },
    );

    expect(result).toMatchObject({
      synced: true,
      created: true,
      userId: '64f0000000000000000000bb',
    });
    expect(created.map((doc) => doc.userId)).toEqual([
      '64f0000000000000000000bb',
      '64f0000000000000000000cc',
    ]);
    expect(created.every((doc) => doc.role === 'pi')).toBe(true);
  });

  it('materializes member observations by resolving researchEntityKey and userEntityKey', async () => {
    const creates: any[] = [];
    const result = await syncResolvedMemberFromObservationFields(
      [
        { field: 'researchEntityKey', value: 'dept-mcdb-fixture-professor' },
        { field: 'userEntityKey', value: 'netid:fixture.manager' },
        { field: 'role', value: 'staff' },
        { field: 'name', value: 'Fixture Manager' },
        { field: 'email', value: 'fixture.manager@yale.edu' },
      ],
      {
        researchEntityModel: {
          findOne: () => ({ lean: async () => ({ _id: '64f0000000000000000000aa' }) }) as any,
        } as any,
        userModel: {
          findOne: () => ({ lean: async () => ({ _id: '64f0000000000000000000bb' }) }) as any,
        } as any,
        researchGroupMemberModel: {
          findOne: () => ({ lean: async () => null }) as any,
          create: async (doc: any) => {
            creates.push(doc);
            return doc;
          },
          updateOne: async () => ({ acknowledged: true }),
        } as any,
      },
    );

    expect(result).toMatchObject({ synced: true, created: true });
    expect(creates[0]).toMatchObject({
      researchEntityId: '64f0000000000000000000aa',
      userId: '64f0000000000000000000bb',
      role: 'staff',
      name: 'Fixture Manager',
      email: 'fixture.manager@yale.edu',
      isCurrentMember: true,
    });
  });

  it('relinks member observations from archived entities to canonical ResearchEntity rows', async () => {
    const creates: any[] = [];
    const result = await syncResolvedMemberFromObservationFields(
      [
        { field: 'researchEntityKey', value: 'dept-mcdb-archived-professor' },
        { field: 'userEntityKey', value: 'netid:fixture.manager' },
        { field: 'role', value: 'staff' },
      ],
      {
        researchEntityModel: {
          findOne: () =>
            ({
              lean: async () => ({
                _id: '64f0000000000000000000aa',
                archived: true,
                canonicalGroupId: '64f0000000000000000000cc',
              }),
            }) as any,
        } as any,
        userModel: {
          findOne: () => ({ lean: async () => ({ _id: '64f0000000000000000000bb' }) }) as any,
        } as any,
        researchGroupMemberModel: {
          findOne: () => ({ lean: async () => null }) as any,
          create: async (doc: any) => {
            creates.push(doc);
            return doc;
          },
          updateOne: async () => ({ acknowledged: true }),
        } as any,
      },
    );

    expect(result).toMatchObject({
      synced: true,
      created: true,
      researchEntityId: '64f0000000000000000000cc',
    });
    expect(creates[0]).toMatchObject({
      researchEntityId: '64f0000000000000000000cc',
      userId: '64f0000000000000000000bb',
    });
  });

  it('skips member observations targeting archived entities without canonical rows', async () => {
    const result = await syncResolvedMemberFromObservationFields(
      [
        { field: 'researchEntityKey', value: 'dept-mcdb-archived-professor' },
        { field: 'userEntityKey', value: 'netid:fixture.manager' },
        { field: 'role', value: 'staff' },
      ],
      {
        researchEntityModel: {
          findOne: () =>
            ({
              lean: async () => ({
                _id: '64f0000000000000000000aa',
                archived: true,
                canonicalGroupId: null,
              }),
            }) as any,
        } as any,
        userModel: {
          findOne: () => ({ lean: async () => ({ _id: '64f0000000000000000000bb' }) }) as any,
        } as any,
        researchGroupMemberModel: {
          findOne: async () => {
            throw new Error('should not query member rows for archived entity without canonical');
          },
          create: async () => {
            throw new Error('should not create member rows for archived entity without canonical');
          },
          updateOne: async () => ({ acknowledged: true }),
        } as any,
      },
    );

    expect(result).toMatchObject({
      synced: false,
      created: false,
      skipped: 'archived-entity-without-canonical',
    });
  });

  it('does not overwrite omitted role or current-member fields on existing member updates', async () => {
    const updates: any[] = [];
    const result = await syncResolvedMemberFromObservationFields(
      [
        { field: 'researchEntityKey', value: 'dept-mcdb-fixture-professor' },
        { field: 'userEntityKey', value: 'netid:fixture.manager' },
        { field: 'name', value: 'Fixture Manager' },
        { field: 'email', value: 'fixture.manager@yale.edu' },
      ],
      {
        researchEntityModel: {
          findOne: () => ({ lean: async () => ({ _id: '64f0000000000000000000aa' }) }) as any,
        } as any,
        userModel: {
          findOne: () => ({ lean: async () => ({ _id: '64f0000000000000000000bb' }) }) as any,
        } as any,
        researchGroupMemberModel: {
          findOne: () =>
            ({
              lean: async () => ({
                _id: 'member-1',
                researchEntityId: '64f0000000000000000000aa',
                userId: '64f0000000000000000000bb',
                role: 'staff',
                isCurrentMember: false,
                manuallyLockedFields: [],
              }),
            }) as any,
          create: async () => {
            throw new Error('should not create when membership already exists');
          },
          updateOne: async (_filter: any, update: any) => {
            updates.push(update);
            return { acknowledged: true };
          },
        } as any,
      },
    );

    expect(result).toMatchObject({ synced: true, created: false });
    expect(updates[0].$set).not.toHaveProperty('role');
    expect(updates[0].$set).not.toHaveProperty('isCurrentMember');
    expect(updates[0].$set).toMatchObject({
      name: 'Fixture Manager',
      email: 'fixture.manager@yale.edu',
    });
  });

  it('falls back to observed email when netid user lookup misses', async () => {
    const userLookups: any[] = [];
    const creates: any[] = [];
    const result = await syncResolvedMemberFromObservationFields(
      [
        { field: 'researchEntityKey', value: 'dept-mcdb-fixture-professor' },
        { field: 'userEntityKey', value: 'netid:fixture.manager' },
        { field: 'role', value: 'staff' },
        { field: 'name', value: 'Fixture Manager' },
        { field: 'email', value: 'fixture.manager@yale.edu' },
      ],
      {
        researchEntityModel: {
          findOne: () => ({ lean: async () => ({ _id: '64f0000000000000000000aa' }) }) as any,
        } as any,
        userModel: {
          findOne: (filter: any) => {
            userLookups.push(filter);
            return {
              lean: async () =>
                filter.email === 'fixture.manager@yale.edu'
                  ? { _id: '64f0000000000000000000bb' }
                  : null,
            } as any;
          },
        } as any,
        researchGroupMemberModel: {
          findOne: () => ({ lean: async () => null }) as any,
          create: async (doc: any) => {
            creates.push(doc);
            return doc;
          },
          updateOne: async () => ({ acknowledged: true }),
        } as any,
      },
    );

    expect(result).toMatchObject({
      synced: true,
      created: true,
      userId: '64f0000000000000000000bb',
    });
    expect(userLookups).toEqual([
      { netid: 'fixture.manager' },
      { email: 'fixture.manager@yale.edu' },
    ]);
    expect(creates[0]).toMatchObject({
      userId: '64f0000000000000000000bb',
      email: 'fixture.manager@yale.edu',
    });
  });

  it('does not copy PI research interests into ResearchEntity research areas', () => {
    const supplements = buildResearchEntityProfileSupplementObservations(
      [
        { field: 'name', value: 'Fixture Analyst Lab' },
        { field: 'websiteUrl', value: 'https://fixture-analyst-lab.yale.edu/' },
      ],
      {
        inferredPiUserKey: 'netid:fixture.analyst',
        userId: 'user-fixture',
        userObservations: [
          {
            field: 'bio',
            value: 'Fixture studies algebraic geometry for scientific computing.',
            sourceName: 'dept-faculty-roster',
            confidence: 0.7,
            observedAt: new Date('2026-05-15T00:00:00Z'),
          },
          {
            field: 'researchInterests',
            value: ['Algebraic Geometry', 'Scientific Computing'],
            sourceName: 'dept-faculty-roster',
            confidence: 0.7,
            observedAt: new Date('2026-05-15T00:00:00Z'),
          },
        ],
      },
    );

    expect(supplements.some((observation) => observation.field === 'researchAreas')).toBe(false);
    expect(supplements.some((observation) => observation.field === 'description')).toBe(false);
    expect(supplements.some((observation) => observation.field === 'fullDescription')).toBe(false);
    expect(supplements.some((observation) => observation.field === 'shortDescription')).toBe(false);
  });

  it('uses linked PI profile departments to fill sparse lab department context', () => {
    const supplements = buildResearchEntityProfileSupplementObservations(
      [
        { field: 'name', value: 'Fixture Analyst Lab' },
        { field: 'school', value: 'Yale School of Medicine' },
      ],
      {
        inferredPiUserId: 'user-fixture',
        userId: 'user-fixture',
        userObservations: [
          {
            field: 'primaryDepartment',
            value: 'PEDT - Pediatrics',
            sourceName: 'yale-directory',
            confidence: 0.75,
            observedAt: new Date('2026-05-15T00:00:00Z'),
          },
          {
            field: 'departments',
            value: ['PEDT - Pediatrics', 'Yale School of Medicine'],
            sourceName: 'yale-directory',
            confidence: 0.7,
            observedAt: new Date('2026-05-15T00:00:00Z'),
          },
        ],
      },
    );

    expect(supplements).toEqual([
      expect.objectContaining({
        field: 'departments',
        value: ['PEDT - Pediatrics', 'Yale School of Medicine'],
      }),
    ]);
  });

  it('does not overwrite explicit research entity department observations with PI profile context', () => {
    const supplements = buildResearchEntityProfileSupplementObservations(
      [
        { field: 'name', value: 'Fixture Analyst Lab' },
        { field: 'departments', value: ['Genetics'] },
      ],
      {
        inferredPiUserId: 'user-fixture',
        userId: 'user-fixture',
        userObservations: [
          {
            field: 'primaryDepartment',
            value: 'PEDT - Pediatrics',
            sourceName: 'yale-directory',
            confidence: 0.75,
            observedAt: new Date('2026-05-15T00:00:00Z'),
          },
        ],
      },
    );

    expect(supplements.some((observation) => observation.field === 'departments')).toBe(false);
  });

  it('loads PI profile context from an existing current membership when observations lack inferred PI fields', async () => {
    const context = await loadPiProfileContextFromCurrentMembership(
      '64f0000000000000000000aa',
      {
        researchGroupMemberModel: {
          findOne: () =>
            ({
              lean: async () => ({
                userId: '64f0000000000000000000bb',
              }),
            }) as any,
          create: async () => {
            throw new Error('should not create membership while loading profile context');
          },
          updateOne: async () => {
            throw new Error('should not update membership while loading profile context');
          },
        } as any,
        userModel: {
          findById: () =>
            ({
              lean: async () => ({
                _id: '64f0000000000000000000bb',
                  fname: 'Fixture',
                  lname: 'Analyst',
                primaryDepartment: 'MEDPED Pediatrics',
                secondaryDepartments: ['MED School of Medicine'],
                departments: [],
              }),
            }) as any,
          findOne: () => ({ lean: async () => null }) as any,
          find: () => ({ limit: () => ({ lean: async () => [] }) }) as any,
        } as any,
        observationModel: {
          find: () =>
            ({
              lean: async () => [
                {
                  field: 'primaryDepartment',
                  value: 'MEDPED Pediatrics',
                  sourceName: 'yale-directory',
                  confidence: 0.75,
                  observedAt: new Date('2026-05-15T00:00:00Z'),
                },
              ],
            }) as any,
        } as any,
      },
    );
    const supplements = buildResearchEntityProfileSupplementObservations(
      [{ field: 'name', value: 'Fixture Analyst Lab' }],
      context,
    );

    expect(context.userId).toBe('64f0000000000000000000bb');
    expect(supplements).toEqual([
      expect.objectContaining({
        field: 'departments',
        value: ['MEDPED Pediatrics', 'MED School of Medicine'],
      }),
    ]);
  });

  it('builds guarded official-profile fallback coverage inputs from Yale PI profile observations', () => {
    const inputs = buildOfficialProfileCoverageInputs(
      '64f0000000000000000000aa',
      'Fixture Analyst Lab',
      'https://fixture-analyst-lab.yale.edu/',
      {
        inferredPiUserKey: 'netid:fixture.analyst',
        userId: 'user-fixture',
        userObservations: [
          {
            _id: 'obs-profile',
            field: 'profileUrls',
            value: { departmental: 'https://math.yale.edu/people/fixture-analyst' },
            sourceName: 'dept-faculty-roster',
            confidence: 0.7,
            observedAt: new Date('2026-05-15T00:00:00Z'),
          },
          {
            _id: 'obs-title',
            field: 'title',
            value: 'Associate Professor of Applied Mathematics',
            sourceName: 'dept-faculty-roster',
            confidence: 0.7,
            observedAt: new Date('2026-05-15T00:00:00Z'),
          },
          {
            _id: 'obs-fname',
            field: 'fname',
            value: 'Fixture',
            sourceName: 'dept-faculty-roster',
            confidence: 0.7,
            observedAt: new Date('2026-05-15T00:00:00Z'),
          },
          {
            _id: 'obs-lname',
            field: 'lname',
            value: 'Analyst',
            sourceName: 'dept-faculty-roster',
            confidence: 0.7,
            observedAt: new Date('2026-05-15T00:00:00Z'),
          },
        ],
      },
    );

    expect(inputs.pathway).toMatchObject({
      pathwayType: 'EXPLORATORY_CONTACT',
      studentFacingLabel: 'Explore the PI profile',
    });
    expect(inputs.route).toMatchObject({
      routeType: 'FACULTY_PI',
      visibility: 'PUBLIC',
      url: 'https://math.yale.edu/people/fixture-analyst',
      name: 'Fixture Analyst',
    });
    expect(inputs.signal).toMatchObject({
      signalType: 'REACH_OUT_PLAUSIBLE',
      sourceUrl: 'https://math.yale.edu/people/fixture-analyst',
    });
  });

  it('does not build public official-profile fallback coverage from forbidden Engineering profiles', () => {
    const inputs = buildOfficialProfileCoverageInputs(
      '64f0000000000000000000cc',
      'Example PI Lab',
      'https://example-lab.test/',
      {
        inferredPiUserKey: 'netid:example.pi',
        userId: 'user-example',
        userObservations: [
          {
            _id: 'obs-profile',
            field: 'profileUrls',
            value: {
              departmental:
                'https://engineering.yale.edu/research-and-faculty/faculty-directory/example-person',
            },
            sourceName: 'dept-faculty-roster',
            confidence: 0.7,
            observedAt: new Date('2026-05-15T00:00:00Z'),
          },
          {
            _id: 'obs-title',
            field: 'title',
            value: 'Assistant Professor of Computer Science',
            sourceName: 'dept-faculty-roster',
            confidence: 0.7,
            observedAt: new Date('2026-05-15T00:00:00Z'),
          },
        ],
      },
    );

    expect(inputs).toEqual({});
  });

  it('does not build official-profile fallback coverage for third-party funding entities', () => {
    const inputs = buildOfficialProfileCoverageInputs(
      '64f0000000000000000000dd',
      'Fixture Analyst Lab',
      undefined,
      {
        inferredOwnerObservation: {
          field: 'inferredPiUserId',
          value: 'user-fixture',
          sourceName: 'nsf-award-search',
          confidence: 0.7,
          observedAt: new Date('2026-05-15T00:00:00Z'),
        },
        inferredPiUserKey: 'netid:fixture.analyst',
        userId: 'user-fixture',
        userObservations: [
          {
            _id: 'obs-profile',
            field: 'profileUrls',
            value: { departmental: 'https://math.yale.edu/people/fixture-analyst' },
            sourceName: 'dept-faculty-roster',
            confidence: 0.7,
            observedAt: new Date('2026-05-15T00:00:00Z'),
          },
          {
            _id: 'obs-title',
            field: 'title',
            value: 'Associate Professor of Applied Mathematics',
            sourceName: 'dept-faculty-roster',
            confidence: 0.7,
            observedAt: new Date('2026-05-15T00:00:00Z'),
          },
        ],
      },
    );

    expect(inputs).toEqual({});
  });
});

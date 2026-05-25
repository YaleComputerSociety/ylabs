import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  search: vi.fn(),
  listingDistinct: vi.fn(),
  researchEntityFindOne: vi.fn(),
  researchEntityFindById: vi.fn(),
  researchEntityFindOneAndUpdate: vi.fn(),
  researchGroupMemberFindOne: vi.fn(),
  researchGroupMemberUpdateOne: vi.fn(),
  departmentFindOne: vi.fn(),
  userFindById: vi.fn(),
  userFindOne: vi.fn(),
  listAccessSummariesForResearchEntities: vi.fn(),
}));

vi.mock('../../utils/meiliClient', () => ({
  getMeiliIndex: vi.fn(async () => ({
    search: mocks.search,
  })),
}));

vi.mock('../../models/listing', () => ({
  Listing: {
    distinct: mocks.listingDistinct,
  },
}));

vi.mock('../../models/researchEntity', () => ({
  ResearchEntity: {
    findOne: mocks.researchEntityFindOne,
    findById: mocks.researchEntityFindById,
    findOneAndUpdate: mocks.researchEntityFindOneAndUpdate,
  },
}));

vi.mock('../../models/researchGroupMember', () => ({
  ResearchGroupMember: {
    findOne: mocks.researchGroupMemberFindOne,
    find: vi.fn(() => ({ lean: async () => [] })),
    updateOne: mocks.researchGroupMemberUpdateOne,
  },
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

vi.mock('../../models/user', () => ({
  User: {
    findById: mocks.userFindById,
    findOne: mocks.userFindOne,
    find: vi.fn(async () => []),
  },
}));

vi.mock('../accessSummaryService', () => ({
  getAccessSummaryForResearchEntity: vi.fn(),
  listAccessSummariesForResearchEntities: mocks.listAccessSummariesForResearchEntities,
}));

import {
  findOrCreateForOwner,
  getResearchGroupDetail,
  searchResearchGroupsViaMeili,
} from '../researchGroupService';

beforeEach(() => {
  mocks.search.mockReset();
  mocks.listingDistinct.mockReset();
  mocks.researchEntityFindOne.mockReset();
  mocks.researchEntityFindById.mockReset();
  mocks.researchEntityFindOneAndUpdate.mockReset();
  mocks.researchGroupMemberFindOne.mockReset();
  mocks.researchGroupMemberUpdateOne.mockReset();
  mocks.departmentFindOne.mockReset();
  mocks.userFindById.mockReset();
  mocks.userFindOne.mockReset();
  mocks.listAccessSummariesForResearchEntities.mockReset();
  mocks.listingDistinct.mockResolvedValue([]);
  mocks.listAccessSummariesForResearchEntities.mockResolvedValue(new Map());
  mocks.researchEntityFindOne.mockReturnValue({ lean: async () => null });
  mocks.researchEntityFindById.mockReturnValue({ lean: async () => null });
  mocks.researchGroupMemberFindOne.mockReturnValue({ lean: async () => null });
  mocks.departmentFindOne.mockReturnValue({ lean: async () => null });
  mocks.userFindById.mockReturnValue({ select: () => ({ lean: async () => null }) });
  mocks.userFindOne.mockReturnValue({ select: () => ({ lean: async () => null }) });
});

describe('searchResearchGroupsViaMeili', () => {
  it('falls back to keyword search when a local Meili index lacks the hybrid embedder', async () => {
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
            slug: 'reilly-lab',
            name: 'Reilly Lab',
            kind: 'lab',
            departments: ['Chemistry'],
            researchAreas: [],
            sourceUrls: [],
          },
        ],
        estimatedTotalHits: 1,
      });

    const result = await searchResearchGroupsViaMeili('reilly', {}, 1, 1);

    expect(mocks.search).toHaveBeenCalledTimes(2);
    expect(mocks.search).toHaveBeenNthCalledWith(
      1,
      'reilly',
      expect.objectContaining({
        hybrid: { semanticRatio: 0.8, embedder: 'default' },
      }),
    );
    expect(mocks.search).toHaveBeenNthCalledWith(
      2,
      'reilly',
      expect.not.objectContaining({ hybrid: expect.anything() }),
    );
    expect(result).toMatchObject({
      estimatedTotalHits: 1,
      page: 1,
      pageSize: 1,
      researchEntities: [{ _id: entityId, slug: 'reilly-lab', name: 'Reilly Lab' }],
    });
  });
});

describe('findOrCreateForOwner', () => {
  it('does not attach a PI membership when owner _id belongs to a different netid', async () => {
    const ownerId = '67d8925550621bcef4349851';
    const group = {
      _id: '69f6c42e0557b2db61d6e5c8',
      slug: 'peters-lab-jdp52',
      name: 'Peters Lab',
      createdAt: new Date('2026-05-01T00:00:00.000Z'),
      updatedAt: new Date('2026-05-01T00:00:00.000Z'),
    };
    mocks.userFindById.mockReturnValue({
      select: () => ({ lean: async () => ({ _id: ownerId, netid: 'jp2492' }) }),
    });
    mocks.researchEntityFindOneAndUpdate.mockReturnValue({
      lean: async () => group,
    });

    const result = await findOrCreateForOwner({
      _id: ownerId,
      netid: 'jdp52',
      fname: 'John',
      lname: 'Peters',
      primaryDepartment: 'English',
    });

    expect(result.group).toBe(group);
    expect(mocks.researchGroupMemberFindOne).not.toHaveBeenCalled();
    expect(mocks.researchGroupMemberUpdateOne).not.toHaveBeenCalled();
    expect(mocks.researchEntityFindOneAndUpdate).toHaveBeenCalledWith(
      { slug: 'peters-lab-jdp52' },
      expect.any(Object),
      expect.objectContaining({ upsert: true }),
    );
  });
});

describe('getResearchGroupDetail', () => {
  it('requires public student visibility when resolving a public research detail slug', async () => {
    mocks.researchEntityFindOne.mockReturnValue({
      lean: async () => null,
    });

    const result = await getResearchGroupDetail('hidden-lab');

    expect(result).toBeNull();
    expect(mocks.researchEntityFindOne).toHaveBeenCalledWith({
      slug: 'hidden-lab',
      archived: { $ne: true },
      studentVisibilityTier: { $in: ['student_ready', 'limited_but_safe'] },
    });
  });
});

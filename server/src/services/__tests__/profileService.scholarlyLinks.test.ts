import mongoose from 'mongoose';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../models/user', () => ({
  User: {
    findOne: vi.fn(),
  },
}));

vi.mock('../../models/researchGroupMember', () => ({
  ResearchGroupMember: {
    find: vi.fn(),
  },
}));

vi.mock('../../models/researchEntity', () => ({
  ResearchEntity: {
    find: vi.fn(),
  },
}));

vi.mock('../departmentResolver', () => ({
  canonicalizeProfileDepartments: vi.fn(async (input) => ({
    primaryDepartment: typeof input.primaryDepartment === 'string' ? input.primaryDepartment : '',
    secondaryDepartments: Array.isArray(input.secondaryDepartments)
      ? input.secondaryDepartments
      : [],
    departments: Array.isArray(input.departments) ? input.departments : [],
    unresolved: [],
    ignored: [],
  })),
}));

vi.mock('../scholarlyLinkService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../scholarlyLinkService')>();
  return {
    ...actual,
    listPublicScholarlyLinksForUser: vi.fn(),
  };
});

const { User } = await import('../../models/user');
const { ResearchGroupMember } = await import('../../models/researchGroupMember');
const { ResearchEntity } = await import('../../models/researchEntity');
const { listPublicScholarlyLinksForUser } = await import('../scholarlyLinkService');
const { getProfileByNetid } = await import('../profileService');

const mockedUser = User as unknown as {
  findOne: ReturnType<typeof vi.fn>;
};
const mockedResearchGroupMember = ResearchGroupMember as unknown as {
  find: ReturnType<typeof vi.fn>;
};
const mockedResearchEntity = ResearchEntity as unknown as {
  find: ReturnType<typeof vi.fn>;
};

const mockedListLinks = listPublicScholarlyLinksForUser as unknown as ReturnType<typeof vi.fn>;

function mockUserFindOne(user: any) {
  const query = {
    select: vi.fn().mockReturnThis(),
    lean: vi.fn().mockResolvedValue(user),
  };
  mockedUser.findOne.mockReturnValue(query);
  return query;
}

function mockResearchGroupMemberFind(rows: any[]) {
  const query = {
    select: vi.fn().mockReturnThis(),
    lean: vi.fn().mockResolvedValue(rows),
  };
  mockedResearchGroupMember.find.mockReturnValue(query);
  return query;
}

function mockResearchEntityFind(rows: any[]) {
  const query = {
    select: vi.fn().mockReturnThis(),
    lean: vi.fn().mockResolvedValue(rows),
  };
  mockedResearchEntity.find.mockReturnValue(query);
  return query;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('getProfileByNetid scholarly links', () => {
  it('attaches compact scholarly links to public profile payloads', async () => {
    const userId = new mongoose.Types.ObjectId();
    mockUserFindOne({
      _id: userId,
      netid: 'fixture.scholar',
      fname: 'Fixture',
      lname: 'Scholar',
      primaryDepartment: 'Physics',
    });
    mockResearchGroupMemberFind([]);
    mockResearchEntityFind([]);
    mockedListLinks.mockResolvedValue([
      {
        _id: 'link-1',
        title: 'Synthetic oxide interface benchmark',
        url: 'https://example.edu/scholarly-links/synthetic-oxide-benchmark',
        displaySource: 'Fixture Source',
        year: 2024,
      },
    ]);

    const profile = await getProfileByNetid('fixture.scholar');

    expect(mockedListLinks).toHaveBeenCalledWith(userId);
    expect(profile).toMatchObject({
      netid: 'fixture.scholar',
      primary_department: 'Physics',
      scholarlyLinks: [
        {
          title: 'Synthetic oxide interface benchmark',
          url: 'https://example.edu/scholarly-links/synthetic-oxide-benchmark',
          displaySource: 'Fixture Source',
        },
      ],
    });
  });

  it('does not expose legacy profile publications when migrated scholarly links are missing', async () => {
    const userId = new mongoose.Types.ObjectId();
    mockUserFindOne({
      _id: userId,
      netid: 'fixture.legacy',
      fname: 'Fixture',
      lname: 'Legacy',
      primaryDepartment: 'Synthetic Public Health',
      publications: [
        {
          title: 'Estimating synthetic sentinel-clinic visit patterns',
          year: 2025,
          venue: 'Synthetic Epidemiology Reports',
        },
      ],
    });
    mockResearchGroupMemberFind([]);
    mockResearchEntityFind([]);
    mockedListLinks.mockResolvedValue([]);

    const profile = await getProfileByNetid('fixture.legacy');

    expect(profile?.scholarlyLinks).toEqual([]);
  });

  it('surfaces linked research homes when a faculty profile has entity membership', async () => {
    const userId = new mongoose.Types.ObjectId();
    const researchEntityId = new mongoose.Types.ObjectId();
    mockUserFindOne({
      _id: userId,
      netid: 'fixture.member',
      fname: 'Fixture',
      lname: 'Member',
      primaryDepartment: 'Computer Science',
    });
    mockResearchGroupMemberFind([
      {
        researchEntityId,
        role: 'pi',
      },
    ]);
    mockResearchEntityFind([
      {
        _id: researchEntityId,
        slug: 'synthetic-systems-research-home',
        name: 'Synthetic Systems Research Home',
        shortDescription: 'Studies distributed algorithms and population protocols.',
        departments: ['Computer Science'],
        researchAreas: ['Distributed Algorithms'],
      },
    ]);
    mockedListLinks.mockResolvedValue([]);

    const profile = await getProfileByNetid('fixture.member');

    expect(mockedResearchGroupMember.find).toHaveBeenCalledWith({
      userId,
      role: { $in: ['pi', 'co-pi', 'director', 'co-director'] },
      isCurrentMember: { $ne: false },
    });
    expect(profile?.researchEntities).toMatchObject([
      {
        slug: 'synthetic-systems-research-home',
        name: 'Synthetic Systems Research Home',
        shortDescription: 'Studies distributed algorithms and population protocols.',
        role: 'pi',
      },
    ]);
  });
});

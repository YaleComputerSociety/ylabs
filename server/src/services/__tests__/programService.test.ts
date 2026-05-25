import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  find: vi.fn(),
  findOne: vi.fn(),
  countDocuments: vi.fn(),
  distinct: vi.fn(),
}));

vi.mock('../../models/fellowship', () => ({
  Fellowship: {
    find: mocks.find,
    findOne: mocks.findOne,
    countDocuments: mocks.countDocuments,
    distinct: mocks.distinct,
  },
}));

import { getProgramFilterOptions, readProgram, searchPrograms } from '../programService';

const mockFindChain = () => {
  const chain = {
    select: vi.fn(),
    sort: vi.fn(),
    skip: vi.fn(),
    limit: vi.fn(),
    lean: vi.fn(),
  };
  chain.select.mockReturnValue(chain);
  chain.sort.mockReturnValue(chain);
  chain.skip.mockReturnValue(chain);
  chain.limit.mockReturnValue(chain);
  chain.lean.mockResolvedValue([]);
  mocks.find.mockReturnValue(chain);
  return chain;
};

describe('program search service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindChain();
    mocks.findOne.mockResolvedValue({
      toObject: () => ({ _id: '67d8928150621bcef434a1d5', title: 'Visible program' }),
    });
    mocks.countDocuments.mockResolvedValue(0);
    mocks.distinct.mockResolvedValue([]);
  });

  it('filters structured programs by canonical program category', async () => {
    const result = await searchPrograms({
      programCategory: ['CENTER_INTERNSHIP', 'SUMMER_RESEARCH_PROGRAM'],
    });

    expect(result).toMatchObject({
      programs: [],
      total: 0,
      page: 1,
      pageSize: 20,
      totalPages: 0,
    });
    expect(mocks.find).toHaveBeenCalledWith(
      expect.objectContaining({
        archived: false,
        programCategory: { $in: ['CENTER_INTERNSHIP', 'SUMMER_RESEARCH_PROGRAM'] },
      }),
    );
    expect(mocks.countDocuments).toHaveBeenCalledWith(
      expect.objectContaining({
        programCategory: { $in: ['CENTER_INTERNSHIP', 'SUMMER_RESEARCH_PROGRAM'] },
      }),
    );
  });

  it('defaults public program search to student-visible trust tiers', async () => {
    await searchPrograms({});

    expect(mocks.find).toHaveBeenCalledWith(
      expect.objectContaining({
        archived: false,
        studentVisibilityTier: { $in: ['student_ready', 'limited_but_safe'] },
      }),
    );
    expect(mocks.countDocuments).toHaveBeenCalledWith(
      expect.objectContaining({
        studentVisibilityTier: { $in: ['student_ready', 'limited_but_safe'] },
      }),
    );
  });

  it('requires student-visible trust tiers for normal program detail reads', async () => {
    await readProgram('67d8928150621bcef434a1d5');

    expect(mocks.findOne).toHaveBeenCalledWith({
      _id: '67d8928150621bcef434a1d5',
      archived: false,
      studentVisibilityTier: { $in: ['student_ready', 'limited_but_safe'] },
    });
  });

  it('includes program categories in filter options', async () => {
    mocks.distinct.mockResolvedValueOnce(['FELLOWSHIP']);
    mocks.distinct.mockResolvedValueOnce(['Summer']);
    mocks.distinct.mockResolvedValueOnce(['Research']);
    mocks.distinct.mockResolvedValueOnce(['Global']);
    mocks.distinct.mockResolvedValueOnce(['US']);
    mocks.distinct.mockResolvedValueOnce(['CENTER_INTERNSHIP']);
    mocks.distinct.mockResolvedValueOnce(['MENTOR_MATCHING']);
    mocks.distinct.mockResolvedValueOnce(['DIRECT_FACULTY_MATCHING']);
    mocks.distinct.mockResolvedValueOnce(['Structured research program']);

    const options = await getProgramFilterOptions();

    expect(options.programCategory).toEqual(['CENTER_INTERNSHIP']);
    expect(options.programKind).toEqual(['MENTOR_MATCHING']);
    expect(options.entryMode).toEqual(['DIRECT_FACULTY_MATCHING']);
    expect(options.studentFacingCategory).toEqual(['Structured research program']);
    const visibleFilter = {
      archived: false,
      studentVisibilityTier: { $in: ['student_ready', 'limited_but_safe'] },
    };
    expect(mocks.distinct).toHaveBeenCalledWith('programCategory', visibleFilter);
    expect(mocks.distinct).toHaveBeenCalledWith('programKind', visibleFilter);
    expect(mocks.distinct).toHaveBeenCalledWith('entryMode', visibleFilter);
    expect(mocks.distinct).toHaveBeenCalledWith('studentFacingCategory', visibleFilter);
  });
});

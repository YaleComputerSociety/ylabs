import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  find: vi.fn(),
  findOne: vi.fn(),
  findByIdAndUpdate: vi.fn(),
  findOneAndUpdate: vi.fn(),
  countDocuments: vi.fn(),
  distinct: vi.fn(),
}));

vi.mock('../../models/fellowship', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../models/fellowship')>()),
  Fellowship: {
    find: mocks.find,
    findOne: mocks.findOne,
    findByIdAndUpdate: mocks.findByIdAndUpdate,
    findOneAndUpdate: mocks.findOneAndUpdate,
    countDocuments: mocks.countDocuments,
    distinct: mocks.distinct,
  },
}));

import {
  addProgramFavorite,
  getProgramFilterOptions,
  readProgram,
  readPrograms,
  searchPrograms,
} from '../programService';

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
    mocks.findByIdAndUpdate.mockResolvedValue({
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
        studentVisibilityTier: { $in: ['student_ready'] },
      }),
    );
    expect(mocks.countDocuments).toHaveBeenCalledWith(
      expect.objectContaining({
        studentVisibilityTier: { $in: ['student_ready'] },
      }),
    );
  });

  it('does not let normal program searches request review or suppressed tiers', async () => {
    await searchPrograms({
      studentVisibilityTier: ['operator_review', 'suppressed'],
      includeOperatorReview: true,
      includeSuppressed: true,
    });

    expect(mocks.find).toHaveBeenCalledWith(
      expect.objectContaining({
        archived: false,
        studentVisibilityTier: { $in: ['student_ready'] },
      }),
    );
    expect(mocks.countDocuments).toHaveBeenCalledWith(
      expect.objectContaining({
        studentVisibilityTier: { $in: ['student_ready'] },
      }),
    );
  });

  it('normalizes unsafe program search sort fields before building Mongo sort objects', async () => {
    const chain = mockFindChain();

    await searchPrograms({
      sortBy: 'studentVisibilitySuppressionReason',
      sortOrder: 1,
    });

    expect(chain.sort).toHaveBeenCalledWith({ deadline: 1 });
  });

  it('keeps allowed program search sort fields before building Mongo sort objects', async () => {
    const chain = mockFindChain();

    await searchPrograms({
      sortBy: 'deadline',
      sortOrder: 1,
    });

    expect(chain.sort).toHaveBeenCalledWith({ deadline: 1 });
  });

  it('normalizes unsafe program search sort directions before building Mongo sort objects', async () => {
    const chain = mockFindChain();

    await searchPrograms({
      sortBy: 'deadline',
      sortOrder: Number.NaN,
    });

    expect(chain.sort).toHaveBeenCalledWith({ deadline: -1 });
  });

  it('does not stringify arbitrary program ids before detail lookup', async () => {
    await expect(
      readProgram({
        toString: () => {
          throw new Error('program detail stringified an arbitrary id');
        },
      }),
    ).rejects.toThrow('Did not receive expected id type ObjectId');

    expect(mocks.findOne).not.toHaveBeenCalled();
  });

  it('caps bulk program id reads before Mongo fan-out', async () => {
    const ids = Array.from({ length: 100 }, (_, index) =>
      `67d8928150621bcef434a${index.toString(16).padStart(3, '0')}`.slice(0, 24),
    );
    Object.defineProperty(ids, '100', {
      get: () => {
        throw new Error('program bulk read inspected ids beyond the cap');
      },
      enumerable: true,
    });
    mocks.find.mockResolvedValueOnce([
      {
        toObject: () => ({ _id: ids[0], title: 'Visible program' }),
      },
    ]);

    const programs = await readPrograms(ids);

    expect(mocks.find).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: { $in: ids.slice(0, 100) },
        archived: false,
      }),
    );
    expect(programs).toHaveLength(1);
  });

  it('redacts direct contact details in public program service results', async () => {
    const chain = mockFindChain();
    chain.lean.mockResolvedValue([
      {
        _id: '67d8928150621bcef434a1d5',
        title: 'Visible program',
        summary: 'Email prose-contact@yale.edu or call 203-555-1212.',
        description: 'Questions: office@example.edu.',
        prepSteps: ['Email prep-contact@yale.edu or call 203-555-7777.'],
        contactPhone: '203-555-9999',
        contactOffice: 'Office contact: office@example.edu or 203-555-0000.',
        studentVisibilityTier: 'student_ready',
      },
    ]);
    mocks.countDocuments.mockResolvedValue(1);

    const result = await searchPrograms({});

    expect(result.programs[0]).toMatchObject({
      summary: 'Email [email redacted] or call [phone redacted].',
      description: 'Questions: [email redacted].',
      prepSteps: ['Email [email redacted] or call [phone redacted].'],
      contactOffice: 'Office contact: [email redacted] or [phone redacted].',
    });
    expect(result.programs[0].contactPhone).toBeUndefined();
    expect(JSON.stringify(result.programs[0])).not.toContain('prose-contact@yale.edu');
    expect(JSON.stringify(result.programs[0])).not.toContain('prep-contact@yale.edu');
    expect(JSON.stringify(result.programs[0])).not.toContain('office@example.edu');
    expect(JSON.stringify(result.programs[0])).not.toContain('203-555');
  });

  it('caps program search pagination before building Mongo skip and limit', async () => {
    const chain = mockFindChain();

    const result = await searchPrograms({
      page: 999_999_999,
      pageSize: 500,
    });

    expect(chain.skip).toHaveBeenCalledWith(99_900);
    expect(chain.limit).toHaveBeenCalledWith(100);
    expect(result).toMatchObject({
      page: 1000,
      pageSize: 100,
      totalPages: 0,
    });
  });

  it('bounds direct program search query and filters before building Mongo filters', async () => {
    await searchPrograms({
      query: ` ${'q'.repeat(700)} `,
      yearOfStudy: Array.from({ length: 60 }, (_, index) => `Year ${index}`),
      purpose: ['x'.repeat(200)],
    });

    const filter = mocks.find.mock.calls[0][0];
    expect(filter.$text).toEqual({ $search: 'q'.repeat(512) });
    expect(filter.yearOfStudy.$in).toHaveLength(50);
    expect(filter.yearOfStudy.$in).toContain('Year 49');
    expect(filter.yearOfStudy.$in).not.toContain('Year 50');
    expect(filter.purpose.$in).toEqual(['x'.repeat(120)]);
    expect(mocks.countDocuments).toHaveBeenCalledWith(
      expect.objectContaining({
        $text: { $search: 'q'.repeat(512) },
        purpose: { $in: ['x'.repeat(120)] },
      }),
    );
  });

  it('drops non-string direct program filter values and avoids object pagination coercion', async () => {
    const page = { toString: vi.fn(() => '999999999') };
    const pageSize = { toString: vi.fn(() => '500') };
    const badFilter = { toString: vi.fn(() => 'Injected') };

    const result = await searchPrograms({
      page: page as any,
      pageSize: pageSize as any,
      yearOfStudy: [badFilter as any, 'First-year'],
    });

    const filter = mocks.find.mock.calls[0][0];
    expect(page.toString).not.toHaveBeenCalled();
    expect(pageSize.toString).not.toHaveBeenCalled();
    expect(badFilter.toString).not.toHaveBeenCalled();
    expect(filter.yearOfStudy.$in).toEqual(['First-year']);
    expect(result).toMatchObject({
      page: 1,
      pageSize: 20,
    });
  });

  it('strips internal review metadata from public program search results', async () => {
    const chain = mockFindChain();
    chain.lean.mockResolvedValueOnce([
      {
        _id: '67d8928150621bcef434a1d5',
        title: 'Visible program',
        sourceName: 'Yale Office',
        sourceUrl: 'https://example.yale.edu/program',
        sourceKey: 'internal-source-key',
        sourceFingerprint: 'sha256:internal',
        sourceLastVerifiedAt: new Date('2026-01-01T00:00:00Z'),
        sourceLastChangedAt: new Date('2026-01-02T00:00:00Z'),
        studentVisibilityTier: 'student_ready',
        studentVisibilityReasons: ['operator note'],
        studentVisibilityReviewedByUserId: 'operator-user-id',
        archived: false,
        audited: true,
        views: 12,
        favorites: 3,
      },
    ]);

    const result = await searchPrograms({});

    expect(result.programs).toEqual([
      expect.objectContaining({
        _id: '67d8928150621bcef434a1d5',
        title: 'Visible program',
        sourceName: 'Yale Office',
        sourceUrl: 'https://example.yale.edu/program',
      }),
    ]);
    expect(result.programs[0]).not.toHaveProperty('sourceKey');
    expect(result.programs[0]).not.toHaveProperty('sourceFingerprint');
    expect(result.programs[0]).not.toHaveProperty('sourceLastVerifiedAt');
    expect(result.programs[0]).not.toHaveProperty('sourceLastChangedAt');
    expect(result.programs[0]).not.toHaveProperty('studentVisibilityTier');
    expect(result.programs[0]).not.toHaveProperty('studentVisibilityReasons');
    expect(result.programs[0]).not.toHaveProperty('studentVisibilityReviewedByUserId');
    expect(result.programs[0]).not.toHaveProperty('archived');
    expect(result.programs[0]).not.toHaveProperty('audited');
    expect(result.programs[0]).not.toHaveProperty('views');
    expect(result.programs[0]).not.toHaveProperty('favorites');
  });

  it('lets admin program searches inspect operator-review rows', async () => {
    await searchPrograms({
      includeNonPublic: true,
      includeOperatorReview: true,
    });

    expect(mocks.find).toHaveBeenCalledWith(
      expect.objectContaining({
        archived: false,
        studentVisibilityTier: { $in: ['student_ready', 'operator_review'] },
      }),
    );
  });

  it('lets admin program searches inspect suppressed rows', async () => {
    await searchPrograms({
      includeNonPublic: true,
      studentVisibilityTier: ['suppressed'],
    });

    expect(mocks.find).toHaveBeenCalledWith(
      expect.objectContaining({
        archived: false,
        studentVisibilityTier: { $in: ['suppressed'] },
      }),
    );
  });

  it('requires student-visible trust tiers for normal program detail reads', async () => {
    await readProgram('67d8928150621bcef434a1d5');

    expect(mocks.findOne).toHaveBeenCalledWith({
      _id: '67d8928150621bcef434a1d5',
      archived: false,
      studentVisibilityTier: { $in: ['student_ready'] },
    });
  });

  it('strips internal review metadata from public program detail reads', async () => {
    mocks.findOne.mockResolvedValueOnce({
      toObject: () => ({
        _id: '67d8928150621bcef434a1d5',
        title: 'Visible program',
        sourceName: 'Yale Office',
        sourceUrl: 'https://example.yale.edu/program',
        sourceKey: 'internal-source-key',
        sourceFingerprint: 'sha256:internal',
        sourceLastVerifiedAt: new Date('2026-01-01T00:00:00Z'),
        sourceLastChangedAt: new Date('2026-01-02T00:00:00Z'),
        studentVisibilityTier: 'student_ready',
        studentVisibilityReasons: ['operator note'],
        studentVisibilityReviewedByUserId: 'operator-user-id',
        archived: false,
        audited: true,
        views: 12,
        favorites: 3,
      }),
    });

    const program = await readProgram('67d8928150621bcef434a1d5');

    expect(program).toEqual(
      expect.objectContaining({
        _id: '67d8928150621bcef434a1d5',
        title: 'Visible program',
        sourceName: 'Yale Office',
        sourceUrl: 'https://example.yale.edu/program',
      }),
    );
    expect(program).not.toHaveProperty('sourceKey');
    expect(program).not.toHaveProperty('sourceFingerprint');
    expect(program).not.toHaveProperty('sourceLastVerifiedAt');
    expect(program).not.toHaveProperty('sourceLastChangedAt');
    expect(program).not.toHaveProperty('studentVisibilityTier');
    expect(program).not.toHaveProperty('studentVisibilityReasons');
    expect(program).not.toHaveProperty('studentVisibilityReviewedByUserId');
    expect(program).not.toHaveProperty('archived');
    expect(program).not.toHaveProperty('audited');
    expect(program).not.toHaveProperty('views');
    expect(program).not.toHaveProperty('favorites');
  });

  it('strips internal review metadata from public program favorite responses', async () => {
    mocks.findOneAndUpdate.mockResolvedValueOnce({
      toObject: () => ({
        _id: '67d8928150621bcef434a1d5',
        title: 'Visible program',
        sourceName: 'Yale Office',
        sourceUrl: 'https://example.yale.edu/program',
        sourceKey: 'internal-source-key',
        sourceFingerprint: 'sha256:internal',
        studentVisibilityTier: 'student_ready',
        studentVisibilityReviewedByUserId: 'operator-user-id',
        archived: false,
        audited: true,
        views: 12,
        favorites: 4,
      }),
    });

    const program = await addProgramFavorite('67d8928150621bcef434a1d5');

    expect(program).toEqual(
      expect.objectContaining({
        _id: '67d8928150621bcef434a1d5',
        title: 'Visible program',
        sourceName: 'Yale Office',
        sourceUrl: 'https://example.yale.edu/program',
      }),
    );
    expect(program).not.toHaveProperty('sourceKey');
    expect(program).not.toHaveProperty('sourceFingerprint');
    expect(program).not.toHaveProperty('studentVisibilityTier');
    expect(program).not.toHaveProperty('studentVisibilityReviewedByUserId');
    expect(program).not.toHaveProperty('archived');
    expect(program).not.toHaveProperty('audited');
    expect(program).not.toHaveProperty('views');
    expect(program).not.toHaveProperty('favorites');
  });

  it('does not stringify arbitrary program ids before favorite mutations', async () => {
    await expect(
      addProgramFavorite({
        toString: () => {
          throw new Error('program favorite stringified an arbitrary id');
        },
      }),
    ).rejects.toThrow('Did not receive expected id type ObjectId');

    expect(mocks.findByIdAndUpdate).not.toHaveBeenCalled();
    expect(mocks.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('lets admin program detail reads inspect review or suppressed records', async () => {
    mocks.findOne.mockResolvedValueOnce({
      toObject: () => ({
        _id: '67d8928150621bcef434a1d5',
        title: 'Visible program',
        sourceKey: 'internal-source-key',
        studentVisibilityTier: 'operator_review',
        views: 12,
      }),
    });

    const program = await readProgram('67d8928150621bcef434a1d5', { includeNonPublic: true });

    expect(mocks.findOne).toHaveBeenCalledWith({
      _id: '67d8928150621bcef434a1d5',
      archived: false,
    });
    expect(program).toMatchObject({
      sourceKey: 'internal-source-key',
      studentVisibilityTier: 'operator_review',
      views: 12,
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
      studentVisibilityTier: { $in: ['student_ready'] },
    };
    expect(mocks.distinct).toHaveBeenCalledWith('programCategory', visibleFilter);
    expect(mocks.distinct).toHaveBeenCalledWith('programKind', visibleFilter);
    expect(mocks.distinct).toHaveBeenCalledWith('entryMode', visibleFilter);
    expect(mocks.distinct).toHaveBeenCalledWith('studentFacingCategory', visibleFilter);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  searchPrograms: vi.fn(),
}));

vi.mock('../../services/programService', () => ({
  searchPrograms: mocks.searchPrograms,
  getProgramFilterOptions: vi.fn(),
  readProgram: vi.fn(),
  addProgramView: vi.fn(),
  addProgramFavorite: vi.fn(),
  removeProgramFavorite: vi.fn(),
}));

import { searchProgramsController } from '../programController';

const response = () => {
  const res = {
    json: vi.fn(),
    status: vi.fn(),
  };
  res.status.mockReturnValue(res);
  return res;
};

describe('programController search visibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.searchPrograms.mockResolvedValue({
      programs: [],
      total: 0,
      page: 1,
      pageSize: 20,
      totalPages: 0,
    });
  });

  it('does not pass nonpublic visibility filters for normal student searches', async () => {
    const res = response();

    await searchProgramsController(
      {
        query: {
          studentVisibilityTier: 'operator_review,suppressed',
          includeOperatorReview: 'true',
          includeSuppressed: 'true',
        },
        user: { userType: 'student' },
      } as any,
      res as any,
    );

    expect(mocks.searchPrograms).toHaveBeenCalledWith(
      expect.objectContaining({
        includeNonPublic: false,
        studentVisibilityTier: [],
        includeOperatorReview: false,
        includeSuppressed: false,
      }),
    );
  });

  it('passes admin visibility filters for review and suppressed program inspection', async () => {
    const res = response();

    await searchProgramsController(
      {
        query: {
          studentVisibilityTier: 'operator_review|suppressed',
          includeOperatorReview: 'true',
          includeSuppressed: 'true',
        },
        user: { userType: 'admin' },
      } as any,
      res as any,
    );

    expect(mocks.searchPrograms).toHaveBeenCalledWith(
      expect.objectContaining({
        includeNonPublic: true,
        studentVisibilityTier: ['operator_review', 'suppressed'],
        includeOperatorReview: true,
        includeSuppressed: true,
      }),
    );
  });
});

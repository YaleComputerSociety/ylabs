import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  searchPrograms: vi.fn(),
}));

vi.mock('../../services/programService', () => ({
  searchPrograms: mocks.searchPrograms,
  readProgram: vi.fn(),
  getProgramFilterOptions: vi.fn(),
  addProgramView: vi.fn(),
  addProgramFavorite: vi.fn(),
  removeProgramFavorite: vi.fn(),
}));

import { searchProgramsController } from '../programController';

describe('searchProgramsController', () => {
  it('passes canonical student-facing program filters through to the service', async () => {
    mocks.searchPrograms.mockResolvedValue({
      programs: [],
      total: 0,
      page: 1,
      pageSize: 20,
      totalPages: 0,
    });
    const json = vi.fn();
    const response = { json, status: vi.fn().mockReturnThis() };

    await searchProgramsController(
      {
        query: {
          programKind: 'MENTOR_MATCHING|STRUCTURED_PROGRAM',
          entryMode: 'DIRECT_FACULTY_MATCHING',
          studentFacingCategory: 'Mentored summer program',
        },
        user: undefined,
      } as any,
      response as any,
    );

    expect(mocks.searchPrograms).toHaveBeenCalledWith(
      expect.objectContaining({
        programKind: ['MENTOR_MATCHING', 'STRUCTURED_PROGRAM'],
        entryMode: ['DIRECT_FACULTY_MATCHING'],
        studentFacingCategory: ['Mentored summer program'],
      }),
    );
    expect(json).toHaveBeenCalledWith({
      results: [],
      total: 0,
      page: 1,
      pageSize: 20,
      totalPages: 0,
    });
  });
});

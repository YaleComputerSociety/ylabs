import { describe, expect, it, vi } from 'vitest';

const fellowshipModelMock = vi.hoisted(() => ({
  distinct: vi.fn(),
}));

vi.mock('../../models/fellowship', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../models/fellowship')>()),
  Fellowship: fellowshipModelMock,
}));

import { getFilterOptions } from '../fellowshipService';
import { orderYearOfStudyOptions } from '../programYearOfStudyOrder';

const STORED_ALPHABETICAL = [
  'Alumni',
  'First-Year Student',
  'Grad/Prof Year1',
  'Grad/Prof Year2',
  'Grad/Prof Year3',
  'Grad/Prof Year4',
  'Graduate Pre-Candidacy',
  'JD',
  'Junior',
  'MD',
  'Master’s Student',
  'PhD Post-Candidacy',
  'PhD Pre-Candidacy',
  'Senior',
  'Sophomore',
];

const ACADEMIC_PROGRESSION = [
  'First-Year Student',
  'Sophomore',
  'Junior',
  'Senior',
  'Master’s Student',
  'Grad/Prof Year1',
  'Grad/Prof Year2',
  'Grad/Prof Year3',
  'Grad/Prof Year4',
  'Graduate Pre-Candidacy',
  'PhD Pre-Candidacy',
  'PhD Post-Candidacy',
  'JD',
  'MD',
  'Alumni',
];

describe('program year of study order', () => {
  it('orders every stored year of study by academic progression', () => {
    expect(orderYearOfStudyOptions(STORED_ALPHABETICAL)).toEqual(ACADEMIC_PROGRESSION);
  });

  it('keeps undergraduate years ahead of every graduate level', () => {
    const ordered = orderYearOfStudyOptions(['Grad/Prof Year1', 'Senior', 'Alumni', 'Sophomore']);
    expect(ordered).toEqual(['Sophomore', 'Senior', 'Grad/Prof Year1', 'Alumni']);
  });

  it('places a year the progression does not know after the known ones, alphabetically', () => {
    expect(orderYearOfStudyOptions(['Visiting Scholar', 'Junior', 'Postdoc', 'Alumni'])).toEqual([
      'Junior',
      'Alumni',
      'Postdoc',
      'Visiting Scholar',
    ]);
  });

  it('serves the Year filter options in progression order', async () => {
    fellowshipModelMock.distinct.mockImplementation(async (field: string) =>
      field === 'yearOfStudy' ? [...STORED_ALPHABETICAL, ''] : [],
    );

    const options = await getFilterOptions();

    expect(options.yearOfStudy).toEqual(ACADEMIC_PROGRESSION);
  });
});

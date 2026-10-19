import { describe, expect, it } from 'vitest';

import { ALL_UNDERGRADUATE_YEARS_LABEL, yearOfStudyChipLabels } from '../programYearOfStudyChips';

describe('yearOfStudyChipLabels', () => {
  it('folds every undergraduate year into one chip ahead of graduate levels', () => {
    expect(
      yearOfStudyChipLabels([
        'Senior',
        'Grad/Prof Year1',
        'First-Year Student',
        'Junior',
        'Sophomore',
      ]),
    ).toEqual([ALL_UNDERGRADUATE_YEARS_LABEL, 'Grad/Prof Year1']);
  });

  it('orders a partial set of years by academic progression', () => {
    expect(yearOfStudyChipLabels(['Senior', 'Alumni', 'Junior'])).toEqual([
      'Junior',
      'Senior',
      'Alumni',
    ]);
  });

  it('puts unknown values after known ones', () => {
    expect(yearOfStudyChipLabels(['Visiting Student', 'Sophomore'])).toEqual([
      'Sophomore',
      'Visiting Student',
    ]);
  });
});

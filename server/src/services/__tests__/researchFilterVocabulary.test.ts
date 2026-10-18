import { describe, expect, it } from 'vitest';

import {
  resolveStudentFilterValues,
  type ResearchFilterVocabulary,
} from '../researchFilterVocabulary';

const vocabulary: ResearchFilterVocabulary = {
  school: new Map([['school of the environment', 'School of the Environment']]),
  departments: new Map([
    ['chemistry', 'Chemistry'],
    ['earth & planetary sciences', 'Earth & Planetary Sciences'],
  ]),
};

describe('resolveStudentFilterValues', () => {
  it('leaves filters the corpus already spells that way untouched and reports nothing', () => {
    const filters = { school: ['School of the Environment'], departments: ['Chemistry'] };

    expect(resolveStudentFilterValues(filters, vocabulary)).toEqual({ filters });
  });

  it('maps a value to the spelling the corpus holds', () => {
    expect(resolveStudentFilterValues({ departments: ['  chemistry '] }, vocabulary)).toEqual({
      filters: { departments: ['Chemistry'] },
      applied: { departments: ['Chemistry'] },
    });
  });

  it('drops a value no row holds, keeping the other filters', () => {
    expect(
      resolveStudentFilterValues(
        {
          school: ['Synthetic Nowhere School'],
          departments: ['Chemistry'],
          entityType: ['LAB'],
          hostsUndergrads: true,
        },
        vocabulary,
      ),
    ).toEqual({
      filters: {
        school: undefined,
        departments: ['Chemistry'],
        entityType: ['LAB'],
        hostsUndergrads: true,
      },
      applied: { school: [], departments: ['Chemistry'] },
    });
  });

  it('applies the filters unchanged when the vocabulary could not be read', () => {
    const filters = { school: ['Synthetic Nowhere School'] };

    expect(resolveStudentFilterValues(filters, null)).toEqual({ filters });
  });
});

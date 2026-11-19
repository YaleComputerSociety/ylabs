import { describe, expect, it } from 'vitest';

import {
  programSearchUrlStatesDifferOnlyInQuery,
  readProgramSearchUrlState,
  writeProgramSearchUrlState,
} from '../programSearchUrlState';

const SORTABLE_KEYS = ['default', 'deadline', 'title'];

describe('programSearchUrlState', () => {
  it('round-trips the search, quick filter, filters, and a chosen sort', () => {
    const params = new URLSearchParams(
      'q=history&quick=noMentorFirst&subject=Biology&region=Asia&sort=deadline&dir=asc&program=p1',
    );
    const state = readProgramSearchUrlState(params, SORTABLE_KEYS);

    expect(state).toMatchObject({
      queryString: 'history',
      quickFilter: 'noMentorFirst',
      selectedSubjects: ['Biology'],
      selectedRegions: ['Asia'],
      sortBy: 'deadline',
      sortDirection: 'asc',
    });
    expect(writeProgramSearchUrlState(new URLSearchParams('program=p1'), state).toString()).toBe(
      'program=p1&q=history&quick=noMentorFirst&subject=Biology&region=Asia&sort=deadline&dir=asc',
    );
  });

  it('drops an unknown sort and keeps the default sort out of the URL', () => {
    const state = readProgramSearchUrlState(new URLSearchParams('sort=popularity'), SORTABLE_KEYS);

    expect(state.sortBy).toBe('default');
    expect(writeProgramSearchUrlState(new URLSearchParams(), state).toString()).toBe('');
  });

  it('treats a typed query as a replaceable change and a filter as a new history entry', () => {
    const before = readProgramSearchUrlState(new URLSearchParams('q=eco'), SORTABLE_KEYS);
    const typed = { ...before, queryString: 'econ' };
    const filtered = { ...before, selectedTermOfAward: ['Summer'] };

    expect(programSearchUrlStatesDifferOnlyInQuery(before, typed)).toBe(true);
    expect(programSearchUrlStatesDifferOnlyInQuery(before, filtered)).toBe(false);
  });
});

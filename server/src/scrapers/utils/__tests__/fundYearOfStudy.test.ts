import { describe, expect, it } from 'vitest';
import { resolveFundYearOfStudy } from '../fundYearOfStudy';

const read = (text: string, filter: string[] = []) =>
  resolveFundYearOfStudy([{ text, isEligibilitySection: true }], filter);

describe('resolveFundYearOfStudy phrasing shapes', () => {
  it('reads a trailing relative clause as a condition on the students, not an exclusion of the years', () => {
    expect(
      read(
        'Eligible are Yale first-year students, sophomores, juniors, and seniors who are not Examplian nationals.',
      ),
    ).toEqual({ kind: 'prose', values: ['First-Year Student', 'Sophomore', 'Junior', 'Senior'] });
  });

  it('maps an ordinal undergraduate year to its class year', () => {
    expect(read('Open to third year undergraduate students only.')).toEqual({
      kind: 'prose',
      values: ['Junior'],
    });
    expect(read('Open to second-year undergraduates.')).toEqual({
      kind: 'prose',
      values: ['Sophomore'],
    });
    expect(read('Open to fourth year undergraduate students.')).toEqual({
      kind: 'prose',
      values: ['Senior'],
    });
  });

  it('reads a doctoral first year as a doctoral student, not an undergraduate first year', () => {
    expect(read('Open to graduating seniors or current first-year doctoral students.')).toEqual({
      kind: 'prose',
      values: ['Senior', 'PhD Pre-Candidacy', 'PhD Post-Candidacy'],
    });
  });

  it('reads college beside graduate and law as the undergraduate level', () => {
    expect(read('The award is open to college, graduate, and law students.')).toEqual({
      kind: 'prose',
      values: [
        'First-Year Student',
        'Sophomore',
        'Junior',
        'Senior',
        'Master’s Student',
        'PhD Pre-Candidacy',
        'PhD Post-Candidacy',
        'JD',
      ],
    });
  });

  it('still reads a negated predicate that follows the years as an exclusion', () => {
    expect(read('Open to all undergraduates. Seniors are not eligible.')).toEqual({
      kind: 'prose',
      values: ['First-Year Student', 'Sophomore', 'Junior'],
    });
  });

  it('still reads a bare first-year student as an undergraduate first year', () => {
    expect(read('Open to first-year students only.')).toEqual({
      kind: 'prose',
      values: ['First-Year Student'],
    });
  });
});

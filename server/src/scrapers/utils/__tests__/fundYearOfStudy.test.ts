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

  it('still reads a negated predicate that follows a relative clause as an exclusion', () => {
    expect(
      read(
        'Open to all undergraduates. Seniors who have previously received the award are not eligible.',
      ),
    ).toEqual({
      kind: 'prose',
      values: ['First-Year Student', 'Sophomore', 'Junior', 'Senior'],
    });
  });

  it('still reads a bare first-year student as an undergraduate first year', () => {
    expect(read('Open to first-year students only.')).toEqual({
      kind: 'prose',
      values: ['First-Year Student'],
    });
  });
});

describe('resolveFundYearOfStudy reads a level quantified by "at any level" as the whole level (#5121)', () => {
  const nonEligibility = (text: string, filter: string[]) =>
    resolveFundYearOfStudy([{ text, isEligibilitySection: false }], filter);
  const listedFilter = ['First-Year Student', 'Sophomore', 'Junior', 'Master’s Student'];

  it('admits every undergraduate year when the prose funds undergraduates at any level', () => {
    expect(
      nonEligibility(
        'The program invites applications from graduate and undergraduate students. Funds are available for senior essay support for undergraduates, and for travel fellowships for undergraduates at any level.',
        listedFilter,
      ),
    ).toEqual({
      kind: 'prose',
      values: ['First-Year Student', 'Sophomore', 'Junior', 'Senior', 'Master’s Student'],
    });
  });

  it('does not read a senior essay as an unread year that keeps a level incomplete', () => {
    expect(
      nonEligibility(
        'Applications from any undergraduate students are welcome, including those writing a senior essay.',
        ['Junior'],
      ),
    ).toEqual(
      nonEligibility('Applications from any undergraduate students are welcome.', ['Junior']),
    );
  });

  it('keeps refining an unquantified level by the listing filter', () => {
    expect(
      nonEligibility('The program invites applications from undergraduate students.', [
        'Sophomore',
        'Junior',
      ]),
    ).toEqual({ kind: 'prose', values: ['Sophomore', 'Junior'] });
  });
});

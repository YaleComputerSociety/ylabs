import { describe, expect, it } from 'vitest';
import { isTraineeLevelTitle } from '../traineeLevelTitle';
import { isTraineeLevelTitle as clientIsTraineeLevelTitle } from '../../../../client/src/utils/leadRoleDisplay';

/**
 * The cases both copies must agree on. Parity is pinned by behaviour rather than by
 * sharing a file, because client and server are separate packages (#2433).
 */
const PARITY_CASES = [
  'Postdoctoral Associate',
  'Postdoctoral Fellow',
  'Postdoctoral Scholar',
  'Post-doctoral Associate',
  'Postdoc',
  'Research Assistant',
  'Research Assistant, YSPH',
  'Research Assistant 2 HSS',
  'Research Assistant Professor',
  'Postdoctoral Associate & Lecturer',
  'Postdoctoral Associate and Director of Graduate Studies',
  'Professor of Economics',
  'Senior Lecturer',
  'Ph.D. Student',
  'PhD Student',
  'Doctoral Candidate',
  'Graduate Student',
  'Undergraduate Student',
  'Masters Student',
  'Economic Research Intern',
  'Pre-Doctoral Fellow',
  'International Student Adviser',
  'Research\nAssistant',
  'Research  Assistant',
  'Assistant Professor',
  'Student',
  'MA Student',
  'IDE Student',
  'Graduate School Student',
  'IDE Alumni',
  'African Studies MA Student and Lindsay Fellow',
  'Assis­tant Pro­fes­sor of Eco­nom­ics',
  '',
  '   ',
];

describe('isTraineeLevelTitle', () => {
  it('treats a bare postdoc or research assistant as unable to host', () => {
    expect(isTraineeLevelTitle('Postdoctoral Associate')).toBe(true);
    expect(isTraineeLevelTitle('Postdoctoral Fellow')).toBe(true);
    expect(isTraineeLevelTitle('Post-doc')).toBe(true);
    expect(isTraineeLevelTitle('Research Assistant, YSPH')).toBe(true);
  });

  it('exempts a supervisory title alongside the trainee one', () => {
    expect(isTraineeLevelTitle('Research Assistant Professor')).toBe(false);
    expect(isTraineeLevelTitle('Postdoctoral Associate & Lecturer')).toBe(false);
    expect(isTraineeLevelTitle('Postdoctoral Associate and Director of Graduate Studies')).toBe(
      false,
    );
  });

  it('treats a student, candidate or intern as unable to host, a fortiori', () => {
    expect(isTraineeLevelTitle('Ph.D. Student')).toBe(true);
    expect(isTraineeLevelTitle('PhD Student')).toBe(true);
    expect(isTraineeLevelTitle('Doctoral Candidate')).toBe(true);
    expect(isTraineeLevelTitle('Graduate Student')).toBe(true);
    expect(isTraineeLevelTitle('Undergraduate Student')).toBe(true);
    expect(isTraineeLevelTitle('Economic Research Intern')).toBe(true);
    expect(isTraineeLevelTitle('Pre-Doctoral Fellow')).toBe(true);
  });

  it('says nothing about a title that names no trainee rank', () => {
    expect(isTraineeLevelTitle('Professor of Economics')).toBe(false);
    expect(isTraineeLevelTitle('Senior Research Scientist')).toBe(false);
    expect(isTraineeLevelTitle('Research Economist')).toBe(false);
    expect(isTraineeLevelTitle('')).toBe(false);
    expect(isTraineeLevelTitle(undefined)).toBe(false);
  });

  it('reads a title the same way however its internal whitespace is stored', () => {
    expect(isTraineeLevelTitle('Research\nAssistant')).toBe(true);
    expect(isTraineeLevelTitle('Research  Assistant')).toBe(true);
  });

  it('does not fire on a supervisory role that merely mentions students', () => {
    expect(isTraineeLevelTitle('Director of Graduate Studies')).toBe(false);
    expect(isTraineeLevelTitle('Dean of Undergraduate Education')).toBe(false);
  });

  it('reads a student rank that carries no degree qualifier', () => {
    expect(isTraineeLevelTitle('Student')).toBe(true);
    expect(isTraineeLevelTitle('MA Student')).toBe(true);
    expect(isTraineeLevelTitle('IDE Student')).toBe(true);
    expect(isTraineeLevelTitle('Graduate School Student')).toBe(true);
    expect(isTraineeLevelTitle('African Studies MA Student and Lindsay Fellow')).toBe(true);
  });

  it('reads a programme alumnus as holding no appointment that can host', () => {
    expect(isTraineeLevelTitle('IDE Alumni')).toBe(true);
    expect(isTraineeLevelTitle('IDE Alumnus')).toBe(true);
  });

  it('keeps a student noun used as a modifier out of the rank read', () => {
    expect(isTraineeLevelTitle('International Student Adviser')).toBe(false);
    expect(isTraineeLevelTitle('Student Affairs Coordinator')).toBe(false);
  });

  it('reads a title through the soft hyphens a Yale profile stores inside its words', () => {
    expect(isTraineeLevelTitle('Assis­tant Pro­fes­sor of Eco­nom­ics')).toBe(
      false,
    );
    expect(isTraineeLevelTitle('IDE Stu­dent')).toBe(true);
  });

  it('agrees with the client copy on every pinned case', () => {
    for (const title of PARITY_CASES) {
      expect(isTraineeLevelTitle(title), `disagreed on "${title}"`).toBe(
        clientIsTraineeLevelTitle(title),
      );
    }
  });
});

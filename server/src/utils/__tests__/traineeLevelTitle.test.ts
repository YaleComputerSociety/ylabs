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

  it('agrees with the client copy on every pinned case', () => {
    for (const title of PARITY_CASES) {
      expect(isTraineeLevelTitle(title), `disagreed on "${title}"`).toBe(
        clientIsTraineeLevelTitle(title),
      );
    }
  });
});

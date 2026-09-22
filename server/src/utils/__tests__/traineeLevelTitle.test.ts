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

  it('says nothing about a title that names no trainee rank', () => {
    expect(isTraineeLevelTitle('Professor of Economics')).toBe(false);
    expect(isTraineeLevelTitle('Ph.D. Student')).toBe(false);
    expect(isTraineeLevelTitle('')).toBe(false);
    expect(isTraineeLevelTitle(undefined)).toBe(false);
  });

  it('agrees with the client copy on every pinned case', () => {
    for (const title of PARITY_CASES) {
      expect(isTraineeLevelTitle(title), `disagreed on "${title}"`).toBe(
        clientIsTraineeLevelTitle(title),
      );
    }
  });
});

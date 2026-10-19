import { describe, expect, it } from 'vitest';

import { personInitials } from '../personInitials';

describe('personInitials', () => {
  it('takes the first and last name tokens and skips a middle initial', () => {
    expect(personInitials('Ada R. Fixture')).toBe('AF');
  });

  it('keeps a hyphenated given name as one token', () => {
    expect(personInitials('Mary-Ann Fixture')).toBe('MF');
  });

  it('skips a trailing suffix and a parenthetical', () => {
    expect(personInitials('Ada Fixture Jr.')).toBe('AF');
    expect(personInitials('Ada (Addie) Q. Fixture, PhD')).toBe('AF');
  });

  it('skips a credential written with internal periods', () => {
    expect(personInitials('Ada Fixture, M.D.')).toBe('AF');
    expect(personInitials('Ada Fixture, Ph.D.')).toBe('AF');
  });

  it('uses one letter for a single-token name and none for an empty one', () => {
    expect(personInitials('Fixture')).toBe('F');
    expect(personInitials('   ')).toBe('');
  });
});

import { describe, expect, it } from 'vitest';
import { GRANT_SHELL_KIND, grantShellResearchRecordName } from '../grantShellIdentity';
import { mapResearchGroupKindToEntityType } from '../../../models/researchAccessTypes';

describe('a grant lane never asserts a lab it has no evidence for (#3145)', () => {
  it('names a funded person after the person as a faculty research record', () => {
    expect(grantShellResearchRecordName('Jordan Avery', 'NIH PI nih-pi-jordan-avery')).toBe(
      'Jordan Avery Faculty Research',
    );
    expect(grantShellResearchRecordName('Perry Lowell Smith', 'fallback')).toBe(
      'Perry Lowell Smith Faculty Research',
    );
  });

  it('never derives a name ending in Lab or Laboratory', () => {
    for (const personName of ['Jordan Avery', 'Perry Lowell Smith', "Maria O'Hern"]) {
      expect(grantShellResearchRecordName(personName, 'fallback')).not.toMatch(
        /\b(Lab|Laboratory)$/,
      );
    }
  });

  it('falls back rather than inventing a name from something that is not a person name', () => {
    expect(grantShellResearchRecordName('', 'NSF PI nsf-pi-000')).toBe('NSF PI nsf-pi-000');
    expect(grantShellResearchRecordName('Avery', 'NSF PI nsf-pi-000')).toBe('NSF PI nsf-pi-000');
    expect(grantShellResearchRecordName('Jordan Avery Lab', 'NSF PI nsf-pi-000')).toBe(
      'NSF PI nsf-pi-000',
    );
  });

  it('types the shell as the first-class person-scoped type, not a lab', () => {
    expect(GRANT_SHELL_KIND).toBe('individual');
    expect(mapResearchGroupKindToEntityType(GRANT_SHELL_KIND)).toBe('FACULTY_RESEARCH_AREA');
  });
});

import { describe, expect, it } from 'vitest';
import { statedAdministeringOffice } from '../administeringOffice';

const officeIn = (...sections: string[]) => statedAdministeringOffice(sections);

describe('the administering office a program page states (#4589)', () => {
  it('reads the office from an explicit administering statement', () => {
    expect(officeIn('This fellowship is administered by the Office of Fixture Fellowships.')).toBe(
      'Office of Fixture Fellowships',
    );
    expect(
      officeIn('Funds are administered by the Fixture Studies Council at the Fixture Center.'),
    ).toBe('Fixture Studies Council at the Fixture Center');
    expect(
      officeIn(
        'The Fixture Award, from the endowments of Fixture College, is administered by the the Office of Fixture Fellowships to support summer internships.',
      ),
    ).toBe('Office of Fixture Fellowships');
    expect(
      officeIn('The campus nomination process is coordinated by the Office of Fixtures.'),
    ).toBe('Office of Fixtures');
    expect(
      officeIn('Administered by the Council of Fixture Heads, the Fixture Awards support plays.'),
    ).toBe('Council of Fixture Heads');
  });

  it('reads the office that opens a sentence inviting applications', () => {
    expect(
      officeIn(
        'The Fixture Council on Regional Studies invites applications for the Fixture Prize.',
      ),
    ).toBe('Fixture Council on Regional Studies');
    expect(
      officeIn(
        'The Fixture Program for the Study of Examples (FPSE) invites applications for a grant.',
      ),
    ).toBe('Fixture Program for the Study of Examples');
    expect(
      officeIn('Fixture Law School is pleased to invite applications for the fellowship.'),
    ).toBe('Fixture Law School');
  });

  it('keeps a name joined by ", at" whole', () => {
    expect(
      officeIn(
        'The nomination process is coordinated through Fellowship Programs, at the Fixture Center for Professional Experience.',
      ),
    ).toBe('Fellowship Programs at the Fixture Center for Professional Experience');
  });

  it('never reads a person, a contact address or a staff title as the office', () => {
    expect(officeIn('This fellowship is administered by Pat Fixture.')).toBeUndefined();
    expect(officeIn('This fellowship is administered by Director Pat Fixture of the Office.')).toBe(
      undefined,
    );
    expect(officeIn('This fellowship is administered by fixture.office@example.org.')).toBe(
      undefined,
    );
    expect(officeIn('This grant is administered by Professor Pat Fixture.')).toBeUndefined();
    expect(
      officeIn('This grant is administered by Pat Fixture in the Office of Fixture Fellowships.'),
    ).toBeUndefined();
    expect(officeIn('This grant is administered by Pat Fixture at the Fixture Center.')).toBe(
      undefined,
    );
  });

  it('refuses an outside funder and a statement about other programs', () => {
    expect(
      officeIn('The Fixture Scholarships are administered by the Fixture Trust for study abroad.'),
    ).toBeUndefined();
    expect(
      officeIn(
        'You may only submit one proposal for summer fellowships administered by the Office of Fixture Fellowships.',
      ),
    ).toBeUndefined();
    expect(officeIn('Students traveling with Fixture-administered funds must register.')).toBe(
      undefined,
    );
  });

  it('reads a lower-case or truncated name as no office', () => {
    expect(
      officeIn('The Fixture School of Global affairs invites applications for the grant.'),
    ).toBe(undefined);
  });

  it('reads one office named two ways as one, and two different offices as neither', () => {
    expect(
      officeIn(
        'The Whitney Fixture Center for Area Studies invites applications for summer study.',
        'The Fixture Center is accepting applications for virtual programs.',
      ),
    ).toBe('Whitney Fixture Center for Area Studies');
    expect(
      officeIn(
        'The Council on Fixture Studies invites applications for the prize.',
        'The Fixture Studies Council invites applications for the prize.',
      ),
    ).toBe('Council on Fixture Studies');
    expect(
      officeIn(
        'This fellowship is administered by the Office of Fixture Fellowships.',
        'Funds are administered by the Fixture Studies Council.',
      ),
    ).toBeUndefined();
  });

  it('is silent when no sentence states who administers the program', () => {
    expect(officeIn('Recipients must submit a report to the Fixture College Office.')).toBe(
      undefined,
    );
  });
});

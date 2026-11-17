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

  it('reads the office whose named application system applications go through', () => {
    expect(
      officeIn(
        'Applications for this fellowship will be accepted via the Office of Fellowships Summer Research Common Application.',
      ),
    ).toBe('Office of Fellowships');
    expect(
      officeIn(
        'Application for this fellowship is via the Fixture Center Summer Travel Fellowships Common Application.',
      ),
    ).toBe('Fixture Center');
    expect(
      officeIn('Note: application to this competition is via the Department of Fixtures website.'),
    ).toBe('Department of Fixtures');
  });

  it('reads the whole multi-word office name a website route names', () => {
    expect(
      officeIn('Application to this competition is via the Department of Fixture Science website.'),
    ).toBe('Department of Fixture Science');
    expect(
      officeIn('Applications are submitted via the Council on Fixture Regional Studies portal.'),
    ).toBe('Council on Fixture Regional Studies');
    expect(
      officeIn('Application is via the Center for Fixture and Professional Experience website.'),
    ).toBe('Center for Fixture and Professional Experience');
  });

  it('reads awarded through, accepts applications, pleased to award and submit to an office', () => {
    expect(
      officeIn('The Fixture Travel Grant is awarded through Fixture Center and supports study.'),
    ).toBe('Fixture Center');
    expect(officeIn('The Fixture Center accepts applications from Yale students.')).toBe(
      'Fixture Center',
    );
    expect(
      officeIn('The Fixture Program in Science is pleased to award the Fixture Fellowship.'),
    ).toBe('Fixture Program in Science');
    expect(
      officeIn(
        'Please attach a one-page proposal and submit to the Head of College Office by May 1.',
      ),
    ).toBe('Head of College Office');
  });

  it('states no office for a bare system, a negated route, or a report owed to an office', () => {
    expect(
      officeIn('Applications should be submitted through the Yale Student Grants Database.'),
    ).toBeUndefined();
    expect(
      officeIn('Applications for this fellowship cannot be submitted via this database.'),
    ).toBeUndefined();
    expect(
      officeIn(
        'Applications are not accepted via the Office of Fixture Fellowships Common Application.',
      ),
    ).toBeUndefined();
    expect(
      officeIn(
        "Recipients must submit a summary report on their fellowship to the Fixture Head of College's Office.",
      ),
    ).toBeUndefined();
    expect(
      officeIn('Some fellowships may be found via the Student Grants Database.'),
    ).toBeUndefined();
  });

  it('still states none when the route and another sentence name two different offices', () => {
    expect(
      officeIn(
        'Applications will be accepted via the Office of Fixture Fellowships Common Application.',
        'The Fixture Council on Regional Studies invites applications for this prize.',
      ),
    ).toBeUndefined();
  });

  it('keeps a multi-word complement whole and states none when its end is undecidable', () => {
    expect(
      officeIn(
        'Applications are submitted through the Yale Program in Fixture Studies Fellowship Application.',
      ),
    ).toBe('Yale Program in Fixture Studies');
    expect(
      officeIn(
        'Applications are accepted via the Office of Undergraduate Research Summer Application.',
      ),
    ).toBe('Office of Undergraduate Research');
    expect(
      officeIn(
        'Applications are accepted via the Office of Fellowships and Funding Summer Application.',
      ),
    ).toBe('Office of Fellowships and Funding');
    expect(
      officeIn('Applications are accepted via the Office of Fixture Research'),
    ).toBeUndefined();
    expect(
      officeIn(
        'Applications are accepted via the Office of International Summer Programs Application.',
      ),
    ).toBeUndefined();
  });
});

import { describe, expect, it } from 'vitest';

import { researcherDisplayProfileSchema } from '../../models/researcher';
import {
  MAX_STORED_PERSON_TITLE_LENGTH,
  servablePersonTitle,
  hasPhoneContactFragment,
  hasRawEmailAddress,
  hasStreetAddressFragment,
  isNavMenuChromeTitle,
  isPageHeadingTitle,
  isSectionLabelTitle,
  isTruncatedPersonTitle,
  normalizeTitleWhitespace,
  sanitizePersonTitle,
} from '../titleHygiene';

const YQI_NAV_MENU_TITLE =
  'About the InstituteMission & HistoryCommunity ValuesOur membersAnnual ReportsJoin the InstituteYQI in the MediaLocation & ContactsPrograms & EventsUpcoming EventsArtists-in-Residence ProgramColloquia and Seminar SeriesDistinguished Lecturer';

describe('isNavMenuChromeTitle', () => {
  it('rejects the issue #708 Yale Quantum Institute nav-menu blob', () => {
    expect(isNavMenuChromeTitle(YQI_NAV_MENU_TITLE)).toBe(true);
  });

  it('rejects concatenated menu link text with no separators', () => {
    expect(isNavMenuChromeTitle('HomeAboutResearchPeopleContact')).toBe(true);
  });

  it('rejects breadcrumb trails', () => {
    expect(isNavMenuChromeTitle('Home » Faculty » Directory')).toBe(true);
  });

  it('rejects space-separated navigation menus', () => {
    expect(isNavMenuChromeTitle('About Us Our Team Upcoming Events Contact Us')).toBe(true);
  });

  it('refuses a department site menu read with spaces between single-word items as a person title (#4046)', () => {
    for (const menu of [
      'Home About Research Academics People Media Events Outreach Opportunities Belonging For Prospectives',
      'Graduate Program Undergraduate Major Research & Collections Media Gallery Prize People',
      'Home About Research Academics People Media Events Outreach',
    ]) {
      expect(sanitizePersonTitle(menu)).toBeUndefined();
    }
  });

  it('keeps a multi-word capitalized title that names a role or carries few menu items (#4046)', () => {
    for (const title of [
      'Senior Administrative Assistant Child Study Center',
      'Social Worker Child Study Center',
      'Research Associate Internal Medicine General Medicine',
      'Yale-Foundation Medicine Retrospective Oncology Research Coordinator',
      'Director Of Research Media And Outreach Programs',
      'Home About Research',
      'Senior Communications And Media Events Planner',
      'News And Media Relations Office Staff Writer',
      'Communications Media Events And Outreach Team',
      'Senior Media Events Planner Office Staff',
      'Senior Digital Media Collections Gallery Archivist',
      'Public Health News Media Events Producer',
      'Community Research Outreach Events Program Planner',
    ]) {
      expect(sanitizePersonTitle(title)).toBe(title);
    }
  });

  it('keeps a real single job title', () => {
    expect(isNavMenuChromeTitle('Professor of Chemistry')).toBe(false);
  });

  it('keeps a real compound job title with a comma and ampersand', () => {
    expect(
      isNavMenuChromeTitle(
        'Professor of Molecular Biophysics & Biochemistry, Director of the Institute for Biospheric Studies',
      ),
    ).toBe(false);
  });

  it('keeps a legitimate Distinguished Lecturer title on its own', () => {
    expect(isNavMenuChromeTitle('Distinguished Lecturer in Physics')).toBe(false);
  });

  it('keeps a title containing a single internal-capital name token', () => {
    expect(isNavMenuChromeTitle('Professor at the MacMillan Center')).toBe(false);
  });

  it('treats empty and nullish values as not chrome', () => {
    expect(isNavMenuChromeTitle('')).toBe(false);
    expect(isNavMenuChromeTitle(null)).toBe(false);
    expect(isNavMenuChromeTitle(undefined)).toBe(false);
  });
});

describe('hasRawEmailAddress', () => {
  it('rejects a title carrying a raw email address', () => {
    expect(hasRawEmailAddress('Professor of Physics jane.doe@example.edu')).toBe(true);
  });

  it('keeps a plain job title', () => {
    expect(hasRawEmailAddress('Associate Professor of Chemistry')).toBe(false);
  });
});

describe('hasStreetAddressFragment', () => {
  it('rejects an Address: label run into the title', () => {
    expect(
      hasStreetAddressFragment(
        'Professor of Ecology & Evolutionary BiologyAddress: 21 Sachem St. New Haven, CT 06511',
      ),
    ).toBe(true);
  });

  it('rejects a bare city, state and ZIP fragment', () => {
    expect(hasStreetAddressFragment('New Haven, CT 06520')).toBe(true);
  });

  it('keeps a plain job title', () => {
    expect(hasStreetAddressFragment('Professor of Ecology and Evolutionary Biology')).toBe(false);
  });
});

describe('hasPhoneContactFragment', () => {
  it('rejects a Phone: label run into the title', () => {
    expect(hasPhoneContactFragment('Professor of Chemistry Phone: 203-432-1234')).toBe(true);
  });

  it('rejects a Fax: label', () => {
    expect(hasPhoneContactFragment('Director of the Center Fax: (203) 432-0000')).toBe(true);
  });

  it('rejects a bare ten-digit phone number in any format', () => {
    expect(hasPhoneContactFragment('Professor of Physics (203) 432-1234')).toBe(true);
    expect(hasPhoneContactFragment('Professor of Physics 203.432.1234')).toBe(true);
  });

  it('keeps a plain job title', () => {
    expect(hasPhoneContactFragment('Associate Professor of Chemistry')).toBe(false);
  });

  it('does not treat a course number or endowed-chair year as a phone number', () => {
    expect(hasPhoneContactFragment('The 1701 Professor of Chemistry, CHEM 502')).toBe(false);
  });

  it('does not fire on Phone/Tel substrings inside real words', () => {
    expect(hasPhoneContactFragment('Professor at the Hotel Management Institute')).toBe(false);
  });
});

describe('isSectionLabelTitle', () => {
  it('rejects the issue #1257 "Research / Faculty" section label', () => {
    expect(isSectionLabelTitle('Research / Faculty')).toBe(true);
  });

  it('rejects ampersand and word-joined variants of the same label', () => {
    expect(isSectionLabelTitle('Research & Faculty')).toBe(true);
    expect(isSectionLabelTitle('Research and Faculty')).toBe(true);
  });

  it('rejects a directory-index label', () => {
    expect(isSectionLabelTitle('Faculty Directory')).toBe(true);
    expect(isSectionLabelTitle('Faculty')).toBe(true);
  });

  it('keeps a real job title that merely contains the word faculty', () => {
    expect(isSectionLabelTitle('Faculty Director of the Graduate Program')).toBe(false);
    expect(isSectionLabelTitle('Professor of Computer Science')).toBe(false);
  });

  it('treats empty and nullish values as not a section label', () => {
    expect(isSectionLabelTitle('')).toBe(false);
    expect(isSectionLabelTitle(null)).toBe(false);
    expect(isSectionLabelTitle(undefined)).toBe(false);
  });
});

describe('isPageHeadingTitle (#5323)', () => {
  it('refuses a plural roster heading, an award name and a news headline', () => {
    for (const heading of [
      'Research Affiliates',
      'Clinical Research Affiliates',
      'Faculty Impact Award',
      'Yale-Foundation Medicine Retrospective Oncology Research Award',
      'Young Investigator Travel Award',
      'Faculty and Postdocs Hailed as Outstanding Mentors',
    ]) {
      expect(isPageHeadingTitle(heading)).toBe(true);
      expect(sanitizePersonTitle(heading)).toBeUndefined();
    }
  });

  it('keeps a title that names a singular role or a unit', () => {
    for (const title of [
      'Research Affiliate',
      'Associate Dean of Students',
      'Chief of Staff',
      'Emeritus Faculty',
      'Adjunct Faculty',
      'Won Park Hahn Professor of Global Affairs and Management',
      'Professor of Ecology and Evolutionary Biology',
      'Pre-Award Administrator',
      'Director, Office of Sponsored Awards',
      'Professor Emeritus of Public Health; Research Associate, National Bureau',
    ]) {
      expect(isPageHeadingTitle(title)).toBe(false);
    }
  });
});

describe('sanitizePersonTitle', () => {
  it('drops the issue #708 Yale Quantum Institute nav-menu blob', () => {
    expect(sanitizePersonTitle(YQI_NAV_MENU_TITLE)).toBeUndefined();
  });

  it('drops a department nav bar lifted as concatenated menu text', () => {
    expect(
      sanitizePersonTitle(
        'Graduate ProgramUndergraduate MajorResearch & CollectionsMedia GalleryPeople',
      ),
    ).toBeUndefined();
  });

  it('drops the issue #1257 "Research / Faculty" section label', () => {
    expect(sanitizePersonTitle('Research / Faculty')).toBeUndefined();
    expect(sanitizePersonTitle('Faculty Directory')).toBeUndefined();
  });

  it('drops a title with a street address fragment', () => {
    expect(
      sanitizePersonTitle('Evolutionary BiologyAddress: 21 Sachem St. New Haven, CT 06511'),
    ).toBeUndefined();
  });

  it('drops a title carrying a raw email address', () => {
    expect(sanitizePersonTitle('Professor jane.doe@example.edu')).toBeUndefined();
  });

  it('drops a title carrying a phone/fax contact fragment (#740)', () => {
    expect(sanitizePersonTitle('Professor of Chemistry Phone: 203-432-1234')).toBeUndefined();
    expect(sanitizePersonTitle('Director Fax: (203) 432-0000')).toBeUndefined();
  });

  it('drops a multi-sentence bio dumped into the title', () => {
    expect(
      sanitizePersonTitle('Her lab studies protein folding. She teaches. She joined in 2004.'),
    ).toBeUndefined();
  });

  it('keeps a long but single-phrase endowed-chair title', () => {
    expect(
      sanitizePersonTitle(
        'Sterling Professor of Molecular, Cellular and Developmental Biology and Professor of Chemistry and of Physics',
      ),
    ).toBe(
      'Sterling Professor of Molecular, Cellular and Developmental Biology and Professor of Chemistry and of Physics',
    );
  });

  it('keeps and normalizes a real job title', () => {
    expect(sanitizePersonTitle('  Associate   Professor of Chemistry ')).toBe(
      'Associate Professor of Chemistry',
    );
  });

  it('returns undefined for empty and nullish values', () => {
    expect(sanitizePersonTitle('')).toBeUndefined();
    expect(sanitizePersonTitle(null)).toBeUndefined();
    expect(sanitizePersonTitle(undefined)).toBeUndefined();
  });
});

describe('normalizeTitleWhitespace', () => {
  it('collapses whitespace and trims', () => {
    expect(normalizeTitleWhitespace('  Associate   Professor \n of Physics ')).toBe(
      'Associate Professor of Physics',
    );
  });

  it('coerces nullish input to an empty string', () => {
    expect(normalizeTitleWhitespace(null)).toBe('');
    expect(normalizeTitleWhitespace(undefined)).toBe('');
  });
});

describe('a field label scraped in front of a title', () => {
  it.each([
    ['Title: Lecturer', 'Lecturer'],
    ['Title: Senior Lecturer, Film and Media Studies', 'Senior Lecturer, Film and Media Studies'],
    ['Position: Assistant Professor', 'Assistant Professor'],
    ['Job Title: Research Scientist', 'Research Scientist'],
  ])('is stripped from %s', (raw, title) => {
    expect(sanitizePersonTitle(raw)).toBe(title);
  });

  it('leaves a title that only contains the word', () => {
    expect(sanitizePersonTitle('Title IX Coordinator')).toBe('Title IX Coordinator');
  });
});

describe('a title cut off at a connective (#5109)', () => {
  it.each(['Professor of', 'Example Chair Professor of', 'Professor and Chair of', 'Lecturer in'])(
    'refuses %s',
    (title) => {
      expect(isTruncatedPersonTitle(title)).toBe(true);
      expect(sanitizePersonTitle(title)).toBeUndefined();
    },
  );

  it.each([
    'Professor of Ecology & Evolutionary Biology',
    'Professor of the Practice',
    'Associate Professor; Director of Undergraduate Studies',
    'Lecturer',
  ])('keeps %s', (title) => {
    expect(isTruncatedPersonTitle(title)).toBe(false);
    expect(sanitizePersonTitle(title)).toBe(title);
  });
});

describe('servablePersonTitle (#5594)', () => {
  const bio =
    'Avery Synthetic is associate professor of political science. Avery studies the history of fixture institutions and how they change over time, drawing on archival work.';

  it('keeps an ordinary title unchanged', () => {
    expect(servablePersonTitle('Associate Professor of Political Science')).toBe(
      'Associate Professor of Political Science',
    );
  });

  it("refuses a title with the person's name and biography glued on", () => {
    expect(
      servablePersonTitle(`Associate Professor of Political Science Avery Synthetic ${bio}`),
    ).toBeUndefined();
  });

  it('refuses a site menu read as a title', () => {
    expect(
      servablePersonTitle(
        'HomeAboutFixture CouncilFixture SocietyResearchResearch HomeCosmologyExoplanetsPeopleFacultyPostdocsGraduate StudentsUndergraduatesEventsSeminarsColloquiaNewsContact UsGiving',
      ),
    ).toBeUndefined();
  });

  it('refuses a title with degree lines run on', () => {
    expect(
      servablePersonTitle(
        'Professor of English Ph.D., Fixture University, 1999M.A., Fixture College, 1995B.A., Fixture College, summa cum laude, 1993 Fields of interest include fixture poetry',
      ),
    ).toBeUndefined();
  });

  it('refuses a title with contact details run on', () => {
    expect(
      servablePersonTitle(
        'Professor of History.avery.synthetic@yale.eduOffice: HQ 101Phone: 203-555-0100',
      ),
    ).toBeUndefined();
  });

  it('keeps a long semicolon list of appointments whole, never trimming it to a length', () => {
    const appointments = [
      'Fixture Endowed Professor of Synthetic Studies',
      'Director, Center for Fixture Methods in Placeholder Science (CFMPS)',
      'Professor of Statistics and Data Science',
      'Professor of Medicine (Synthetic Medicine)',
      'Assistant Director, Global Placeholder Program, Fixture Cancer Center',
    ];
    const title = appointments.join('; ');
    expect(title.length).toBeGreaterThan(250);
    expect(servablePersonTitle(title)).toBe(title);
  });

  it('keeps an appointment list written as sentences whole', () => {
    const title =
      'Avery B. and Casey Fixture Professor and Chair of Synthetic Studies. Professor of Genetics and Placeholder Pathology. Associate Dean for Fixture Scientist Development';
    expect(title.length).toBeGreaterThan(140);
    expect(servablePersonTitle(title)).toBe(title);
  });

  it('keeps a semicolon list whose last appointment runs on as a second sentence', () => {
    const title =
      'Professor of Fixture Studies and Synthetic Methods; Executive Director of the FSMTU and Vice Chair for Clinical and Translational Research in the Departments of Fixture Studies and Synthetic Methods. Director, Fixture Center for Placeholder Health.';
    expect(title.length).toBeGreaterThan(200);
    expect(servablePersonTitle(title)).toBe(title);
  });

  it.each([
    'Fixture Endowed Professor of Synthetic Culture; Professor of American Studies, Placeholder Studies, and Divinity (ISM); and Director, Center for the Study of Material and Visual Cultures of Fixture Religion',
    'Dean of the Faculty of Fixture Arts and Sciences; Synthetic Professor of Placeholder Studies; Professor of Political Science and International Affairs; Professor in the Institution for Fixture Policy Studies.',
  ])('keeps the long genuine appointment list %s whole', (title) => {
    expect(title.length).toBeGreaterThan(200);
    expect(servablePersonTitle(title)).toBe(title);
  });

  it('keeps a stray space before a comma, which a page renders inside a genuine appointment', () => {
    for (const title of [
      'Associate Professor , Fixture and Synthetic Science',
      'Senior Lecturer in Ethnicity ,Fixture, and Migration',
    ]) {
      expect(servablePersonTitle(title)).toBe(title);
    }
  });

  it("refuses a heading run into the person's biography, which a lowercase verb gives away", () => {
    expect(
      servablePersonTitle(
        "Professor of Fixture Studies and Faculty Director of the Synthetic Program at the Fixture Center Bio Avery Synthetic is Professor in the Department of Fixture Studies, where Avery's research focuses on the",
      ),
    ).toBeUndefined();
    expect(
      servablePersonTitle(
        "Dr. Avery Synthetic's research is focused on developing predictive fixture methods to understand synthetic genome architecture",
      ),
    ).toBeUndefined();
  });

  it('refuses a first-person biography run onto a title', () => {
    expect(
      servablePersonTitle(
        'Fixture Professor of English I study the history of synthetic poetry, primarily American and British',
      ),
    ).toBeUndefined();
  });

  it.each([
    'Associate Research Scientist I in Fixture Medicine',
    'Professor of History and of Fixture Studies',
  ])('keeps %s, whose roman numeral or field name is not a pronoun', (title) => {
    expect(servablePersonTitle(title)).toBe(title);
  });

  it('trims a list only to drop a trailing glued defect, keeping the leading appointments whole', () => {
    expect(
      servablePersonTitle(
        'Professor of Fixture Studies; Director of the Fixture Center; Avery received her Ph.D. in synthetic methods',
      ),
    ).toBe('Professor of Fixture Studies; Director of the Fixture Center');
  });

  it('refuses a clean title past the storage bound rather than cutting it', () => {
    const first = `Professor of ${'Fixture '.repeat(130)}Studies`;
    expect(first.length).toBeGreaterThan(MAX_STORED_PERSON_TITLE_LENGTH);
    expect(servablePersonTitle(first)).toBeUndefined();
    expect(servablePersonTitle(`${first}; Director of the Fixture Center`)).toBeUndefined();
  });

  it('bounds a stored title at the researcher schema limit', () => {
    expect(researcherDisplayProfileSchema.path('title').options.maxlength).toBe(
      MAX_STORED_PERSON_TITLE_LENGTH,
    );
  });

  it('stops at the first semicolon part that is not a title', () => {
    expect(
      servablePersonTitle(
        `Professor of Fixture Studies; Director of the Fixture Center; ${bio} ${bio}`,
      ),
    ).toBe('Professor of Fixture Studies; Director of the Fixture Center');
  });

  it('keeps a real comma-joined appointment title between the card and stored limits', () => {
    const title =
      'Associate Professor of Fixture Studies and of Synthetic Methods, Director of the Fixture Center for Testing, and Chair of Placeholder Records';
    expect(title.length).toBeGreaterThan(140);
    expect(title.length).toBeLessThanOrEqual(MAX_STORED_PERSON_TITLE_LENGTH);
    expect(servablePersonTitle(title)).toBe(title);
  });

  it('refuses glued biography text by its defect, not only by its length', () => {
    const glued = `Associate Professor of Political Science Avery Synthetic ${bio} ${bio}`;
    expect(glued.length).toBeGreaterThan(300);
    expect(servablePersonTitle(glued)).toBeUndefined();
    const underTheLimit = glued.slice(0, 190);
    expect(servablePersonTitle(underTheLimit)).toBeUndefined();
  });

  it.each(['Research / Faculty', 'Related Research', 'Research', 'Profile', 'Overview', 'Home'])(
    'refuses profile-page furniture %s, which a first-hand profile read would otherwise carry',
    (value) => {
      expect(servablePersonTitle(value)).toBeUndefined();
    },
  );

  it.each(['Voluntary Faculty', 'Adjunct Faculty', 'Research Assistant 1', 'Critic', 'Lector'])(
    'keeps the real title %s',
    (value) => {
      expect(servablePersonTitle(value)).toBe(value);
    },
  );
});

describe('sanitizePersonTitle at ingest refuses by defect shape, never by length (#5832)', () => {
  const longAppointmentList = [
    'Fixture Endowed Professor of Synthetic Studies',
    'Director, Center for Fixture Methods in Placeholder Science (CFMPS)',
    'Professor of Statistics and Data Science',
    'Associate Director, Global Placeholder Program, Fixture Cancer Center',
  ].join('; ');

  it.each([
    ['a semicolon list of appointments', longAppointmentList],
    [
      'a comma-joined appointment title',
      'Associate Professor of Fixture Studies and of Synthetic Methods, Director of the Fixture Center for Testing, and Chair of Placeholder Records',
    ],
    [
      'an appointment list written as sentences',
      'Avery B. and Casey Fixture Professor and Chair of Synthetic Studies. Professor of Genetics and Placeholder Pathology. Associate Dean for Fixture Scientist Development',
    ],
    [
      'a long single-phrase endowed-chair title',
      `Professor of ${'Molecular Biology '.repeat(10).trim()}`,
    ],
  ])('emits %s past 140 characters whole', (_shape, title) => {
    expect(title.length).toBeGreaterThan(140);
    expect(sanitizePersonTitle(title)).toBe(title);
  });

  const longTitle =
    'Professor of Fixture Studies and of Synthetic Methods, Director of the Fixture Center for Testing';

  it.each([
    [
      'a concatenated site menu',
      `${longTitle} HomeAboutFixture CouncilResearchPeopleFacultyEventsNewsContact UsGiving`,
    ],
    [
      'a breadcrumb trail',
      `Home > People > Faculty > ${longTitle} and Placeholder Records Archive`,
    ],
    ['a raw email address', `${longTitle}, avery.synthetic@example.edu, Placeholder Records`],
    ['a street address', `${longTitle}, Address: 21 Fixture St. New Haven, CT 06511`],
    ['a phone number', `${longTitle}, Phone: 203-555-0100, Fixture Records Office`],
    [
      'a glued biography clause',
      `${longTitle}. Avery received her doctorate from a fixture institution in synthetic methods`,
    ],
    [
      'a lowercase finite verb',
      `${longTitle}. Avery Synthetic directs the placeholder program for fixture records`,
    ],
    [
      'a personal pronoun',
      `${longTitle}, where she leads the placeholder program for fixture records and methods`,
    ],
    [
      'a first-person clause',
      `${longTitle} I study the history of synthetic poetry, primarily American and British`,
    ],
    [
      'a degree line',
      `${longTitle} Ph.D., Fixture University, 1999 M.A., Fixture College, 1995 placeholder`,
    ],
    ['a dangling connective', `${longTitle} and Professor of Placeholder Records and of`],
  ])('refuses a long title carrying %s', (_shape, title) => {
    expect(title.length).toBeGreaterThan(140);
    expect(sanitizePersonTitle(title)).toBeUndefined();
  });

  it.each([
    ['a section label', 'Research / Faculty'],
    ['a plural roster heading', 'Research Affiliates'],
  ])('still refuses %s', (_shape, title) => {
    expect(sanitizePersonTitle(title)).toBeUndefined();
  });

  it('keeps the leading appointments of a list whose later appointment is glued biography', () => {
    expect(
      sanitizePersonTitle(
        `${longAppointmentList}; Avery received her Ph.D. in synthetic methods from a fixture institution`,
      ),
    ).toBe(longAppointmentList);
  });

  it('refuses a clean title past the storage bound rather than cutting it', () => {
    const overBound = `Professor of ${'Fixture '.repeat(130)}Studies`;
    expect(overBound.length).toBeGreaterThan(MAX_STORED_PERSON_TITLE_LENGTH);
    expect(sanitizePersonTitle(overBound)).toBeUndefined();
  });

  it('is idempotent, so a second pass over an emitted title changes nothing', () => {
    for (const title of [
      longAppointmentList,
      `${longAppointmentList}; Avery received her Ph.D. in synthetic methods`,
      'Title: Senior Lecturer, Film and Media Studies',
      'Research / Faculty',
    ]) {
      const emitted = sanitizePersonTitle(title);
      expect(sanitizePersonTitle(emitted)).toBe(emitted);
    }
  });
});

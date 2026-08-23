import { describe, expect, it } from 'vitest';

import {
  hasPhoneContactFragment,
  hasRawEmailAddress,
  hasStreetAddressFragment,
  isBioProseTitle,
  isNavMenuChromeTitle,
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

describe('isBioProseTitle', () => {
  it('rejects a multi-sentence bio dumped into the title', () => {
    expect(
      isBioProseTitle(
        'Her lab studies protein folding. She teaches biochemistry. She joined in 2004.',
      ),
    ).toBe(true);
  });

  it('keeps a real compound title with a trailing degree abbreviation', () => {
    expect(isBioProseTitle('Professor of Immunobiology, Ph.D.')).toBe(false);
  });

  it('keeps an abbreviated rank title', () => {
    expect(isBioProseTitle('Assoc. Prof. of Chemistry')).toBe(false);
  });

  it('keeps an endowed-chair title carrying a personal name with initials', () => {
    expect(isBioProseTitle('The William K. Lanman, Jr. Professor of Molecular Biophysics')).toBe(
      false,
    );
  });

  it('keeps a long but single-phrase endowed-chair title', () => {
    expect(
      isBioProseTitle(
        'Sterling Professor of Molecular, Cellular and Developmental Biology and Professor of Chemistry and of Physics',
      ),
    ).toBe(false);
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

  it('drops a title longer than a role string ever runs (#740)', () => {
    expect(sanitizePersonTitle(`Professor of ${'Molecular Biology '.repeat(10)}`)).toBeUndefined();
  });

  it('keeps a long but single-phrase endowed-chair title under the length cap', () => {
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

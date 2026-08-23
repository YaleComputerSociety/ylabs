import { describe, expect, it } from 'vitest';

import { isNavMenuChromeTitle, normalizeTitleWhitespace } from '../titleHygiene';

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

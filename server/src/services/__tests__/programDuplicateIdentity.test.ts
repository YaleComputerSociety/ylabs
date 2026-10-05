import { describe, expect, it } from 'vitest';
import {
  programFundTitleKey,
  programTermQualifier,
  selectDuplicateProgramCopies,
} from '../programDuplicateIdentity';

const DESCRIPTION =
  'The fixture fund supports undergraduates who plan summer research projects in the humanities and social sciences, with awards for travel, living costs, and materials.';

const copy = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  title: 'Fixture Fund',
  description: DESCRIPTION,
  sourceName: 'yale-college-fellowships-office',
  tier: 'student_ready',
  ...overrides,
});

const redundant = (...copies: ReturnType<typeof copy>[]) => [
  ...selectDuplicateProgramCopies(copies),
];

describe('programFundTitleKey', () => {
  it('reads a title the same whatever its case, punctuation, ampersand, or leading article', () => {
    expect(programFundTitleKey('The Fixture Research & Travel Fellowship')).toBe(
      programFundTitleKey('fixture research and travel fellowship'),
    );
    expect(programFundTitleKey('Fixture’s Fund')).toBe(programFundTitleKey("Fixture's Fund"));
  });

  it('keeps a title that has a word "and" apart from one that does not', () => {
    expect(programFundTitleKey('Fixture Research and Travel Fund')).not.toBe(
      programFundTitleKey('Fixture Research Travel Fund'),
    );
  });
});

describe('selectDuplicateProgramCopies', () => {
  it('keeps the copy most fit to serve among copies from one lane', () => {
    expect(redundant(copy('a', { tier: 'suppressed' }), copy('b'))).toEqual([['a', 'b']]);
  });

  it('keeps the Yale fellowship database record over another lane copy (#4289)', () => {
    expect(redundant(copy('a', { sourceName: 'student-grants-database' }), copy('b'))).toEqual([
      ['b', 'a'],
    ]);
  });

  it('keeps the database record even when the other copy is more fit to serve (#4289)', () => {
    expect(
      redundant(
        copy('a'),
        copy('b', { sourceName: 'student-grants-database', tier: 'suppressed' }),
      ),
    ).toEqual([['a', 'b']]);
  });

  it('keeps the older row when nothing else separates two copies', () => {
    expect(redundant(copy('b'), copy('a'))).toEqual([['b', 'a']]);
  });

  it('joins copies whose titles differ only by an article or an ampersand', () => {
    expect(
      redundant(
        copy('a', { title: 'The Fixture Research & Travel Fund' }),
        copy('b', { title: 'Fixture Research and Travel Fund' }),
      ),
    ).toEqual([['b', 'a']]);
  });

  it('joins a fund paragraph to a copy that stored the whole page around it', () => {
    expect(
      redundant(
        copy('a', { sourceName: 'student-grants-database' }),
        copy('b', {
          description: `Student and faculty awards. Apply now. ${DESCRIPTION} Questions go to the fellowships office, and recipients are announced in April.`,
        }),
      ),
    ).toEqual([['b', 'a']]);
  });

  it('leaves funds that share a description but name different colleges apart', () => {
    expect(
      redundant(
        copy('a', { title: 'North College Fixture Fund' }),
        copy('b', { title: 'South College Fixture Fund' }),
      ),
    ).toEqual([]);
  });

  it('leaves funds that share a title but describe different awards apart', () => {
    expect(
      redundant(
        copy('a'),
        copy('b', {
          description:
            'A different fixture award pays for a semester of language study abroad for sophomores, covering tuition at an approved partner program.',
        }),
      ),
    ).toEqual([]);
  });

  it('refuses to join copies on a title alone or a description too short to tell funds apart', () => {
    expect(redundant(copy('a', { description: '' }), copy('b', { description: '' }))).toEqual([]);
    expect(
      redundant(
        copy('a', { description: 'Supports research.' }),
        copy('b', { description: 'Supports research.' }),
      ),
    ).toEqual([]);
  });
});

describe('selectDuplicateProgramCopies on a shared fund page', () => {
  const FUND_PAGE = 'https://yale.communityforce.com/Funds/FundDetails.aspx?46495854555245';
  const OTHER_FUND_PAGE = 'https://yale.communityforce.com/Funds/FundDetails.aspx?4F54484552';
  const CATALOG_BLURB =
    'A one-line catalog summary of the fixture award for summer travel abroad, listed with every other grant this office administers.';

  it('joins two copies of one fund page with one title despite different descriptions', () => {
    expect(
      redundant(
        copy('a', { sourceName: 'student-grants-database', sourceUrl: FUND_PAGE }),
        copy('b', {
          description: CATALOG_BLURB,
          sourceUrl: 'https://catalog.example.edu/fellowships-and-grants',
          applicationLink: 'https://bit.ly/fixture',
          links: [{ url: FUND_PAGE }],
        }),
      ),
    ).toEqual([['b', 'a']]);
  });

  it('joins copies whose titles differ by a prefix or a parenthetical aside', () => {
    expect(
      redundant(
        copy('a', {
          title: 'Fixture Council (FC) - Summer Travel Grant',
          sourceName: 'student-grants-database',
          sourceUrl: FUND_PAGE,
        }),
        copy('b', {
          title: 'Fixture Council - Summer Travel Grant',
          description: CATALOG_BLURB,
          applicationLink: FUND_PAGE,
        }),
      ),
    ).toEqual([['b', 'a']]);
    expect(
      redundant(
        copy('a', { title: 'Center Fixture Travel Fellowship', sourceUrl: FUND_PAGE }),
        copy('b', {
          title: 'Fixture Travel Fellowship',
          description: CATALOG_BLURB,
          links: [{ url: FUND_PAGE }],
        }),
      ),
    ).toEqual([['b', 'a']]);
  });

  it('joins copies whose titles name the award in another form', () => {
    expect(
      redundant(
        copy('a', {
          title: 'Fixture Undergraduate Fellowship',
          sourceName: 'student-grants-database',
          sourceUrl: FUND_PAGE,
        }),
        copy('b', {
          title: 'Fixture Undergraduate Fellows Program',
          description: CATALOG_BLURB,
          applicationLink: FUND_PAGE,
        }),
      ),
    ).toEqual([['b', 'a']]);
    expect(
      redundant(
        copy('a', { title: 'Fixture Fellowships for Baltic Studies', sourceUrl: FUND_PAGE }),
        copy('b', {
          title: 'Fixture Fellowship for Baltic Studies',
          description: CATALOG_BLURB,
          links: [{ url: FUND_PAGE }],
        }),
      ),
    ).toEqual([['b', 'a']]);
  });

  it('keeps a common application apart from a fund on its page even with the award noun folded', () => {
    expect(
      redundant(
        copy('a', {
          title: 'Fixture Fellows and Scholars Common Application',
          sourceName: 'student-grants-database',
          sourceUrl: FUND_PAGE,
        }),
        copy('b', {
          title: 'Fixture Undergraduate Fellows Program',
          description: CATALOG_BLURB,
          applicationLink: FUND_PAGE,
        }),
      ),
    ).toEqual([]);
  });

  it('leaves two titles apart when a catalog page gave one fund another fund page', () => {
    expect(
      redundant(
        copy('a', {
          title: 'Fixture Council Grants for Language Study',
          sourceName: 'student-grants-database',
          sourceUrl: FUND_PAGE,
        }),
        copy('b', {
          title: 'Fixture Union Studies Grants',
          description: CATALOG_BLURB,
          applicationLink: FUND_PAGE,
        }),
      ),
    ).toEqual([]);
  });

  it('never joins copies on this rule when their fund pages differ', () => {
    expect(
      redundant(
        copy('a', { sourceUrl: FUND_PAGE }),
        copy('b', { description: CATALOG_BLURB, applicationLink: OTHER_FUND_PAGE }),
      ),
    ).toEqual([]);
  });

  it('keeps the database record, then the copy most fit to serve, whichever cites the page', () => {
    expect(
      redundant(
        copy('a', { tier: 'suppressed', sourceUrl: FUND_PAGE }),
        copy('b', {
          sourceName: 'student-grants-database',
          description: CATALOG_BLURB,
          applicationLink: FUND_PAGE,
        }),
      ),
    ).toEqual([['a', 'b']]);
    expect(
      redundant(
        copy('a', { sourceName: 'student-grants-database', sourceUrl: FUND_PAGE }),
        copy('b', { description: CATALOG_BLURB, links: [{ url: FUND_PAGE }] }),
      ),
    ).toEqual([['b', 'a']]);
    expect(
      redundant(
        copy('a', { tier: 'suppressed', sourceUrl: FUND_PAGE }),
        copy('b', { description: CATALOG_BLURB, applicationLink: FUND_PAGE }),
      ),
    ).toEqual([['a', 'b']]);
  });
});

describe('selectDuplicateProgramCopies on one program page two lanes cite (#4175)', () => {
  const PROGRAM_PAGE = 'https://www.example.edu/undergraduate/fixture-research-internship-program/';
  const FORM = 'https://forms.example.com/fixture-internship';
  const OTHER_DESCRIPTION =
    'Department guidance for undergraduates looking for a faculty research placement in the fixture department during the academic year.';

  it('joins two lanes whose copies cite one program page and one form whatever the scheme', () => {
    expect(
      redundant(
        copy('a', {
          title: 'Research Internship Program',
          description: '',
          sourceUrl: PROGRAM_PAGE,
          applicationLink: FORM,
        }),
        copy('b', {
          title: 'Fixture Department Research Internship Program',
          description: OTHER_DESCRIPTION,
          sourceName: 'department-undergrad-research',
          sourceUrl: PROGRAM_PAGE.replace('https://www.', 'http://'),
          applicationLink: FORM.replace('https://', 'http://'),
        }),
      ),
    ).toEqual([['b', 'a']]);
  });

  it('keeps the database record when the copies share only the program page (#4289)', () => {
    expect(
      redundant(
        copy('a', { title: 'Undergraduate Fellowships', sourceUrl: PROGRAM_PAGE }),
        copy('b', {
          title: 'Fixture Institute Undergraduate Fellowships',
          description: OTHER_DESCRIPTION,
          sourceName: 'student-grants-database',
          sourceUrl: PROGRAM_PAGE,
        }),
      ),
    ).toEqual([['a', 'b']]);
  });

  it('leaves copies apart when their titles name different programs on one page', () => {
    expect(
      redundant(
        copy('a', { title: 'Fixture Council Summer Grant', sourceUrl: PROGRAM_PAGE }),
        copy('b', {
          title: 'Fixture Studies Travel Fellowship',
          description: OTHER_DESCRIPTION,
          sourceName: 'student-grants-database',
          sourceUrl: PROGRAM_PAGE,
        }),
      ),
    ).toEqual([]);
  });

  it('joins nothing on a page or a form one lane cites for several rows', () => {
    const LISTING = 'https://funding.example.edu/find-funding/all-fellowships';
    expect(
      redundant(
        copy('a', { title: 'Fixture Foundation Fellowship', sourceUrl: LISTING }),
        copy('b', {
          title: 'Fixture Foundation Travel Fellowship',
          description: OTHER_DESCRIPTION,
          sourceName: 'student-grants-database',
          sourceUrl: LISTING,
        }),
        copy('c', {
          title: 'Another Fixture Award',
          description:
            'A third fixture award listed on the same funding index page for graduating seniors.',
          sourceName: 'student-grants-database',
          sourceUrl: LISTING,
        }),
      ),
    ).toEqual([]);
  });

  it('never joins one lane copies on a shared page alone', () => {
    expect(
      redundant(
        copy('a', { title: 'Fixture Fellowship', sourceUrl: PROGRAM_PAGE }),
        copy('b', {
          title: 'Fixture Fellowship Summer Session',
          description: OTHER_DESCRIPTION,
          sourceUrl: PROGRAM_PAGE,
        }),
      ),
    ).toEqual([]);
  });

  it('joins a narrower title to a wider one over one description across lanes (#4587)', () => {
    const CATALOG = 'https://funding.example.edu/find-funding/offered-through';
    expect(
      redundant(
        copy('a', { title: 'Fixture Foundation Fellowship', sourceUrl: CATALOG }),
        copy('b', {
          title: 'Fixture Foundation Travel Fellowship',
          sourceName: 'student-grants-database',
          sourceUrl: CATALOG,
        }),
        copy('c', {
          title: 'Another Fixture Award',
          description: OTHER_DESCRIPTION,
          sourceUrl: CATALOG,
        }),
      ),
    ).toEqual([['a', 'b']]);
  });

  it('joins neither wider title when two distinct funds both contain the narrower one (#4587)', () => {
    expect(
      redundant(
        copy('a', { title: 'Fixture Summer Fellowship' }),
        copy('b', { title: 'North College Fixture Summer Fellowship' }),
        copy('c', { title: 'South College Fixture Summer Fellowship' }),
      ),
    ).toEqual([]);
  });

  it('joins the terms of one program listed as sibling records (#4587)', () => {
    expect(
      redundant(
        copy('a', { title: 'Fixture Laboratory Internship - Fall Term' }),
        copy('b', { title: 'Fixture Laboratory Internship - Spring Term' }),
        copy('c', { title: 'Fixture Laboratory Internship (Summer Term)' }),
      ),
    ).toEqual([
      ['b', 'a'],
      ['c', 'a'],
    ]);
  });

  it('keeps a term-named program apart from another program with the same remainder', () => {
    expect(
      redundant(
        copy('a', { title: 'Fixture Laboratory Internship - Fall Term' }),
        copy('b', {
          title: 'Fixture Laboratory Internship - Fall Term',
          description: OTHER_DESCRIPTION,
        }),
      ),
    ).toEqual([]);
  });
});

describe('programTermQualifier', () => {
  it('reads only a trailing term qualifier', () => {
    expect(programTermQualifier('Fixture Internship - Spring Term')).toBe('spring');
    expect(programTermQualifier('Fixture Internship (Summer Session)')).toBe('summer');
    expect(programTermQualifier('Fixture Summer Fellowship')).toBe('');
    expect(programTermQualifier('Fixture Fellowships: Class of 2004 Summer')).toBe('');
  });
});

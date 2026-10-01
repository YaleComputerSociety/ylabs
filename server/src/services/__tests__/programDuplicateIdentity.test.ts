import { describe, expect, it } from 'vitest';
import { programFundTitleKey, selectDuplicateProgramCopies } from '../programDuplicateIdentity';

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

import { describe, expect, it } from 'vitest';
import {
  fellowshipAbsenceClearWithheldBySourcePrecedence,
  fellowshipFieldsWithheldBySourcePrecedence,
} from '../fellowshipSourcePrecedence';

const FUND_PAGE = 'https://yale.communityforce.com/Funds/FundDetails.aspx?FUNDA';
const OFFICIAL_PAGE = 'https://funding.yale.edu/fixture-fellowship';

const ownedRow = {
  sourceName: 'yale-college-fellowships-office',
  sourceKey: 'yale-college-fellowships-office:fixture-fellowship',
  sourceUrl: OFFICIAL_PAGE,
  description: 'Stored description from the official page.',
  deadline: new Date('2026-02-01T00:00:00Z'),
};

function withheld(
  stored: Record<string, unknown>,
  staged: Record<string, unknown>,
  observer: string,
  winnerByField: Record<string, string> = {},
) {
  const resolved = Object.fromEntries(
    Object.keys(staged).map((field) => [
      field,
      { contributingSources: [winnerByField[field] ?? observer] },
    ]),
  );
  return fellowshipFieldsWithheldBySourcePrecedence({
    stored,
    staged,
    resolved,
    fundTitle: undefined,
  }).sort();
}

describe('fellowshipFieldsWithheldBySourcePrecedence', () => {
  it('lets an enrich-only source fill gaps and the application window on another lane’s row, never its identity', () => {
    expect(
      withheld(
        ownedRow,
        {
          sourceName: 'student-grants-database',
          sourceKey: 'student-grants-database:funds-funddetails-aspx-funda',
          sourceFingerprint: 'fingerprint',
          description: 'Description from the fund page.',
          awardAmount: '$4,000',
          deadline: new Date('2027-02-01T00:00:00Z'),
          isAcceptingApplications: true,
        },
        'student-grants-database',
      ),
    ).toEqual(['description', 'sourceFingerprint', 'sourceKey', 'sourceName']);
  });

  it('decides per field from the source each value came from, not from the row-level sourceName winner', () => {
    expect(
      withheld(
        ownedRow,
        {
          sourceName: 'yale-college-fellowships-office',
          description: 'Description from the fund page.',
          title: 'Title from the official page',
        },
        'yale-college-fellowships-office',
        { description: 'student-grants-database' },
      ),
    ).toEqual(['description']);
    expect(
      withheld(
        ownedRow,
        {
          sourceName: 'student-grants-database',
          description: 'Refreshed description from the official page.',
        },
        'student-grants-database',
        { description: 'yale-college-fellowships-office' },
      ),
    ).toEqual(['sourceName']);
  });

  it('lets the owning lane reclaim a row an enrich-only source took over', () => {
    expect(
      withheld(
        { ...ownedRow, sourceName: 'student-grants-database', sourceUrl: FUND_PAGE },
        {
          sourceName: 'yale-college-fellowships-office',
          sourceKey: 'yale-college-fellowships-office:fixture-fellowship',
          sourceUrl: OFFICIAL_PAGE,
        },
        'yale-college-fellowships-office',
      ),
    ).toEqual([]);
  });

  it('writes everything on a row the enrich-only source itself owns, apart from a portal sourceUrl over an official one', () => {
    const own = { ...ownedRow, sourceName: 'student-grants-database' };
    expect(
      withheld(own, { description: 'New', sourceUrl: FUND_PAGE }, 'student-grants-database'),
    ).toEqual(['sourceUrl']);
  });

  it('never replaces an official sourceUrl with an application portal page, whoever asserts it', () => {
    expect(withheld(ownedRow, { sourceUrl: FUND_PAGE }, 'yale-college-fellowships-office')).toEqual(
      ['sourceUrl'],
    );
    expect(
      withheld(
        { ...ownedRow, sourceUrl: FUND_PAGE },
        { sourceUrl: OFFICIAL_PAGE },
        'yale-college-fellowships-office',
      ),
    ).toEqual([]);
  });
});

describe('the fellowship database as an official source (#4284)', () => {
  const fundPage = 'https://yale.communityforce.com/Funds/FundDetails.aspx?abc123';

  it('lets the database lane set its fund page as sourceUrl on a row it owns', () => {
    expect(
      fellowshipFieldsWithheldBySourcePrecedence({
        stored: { sourceName: 'student-grants-database', sourceUrl: '' },
        staged: { sourceUrl: fundPage },
        resolved: { sourceUrl: { contributingSources: ['student-grants-database'] } },
        fundTitle: undefined,
      }),
    ).not.toContain('sourceUrl');
  });

  it('never lets the fund page replace a program web page another lane owns', () => {
    expect(
      fellowshipFieldsWithheldBySourcePrecedence({
        stored: {
          sourceName: 'yale-college-fellowships-office',
          sourceUrl: 'https://funding.yale.edu/fixture-fellowship',
        },
        staged: { sourceUrl: fundPage },
        resolved: { sourceUrl: { contributingSources: ['student-grants-database'] } },
        fundTitle: undefined,
      }),
    ).toContain('sourceUrl');
  });
});

describe('fellowshipAbsenceClearWithheldBySourcePrecedence', () => {
  it('refuses an enrich-only source clearing a field on another lane’s row', () => {
    expect(
      fellowshipAbsenceClearWithheldBySourcePrecedence({
        stored: ownedRow,
        assertedBy: ['student-grants-database'],
      }),
    ).toBe(true);
  });

  it('lets a row’s own lane clear a field, and lets the database clear its own row', () => {
    expect(
      fellowshipAbsenceClearWithheldBySourcePrecedence({
        stored: ownedRow,
        assertedBy: ['yale-college-fellowships-office'],
      }),
    ).toBe(false);
    expect(
      fellowshipAbsenceClearWithheldBySourcePrecedence({
        stored: { ...ownedRow, sourceName: 'student-grants-database' },
        assertedBy: ['student-grants-database'],
      }),
    ).toBe(false);
  });
});

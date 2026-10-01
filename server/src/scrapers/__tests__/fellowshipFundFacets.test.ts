import { describe, expect, it } from 'vitest';
import {
  fundFacetsDescribeProgram,
  fundKeyCitedByFellowship,
  preferFundFacetObservations,
  sourceKeyForFund,
} from '../fellowshipFundFacets';
import {
  fellowshipFieldsWithheldBySourcePrecedence,
  newestFundTitle,
} from '../fellowshipSourcePrecedence';

const FUND_PAGE = 'https://yale.communityforce.com/Funds/FundDetails.aspx?FIXTUREFUND';

describe('fundKeyCitedByFellowship', () => {
  it('reads the one fund a row cites, however many links name it', () => {
    expect(
      fundKeyCitedByFellowship({
        sourceUrl: 'https://fellowships.example.edu/fixture',
        applicationLink: FUND_PAGE,
        links: [{ url: FUND_PAGE.replace('https://', 'http://') }, { url: 'https://example.edu' }],
      }),
    ).toBe(sourceKeyForFund(FUND_PAGE));
  });

  it('cites no fund when a row cites two different fund pages', () => {
    expect(
      fundKeyCitedByFellowship({
        sourceUrl: FUND_PAGE,
        applicationLink: 'https://yale.communityforce.com/Funds/FundDetails.aspx?FIXTURECOMMON',
        links: [{ url: FUND_PAGE }],
      }),
    ).toBeNull();
  });

  it('cites no fund for a row without a record-specific fund page', () => {
    expect(
      fundKeyCitedByFellowship({
        applicationLink: 'https://yale.communityforce.com/Funds/Search.aspx',
      }),
    ).toBeNull();
  });
});

describe('preferFundFacetObservations', () => {
  const lane = (id: string, field: string) => ({
    _id: id,
    field,
    sourceName: 'yale-college-fellowships-office',
  });
  const fund = (id: string, field: string) => ({
    _id: id,
    field,
    sourceName: 'student-grants-database',
  });

  it("replaces another lane's inference of a facet the fund states", () => {
    expect(
      preferFundFacetObservations(
        [lane('a', 'purpose'), lane('b', 'title'), lane('c', 'termOfAward')],
        [fund('f1', 'purpose')],
      ).map((observation) => observation._id),
    ).toEqual(['b', 'c', 'f1']);
  });

  it('leaves a facet the fund does not state, and every other field, to the lanes', () => {
    expect(
      preferFundFacetObservations([lane('a', 'purpose'), lane('b', 'title')], []).map(
        (observation) => observation._id,
      ),
    ).toEqual(['a', 'b']);
  });

  it('never admits a non-facet field or another source through the fund evidence', () => {
    expect(
      preferFundFacetObservations(
        [lane('a', 'purpose')],
        [fund('f1', 'description'), lane('x', 'purpose')],
      ).map((observation) => observation._id),
    ).toEqual(['a']);
  });

  it('does not read a fund observation the pass already holds twice', () => {
    const own = fund('f1', 'purpose');
    expect(preferFundFacetObservations([own], [own])).toEqual([own]);
  });
});

describe('fund facets on another lane row (#4173)', () => {
  it("lets the fund's facets write over an owning lane's stored value", () => {
    expect(
      fellowshipFieldsWithheldBySourcePrecedence({
        stored: {
          sourceName: 'yale-college-fellowships-office',
          purpose: ['Travel'],
          summary: 'Stored summary.',
        },
        staged: { purpose: ['Research'], summary: 'Catalog summary.' },
        resolved: {
          purpose: { contributingSources: ['student-grants-database'] },
          summary: { contributingSources: ['student-grants-database'] },
        },
        fundTitle: undefined,
      }),
    ).toEqual(['summary']);
  });
});

describe('fundFacetsDescribeProgram (#4173)', () => {
  it("takes a fund's facets for its own program written differently", () => {
    expect(
      fundFacetsDescribeProgram(
        'Fixture Fellowships for Baltic Studies',
        'Fixture Fellowship for Baltic Studies',
      ),
    ).toBe(true);
    expect(
      fundFacetsDescribeProgram(
        'Fixture Journalism Fellowship',
        'Summer Journalism Fellowships: Fixture',
      ),
    ).toBe(true);
    expect(fundFacetsDescribeProgram('Fixture Fellowship', undefined)).toBe(true);
  });

  it('refuses the facets of a common application that admits to many funds', () => {
    expect(
      fundFacetsDescribeProgram(
        'Fixture Postgraduate Fellowships',
        'Fixture Postgraduate Fellowships Common Application',
      ),
    ).toBe(false);
  });

  it('refuses the facets of a sibling award at another level', () => {
    expect(
      fundFacetsDescribeProgram(
        'Fixture Undergraduate Travel Fellowship',
        'Fixture Postgraduate Fellowship',
      ),
    ).toBe(false);
    expect(
      fundFacetsDescribeProgram(
        'Fixture Graduate Research Grant',
        'Fixture Undergraduate Research Grant',
      ),
    ).toBe(false);
  });
});

describe('the fund pass on another lane row whose fund names a different program (#4173)', () => {
  it("withholds a common application's facets from the program row it reaches", () => {
    expect(
      fellowshipFieldsWithheldBySourcePrecedence({
        stored: {
          sourceName: 'yale-college-fellowships-office',
          title: 'Fixture Postgraduate Fellowships',
          purpose: ['Service'],
        },
        staged: {
          title: 'Fixture Postgraduate Fellowships Common Application',
          purpose: ['Research'],
        },
        resolved: {
          title: { contributingSources: ['student-grants-database'] },
          purpose: { contributingSources: ['student-grants-database'] },
        },
        fundTitle: 'Fixture Postgraduate Fellowships Common Application',
      }),
    ).toEqual(['title', 'purpose']);
  });

  it("reads the fund's title from its observations when the row's locked title is not staged", () => {
    const fundObservations = [
      {
        sourceName: 'student-grants-database',
        field: 'title',
        value: 'Fixture Postgraduate Fellowship',
        observedAt: new Date('2026-01-01T00:00:00Z'),
      },
      {
        sourceName: 'student-grants-database',
        field: 'title',
        value: 'Fixture Postgraduate Fellowships Common Application',
        observedAt: new Date('2026-03-01T00:00:00Z'),
      },
      {
        sourceName: 'student-grants-database',
        field: 'purpose',
        value: ['Research'],
        observedAt: new Date('2026-03-01T00:00:00Z'),
      },
    ];
    expect(
      fellowshipFieldsWithheldBySourcePrecedence({
        stored: {
          sourceName: 'yale-college-fellowships-office',
          title: 'Fixture Postgraduate Fellowships',
          purpose: ['Service'],
        },
        staged: { purpose: ['Research'] },
        resolved: { purpose: { contributingSources: ['student-grants-database'] } },
        fundTitle: newestFundTitle(fundObservations),
      }),
    ).toEqual(['purpose']);
  });
});

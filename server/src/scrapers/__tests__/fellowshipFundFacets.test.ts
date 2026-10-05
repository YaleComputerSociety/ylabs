import { describe, expect, it } from 'vitest';
import {
  fundFacetsDescribeProgram,
  fundKeyCitedByFellowship,
  fundSpeaksForFellowship,
  preferFundFacetObservations,
  sourceKeyForFund,
} from '../fellowshipFundFacets';
import {
  fellowshipFieldsWithheldBySourcePrecedence,
  newestFundTitle,
} from '../fellowshipSourcePrecedence';

const FUND_PAGE = 'https://yale.communityforce.com/Funds/FundDetails.aspx?FIXTUREFUND';

describe('fundSpeaksForFellowship', () => {
  it('speaks for a row citing it alone and naming the same program', () => {
    const row = { title: 'Fixture Undergraduate Travel Fellowship', applicationLink: FUND_PAGE };
    expect(fundSpeaksForFellowship(row, 'Fixture Undergraduate Travel Fellowship')).toBe(true);
    expect(fundSpeaksForFellowship(row, 'Fixture Postgraduate Fellowship')).toBe(false);
  });

  it('speaks for no row citing no fund page or two', () => {
    expect(fundSpeaksForFellowship({ title: 'Fixture Fellowship' }, undefined)).toBe(false);
    expect(
      fundSpeaksForFellowship(
        {
          applicationLink: FUND_PAGE,
          links: [{ url: 'https://yale.communityforce.com/Funds/FundDetails.aspx?OTHERFUND' }],
        },
        undefined,
      ),
    ).toBe(false);
  });
});

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
        [fund('f1', 'eligibility'), lane('x', 'purpose')],
      ).map((observation) => observation._id),
    ).toEqual(['a']);
  });

  it("replaces another lane's application window where the fund states one (#4412)", () => {
    expect(
      preferFundFacetObservations(
        [lane('a', 'deadline'), lane('b', 'applicationOpenDate'), lane('c', 'title')],
        [fund('f1', 'deadline'), fund('f2', 'applicationOpenDate')],
      ).map((observation) => observation._id),
    ).toEqual(['c', 'f1', 'f2']);
  });

  it("leaves the lane's window flags when the fund states no window date (#4412)", () => {
    expect(
      preferFundFacetObservations(
        [lane('a', 'deadline'), lane('b', 'isAcceptingApplications'), lane('c', 'reviewRequired')],
        [fund('f1', 'isAcceptingApplications'), fund('f2', 'reviewRequired')],
      ).map((observation) => observation._id),
    ).toEqual(['a', 'b', 'c']);
  });

  it('takes the window flags with a window date the fund states (#4412)', () => {
    expect(
      preferFundFacetObservations(
        [lane('a', 'deadline'), lane('b', 'isAcceptingApplications'), lane('c', 'reviewRequired')],
        [
          fund('f1', 'deadline'),
          fund('f2', 'isAcceptingApplications'),
          fund('f3', 'reviewRequired'),
        ],
      ).map((observation) => observation._id),
    ).toEqual(['f1', 'f2', 'f3']);
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
        fundSpeaksForRow: true,
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
  const rowCitingFund = {
    sourceName: 'yale-college-fellowships-office',
    title: 'Fixture Postgraduate Fellowships',
    applicationLink: FUND_PAGE,
    purpose: ['Service'],
  };

  it("withholds a common application's facets from the program row it reaches", () => {
    expect(
      fellowshipFieldsWithheldBySourcePrecedence({
        stored: rowCitingFund,
        staged: {
          title: 'Fixture Postgraduate Fellowships Common Application',
          purpose: ['Research'],
        },
        resolved: {
          title: { contributingSources: ['student-grants-database'] },
          purpose: { contributingSources: ['student-grants-database'] },
        },
        fundSpeaksForRow: fundSpeaksForFellowship(
          rowCitingFund,
          'Fixture Postgraduate Fellowships Common Application',
        ),
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
        stored: rowCitingFund,
        staged: { purpose: ['Research'] },
        resolved: { purpose: { contributingSources: ['student-grants-database'] } },
        fundSpeaksForRow: fundSpeaksForFellowship(rowCitingFund, newestFundTitle(fundObservations)),
      }),
    ).toEqual(['purpose']);
  });
});

describe('a retired fund on the row that applies through it (#4174)', () => {
  const archivedBy = (id: string, sourceName: string, value: boolean, observedAt: string) => ({
    _id: id,
    field: 'archived',
    sourceName,
    value,
    observedAt: new Date(observedAt),
  });

  it("replaces the owning lane's live claim with the fund's newest retirement", () => {
    const owningLane = archivedBy('lane', 'yale-college-fellowships-office', false, '2026-10-02');
    const retirement = archivedBy('fund', 'student-grants-database', true, '2026-10-03');

    expect(preferFundFacetObservations([owningLane], [retirement])).toEqual([retirement]);
  });

  it('never revives a row from a live fund, nor retires it once the fund is back', () => {
    const owningLane = archivedBy('lane', 'yale-college-fellowships-office', true, '2026-10-02');
    const live = archivedBy('fund-live', 'student-grants-database', false, '2026-10-01');
    const retired = archivedBy('fund-old', 'student-grants-database', true, '2026-09-01');
    const back = archivedBy('fund-back', 'student-grants-database', false, '2026-10-03');

    expect(preferFundFacetObservations([owningLane], [live])).toEqual([owningLane]);
    expect(preferFundFacetObservations([owningLane], [retired, back])).toEqual([owningLane]);
  });
});

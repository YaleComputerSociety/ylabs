import { describe, expect, it } from 'vitest';
import {
  fundKeysCitedByFellowship,
  preferFundFacetObservations,
  sourceKeyForFund,
} from '../fellowshipFundFacets';
import { fellowshipFieldsWithheldBySourcePrecedence } from '../fellowshipSourcePrecedence';

const FUND_PAGE = 'https://yale.communityforce.com/Funds/FundDetails.aspx?FIXTUREFUND';

describe('fundKeysCitedByFellowship', () => {
  it('reads the fund key from every link a row cites, once', () => {
    expect(
      fundKeysCitedByFellowship({
        sourceUrl: 'https://fellowships.example.edu/fixture',
        applicationLink: FUND_PAGE,
        links: [{ url: FUND_PAGE.replace('https://', 'http://') }, { url: 'https://example.edu' }],
      }),
    ).toEqual([sourceKeyForFund(FUND_PAGE)]);
  });

  it('cites no fund for a row without a record-specific fund page', () => {
    expect(
      fundKeysCitedByFellowship({
        applicationLink: 'https://yale.communityforce.com/Funds/Search.aspx',
      }),
    ).toEqual([]);
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
      }),
    ).toEqual(['summary']);
  });
});

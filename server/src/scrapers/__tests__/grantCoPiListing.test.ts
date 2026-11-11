import { describe, expect, it } from 'vitest';
import { grantCoPiListedPersonIds } from '../grantCoPiListing';

describe('grantCoPiListedPersonIds (#5776)', () => {
  it('names a lead asserted only by a grant lane on a row with another lead', () => {
    expect(
      grantCoPiListedPersonIds({
        leadFacts: [
          { personId: 'lead', sourceName: 'dept-faculty-roster' },
          { personId: 'co-pi', sourceName: 'nih-reporter' },
          { personId: 'co-pi', sourceName: 'nsf-award-search' },
        ],
        rowLeadPersonIds: ['lead', 'co-pi'],
      }),
    ).toEqual(new Set(['co-pi']));
  });

  it('does not name a sole grant lead, which is a funding shell rather than a listing', () => {
    expect(
      grantCoPiListedPersonIds({
        leadFacts: [{ personId: 'pi', sourceName: 'nih-reporter' }],
        rowLeadPersonIds: ['pi'],
      }),
    ).toEqual(new Set());
  });

  it('does not name a lead that any non-grant lane also asserts on the row', () => {
    expect(
      grantCoPiListedPersonIds({
        leadFacts: [
          { personId: 'lead', sourceName: 'dept-faculty-roster' },
          { personId: 'co-pi', sourceName: 'nih-reporter' },
          { personId: 'co-pi', sourceName: 'official-profile-pi-backfill' },
        ],
        rowLeadPersonIds: ['lead', 'co-pi'],
      }),
    ).toEqual(new Set());
  });

  it('falls back to the edge source name when no lead observation names the person', () => {
    expect(
      grantCoPiListedPersonIds({
        leadFacts: [{ personId: 'lead', sourceName: 'dept-faculty-roster' }],
        rowLeadPersonIds: ['lead', 'co-pi'],
        edgeSourceNameByPerson: new Map([
          ['lead', 'dept-faculty-roster'],
          ['co-pi', 'crossref-grants'],
        ]),
      }),
    ).toEqual(new Set(['co-pi']));
  });

  it('does not name a lead with no recorded source at all', () => {
    expect(
      grantCoPiListedPersonIds({
        leadFacts: [{ personId: 'lead', sourceName: 'dept-faculty-roster' }],
        rowLeadPersonIds: ['lead', 'co-pi'],
      }),
    ).toEqual(new Set());
  });
});

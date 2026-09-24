import { describe, expect, it } from 'vitest';
import {
  citationKey,
  laneNamesByCitation,
  planLeadEdgeSourceNameBackfill,
  type LeadEdgeRow,
} from '../backfillLeadEdgeSourceNameCore';

const edge = (o: Partial<LeadEdgeRow> = {}): LeadEdgeRow => ({
  id: 'e1',
  personId: 'p1',
  entityKey: 'ysm-fixture',
  sourceUrl: 'https://medicine.yale.edu/lab/fixture/',
  ...o,
});

describe('lead-edge sourceName backfill plan (#3254)', () => {
  const lanes = laneNamesByCitation([
    {
      entityKey: 'ysm-fixture',
      sourceUrl: 'https://medicine.yale.edu/lab/fixture/',
      sourceName: 'ysm-atoz-index',
    },
  ]);

  it('recovers the lane from an observation citing the same url on the same row', () => {
    const { plans, outcomes } = planLeadEdgeSourceNameBackfill([edge()], lanes);
    expect(plans).toEqual([{ id: 'e1', sourceName: 'ysm-atoz-index' }]);
    expect(outcomes['recovered-from-observation']).toBe(1);
  });

  it('leaves an edge that already names its lane alone', () => {
    const { plans, outcomes } = planLeadEdgeSourceNameBackfill(
      [edge({ sourceName: 'dept-faculty-roster' })],
      lanes,
    );
    expect(plans).toEqual([]);
    expect(outcomes['already-has-source-name']).toBe(1);
  });

  it('fails closed when two lanes cite the same url, rather than picking one', () => {
    const ambiguous = laneNamesByCitation([
      {
        entityKey: 'ysm-fixture',
        sourceUrl: 'https://medicine.yale.edu/lab/fixture/',
        sourceName: 'ysm-atoz-index',
      },
      {
        entityKey: 'ysm-fixture',
        sourceUrl: 'https://medicine.yale.edu/lab/fixture/',
        sourceName: 'dept-faculty-roster',
      },
    ]);
    const { plans, outcomes } = planLeadEdgeSourceNameBackfill([edge()], ambiguous);
    expect(plans).toEqual([]);
    expect(outcomes['observations-disagree-on-lane']).toBe(1);
  });

  it('fails closed with no url and with no observation citing the url', () => {
    expect(
      planLeadEdgeSourceNameBackfill([edge({ sourceUrl: '' })], lanes).outcomes['no-source-url'],
    ).toBe(1);
    expect(
      planLeadEdgeSourceNameBackfill([edge({ sourceUrl: 'https://example.test/other/' })], lanes)
        .outcomes['no-observation-cites-this-url'],
    ).toBe(1);
  });

  it('keys a citation on the row as well as the url, so another row cannot lend its lane', () => {
    expect(citationKey('a', 'u')).not.toBe(citationKey('b', 'u'));
    const { outcomes } = planLeadEdgeSourceNameBackfill([edge({ entityKey: 'other-row' })], lanes);
    expect(outcomes['no-observation-cites-this-url']).toBe(1);
  });
});

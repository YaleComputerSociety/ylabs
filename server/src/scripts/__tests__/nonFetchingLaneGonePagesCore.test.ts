import { describe, expect, it } from 'vitest';
import { LANE_PAGE_HEALTH_FIELD } from '../../scrapers/lanePageHealth';
import {
  confirmedGoneVerdictObservations,
  planRetiredLaneGonePageRetirement,
  retiredLaneCitedPages,
} from '../nonFetchingLaneGonePagesCore';
import { parseNonFetchingLaneGonePagesArgs, CONFIRM_FLAG } from '../nonFetchingLaneGonePages';

const PAGE = 'https://synthetic-lab.example.edu/people/';
const OTHER_PAGE = 'https://synthetic-lab.example.edu/join/';
const ROW = new Set(['row-1', 'synthetic-lab']);
const at = (day: number) => new Date(Date.UTC(2026, 8, day));

const value = (id: string, sourceName: string, field: string, day: number, sourceUrl = PAGE) => ({
  _id: id,
  sourceName,
  entityKey: 'synthetic-lab',
  field,
  value: `${field} value`,
  sourceUrl,
  observedAt: at(day),
});

const verdict = (
  sourceName: string,
  healthStatus: string,
  code: number | undefined,
  day: number,
) => ({
  _id: `${sourceName}-${healthStatus}-${day}`,
  sourceName,
  entityKey: 'synthetic-lab',
  field: LANE_PAGE_HEALTH_FIELD,
  value: { url: PAGE, healthStatus, ...(code ? { httpStatusCode: code } : {}) },
  sourceUrl: PAGE,
  observedAt: at(day),
});

describe('planRetiredLaneGonePageRetirement', () => {
  it('retires a retired lane observation citing a page another lane recorded gone', () => {
    const cached = value('a', 'research-entity-cache-backfill', 'undergradEvidenceQuote', 1);
    const decision = value('b', 'student-decision-llm', 'studentDecisionExplanation', 1);
    const plan = planRetiredLaneGonePageRetirement({
      observations: [cached, decision, verdict('ysm-faculty-directory', 'UNAVAILABLE', 404, 5)],
      rowIdentities: ROW,
    });
    expect(plan.retire.map((observation) => observation._id)).toEqual(['a', 'b']);
  });

  it('retires nothing on an UNKNOWN verdict or a later live read', () => {
    const cached = value('a', 'research-entity-cache-backfill', 'undergradEvidenceQuote', 1);
    expect(
      planRetiredLaneGonePageRetirement({
        observations: [cached, verdict('ysm-faculty-directory', 'UNKNOWN', 403, 5)],
        rowIdentities: ROW,
      }).retire,
    ).toEqual([]);
    expect(
      planRetiredLaneGonePageRetirement({
        observations: [
          cached,
          verdict('ysm-faculty-directory', 'UNAVAILABLE', 404, 5),
          verdict('lab-site-lead-verification', 'HEALTHY', 200, 6),
        ],
        rowIdentities: ROW,
      }).retire,
    ).toEqual([]);
  });

  it('retires on a probe confirmation and never touches a live lane or another page', () => {
    const cached = value('a', 'research-entity-cache-backfill', 'currentUndergradCount', 1);
    const elsewhere = value(
      'b',
      'research-entity-cache-backfill',
      'undergradEvidenceQuote',
      1,
      OTHER_PAGE,
    );
    const live = value('c', 'lab-microsite-undergrad-llm', 'currentUndergradCount', 1);
    const plan = planRetiredLaneGonePageRetirement({
      observations: [cached, elsewhere, live],
      rowIdentities: ROW,
      confirmedGone: confirmedGoneVerdictObservations(
        { entityKey: 'synthetic-lab' },
        [{ url: PAGE, healthStatus: 'UNAVAILABLE', httpStatusCode: 410 }],
        at(9),
      ),
    });
    expect(plan.retire.map((observation) => observation._id)).toEqual(['a']);
    expect(plan.fieldsLeftWithoutEvidence).toEqual([]);
  });

  it('reports a field the retirement leaves with no other evidence', () => {
    const cached = value('a', 'research-entity-cache-backfill', 'undergradEvidenceQuote', 1);
    const plan = planRetiredLaneGonePageRetirement({
      observations: [cached, verdict('ysm-faculty-directory', 'UNAVAILABLE', 404, 5)],
      rowIdentities: ROW,
    });
    expect(plan.fieldsLeftWithoutEvidence).toEqual(['undergradEvidenceQuote']);
  });

  it('lists each page a retired lane cites once', () => {
    expect(
      retiredLaneCitedPages([
        value('a', 'research-entity-cache-backfill', 'undergradEvidenceQuote', 1),
        value('b', 'student-decision-llm', 'studentDecisionExplanation', 1),
        value('c', 'coverage-synthesis-llm', 'fullDescription', 1, OTHER_PAGE),
      ]),
    ).toEqual([PAGE]);
  });
});

describe('parseNonFetchingLaneGonePagesArgs', () => {
  it('is a dry run by default and refuses an unconfirmed or unallowed apply', () => {
    expect(parseNonFetchingLaneGonePagesArgs([], {}).apply).toBe(false);
    expect(() => parseNonFetchingLaneGonePagesArgs(['--apply'], {})).toThrow(CONFIRM_FLAG);
    expect(() => parseNonFetchingLaneGonePagesArgs(['--apply', CONFIRM_FLAG], {})).toThrow(
      'ALLOW_NON_PROD_SCRAPER_WRITES',
    );
    expect(
      parseNonFetchingLaneGonePagesArgs(['--apply', CONFIRM_FLAG, '--only', 'a,b'], {
        ALLOW_NON_PROD_SCRAPER_WRITES: 'true',
      }),
    ).toMatchObject({ apply: true, only: ['a', 'b'] });
  });
});

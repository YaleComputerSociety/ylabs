import { describe, expect, it } from 'vitest';

import { emeritusCurrentActivityEvidence } from '../emeritusLeadWayIn';
import { servedCurrentFunding } from '../servedCurrentFunding';

const UTC_MIDNIGHT_END = '2026-11-30T00:00:00.000Z';
const NEW_YORK_MIDNIGHT_END = '2026-11-30T05:00:00.000Z';

const NEW_YORK_START_OF_LAST_DAY = Date.parse('2026-11-30T05:00:00.000Z');
const NEW_YORK_NINE_PM_ON_LAST_DAY = Date.parse('2026-12-01T02:00:00.000Z');
const NEW_YORK_LAST_MOMENT_OF_LAST_DAY = Date.parse('2026-12-01T04:59:59.999Z');
const NEW_YORK_MIDNIGHT_AFTER_LAST_DAY = Date.parse('2026-12-01T05:00:00.000Z');

const rowEndingOn = (endDate: string) => ({
  recentGrants: [{ id: 'R01XX000001', agency: 'NIH', endDate }],
  recentGrantCount: 1,
  fundingAgencies: ['NIH'],
});

const servedAwardCount = (endDate: string, now: number) =>
  (servedCurrentFunding(rowEndingOn(endDate), now).recentGrants as unknown[]).length;

const emeritusSeesRunningFunding = (endDate: string, now: number) =>
  emeritusCurrentActivityEvidence({
    entity: rowEndingOn(endDate),
    currentTeamMemberCount: 0,
    now: new Date(now),
  }).includes('running_funding');

describe('an award is current through its last New York calendar day (#6041)', () => {
  it.each([UTC_MIDNIGHT_END, NEW_YORK_MIDNIGHT_END])(
    'serves an award stored as %s all day on its last day in New York',
    (endDate) => {
      for (const now of [
        NEW_YORK_START_OF_LAST_DAY,
        NEW_YORK_NINE_PM_ON_LAST_DAY,
        NEW_YORK_LAST_MOMENT_OF_LAST_DAY,
      ]) {
        expect(servedAwardCount(endDate, now)).toBe(1);
        expect(emeritusSeesRunningFunding(endDate, now)).toBe(true);
      }
    },
  );

  it.each([UTC_MIDNIGHT_END, NEW_YORK_MIDNIGHT_END])(
    'stops serving an award stored as %s at New York midnight after its last day',
    (endDate) => {
      expect(servedCurrentFunding(rowEndingOn(endDate), NEW_YORK_MIDNIGHT_AFTER_LAST_DAY)).toEqual({
        recentGrants: [],
      });
      expect(emeritusSeesRunningFunding(endDate, NEW_YORK_MIDNIGHT_AFTER_LAST_DAY)).toBe(false);
    },
  );

  it('uses the daylight-saving New York midnight for a summer end date', () => {
    const summerEnd = '2026-07-31T00:00:00.000Z';
    expect(servedAwardCount(summerEnd, Date.parse('2026-08-01T03:59:59.999Z'))).toBe(1);
    expect(servedAwardCount(summerEnd, Date.parse('2026-08-01T04:00:00.000Z'))).toBe(0);
  });
});

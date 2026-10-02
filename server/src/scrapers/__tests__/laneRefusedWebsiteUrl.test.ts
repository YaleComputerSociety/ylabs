import { describe, expect, it } from 'vitest';
import {
  REFUSED_WEBSITE_URL_FIELD,
  planLaneWithdrawnWebsiteUrlClear,
  withoutLaneRefusedWebsiteUrls,
} from '../laneRefusedWebsiteUrl';

const LANE = 'ysm-faculty-directory';
const RIVAL = 'dept-faculty-roster';
const KEY = 'ysm-faculty-synthetic-person';
const ROW_ID = '64b000000000000000000001';
const LAB = 'https://syntheticlab.example.org/';
const OLD = new Date('2026-08-01T00:00:00Z');
const NEW = new Date('2026-09-01T00:00:00Z');
const ROW = new Set([KEY, ROW_ID]);

const observation = (overrides: Record<string, unknown>) => ({
  sourceName: LANE,
  entityKey: KEY,
  field: 'websiteUrl',
  value: LAB,
  observedAt: OLD,
  ...overrides,
});

describe('withoutLaneRefusedWebsiteUrls (#3926)', () => {
  it('withdraws the lane own older assertion of the link it later refused', () => {
    const asserted = observation({});
    const result = withoutLaneRefusedWebsiteUrls(
      [asserted, observation({ field: REFUSED_WEBSITE_URL_FIELD, observedAt: NEW })],
      ROW,
    );
    expect(result.observations).toEqual([]);
    expect(result.withdrawnValues).toEqual([LAB]);
  });

  it('bridges the two identity forms of the same row', () => {
    const result = withoutLaneRefusedWebsiteUrls(
      [
        observation({ entityKey: undefined, entityId: ROW_ID }),
        observation({ field: REFUSED_WEBSITE_URL_FIELD, observedAt: NEW }),
      ],
      ROW,
    );
    expect(result.withdrawnValues).toEqual([LAB]);
  });

  it('keeps an assertion newer than the refusal', () => {
    const readopted = observation({ observedAt: NEW });
    const result = withoutLaneRefusedWebsiteUrls(
      [readopted, observation({ field: REFUSED_WEBSITE_URL_FIELD, observedAt: OLD })],
      ROW,
    );
    expect(result.observations).toEqual([readopted]);
    expect(result.withdrawnValues).toEqual([]);
  });

  it('never withdraws another lane, and keeps the value clearable only when no other lane states it', () => {
    const rivalAssertion = observation({ sourceName: RIVAL });
    const result = withoutLaneRefusedWebsiteUrls(
      [
        observation({}),
        rivalAssertion,
        observation({ field: REFUSED_WEBSITE_URL_FIELD, observedAt: NEW }),
      ],
      ROW,
    );
    expect(result.observations).toEqual([rivalAssertion]);
    expect(result.withdrawnValues).toEqual([]);
  });

  it('does not let the lane own older citation of the link keep it standing', () => {
    const oldCitation = observation({
      field: 'sourceUrls',
      value: ['https://x.example.org/', LAB],
    });
    const result = withoutLaneRefusedWebsiteUrls(
      [
        observation({}),
        oldCitation,
        observation({ field: REFUSED_WEBSITE_URL_FIELD, observedAt: NEW }),
      ],
      ROW,
    );
    expect(result.observations).toEqual([oldCitation]);
    expect(result.withdrawnValues).toEqual([LAB]);
  });

  it('withdraws only the refused link, on the same key', () => {
    const otherLink = observation({ value: 'https://another.example.org/' });
    const otherKey = observation({ entityKey: 'ysm-faculty-someone-else' });
    const result = withoutLaneRefusedWebsiteUrls(
      [otherLink, otherKey, observation({ field: REFUSED_WEBSITE_URL_FIELD, observedAt: NEW })],
      ROW,
    );
    expect(result.observations).toEqual([otherLink, otherKey]);
    expect(result.withdrawnValues).toEqual([]);
  });
});

describe('planLaneWithdrawnWebsiteUrlClear (#3926)', () => {
  const plan = (overrides: Partial<Parameters<typeof planLaneWithdrawnWebsiteUrlClear>[0]> = {}) =>
    planLaneWithdrawnWebsiteUrlClear({
      stored: { websiteUrl: 'http://www.syntheticlab.example.org' },
      staged: {},
      withdrawnValues: [LAB],
      lockedFields: [],
      ...overrides,
    });

  it('clears a stored value its lane withdrew, matched by website identity', () => {
    expect(plan()).toBe(true);
  });

  it('respects a lock, a staged rival value, and an empty withdrawal', () => {
    expect(plan({ lockedFields: ['websiteUrl'] })).toBe(false);
    expect(plan({ staged: { websiteUrl: 'https://another.example.org/' } })).toBe(false);
    expect(plan({ withdrawnValues: [] })).toBe(false);
  });
});

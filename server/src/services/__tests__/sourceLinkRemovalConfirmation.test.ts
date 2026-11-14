import { describe, expect, it } from 'vitest';

import { CONNECTION_FAILURE_CONFIRMATION_GAP_MS, type SourceLinkHealth } from '../sourceLinkHealth';
import {
  RemovalsByHost,
  removalConfirmation,
  type StoredRemovalVerdict,
} from '../sourceLinkRemovalConfirmation';

const NOW = new Date('2026-11-14T12:00:00Z');
const hoursBefore = (hours: number) => new Date(NOW.getTime() - hours * 60 * 60 * 1000);

const goneStored = (status = 404): StoredRemovalVerdict => ({
  healthStatus: 'UNAVAILABLE',
  httpStatusCode: status,
  checkedAt: hoursBefore(1),
});
const nameAbsentStored = (hoursAgo = 7): StoredRemovalVerdict => ({
  healthStatus: 'UNAVAILABLE',
  nameNotFound: true,
  checkedAt: hoursBefore(hoursAgo),
});
const connectionStored = (hoursAgo = 7): StoredRemovalVerdict => ({
  healthStatus: 'UNAVAILABLE',
  checkedAt: hoursBefore(hoursAgo),
  confirmingConnectionFailureAt: hoursBefore(hoursAgo),
});

const freshGone = (status = 404): SourceLinkHealth => ({
  healthStatus: 'UNAVAILABLE',
  httpStatusCode: status,
});
const freshNameAbsent: SourceLinkHealth = { healthStatus: 'UNAVAILABLE', nameNotFound: true };
const freshRefused: SourceLinkHealth = {
  healthStatus: 'UNAVAILABLE',
  connectionLevelFailure: true,
};

describe('removalConfirmation (#6264)', () => {
  describe('the gone-twice contract', () => {
    it.each([404, 410])('confirms a stored %s that a fresh probe agrees with', (status) => {
      expect(removalConfirmation(goneStored(status), freshGone(status), NOW)).toEqual({
        confirmed: true,
        basis: 'gone-status',
      });
    });

    it('never removes on a fresh probe alone', () => {
      expect(removalConfirmation(undefined, freshGone(), NOW)).toEqual({
        confirmed: false,
        reason: 'no-stored-verdict',
      });
    });

    it('never removes on a stored verdict the fresh probe contradicts', () => {
      expect(
        removalConfirmation(goneStored(), { healthStatus: 'HEALTHY', httpStatusCode: 200 }, NOW),
      ).toEqual({ confirmed: false, reason: 'probe-disagrees' });
    });

    it('never removes when the stored verdict is not gone', () => {
      expect(
        removalConfirmation({ healthStatus: 'HEALTHY', httpStatusCode: 200 }, freshGone(), NOW),
      ).toEqual({ confirmed: false, reason: 'stored-not-gone' });
    });

    it.each([403, 429, 503])('never treats an observed %s as gone', (status) => {
      expect(
        removalConfirmation(goneStored(), { healthStatus: 'UNKNOWN', httpStatusCode: status }, NOW),
      ).toEqual({ confirmed: false, reason: 'probe-disagrees' });
    });
  });

  describe('condition 1: a probe that observed nothing never confirms', () => {
    it.each([
      ['our own host pause or an excluded host', { healthStatus: 'UNKNOWN', excludedHost: true }],
      ['a timeout or reset', { healthStatus: 'UNKNOWN' }],
    ] as const)('holds after %s', (_label, fresh) => {
      expect(removalConfirmation(nameAbsentStored(), fresh as SourceLinkHealth, NOW)).toEqual({
        confirmed: false,
        reason: 'probe-disagrees',
      });
    });

    it('holds for a Yale host that resolves only privately on campus (#6123)', () => {
      const splitHorizon: SourceLinkHealth = {
        healthStatus: 'UNAVAILABLE',
        privateAddressHost: true,
      };
      expect(removalConfirmation(nameAbsentStored(), splitHorizon, NOW)).toEqual({
        confirmed: false,
        reason: 'private-address',
      });
      expect(
        removalConfirmation(
          { ...nameAbsentStored(), privateAddressHost: true },
          freshNameAbsent,
          NOW,
        ),
      ).toEqual({ confirmed: false, reason: 'private-address' });
    });
  });

  describe('condition 2: host-level evidence needs the same class at least 6 hours apart', () => {
    it('confirms a DNS negative seen again 6 hours or more later', () => {
      expect(removalConfirmation(nameAbsentStored(7), freshNameAbsent, NOW)).toEqual({
        confirmed: true,
        basis: 'name-absent',
      });
    });

    it('confirms a refused connection seen again 6 hours or more later', () => {
      expect(removalConfirmation(connectionStored(7), freshRefused, NOW)).toEqual({
        confirmed: true,
        basis: 'connection-refused',
      });
    });

    it('holds two host-level observations less than 6 hours apart', () => {
      const justUnder = (CONNECTION_FAILURE_CONFIRMATION_GAP_MS - 60_000) / (60 * 60 * 1000);
      expect(removalConfirmation(nameAbsentStored(justUnder), freshNameAbsent, NOW)).toEqual({
        confirmed: false,
        reason: 'too-soon',
      });
    });

    it('holds a stored verdict with no readable check time', () => {
      expect(
        removalConfirmation(
          { healthStatus: 'UNAVAILABLE', nameNotFound: true },
          freshNameAbsent,
          NOW,
        ),
      ).toEqual({ confirmed: false, reason: 'too-soon' });
    });

    it('holds a stored verdict written before its failure class was recorded', () => {
      expect(
        removalConfirmation(
          { healthStatus: 'UNAVAILABLE', checkedAt: hoursBefore(48) },
          freshNameAbsent,
          NOW,
        ),
      ).toEqual({ confirmed: false, reason: 'class-unknown' });
    });

    it('holds a fresh host-level failure that carries no class', () => {
      expect(removalConfirmation(nameAbsentStored(), { healthStatus: 'UNAVAILABLE' }, NOW)).toEqual(
        { confirmed: false, reason: 'class-unknown' },
      );
    });

    it.each([
      ['a DNS negative then a refused connection', nameAbsentStored(), freshRefused],
      ['a refused connection then a DNS negative', connectionStored(), freshNameAbsent],
      ['a gone page then a DNS negative', goneStored(), freshNameAbsent],
      ['a DNS negative then a gone page', nameAbsentStored(), freshGone()],
    ] as const)('holds two observations of different classes: %s', (_label, stored, fresh) => {
      expect(removalConfirmation(stored, fresh, NOW)).toEqual({
        confirmed: false,
        reason: 'probe-disagrees',
      });
    });
  });
});

describe('RemovalsByHost (#6264, condition 3)', () => {
  it('reports a lapsed domain as one line with its count', () => {
    const tally = new RemovalsByHost();
    tally.record('https://lapsed.example.edu/lab-a/', 'name-absent');
    tally.record('https://www.lapsed.example.edu/lab-b/', 'name-absent');
    tally.record('https://other.example.edu/gone/', 'gone-status');
    expect(tally.toReport()).toEqual([
      { host: 'lapsed.example.edu', count: 2, byBasis: { 'name-absent': 2 } },
      { host: 'other.example.edu', count: 1, byBasis: { 'gone-status': 1 } },
    ]);
  });
});

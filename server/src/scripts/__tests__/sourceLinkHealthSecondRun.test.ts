import { describe, expect, it } from 'vitest';

import { classifySourceLinkHealth } from '../../services/sourceLinkHealth';
import {
  CONNECTION_FAILURE_CONFIRMATION_GAP_MS,
  isFreshHealthySourceLinkVerdict,
  resolveSourceLinkHealthEntry,
  type StoredSourceLinkHealthEntry,
} from '../backfillSourceLinkHealthCore';

const URL_A = 'https://lab.example.edu/research/';
const CHECKED = new Date('2026-11-01T00:00:00.000Z');
const FIRST_RUN = new Date('2026-11-10T00:00:00.000Z');
const FIRST_RUN_PROBE = new Date('2026-11-10T00:05:00.000Z');
const SECOND_RUN = new Date('2026-11-11T00:00:00.000Z');
const SECOND_RUN_PROBE = new Date('2026-11-11T00:05:00.000Z');

const refused = () => classifySourceLinkHealth({ errorCode: 'ECONNREFUSED', requestedUrl: URL_A });

const storedHealthy: StoredSourceLinkHealthEntry = {
  url: URL_A,
  healthStatus: 'HEALTHY',
  httpStatusCode: 200,
  checkedAt: CHECKED,
};

const pendingSinceFirstRun: StoredSourceLinkHealthEntry = {
  ...storedHealthy,
  lastAttemptedAt: FIRST_RUN_PROBE,
  pendingConnectionFailureAt: FIRST_RUN,
  pendingConnectionFailureProbedAt: FIRST_RUN_PROBE,
};

describe('a connection failure waits for a second run before retiring a live link (#6116)', () => {
  it('keeps a stored HEALTHY verdict on a first refused connection and records it as pending', () => {
    const resolved = resolveSourceLinkHealthEntry(
      URL_A,
      refused(),
      storedHealthy,
      FIRST_RUN_PROBE,
      FIRST_RUN,
    );
    expect(resolved.heldConnectionFailure).toBe(true);
    expect(resolved.entry).toEqual(pendingSinceFirstRun);
  });

  it('records UNAVAILABLE when a different, later run sees the same refusal', () => {
    const first = resolveSourceLinkHealthEntry(
      URL_A,
      refused(),
      storedHealthy,
      FIRST_RUN_PROBE,
      FIRST_RUN,
    );
    expect(first.entry.healthStatus).toBe('HEALTHY');
    const resolved = resolveSourceLinkHealthEntry(
      URL_A,
      refused(),
      first.entry,
      SECOND_RUN_PROBE,
      SECOND_RUN,
    );
    expect(resolved.heldConnectionFailure).toBeUndefined();
    expect(resolved.entry).toEqual({
      url: URL_A,
      healthStatus: 'UNAVAILABLE',
      checkedAt: SECOND_RUN_PROBE,
      pendingConnectionFailureAt: FIRST_RUN,
      pendingConnectionFailureProbedAt: FIRST_RUN_PROBE,
      confirmingConnectionFailureAt: SECOND_RUN,
    });
  });

  it('does not count a second refusal within the same run as confirmation', () => {
    const resolved = resolveSourceLinkHealthEntry(
      URL_A,
      refused(),
      pendingSinceFirstRun,
      new Date('2026-11-10T00:40:00.000Z'),
      FIRST_RUN,
    );
    expect(resolved.heldConnectionFailure).toBe(true);
    expect(resolved.entry.healthStatus).toBe('HEALTHY');
    expect(resolved.entry.pendingConnectionFailureAt).toEqual(FIRST_RUN);
  });

  it('clears the pending failure when the host answers in between', () => {
    const healthy = resolveSourceLinkHealthEntry(
      URL_A,
      classifySourceLinkHealth({ status: 200, requestedUrl: URL_A, finalUrl: URL_A }),
      pendingSinceFirstRun,
      SECOND_RUN_PROBE,
      SECOND_RUN,
    );
    expect(healthy.entry).toEqual({
      url: URL_A,
      healthStatus: 'HEALTHY',
      httpStatusCode: 200,
      checkedAt: SECOND_RUN_PROBE,
    });

    const throttled = resolveSourceLinkHealthEntry(
      URL_A,
      classifySourceLinkHealth({ status: 403, requestedUrl: URL_A }),
      pendingSinceFirstRun,
      SECOND_RUN_PROBE,
      SECOND_RUN,
    );
    expect(throttled.entry.healthStatus).toBe('HEALTHY');
    expect(throttled.entry.pendingConnectionFailureAt).toBeUndefined();

    const third = resolveSourceLinkHealthEntry(
      URL_A,
      refused(),
      healthy.entry,
      new Date('2026-11-12T00:05:00.000Z'),
      new Date('2026-11-12T00:00:00.000Z'),
    );
    expect(third.entry.healthStatus).toBe('HEALTHY');
    expect(third.entry.pendingConnectionFailureAt).toEqual(new Date('2026-11-12T00:00:00.000Z'));
  });

  it('keeps the pending failure through a probe that never reached the host', () => {
    const resolved = resolveSourceLinkHealthEntry(
      URL_A,
      classifySourceLinkHealth({ errorCode: 'ETIMEDOUT', requestedUrl: URL_A }),
      pendingSinceFirstRun,
      SECOND_RUN_PROBE,
      SECOND_RUN,
    );
    expect(resolved.entry.healthStatus).toBe('HEALTHY');
    expect(resolved.entry.pendingConnectionFailureAt).toEqual(FIRST_RUN);
  });

  it('holds an unroutable host the same way as a refused one', () => {
    for (const errorCode of ['EHOSTUNREACH', 'ENETUNREACH']) {
      const resolved = resolveSourceLinkHealthEntry(
        URL_A,
        classifySourceLinkHealth({ errorCode, requestedUrl: URL_A }),
        storedHealthy,
        FIRST_RUN_PROBE,
        FIRST_RUN,
      );
      expect(resolved.entry).toEqual(pendingSinceFirstRun);
    }
  });

  it('still retires a link at once on a confirmed DNS negative', () => {
    const resolved = resolveSourceLinkHealthEntry(
      URL_A,
      classifySourceLinkHealth({ errorCode: 'ENOTFOUND', requestedUrl: URL_A }),
      storedHealthy,
      FIRST_RUN_PROBE,
      FIRST_RUN,
    );
    expect(resolved.heldConnectionFailure).toBeUndefined();
    expect(resolved.entry).toEqual({
      url: URL_A,
      healthStatus: 'UNAVAILABLE',
      checkedAt: FIRST_RUN_PROBE,
    });
  });

  it('still retires a link at once on a gone status code', () => {
    for (const status of [404, 410]) {
      const resolved = resolveSourceLinkHealthEntry(
        URL_A,
        classifySourceLinkHealth({ status, requestedUrl: URL_A }),
        storedHealthy,
        FIRST_RUN_PROBE,
        FIRST_RUN,
      );
      expect(resolved.heldConnectionFailure).toBeUndefined();
      expect(resolved.entry).toEqual({
        url: URL_A,
        healthStatus: 'UNAVAILABLE',
        httpStatusCode: status,
        checkedAt: FIRST_RUN_PROBE,
      });
    }
  });

  it('leaves the probe classification of a refused connection unchanged', () => {
    expect(refused().healthStatus).toBe('UNAVAILABLE');
    expect(refused().httpStatusCode).toBeUndefined();
    expect(
      classifySourceLinkHealth({ errorCode: 'ENOTFOUND' }).connectionLevelFailure,
    ).toBeUndefined();
  });

  it('holds a first refused connection over a stored REDIRECTED verdict as over HEALTHY', () => {
    const storedRedirected: StoredSourceLinkHealthEntry = {
      url: URL_A,
      healthStatus: 'REDIRECTED',
      httpStatusCode: 302,
      checkedAt: CHECKED,
    };
    const first = resolveSourceLinkHealthEntry(
      URL_A,
      refused(),
      storedRedirected,
      FIRST_RUN_PROBE,
      FIRST_RUN,
    );
    expect(first.entry).toEqual({
      ...storedRedirected,
      lastAttemptedAt: FIRST_RUN_PROBE,
      pendingConnectionFailureAt: FIRST_RUN,
      pendingConnectionFailureProbedAt: FIRST_RUN_PROBE,
    });
    const second = resolveSourceLinkHealthEntry(
      URL_A,
      refused(),
      first.entry,
      SECOND_RUN_PROBE,
      SECOND_RUN,
    );
    expect(second.entry).toEqual({
      url: URL_A,
      healthStatus: 'UNAVAILABLE',
      checkedAt: SECOND_RUN_PROBE,
      pendingConnectionFailureAt: FIRST_RUN,
      pendingConnectionFailureProbedAt: FIRST_RUN_PROBE,
      confirmingConnectionFailureAt: SECOND_RUN,
    });
  });

  it('holds nothing over a stored UNAVAILABLE verdict, which the refusal renews as before', () => {
    const resolved = resolveSourceLinkHealthEntry(
      URL_A,
      refused(),
      { url: URL_A, healthStatus: 'UNAVAILABLE', checkedAt: CHECKED },
      FIRST_RUN_PROBE,
      FIRST_RUN,
    );
    expect(resolved.heldConnectionFailure).toBeUndefined();
    expect(resolved.entry).toEqual({
      url: URL_A,
      healthStatus: 'UNAVAILABLE',
      checkedAt: FIRST_RUN_PROBE,
    });
  });

  it('re-probes a fresh HEALTHY verdict that holds a pending failure', () => {
    expect(isFreshHealthySourceLinkVerdict(storedHealthy, 30, FIRST_RUN)).toBe(true);
    expect(isFreshHealthySourceLinkVerdict(pendingSinceFirstRun, 30, FIRST_RUN)).toBe(false);
  });
});

describe('a confirming connection failure must come at least six hours after the first (#6116)', () => {
  const MINUTE_MS = 60_000;
  const HOUR_MS = 60 * MINUTE_MS;
  const after = (ms: number) => new Date(FIRST_RUN.getTime() + ms);
  const refusedInRunStartedAt = (stored: StoredSourceLinkHealthEntry, runStartedAt: Date) =>
    resolveSourceLinkHealthEntry(
      URL_A,
      refused(),
      stored,
      new Date(runStartedAt.getTime() + 5 * MINUTE_MS),
      runStartedAt,
    );

  it('names a six-hour gap', () => {
    expect(CONNECTION_FAILURE_CONFIRMATION_GAP_MS).toBe(6 * HOUR_MS);
  });

  it('does not confirm on a resumed run five minutes later', () => {
    const resolved = refusedInRunStartedAt(pendingSinceFirstRun, after(5 * MINUTE_MS));
    expect(resolved.heldConnectionFailure).toBe(true);
    expect(resolved.entry.healthStatus).toBe('HEALTHY');
    expect(resolved.entry.pendingConnectionFailureAt).toEqual(FIRST_RUN);
    expect(resolved.entry.confirmingConnectionFailureAt).toBeUndefined();
  });

  it('does not confirm on a different run five hours and fifty-nine minutes later', () => {
    const resolved = refusedInRunStartedAt(
      pendingSinceFirstRun,
      after(5 * HOUR_MS + 59 * MINUTE_MS),
    );
    expect(resolved.heldConnectionFailure).toBe(true);
    expect(resolved.entry.healthStatus).toBe('HEALTHY');
    expect(resolved.entry.pendingConnectionFailureAt).toEqual(FIRST_RUN);
  });

  it('confirms on a run exactly six hours later', () => {
    const resolved = refusedInRunStartedAt(pendingSinceFirstRun, after(6 * HOUR_MS));
    expect(resolved.heldConnectionFailure).toBeUndefined();
    expect(resolved.entry.healthStatus).toBe('UNAVAILABLE');
  });

  it('confirms on a run seven hours later and records both failure times', () => {
    const resolved = refusedInRunStartedAt(pendingSinceFirstRun, after(7 * HOUR_MS));
    expect(resolved.entry).toEqual({
      url: URL_A,
      healthStatus: 'UNAVAILABLE',
      checkedAt: after(7 * HOUR_MS + 5 * MINUTE_MS),
      pendingConnectionFailureAt: FIRST_RUN,
      pendingConnectionFailureProbedAt: FIRST_RUN_PROBE,
      confirmingConnectionFailureAt: after(7 * HOUR_MS),
    });
  });

  it('keeps the first failure time through repeated failures inside the gap', () => {
    let entry = pendingSinceFirstRun;
    for (const hours of [1, 3, 5]) {
      const resolved = refusedInRunStartedAt(entry, after(hours * HOUR_MS));
      expect(resolved.entry.healthStatus).toBe('HEALTHY');
      expect(resolved.entry.pendingConnectionFailureAt).toEqual(FIRST_RUN);
      entry = resolved.entry;
    }
    expect(refusedInRunStartedAt(entry, after(6 * HOUR_MS)).entry.healthStatus).toBe('UNAVAILABLE');
  });

  it('never confirms from an invalid stored failure time', () => {
    const corrupt = {
      ...storedHealthy,
      pendingConnectionFailureAt: new Date('not a date'),
    };
    const resolved = refusedInRunStartedAt(corrupt, after(30 * 24 * HOUR_MS));
    expect(resolved.heldConnectionFailure).toBe(true);
    expect(resolved.entry.healthStatus).toBe('HEALTHY');
    expect(resolved.entry.confirmingConnectionFailureAt).toBeUndefined();
  });

  it('keeps both failure times while the refusal continues over the confirmed verdict', () => {
    const confirmed = refusedInRunStartedAt(pendingSinceFirstRun, after(7 * HOUR_MS)).entry;
    const later = refusedInRunStartedAt(confirmed, after(30 * HOUR_MS)).entry;
    expect(later.healthStatus).toBe('UNAVAILABLE');
    expect(later.pendingConnectionFailureAt).toEqual(FIRST_RUN);
    expect(later.confirmingConnectionFailureAt).toEqual(after(7 * HOUR_MS));
  });

  it('does not confirm when the two failures were probed minutes apart across run starts six hours apart', () => {
    const lateFirstProbe = resolveSourceLinkHealthEntry(
      URL_A,
      refused(),
      storedHealthy,
      after(5 * HOUR_MS + 50 * MINUTE_MS),
      FIRST_RUN,
    ).entry;
    const earlySecondProbe = refusedInRunStartedAt(lateFirstProbe, after(6 * HOUR_MS));
    expect(earlySecondProbe.heldConnectionFailure).toBe(true);
    expect(earlySecondProbe.entry.healthStatus).toBe('HEALTHY');
    expect(earlySecondProbe.entry.pendingConnectionFailureProbedAt).toEqual(
      after(5 * HOUR_MS + 50 * MINUTE_MS),
    );

    const laterRun = refusedInRunStartedAt(earlySecondProbe.entry, after(12 * HOUR_MS));
    expect(laterRun.entry.healthStatus).toBe('UNAVAILABLE');
    expect(laterRun.entry.pendingConnectionFailureAt).toEqual(FIRST_RUN);
    expect(laterRun.entry.confirmingConnectionFailureAt).toEqual(after(12 * HOUR_MS));
  });

  it('never confirms a pending failure whose probe time is missing until a probe records one', () => {
    const { pendingConnectionFailureProbedAt: _probe, ...withoutProbe } = pendingSinceFirstRun;
    const resolved = refusedInRunStartedAt(withoutProbe, after(7 * HOUR_MS));
    expect(resolved.heldConnectionFailure).toBe(true);
    expect(resolved.entry.pendingConnectionFailureAt).toEqual(FIRST_RUN);
    expect(resolved.entry.pendingConnectionFailureProbedAt).toEqual(
      after(7 * HOUR_MS + 5 * MINUTE_MS),
    );
  });
});

describe('a held or confirmed connection failure keeps the verified https spelling (#6116)', () => {
  const PLAIN_URL = 'http://lab.example.edu/research/';
  const SPELLING = 'https://lab.example.edu/research/';
  const refusedWithSpelling = () => ({
    ...classifySourceLinkHealth({ errorCode: 'ECONNREFUSED', requestedUrl: PLAIN_URL }),
    httpsSpellingUrl: SPELLING,
  });
  const storedPlainHealthy: StoredSourceLinkHealthEntry = {
    url: PLAIN_URL,
    healthStatus: 'HEALTHY',
    httpStatusCode: 200,
    checkedAt: CHECKED,
  };

  it('records the fresh spelling on the held entry, on confirmation, and while the refusal continues', () => {
    const held = resolveSourceLinkHealthEntry(
      PLAIN_URL,
      refusedWithSpelling(),
      { ...storedPlainHealthy, httpsSpellingUrl: 'https://old.example.edu/research/' },
      FIRST_RUN_PROBE,
      FIRST_RUN,
    );
    expect(held.heldConnectionFailure).toBe(true);
    expect(held.entry.httpsSpellingUrl).toBe(SPELLING);

    const { httpsSpellingUrl: _held, ...heldWithoutSpelling } = held.entry;
    const confirmed = resolveSourceLinkHealthEntry(
      PLAIN_URL,
      refusedWithSpelling(),
      heldWithoutSpelling,
      SECOND_RUN_PROBE,
      SECOND_RUN,
    );
    expect(confirmed.entry.healthStatus).toBe('UNAVAILABLE');
    expect(confirmed.entry.httpsSpellingUrl).toBe(SPELLING);

    const { httpsSpellingUrl: _confirmed, ...confirmedWithoutSpelling } = confirmed.entry;
    const continuing = resolveSourceLinkHealthEntry(
      PLAIN_URL,
      refusedWithSpelling(),
      confirmedWithoutSpelling,
      new Date('2026-11-12T00:05:00.000Z'),
      new Date('2026-11-12T00:00:00.000Z'),
    );
    expect(continuing.entry.healthStatus).toBe('UNAVAILABLE');
    expect(continuing.entry.httpsSpellingUrl).toBe(SPELLING);
  });
});

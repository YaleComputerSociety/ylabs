import { describe, expect, it } from 'vitest';
import {
  daysSinceOutreach,
  FOLLOW_UP_STALE_THRESHOLD_DAYS,
  isStaleUnansweredOutreach,
  MAX_STUDENT_FOLLOW_UPS,
  type FollowUpEligibilityInput,
} from '../studentFollowUpEligibility';

const NOW = new Date('2026-01-20T12:00:00.000Z');
const daysAgo = (days: number): Date => new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);

const baseInput = (overrides: Partial<FollowUpEligibilityInput> = {}): FollowUpEligibilityInput => ({
  latestReachedOutAt: daysAgo(FOLLOW_UP_STALE_THRESHOLD_DAYS + 1),
  latestOutcome: 'unknown',
  hasTerminalOutcome: false,
  followUpsSent: 0,
  dismissedAt: null,
  ...overrides,
});

describe('isStaleUnansweredOutreach', () => {
  it('is eligible when outreach is older than the threshold and still open', () => {
    expect(isStaleUnansweredOutreach(baseInput(), { now: NOW })).toBe(true);
  });

  it('is not eligible when the student never reached out', () => {
    expect(
      isStaleUnansweredOutreach(baseInput({ latestReachedOutAt: null }), { now: NOW }),
    ).toBe(false);
  });

  it('is not eligible before the stale threshold elapses', () => {
    expect(
      isStaleUnansweredOutreach(
        baseInput({ latestReachedOutAt: daysAgo(FOLLOW_UP_STALE_THRESHOLD_DAYS - 1) }),
        { now: NOW },
      ),
    ).toBe(false);
  });

  it('is eligible exactly at the stale threshold', () => {
    expect(
      isStaleUnansweredOutreach(
        baseInput({ latestReachedOutAt: daysAgo(FOLLOW_UP_STALE_THRESHOLD_DAYS) }),
        { now: NOW },
      ),
    ).toBe(true);
  });

  it('treats a no-response outcome as still open', () => {
    expect(isStaleUnansweredOutreach(baseInput({ latestOutcome: 'no-response' }), { now: NOW })).toBe(
      true,
    );
  });

  it.each(['responded-interested', 'responded-not-interested', 'joined-lab'])(
    'suppresses the nudge once the latest outcome is terminal (%s)',
    (outcome) => {
      expect(isStaleUnansweredOutreach(baseInput({ latestOutcome: outcome }), { now: NOW })).toBe(
        false,
      );
    },
  );

  it('suppresses the nudge when any prior attempt reported a terminal outcome', () => {
    expect(
      isStaleUnansweredOutreach(baseInput({ hasTerminalOutcome: true }), { now: NOW }),
    ).toBe(false);
  });

  it('suppresses the nudge once the follow-up cap is reached', () => {
    expect(
      isStaleUnansweredOutreach(baseInput({ followUpsSent: MAX_STUDENT_FOLLOW_UPS }), { now: NOW }),
    ).toBe(false);
    expect(
      isStaleUnansweredOutreach(baseInput({ followUpsSent: MAX_STUDENT_FOLLOW_UPS - 1 }), {
        now: NOW,
      }),
    ).toBe(true);
  });

  it('suppresses the nudge for a dismissed entity', () => {
    expect(isStaleUnansweredOutreach(baseInput({ dismissedAt: daysAgo(1) }), { now: NOW })).toBe(
      false,
    );
  });

  it('honors overridden threshold and cap options', () => {
    expect(
      isStaleUnansweredOutreach(baseInput({ latestReachedOutAt: daysAgo(3) }), {
        now: NOW,
        thresholdDays: 2,
      }),
    ).toBe(true);
    expect(
      isStaleUnansweredOutreach(baseInput({ followUpsSent: 1 }), { now: NOW, maxFollowUps: 1 }),
    ).toBe(false);
  });
});

describe('daysSinceOutreach', () => {
  it('returns the whole number of days since the outreach', () => {
    expect(daysSinceOutreach(daysAgo(9), NOW)).toBe(9);
  });

  it('returns 0 for a missing or future date', () => {
    expect(daysSinceOutreach(null, NOW)).toBe(0);
    expect(daysSinceOutreach(new Date(NOW.getTime() + 60_000), NOW)).toBe(0);
  });
});

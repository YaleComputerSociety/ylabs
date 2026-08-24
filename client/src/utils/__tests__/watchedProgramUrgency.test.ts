import { describe, expect, it } from 'vitest';

import { createFellowship } from '../createFellowship';
import {
  computeWatchedProgramUrgencySummary,
  sortWatchedProgramsByDeadline,
} from '../watchedProgramUrgency';

const NOW = new Date('2026-01-01T00:00:00.000Z');

const daysFromNow = (days: number): string =>
  new Date(NOW.getTime() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

describe('sortWatchedProgramsByDeadline', () => {
  it('orders programs soonest-deadline-first and puts no-deadline programs last', () => {
    const noDeadline = createFellowship({ id: 'p1', title: 'No Deadline Program', deadline: null });
    const farOff = createFellowship({ id: 'p2', title: 'Far-off Fellowship', deadline: daysFromNow(60) });
    const soonest = createFellowship({ id: 'p3', title: 'Sooner Grant', deadline: daysFromNow(3) });

    const ordered = sortWatchedProgramsByDeadline([noDeadline, farOff, soonest], NOW);

    expect(ordered.map((fellowship) => fellowship.id)).toEqual(['p3', 'p2', 'p1']);
  });
});

describe('computeWatchedProgramUrgencySummary', () => {
  it('counts only active-stage programs closing within the window', () => {
    const closingSoonActive = createFellowship({
      id: 'p1',
      title: 'Closing Soon Grant',
      deadline: daysFromNow(5),
      isAcceptingApplications: true,
    });
    const closingSoonClosedOut = createFellowship({
      id: 'p2',
      title: 'Already Closed Out',
      deadline: daysFromNow(2),
    });
    const farOff = createFellowship({ id: 'p3', title: 'Far-off Fellowship', deadline: daysFromNow(60) });

    const summary = computeWatchedProgramUrgencySummary(
      [closingSoonActive, closingSoonClosedOut, farOff],
      { p1: 'SAVED', p2: 'CLOSED', p3: 'SAVED' },
      NOW,
    );

    expect(summary.closingWithin14DaysCount).toBe(1);
    expect(summary.hasNotStartedClosingSoon).toBe(true);
  });

  it('does not flag not-started when the closing-soon program is already in progress', () => {
    const closingSoon = createFellowship({
      id: 'p1',
      title: 'Closing Soon Grant',
      deadline: daysFromNow(5),
    });

    const summary = computeWatchedProgramUrgencySummary([closingSoon], { p1: 'APPLIED' }, NOW);

    expect(summary.closingWithin14DaysCount).toBe(1);
    expect(summary.hasNotStartedClosingSoon).toBe(false);
  });

  it('returns zero and no next-deadline label when nothing is watched', () => {
    const summary = computeWatchedProgramUrgencySummary([], {}, NOW);

    expect(summary.closingWithin14DaysCount).toBe(0);
    expect(summary.hasNotStartedClosingSoon).toBe(false);
    expect(summary.nextDeadlineLabel).toBeUndefined();
    expect(summary.nextDeadlineDate).toBeUndefined();
  });

  it('computes the soonest next-deadline label regardless of stage, unaffected by the window', () => {
    const farOff = createFellowship({
      id: 'p1',
      title: 'Far-off Fellowship',
      deadline: daysFromNow(60),
      isAcceptingApplications: true,
    });

    const summary = computeWatchedProgramUrgencySummary([farOff], { p1: 'CLOSED' }, NOW);

    expect(summary.nextDeadlineLabel).toContain('Far-off Fellowship');
    expect(summary.closingWithin14DaysCount).toBe(0);
  });
});

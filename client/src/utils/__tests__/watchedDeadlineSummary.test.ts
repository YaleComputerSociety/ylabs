import { describe, expect, it } from 'vitest';

import { Fellowship } from '../../types/types';
import {
  approachingDeadlineAriaLabel,
  approachingDeadlineLabel,
  compareByUpcomingDeadline,
  notStartedEmphasis,
  sortByUpcomingDeadline,
  summarizeWatchedDeadlines,
  WatchedProgramWithStage,
} from '../watchedDeadlineSummary';

const NOW = new Date('2099-01-01T12:00:00.000Z');

const program = (id: string, deadline: string | null): Fellowship =>
  ({ id, title: `Program ${id}`, deadline } as Fellowship);

const daysFromNow = (days: number): string =>
  new Date(NOW.getTime() + days * 24 * 60 * 60 * 1000).toISOString();

describe('summarizeWatchedDeadlines', () => {
  it('counts only watched programs whose deadline falls within the window', () => {
    const watched: WatchedProgramWithStage[] = [
      { program: program('soon', daysFromNow(3)), stage: 'SAVED' },
      { program: program('edge', daysFromNow(14)), stage: 'EXPLORING' },
      { program: program('far', daysFromNow(30)), stage: 'SAVED' },
      { program: program('none', null), stage: 'SAVED' },
    ];

    const summary = summarizeWatchedDeadlines(watched, NOW);

    expect(summary.approachingCount).toBe(2);
    expect(summary.approaching.map((item) => item.programId)).toEqual(['soon', 'edge']);
    expect(summary.hasWatchedPrograms).toBe(true);
  });

  it('orders approaching deadlines soonest-first and never surfaces programs without a deadline', () => {
    const watched: WatchedProgramWithStage[] = [
      { program: program('later', daysFromNow(10)), stage: 'SAVED' },
      { program: program('none', null), stage: 'SAVED' },
      { program: program('sooner', daysFromNow(2)), stage: 'SAVED' },
    ];

    const summary = summarizeWatchedDeadlines(watched, NOW);

    expect(summary.approaching.map((item) => item.programId)).toEqual(['sooner', 'later']);
    expect(summary.approaching.some((item) => item.programId === 'none')).toBe(false);
  });

  it('distinguishes not-started from in-progress approaching programs', () => {
    const watched: WatchedProgramWithStage[] = [
      { program: program('untouched', daysFromNow(5)), stage: 'SAVED' },
      { program: program('defaulted', daysFromNow(6)) },
      { program: program('started', daysFromNow(4)), stage: 'CONTACTED' },
    ];

    const summary = summarizeWatchedDeadlines(watched, NOW);

    expect(summary.approachingCount).toBe(3);
    expect(summary.notStartedCount).toBe(2);
    const started = summary.approaching.find((item) => item.programId === 'started');
    expect(started?.notStarted).toBe(false);
  });

  it('excludes already-passed deadlines and reports an empty summary with no watched programs', () => {
    const past = summarizeWatchedDeadlines(
      [{ program: program('over', daysFromNow(-2)), stage: 'SAVED' }],
      NOW,
    );
    expect(past.approachingCount).toBe(0);
    expect(past.hasWatchedPrograms).toBe(true);

    const empty = summarizeWatchedDeadlines([], NOW);
    expect(empty).toMatchObject({
      approachingCount: 0,
      notStartedCount: 0,
      hasWatchedPrograms: false,
    });
  });

  it('honors a custom window', () => {
    const watched: WatchedProgramWithStage[] = [
      { program: program('d5', daysFromNow(5)), stage: 'SAVED' },
      { program: program('d10', daysFromNow(10)), stage: 'SAVED' },
    ];

    expect(summarizeWatchedDeadlines(watched, NOW, 7).approachingCount).toBe(1);
  });
});

describe('sortByUpcomingDeadline', () => {
  it('orders soonest-first with no-deadline programs last', () => {
    const sorted = sortByUpcomingDeadline(
      [program('none', null), program('later', daysFromNow(20)), program('soon', daysFromNow(1))],
      NOW,
    );
    expect(sorted.map((p) => p.id)).toEqual(['soon', 'later', 'none']);
  });

  it('compareByUpcomingDeadline keeps two undated programs equal', () => {
    expect(compareByUpcomingDeadline(program('a', null), program('b', null), NOW)).toBe(0);
  });
});

describe('deadline label helpers', () => {
  it('pluralizes the count and renders a weeks window', () => {
    expect(approachingDeadlineLabel(1)).toBe('1 watched program closes within 2 weeks');
    expect(approachingDeadlineLabel(3)).toBe('3 watched programs close within 2 weeks');
  });

  it('renders a days window when not week-aligned', () => {
    expect(approachingDeadlineLabel(2, 10)).toBe('2 watched programs close within 10 days');
    expect(approachingDeadlineLabel(2, 7)).toBe('2 watched programs close within 1 week');
  });

  it('emits not-started emphasis only when relevant', () => {
    expect(notStartedEmphasis(0)).toBeNull();
    expect(notStartedEmphasis(2)).toBe('2 not started');
  });

  it('folds the not-started emphasis into the accessible label', () => {
    expect(approachingDeadlineAriaLabel(3, 2)).toBe(
      '3 watched programs close within 2 weeks, 2 not started',
    );
    expect(approachingDeadlineAriaLabel(3, 0)).toBe('3 watched programs close within 2 weeks');
  });
});

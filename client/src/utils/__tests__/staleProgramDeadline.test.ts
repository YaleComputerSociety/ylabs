import { describe, expect, it } from 'vitest';

import { getDaysUntilDeadline, getItemSubtitle, isItemOpen } from '../../types/browsable';
import { fellowshipFutureDeadlineDate, upcomingProgramDeadlineEvents } from '../calendarExport';
import { createFellowship } from '../createFellowship';
import { getFellowshipCycleStatus, getFellowshipDeadlineSubtitle } from '../fellowshipCycle';
import {
  STALE_DEADLINE_MESSAGE,
  STALE_DEADLINE_SHORT_LABEL,
  getFellowshipApplicationStatus,
} from '../fellowshipStatus';
import { programBoardSectionOf } from '../programBoard';
import { summarizeWatchedDeadlines } from '../watchedDeadlineSummary';
import { watchedProgramDeadlineSummary } from '../../components/accounts/ProgramWatch';

const NOW = new Date('2026-10-02T12:00:00.000Z');

const staleProgram = (overrides: Record<string, unknown> = {}) =>
  createFellowship({
    id: 'stale-program',
    title: 'Fixture Annual Research Award',
    summary: 'An annual award for undergraduate research.',
    applicationLink: 'https://funding.example.edu/fixture-award',
    sourceUrl: 'https://funding.example.edu/fixture-award',
    studentFacingCategory: 'Research funding',
    programKind: 'FELLOWSHIP_FUNDING',
    isAcceptingApplications: false,
    deadline: null,
    deadlineStale: true,
    ...overrides,
  });

const withStaleDatePayload = () => staleProgram({ deadline: '2019-11-15T23:59:59.999Z' });

describe('a program whose served deadline is stale (#4363)', () => {
  it('keeps the served flag through the client mapping', () => {
    expect(staleProgram().deadlineStale).toBe(true);
    expect(createFellowship({ id: 'fresh', title: 'Fresh' }).deadlineStale).toBe(false);
  });

  it('reads as dates not confirmed, never as closed, passed, or open', () => {
    for (const program of [staleProgram(), withStaleDatePayload()]) {
      const status = getFellowshipApplicationStatus(program, NOW);
      expect(status.kind).toBe('staleDeadline');
      expect(status.detail).toBe(STALE_DEADLINE_MESSAGE);
      expect(status.deadlineLabel).toBe(STALE_DEADLINE_MESSAGE);
      expect(status.isApplicationWindowOpen).toBe(false);
      expect(status.daysUntilDeadline).toBeNull();
      expect(`${status.label} ${status.detail}`).not.toMatch(/passed|closed|accepting/i);
    }
  });

  it('labels the cycle and the card subtitle with the check-the-official-page message', () => {
    for (const program of [staleProgram(), withStaleDatePayload()]) {
      const cycle = getFellowshipCycleStatus(program, NOW);
      expect(cycle.category).toBe('staleDeadline');
      expect(cycle.deadlinePassed).toBe(false);
      expect(cycle.label).not.toMatch(/passed|closed|open/i);
      expect(getFellowshipDeadlineSubtitle(program, NOW)).toBe(STALE_DEADLINE_SHORT_LABEL);
      expect(getItemSubtitle({ type: 'fellowship', data: program })).toBe(
        STALE_DEADLINE_SHORT_LABEL,
      );
      expect(getDaysUntilDeadline({ type: 'fellowship', data: program })).toBeNull();
    }
  });

  it('offers no calendar event and no watched-deadline urgency', () => {
    for (const program of [staleProgram(), withStaleDatePayload()]) {
      expect(fellowshipFutureDeadlineDate(program, NOW)).toBeNull();
      expect(upcomingProgramDeadlineEvents([program], NOW)).toEqual([]);
      expect(summarizeWatchedDeadlines([{ program }], NOW).approachingCount).toBe(0);
      expect(watchedProgramDeadlineSummary([program], NOW)).toEqual({});
    }
  });

  it('is not open now, and sits in the no-dates section rather than next cycle', () => {
    const program = staleProgram();
    expect(isItemOpen({ type: 'fellowship', data: program })).toBe(false);
    expect(programBoardSectionOf(program, getFellowshipCycleStatus(program, NOW).category)).toBe(
      'noDates',
    );
  });
});

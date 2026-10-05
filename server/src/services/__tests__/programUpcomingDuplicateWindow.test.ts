import { describe, expect, it } from 'vitest';
import {
  deriveUpcomingDuplicateWindows,
  servedUpcomingDuplicateWindow,
  storedUpcomingDuplicateWindow,
  type ProgramWindowCopy,
} from '../programUpcomingDuplicateWindow';

const NOW = new Date('2026-10-02T12:00:00.000Z');
const PASSED_FALL = new Date('2026-07-30T21:00:00.000Z');
const SPRING_DATE_ONLY = new Date('2027-01-05T04:59:59.999Z');
const LATER_SPRING = new Date('2027-03-01T22:00:00.000Z');

const copy = (id: string, overrides: Partial<ProgramWindowCopy> = {}): ProgramWindowCopy => ({
  id,
  servableOnItsOwn: true,
  isAcceptingApplications: false,
  ...overrides,
});

const derive = (copies: ProgramWindowCopy[], keptCopyById: Array<[string, string]>) =>
  deriveUpcomingDuplicateWindows(copies, new Map(keptCopyById), NOW);

describe('deriveUpcomingDuplicateWindows (#4382)', () => {
  it("supplies no window from another term's copy of the program (#4587)", () => {
    const windows = derive(
      [
        copy('kept', { title: 'Fixture Internship - Fall Term', deadline: PASSED_FALL }),
        copy('spring', { title: 'Fixture Internship - Spring Term', deadline: SPRING_DATE_ONLY }),
        copy('fall', { title: 'Fixture Internship - Fall Term', deadline: LATER_SPRING }),
      ],
      [
        ['spring', 'kept'],
        ['fall', 'kept'],
      ],
    );
    expect(windows.get('kept')?.sourceProgramId).toBe('fall');
  });

  it("serves a hidden copy's upcoming deadline when the kept copy's has passed", () => {
    const windows = derive(
      [
        copy('kept', { deadline: PASSED_FALL, applicationOpenDate: new Date('2026-06-05') }),
        copy('twin', { deadline: SPRING_DATE_ONLY, isAcceptingApplications: true }),
      ],
      [['twin', 'kept']],
    );
    expect([...windows]).toEqual([
      [
        'kept',
        { deadline: SPRING_DATE_ONLY, isAcceptingApplications: true, sourceProgramId: 'twin' },
      ],
    ]);
  });

  it('serves it when the kept copy states no deadline at all', () => {
    const windows = derive(
      [copy('kept'), copy('twin', { deadline: LATER_SPRING })],
      [['twin', 'kept']],
    );
    expect(windows.get('kept')?.deadline).toEqual(LATER_SPRING);
  });

  it("derives nothing while the kept copy's own deadline is upcoming", () => {
    const windows = derive(
      [copy('kept', { deadline: LATER_SPRING }), copy('twin', { deadline: SPRING_DATE_ONLY })],
      [['twin', 'kept']],
    );
    expect(windows.size).toBe(0);
  });

  it('derives nothing when every copy has passed', () => {
    const windows = derive(
      [
        copy('kept', { deadline: PASSED_FALL }),
        copy('twin', { deadline: new Date('2026-09-01T21:00:00.000Z') }),
      ],
      [['twin', 'kept']],
    );
    expect(windows.size).toBe(0);
  });

  it('picks the earliest still-upcoming deadline among several hidden copies', () => {
    const windows = derive(
      [
        copy('kept', { deadline: PASSED_FALL }),
        copy('later', { deadline: LATER_SPRING }),
        copy('passed', { deadline: new Date('2026-09-01T21:00:00.000Z') }),
        copy('earliest', {
          deadline: SPRING_DATE_ONLY,
          applicationOpenDate: new Date('2026-11-01T04:00:00.000Z'),
        }),
      ],
      [
        ['later', 'kept'],
        ['passed', 'kept'],
        ['earliest', 'kept'],
      ],
    );
    expect(windows.get('kept')).toEqual({
      deadline: SPRING_DATE_ONLY,
      applicationOpenDate: new Date('2026-11-01T04:00:00.000Z'),
      isAcceptingApplications: false,
      sourceProgramId: 'earliest',
    });
  });

  it('reads a date-only deadline as open until the end of its New York day', () => {
    const lateEveningOfTheDeadline = new Date('2027-01-05T03:00:00.000Z');
    const windows = deriveUpcomingDuplicateWindows(
      [
        copy('kept', { deadline: PASSED_FALL }),
        copy('twin', { deadline: new Date('2027-01-04T23:59:59.999Z') }),
      ],
      new Map([['twin', 'kept']]),
      lateEveningOfTheDeadline,
    );
    expect(windows.get('kept')?.sourceProgramId).toBe('twin');
  });

  it('takes no date from a copy the gate would not serve on its own', () => {
    const windows = derive(
      [
        copy('kept', { deadline: PASSED_FALL }),
        copy('twin', { deadline: SPRING_DATE_ONLY, servableOnItsOwn: false }),
      ],
      [['twin', 'kept']],
    );
    expect(windows.size).toBe(0);
  });

  it('leaves programs outside any duplicate group untouched', () => {
    const windows = derive(
      [
        copy('kept', { deadline: PASSED_FALL }),
        copy('twin', { deadline: SPRING_DATE_ONLY }),
        copy('unrelated', { deadline: PASSED_FALL }),
        copy('other-upcoming', { deadline: LATER_SPRING }),
      ],
      [['twin', 'kept']],
    );
    expect([...windows.keys()]).toEqual(['kept']);
  });
});

describe('servedUpcomingDuplicateWindow', () => {
  const stored = {
    deadline: SPRING_DATE_ONLY,
    isAcceptingApplications: true,
    sourceProgramId: 'twin',
  };

  it('serves a stored window whose deadline is still upcoming', () => {
    expect(
      servedUpcomingDuplicateWindow(
        { deadline: PASSED_FALL, upcomingDuplicateWindow: stored },
        NOW,
      ),
    ).toEqual(stored);
  });

  it('falls back once the stored window has itself passed', () => {
    const afterTheSpringDeadline = new Date('2027-01-06T12:00:00.000Z');
    expect(
      servedUpcomingDuplicateWindow(
        { deadline: PASSED_FALL, upcomingDuplicateWindow: stored },
        afterTheSpringDeadline,
      ),
    ).toBeUndefined();
  });

  it("yields to the row's own deadline once that is upcoming again", () => {
    expect(
      servedUpcomingDuplicateWindow(
        { deadline: LATER_SPRING, upcomingDuplicateWindow: stored },
        NOW,
      ),
    ).toBeUndefined();
  });

  it('ignores a malformed stored window', () => {
    expect(
      storedUpcomingDuplicateWindow({ deadline: 'not a date', sourceProgramId: 'x' }),
    ).toBeNull();
    expect(storedUpcomingDuplicateWindow({ deadline: SPRING_DATE_ONLY })).toBeNull();
    expect(storedUpcomingDuplicateWindow(null)).toBeNull();
  });
});

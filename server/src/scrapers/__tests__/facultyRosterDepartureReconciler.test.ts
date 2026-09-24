import { describe, expect, it } from 'vitest';
import {
  classifyEntityRunSignal,
  decideFacultyRosterDeparture,
  countSnapshotObservationBases,
  isEntityAuthoritativeSnapshot,
  passesRosterDropGuard,
  snapshotObservationBasis,
  snapshotDiscoveredEntityKeys,
  type EntityDepartureState,
  type RunPresenceSignal,
  newestSnapshotDateFor,
} from '../facultyRosterDepartureReconciler';

const observedAt = new Date('2026-08-27T00:00:00.000Z');
const runA = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const runB = 'bbbbbbbbbbbbbbbbbbbbbbbb';

const decide = (signal: RunPresenceSignal, entity: EntityDepartureState, currentRunId = runA) =>
  decideFacultyRosterDeparture({ signal, currentRunId, observedAt, entity });

describe('isEntityAuthoritativeSnapshot / snapshotDiscoveredEntityKeys', () => {
  it('is authoritative only when complete and discoveredEntityKeys is an array', () => {
    expect(isEntityAuthoritativeSnapshot({ complete: true, discoveredEntityKeys: ['a'] })).toBe(
      true,
    );
    expect(isEntityAuthoritativeSnapshot({ complete: false, discoveredEntityKeys: ['a'] })).toBe(
      false,
    );
    expect(
      isEntityAuthoritativeSnapshot({ complete: true, discoveredEntityKeys: 'a' } as never),
    ).toBe(false);
  });

  it('refuses authority to a snapshot that records its run read no page', () => {
    expect(
      isEntityAuthoritativeSnapshot({
        complete: true,
        discoveredEntityKeys: ['a'],
        observedInRun: false,
      }),
    ).toBe(false);
    // Absent is unrecorded rather than false: a snapshot published before the field
    // existed keeps the authority its own `complete` flag claims, because omission
    // is not evidence that the page went unread (#3251).
    expect(isEntityAuthoritativeSnapshot({ complete: true, discoveredEntityKeys: ['a'] })).toBe(
      true,
    );
  });

  it('names the three bases a snapshot can record and counts them', () => {
    expect(snapshotObservationBasis({ observedInRun: true })).toBe('observed');
    expect(snapshotObservationBasis({ observedInRun: false })).toBe('derived');
    expect(snapshotObservationBasis({})).toBe('unrecorded');
    expect(
      countSnapshotObservationBases([
        { observedInRun: true },
        { observedInRun: true },
        { observedInRun: false },
        {},
      ]),
    ).toEqual({ snapshotsObserved: 2, snapshotsDerived: 1, snapshotsUnrecorded: 1 });
  });

  it('returns only the string discovered keys', () => {
    expect(snapshotDiscoveredEntityKeys({ discoveredEntityKeys: ['a', 2, 'b'] })).toEqual([
      'a',
      'b',
    ]);
    expect(snapshotDiscoveredEntityKeys({})).toEqual([]);
  });
});

describe('passesRosterDropGuard', () => {
  it('passes when no governed entities exist', () => {
    expect(passesRosterDropGuard(0, 0)).toBe(true);
  });

  it('passes when discovered meets at least half the governed count', () => {
    expect(passesRosterDropGuard(5, 10)).toBe(true);
    expect(passesRosterDropGuard(10, 10)).toBe(true);
  });

  it('freezes when discovered falls below half the governed count', () => {
    expect(passesRosterDropGuard(4, 10)).toBe(false);
    expect(passesRosterDropGuard(0, 3)).toBe(false);
  });
});

describe('classifyEntityRunSignal', () => {
  const healthy = (entries: Record<string, string[]>) =>
    new Map(Object.entries(entries).map(([dept, keys]) => [dept, new Set(keys)]));

  it('is inconclusive when the entity is covered by no scraped department', () => {
    expect(
      classifyEntityRunSignal({
        coveredDeptNames: [],
        healthyDiscoveredByDept: healthy({ Physics: ['lab-a'] }),
        entitySlug: 'lab-a',
      }),
    ).toBe('inconclusive');
  });

  it('is inconclusive when any covering department was not healthy this run', () => {
    expect(
      classifyEntityRunSignal({
        coveredDeptNames: ['Physics', 'Astronomy'],
        healthyDiscoveredByDept: healthy({ Physics: ['lab-a'] }),
        entitySlug: 'lab-a',
      }),
    ).toBe('inconclusive');
  });

  it('is present when found in any healthy covering department (cross-listing)', () => {
    expect(
      classifyEntityRunSignal({
        coveredDeptNames: ['Physics', 'Astronomy'],
        healthyDiscoveredByDept: healthy({ Physics: ['other'], Astronomy: ['lab-a'] }),
        entitySlug: 'lab-a',
      }),
    ).toBe('present');
  });

  it('is absent only when all covering departments were healthy and none listed it', () => {
    expect(
      classifyEntityRunSignal({
        coveredDeptNames: ['Physics', 'Astronomy'],
        healthyDiscoveredByDept: healthy({ Physics: ['other'], Astronomy: ['another'] }),
        entitySlug: 'lab-a',
      }),
    ).toBe('absent');
  });
});

describe('decideFacultyRosterDeparture fail-closed guards', () => {
  it('noops on an inconclusive run', () => {
    expect(decide('inconclusive', {}).action).toBe('noop');
    expect(decide('inconclusive', { absentFromRosterSinceRunId: runA }, runB).action).toBe('noop');
  });

  it('noops when there is no current run id', () => {
    expect(decide('absent', {}, '').action).toBe('noop');
  });
});

describe('decideFacultyRosterDeparture presence', () => {
  it('refreshes last-seen and clears absence when present', () => {
    const decision = decide('present', {});
    expect(decision.action).toBe('refresh_present');
    expect(decision.set.lastSeenInCompleteRosterAt).toEqual(observedAt);
    expect(decision.set.absentFromRosterSinceRunId).toBe('');
    expect(decision.set.yaleStatusCache).toBeUndefined();
  });

  it('un-departs an entity that reappears', () => {
    const decision = decide('present', {
      yaleStatusReasonCache: 'departed',
      absentFromRosterSinceRunId: runA,
    });
    expect(decision.action).toBe('clear_departed');
    expect(decision.set.yaleStatusCache).toBe('active');
    expect(decision.set.activeAtYaleCache).toBe(true);
    expect(decision.set.yaleStatusReasonCache).toBe('');
    expect(decision.set.absentFromRosterSinceRunId).toBe('');
  });

  it('never un-departs a human-recorded closure, whose cohort is still on the roster', () => {
    const decision = decide('present', {
      yaleStatusReasonCache: 'departed',
      absentFromRosterSinceRunId: runA,
      hasRecordedClosure: true,
    });
    expect(decision.action).toBe('refresh_present');
    expect(decision.set.yaleStatusCache).toBeUndefined();
    expect(decision.set.activeAtYaleCache).toBeUndefined();
    expect(decision.set.yaleStatusReasonCache).toBeUndefined();
    expect(decision.set.lastSeenInCompleteRosterAt).toEqual(observedAt);
    expect(decision.set.absentFromRosterSinceRunId).toBe('');
  });
});

describe('decideFacultyRosterDeparture K=2 durability', () => {
  it('records the first absence without suppressing (K=1)', () => {
    const decision = decide('absent', {});
    expect(decision.action).toBe('record_first_absence');
    expect(decision.set.absentFromRosterSinceRunId).toBe(runA);
    expect(decision.set.activeAtYaleCache).toBeUndefined();
  });

  it('noops on a repeat absence within the same run', () => {
    expect(decide('absent', { absentFromRosterSinceRunId: runA }, runA).action).toBe('noop');
  });

  it('proposes suppression on a second consecutive absent run (K=2)', () => {
    const decision = decide('absent', { absentFromRosterSinceRunId: runA }, runB);
    expect(decision.action).toBe('suppress_departed');
    expect(decision.set.yaleStatusCache).toBe('departed');
    expect(decision.set.activeAtYaleCache).toBe(false);
    expect(decision.set.yaleStatusReasonCache).toBe('departed');
  });
});

describe('decideFacultyRosterDeparture death precedence', () => {
  it('never overwrites a deceased entity when absent', () => {
    expect(
      decide(
        'absent',
        { yaleStatusReasonCache: 'deceased', absentFromRosterSinceRunId: runA },
        runB,
      ).action,
    ).toBe('noop');
  });

  it('never touches a deceased entity even when present', () => {
    expect(decide('present', { yaleStatusReasonCache: 'deceased' }).action).toBe('noop');
  });
});

describe('plan readability (#3235)', () => {
  it('reports the newest snapshot date among the row’s own departments', () => {
    const early = new Date('2026-09-01T00:00:00.000Z');
    const late = new Date('2026-09-20T00:00:00.000Z');
    const byDept = new Map([
      ['Economics', early],
      ['Statistics', late],
      ['Untouched', new Date('2026-09-30T00:00:00.000Z')],
    ]);
    expect(newestSnapshotDateFor(['Economics', 'Statistics'], byDept)).toEqual(late);
    expect(newestSnapshotDateFor(['Economics'], byDept)).toEqual(early);
  });

  // A row whose own departments carry no snapshot has no date that is evidence about
  // it, and null says so rather than borrowing another department's.
  it('returns null rather than borrowing a date from a department it does not cover', () => {
    const byDept = new Map([['Economics', new Date('2026-09-01T00:00:00.000Z')]]);
    expect(newestSnapshotDateFor(['Statistics'], byDept)).toBeNull();
    expect(newestSnapshotDateFor([], byDept)).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import {
  classifyEntityRunSignal,
  decideFacultyRosterDeparture,
  isEntityAuthoritativeSnapshot,
  rosterHealthAdmissibility,
  newestSnapshotDateFor,
  passesRosterDropGuard,
  rosterDiscoveryRegressed,
  rosterDropGuardVerdict,
  rosterHealthReadProvenance,
  snapshotDiscoveredEntityKeys,
  type EntityDepartureState,
  type RunPresenceSignal,
} from '../facultyRosterDepartureReconciler';

const observedAt = new Date('2026-08-27T00:00:00.000Z');
const NOW_ISO = '2026-09-24T03:00:00.000Z';
const runA = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const runB = 'bbbbbbbbbbbbbbbbbbbbbbbb';

const decide = (signal: RunPresenceSignal, entity: EntityDepartureState, currentRunId = runA) =>
  decideFacultyRosterDeparture({ signal, currentRunId, observedAt, entity });

describe('isEntityAuthoritativeSnapshot / snapshotDiscoveredEntityKeys', () => {
  const fetchedRead = { pagesRead: 1, readMode: 'html', cacheAllowed: false, readAt: NOW_ISO };

  it('is authoritative only when complete and discoveredEntityKeys is an array', () => {
    expect(
      isEntityAuthoritativeSnapshot({
        complete: true,
        discoveredEntityKeys: ['a'],
        read: fetchedRead,
      }),
    ).toBe(true);
    expect(
      isEntityAuthoritativeSnapshot({
        complete: false,
        discoveredEntityKeys: ['a'],
        read: fetchedRead,
      }),
    ).toBe(false);
    expect(
      isEntityAuthoritativeSnapshot({
        complete: true,
        discoveredEntityKeys: 'a',
        read: fetchedRead,
      } as never),
    ).toBe(false);
  });

  /**
   * A read that completed and listed nobody is the whole defect. An empty discovery and a
   * department with no faculty are opposite facts this snapshot cannot tell apart, so
   * admitting it asserts absence for every person the department governs (#3302).
   */
  it('refuses a completed read that discovered nobody', () => {
    expect(
      isEntityAuthoritativeSnapshot({
        complete: true,
        discoveredEntityKeys: [],
        read: fetchedRead,
      }),
    ).toBe(false);
  });

  it('names the three non-evidence states apart rather than collapsing them', () => {
    expect(
      rosterHealthAdmissibility({ complete: true, discoveredEntityKeys: ['a'], read: fetchedRead }),
    ).toBe('read-discovered-people');
    expect(
      rosterHealthAdmissibility({ complete: true, discoveredEntityKeys: [], read: fetchedRead }),
    ).toBe('read-discovered-nobody');
    expect(
      rosterHealthAdmissibility({
        complete: false,
        discoveredEntityKeys: ['a'],
        read: fetchedRead,
      }),
    ).toBe('incomplete');
    expect(
      rosterHealthAdmissibility({
        complete: true,
        discoveredEntityKeys: ['a'],
        read: { pagesRead: 0, readMode: 'none', cacheAllowed: false, readAt: NOW_ISO },
      }),
    ).toBe('not-read');
    expect(rosterHealthAdmissibility({ complete: true, discoveredEntityKeys: ['a'] })).toBe(
      'unrecorded',
    );
  });

  it('keeps a cache-permitted read that found people admissible', () => {
    expect(
      rosterHealthAdmissibility({
        complete: true,
        discoveredEntityKeys: ['a'],
        read: { pagesRead: 1, readMode: 'html', cacheAllowed: true, readAt: NOW_ISO },
      }),
    ).toBe('read-discovered-people');
  });

  it('refuses a snapshot whose run recorded no read of the department page', () => {
    expect(isEntityAuthoritativeSnapshot({ complete: true, discoveredEntityKeys: ['a'] })).toBe(
      false,
    );
    expect(
      isEntityAuthoritativeSnapshot({
        complete: true,
        discoveredEntityKeys: ['a'],
        read: { pagesRead: 0, readMode: 'none', cacheAllowed: false, readAt: NOW_ISO },
      }),
    ).toBe(false);
  });

  it('classifies what the snapshot recorded about its read', () => {
    expect(rosterHealthReadProvenance({})).toBe('unrecorded');
    expect(rosterHealthReadProvenance({ read: { pagesRead: 0, readMode: 'none' } })).toBe(
      'not-read',
    );
    expect(rosterHealthReadProvenance({ read: { pagesRead: 2, readMode: 'html' } })).toBe(
      'fetched',
    );
    expect(
      rosterHealthReadProvenance({
        read: { pagesRead: 2, readMode: 'html', cacheAllowed: true },
      }),
    ).toBe('cache-permitted');
  });

  it('dates a row from the newest read among its own departments', () => {
    const earlier = new Date('2026-09-24T01:00:00.000Z');
    const later = new Date('2026-09-24T05:00:00.000Z');
    const observedAtByDept = new Map([
      ['Economics', earlier],
      ['Statistics', later],
    ]);
    expect(newestSnapshotDateFor(['Economics', 'Statistics'], observedAtByDept)).toEqual(later);
    expect(newestSnapshotDateFor(['Economics'], observedAtByDept)).toEqual(earlier);
    expect(newestSnapshotDateFor(['Nowhere'], observedAtByDept)).toBeNull();
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
  it('does not pass a department that governs nothing, and says so as its own verdict', () => {
    // A zero denominator is not a trusted read. Callers read "passes" to decide a
    // snapshot may speak for its department, which is the #2410 shape.
    expect(rosterDropGuardVerdict(0, 0)).toBe('governs-nothing');
    expect(rosterDropGuardVerdict(7, 0)).toBe('governs-nothing');
    expect(passesRosterDropGuard(0, 0)).toBe(false);
  });

  it('names the two graded verdicts', () => {
    expect(rosterDropGuardVerdict(5, 10)).toBe('pass');
    expect(rosterDropGuardVerdict(4, 10)).toBe('freeze');
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

describe('rosterDiscoveryRegressed', () => {
  it('catches a discovery collapse the cross-population guard lets through', () => {
    // The measured case: a department read 153 then 86. Against the rows this lane has
    // observed that second read scores 0.69 and passes the drop guard, so only a
    // comparison with the department's own history sees the fall.
    expect(rosterDiscoveryRegressed(153, 86)).toBe(true);
    expect(passesRosterDropGuard(86, 124)).toBe(true);
  });

  it('accepts ordinary turnover', () => {
    expect(rosterDiscoveryRegressed(40, 38)).toBe(false);
    expect(rosterDiscoveryRegressed(40, 30)).toBe(false);
  });

  it('never freezes a first reading, because absence of history is not evidence', () => {
    expect(rosterDiscoveryRegressed(null, 1)).toBe(false);
    expect(rosterDiscoveryRegressed(0, 1)).toBe(false);
  });
});

describe('classifyEntityRunSignal', () => {
  const healthy = (entries: Record<string, string[]>) =>
    new Map(Object.entries(entries).map(([dept, keys]) => [dept, new Set(keys)]));
  const rosterObservedEntityKeys = new Set(['lab-a', 'other', 'another']);

  it('is inconclusive when the entity is covered by no scraped department', () => {
    expect(
      classifyEntityRunSignal({
        coveredDeptNames: [],
        healthyDiscoveredByDept: healthy({ Physics: ['lab-a'] }),
        entitySlug: 'lab-a',
        rosterObservedEntityKeys,
      }),
    ).toBe('inconclusive');
  });

  it('is inconclusive when any covering department was not healthy this run', () => {
    expect(
      classifyEntityRunSignal({
        coveredDeptNames: ['Physics', 'Astronomy'],
        healthyDiscoveredByDept: healthy({ Physics: ['lab-a'] }),
        entitySlug: 'lab-a',
        rosterObservedEntityKeys,
      }),
    ).toBe('inconclusive');
  });

  it('is present when found in any healthy covering department (cross-listing)', () => {
    expect(
      classifyEntityRunSignal({
        coveredDeptNames: ['Physics', 'Astronomy'],
        healthyDiscoveredByDept: healthy({ Physics: ['other'], Astronomy: ['lab-a'] }),
        entitySlug: 'lab-a',
        rosterObservedEntityKeys,
      }),
    ).toBe('present');
  });

  it('is inconclusive for a row this lane has never observed, however healthy the read', () => {
    // Every key a department roster discovers is one it minted, so a row from another
    // lane can only ever read as absent. That is an unnameable row, not a departure.
    expect(
      classifyEntityRunSignal({
        coveredDeptNames: ['Physics'],
        healthyDiscoveredByDept: healthy({ Physics: ['other'] }),
        entitySlug: 'ysm-faculty-someone',
        rosterObservedEntityKeys,
      }),
    ).toBe('inconclusive');
  });

  it('is absent only when all covering departments were healthy and none listed it', () => {
    expect(
      classifyEntityRunSignal({
        coveredDeptNames: ['Physics', 'Astronomy'],
        healthyDiscoveredByDept: healthy({ Physics: ['other'], Astronomy: ['another'] }),
        entitySlug: 'lab-a',
        rosterObservedEntityKeys,
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

import { describe, expect, it } from 'vitest';
import {
  blockingDepartureLaneGate,
  laneHasEverEvaluatedARow,
  summarizeFacultyDepartureLaneAudit,
  summarizeStandingRosterFreezes,
  type FacultyDepartureLaneFacts,
} from '../auditFacultyDepartureLaneCore';
import { parseFacultyDepartureLaneAuditArgs } from '../auditFacultyDepartureLane';

function facts(overrides: Partial<FacultyDepartureLaneFacts> = {}): FacultyDepartureLaneFacts {
  return {
    flagEnabled: true,
    rosterHealthObservations: 125,
    rosterHealthRuns: 12,
    plannedRunId: 'run-1',
    planOutcome: 'planned',
    plan: {
      refresh_present: 37,
      record_first_absence: 20,
      suppress_departed: 0,
      clear_departed: 0,
    },
    governedDepartments: 1,
    unresolvedDepartments: 0,
    frozenDepartments: 0,
    liveEntities: 4756,
    entitiesWithLastSeen: 0,
    entitiesWithAbsenceRecorded: 0,
    entitiesReasonDeparted: 8,
    readProvenance: { fetched: 112, 'cache-permitted': 0, 'not-read': 13, unrecorded: 0 },
    newestRecordedReadAgeHours: 1,
    ...overrides,
  };
}

describe('faculty-departure lane audit: has it ever run', () => {
  it('reads the bookkeeping fields, not the outcome field', () => {
    // A `departed` count is an absence of output; the bookkeeping fields are
    // written before any suppression decision, so they measure evaluation.
    expect(laneHasEverEvaluatedARow(facts({ entitiesReasonDeparted: 8 }))).toBe(false);
    expect(laneHasEverEvaluatedARow(facts({ entitiesWithLastSeen: 1 }))).toBe(true);
    expect(laneHasEverEvaluatedARow(facts({ entitiesWithAbsenceRecorded: 1 }))).toBe(true);
  });

  it('says so in the narrative, so a relayed count cannot lose the caveat', () => {
    expect(summarizeFacultyDepartureLaneAudit(facts()).narrative).toContain(
      'measure other producers rather than departure activity',
    );
    expect(
      summarizeFacultyDepartureLaneAudit(facts({ entitiesWithLastSeen: 37 })).narrative,
    ).toContain('has evaluated rows here');
  });
});

describe('faculty-departure lane audit: the blocking gate', () => {
  it('reports the gates in the order the lane hits them', () => {
    expect(blockingDepartureLaneGate(facts({ flagEnabled: false }))).toBe('flag');
    expect(
      blockingDepartureLaneGate(facts({ flagEnabled: false, rosterHealthObservations: 0 })),
    ).toBe('flag');
    expect(blockingDepartureLaneGate(facts({ rosterHealthObservations: 0 }))).toBe(
      'no-roster-health-observations',
    );
    expect(blockingDepartureLaneGate(facts({ planOutcome: 'no-authoritative-departments' }))).toBe(
      'no-authoritative-departments',
    );
    expect(blockingDepartureLaneGate(facts({ planOutcome: 'invalid-run-id' }))).toBe(
      'invalid-run-id',
    );
    expect(blockingDepartureLaneGate(facts())).toBe('none');
  });

  it('blocks when no snapshot in the planning run recorded reading its page', () => {
    expect(
      blockingDepartureLaneGate(
        facts({
          readProvenance: { fetched: 0, 'cache-permitted': 0, 'not-read': 0, unrecorded: 230 },
        }),
      ),
    ).toBe('no-snapshot-recorded-a-read');
    expect(blockingDepartureLaneGate(facts({ readProvenance: undefined }))).toBe(
      'no-snapshot-recorded-a-read',
    );
    expect(
      blockingDepartureLaneGate(
        facts({
          readProvenance: { fetched: 0, 'cache-permitted': 3, 'not-read': 9, unrecorded: 0 },
        }),
      ),
    ).toBe('none');
  });

  it('separates rows the lane would touch from rows it would remove', () => {
    const report = summarizeFacultyDepartureLaneAudit(facts());
    expect(report.wouldAct).toBe(57);
    expect(report.wouldSuppress).toBe(0);
    const withSuppression = summarizeFacultyDepartureLaneAudit(
      facts({
        plan: {
          refresh_present: 1,
          record_first_absence: 0,
          suppress_departed: 3,
          clear_departed: 1,
        },
      }),
    );
    expect(withSuppression.wouldAct).toBe(5);
    expect(withSuppression.wouldSuppress).toBe(3);
  });

  it('reports zero rather than guessing when no run carried the lane its input', () => {
    const report = summarizeFacultyDepartureLaneAudit(
      facts({ plan: undefined, planOutcome: undefined, plannedRunId: undefined }),
    );
    expect(report.wouldAct).toBe(0);
    expect(report.wouldSuppress).toBe(0);
  });
});

describe('faculty-departure lane audit: CLI arguments', () => {
  it('has no apply path, because suppression removes a research home', () => {
    expect(() => parseFacultyDepartureLaneAuditArgs(['--apply'])).toThrow('never writes');
  });

  it('parses a run id and refuses an unknown flag', () => {
    expect(parseFacultyDepartureLaneAuditArgs(['--run=abc'])).toMatchObject({ runId: 'abc' });
    expect(parseFacultyDepartureLaneAuditArgs(['--run', 'abc'])).toMatchObject({ runId: 'abc' });
    expect(() => parseFacultyDepartureLaneAuditArgs(['--run='])).toThrow(
      '--run requires a scrapeRunId',
    );
    expect(() => parseFacultyDepartureLaneAuditArgs(['--nope'])).toThrow(
      'Unknown argument: --nope',
    );
  });
});

describe('summarizeStandingRosterFreezes', () => {
  const NOW = new Date('2026-09-24T00:00:00.000Z');
  const entry = (
    department: string,
    observedAt: string,
    verdict: 'pass' | 'freeze' | 'governs-nothing' | 'not-authoritative',
    discovered = 3,
    rosterGoverned = 20,
  ) => ({
    department,
    observedAt,
    authoritative: verdict !== 'not-authoritative',
    discovered,
    rosterGoverned,
    verdict,
  });

  it('is not scoped to one run: it reports every department frozen on its latest authoritative read', () => {
    const report = summarizeStandingRosterFreezes(
      [
        entry('Frozen A', '2026-09-13T00:00:00.000Z', 'freeze'),
        entry('Frozen A', '2026-09-24T00:00:00.000Z', 'freeze'),
        entry('Frozen B', '2026-09-22T00:00:00.000Z', 'freeze'),
        entry('Healthy', '2026-09-24T00:00:00.000Z', 'pass', 18),
      ],
      NOW,
    );
    expect(report.standingFreezes.map((freeze) => freeze.department)).toEqual([
      'Frozen A',
      'Frozen B',
    ]);
    expect(report.longestStandingFreezeDays).toBe(11);
    expect(report.standingFreezes[0].consecutiveFrozenSnapshots).toBe(2);
  });

  it('dates a freeze from the start of its consecutive run, not from the oldest snapshot', () => {
    // A department that was healthy and then froze has stood frozen only since the
    // freeze, and reporting the first snapshot would overstate every age.
    const report = summarizeStandingRosterFreezes(
      [
        entry('Recently broken', '2026-09-01T00:00:00.000Z', 'pass', 19),
        entry('Recently broken', '2026-09-22T00:00:00.000Z', 'freeze'),
      ],
      NOW,
    );
    expect(report.standingFreezes[0].standingForDays).toBe(2);
  });

  it('counts departments that have never produced an authoritative snapshot', () => {
    const report = summarizeStandingRosterFreezes(
      [
        entry('Never read', '2026-09-24T00:00:00.000Z', 'not-authoritative'),
        entry('Read once', '2026-09-24T00:00:00.000Z', 'pass', 18),
      ],
      NOW,
    );
    expect(report.departmentsWithHistory).toBe(2);
    expect(report.departmentsWithAnyAuthoritativeSnapshot).toBe(1);
    expect(report.departmentsWithNoAuthoritativeSnapshot).toBe(1);
    expect(report.standingFreezes).toEqual([]);
  });
});

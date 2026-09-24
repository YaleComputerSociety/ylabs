/**
 * Pure decision layer for `research-entity:audit-departure-lane` (#2428).
 *
 * The faculty-departure lane had never evaluated a single row in any environment,
 * and its silence was indistinguishable from "no departures happened": at least
 * three sessions read `yaleStatusReasonCache: 'departed'` being 0 rows as a
 * measurement of departure activity when it measured nothing. This turns the
 * lane's own bookkeeping into a verdict a reader can act on.
 *
 * The two bookkeeping fields are the instrument rather than the outcome fields.
 * `lastSeenInCompleteRosterAt` is written on every present run and
 * `absentFromRosterSinceRunId` on the first absent one, both BEFORE any
 * suppression decision, so both at zero is proof of non-execution while a
 * `departed` count of zero is merely an absence of output.
 *
 * No I/O: the runner gathers facts, this decides what they mean.
 */
import type {
  FacultyRosterDepartureOutcome,
  FacultyRosterDeparturePlan,
  RosterHealthReadProvenance,
} from '../scrapers/facultyRosterDepartureReconciler';

export interface FacultyDepartureLaneFacts {
  /** Whether `SCRAPER_FACULTY_DEPARTURE_DETECTION` is set to enable writes. */
  flagEnabled: boolean;
  /** Live `departmentRosterHealth` observations, the lane's only input. */
  rosterHealthObservations: number;
  /** Distinct scrape runs that carry at least one of those observations. */
  rosterHealthRuns: number;
  /** The run the plan was taken from, when one was available. */
  plannedRunId?: string;
  planOutcome?: FacultyRosterDepartureOutcome;
  plan?: FacultyRosterDeparturePlan;
  governedDepartments: number;
  unresolvedDepartments: number;
  frozenDepartments: number;
  regressedDepartments?: number;
  liveEntities: number;
  /** Rows the lane has ever recorded as present in a complete roster. */
  entitiesWithLastSeen: number;
  /** Rows the lane has ever recorded a first absence for. */
  entitiesWithAbsenceRecorded: number;
  /** Rows currently carrying the `departed` reason, from any producer. */
  entitiesReasonDeparted: number;
  /**
   * How many of the planning run's snapshots recorded reading their department's
   * page. Read this before believing the plan: a snapshot counted `unrecorded` or
   * `not-read` governs nothing, so the plan rests on the `fetched` and
   * `cache-permitted` ones alone (#3251).
   */
  readProvenance?: Record<RosterHealthReadProvenance, number>;
  /** Age in whole hours of the newest read the planning run recorded. */
  newestRecordedReadAgeHours?: number | null;
}

/**
 * The gate that stops this lane from acting, in the order the code hits them.
 * `none` means nothing structural is in the way, so whether it acts is a decision
 * rather than a defect.
 */
export type FacultyDepartureLaneGate =
  | 'flag'
  | 'no-roster-health-observations'
  | 'no-authoritative-departments'
  | 'no-snapshot-recorded-a-read'
  | 'invalid-run-id'
  | 'none';

export interface FacultyDepartureLaneAuditReport {
  /** Has the lane ever evaluated a single row in this database? */
  everEvaluated: boolean;
  /** The first gate in the lane's own order that would stop it writing. */
  blockingGate: FacultyDepartureLaneGate;
  /** Rows the lane would act on today if it were enabled, before the Yale-profile probe. */
  wouldAct: number;
  wouldSuppress: number;
  narrative: string;
  facts: FacultyDepartureLaneFacts;
}

export function laneHasEverEvaluatedARow(facts: FacultyDepartureLaneFacts): boolean {
  return facts.entitiesWithLastSeen > 0 || facts.entitiesWithAbsenceRecorded > 0;
}

export function blockingDepartureLaneGate(
  facts: FacultyDepartureLaneFacts,
): FacultyDepartureLaneGate {
  if (!facts.flagEnabled) return 'flag';
  if (facts.rosterHealthObservations === 0) return 'no-roster-health-observations';
  if (facts.planOutcome === 'invalid-run-id') return 'invalid-run-id';
  if (facts.planOutcome === 'no-roster-health-observations') {
    return 'no-roster-health-observations';
  }
  if (snapshotsRecordingARead(facts) === 0) return 'no-snapshot-recorded-a-read';
  if (facts.planOutcome === 'no-authoritative-departments') return 'no-authoritative-departments';
  return 'none';
}

/**
 * Snapshots whose own run recorded reading the department's page. A plan resting on
 * zero of these is resting on nothing, which is the state #3251 could not see
 * because the run-level fetch metrics counted only the rendered-browser branch.
 */
export function snapshotsRecordingARead(facts: FacultyDepartureLaneFacts): number {
  const provenance = facts.readProvenance;
  if (!provenance) return 0;
  return (provenance.fetched ?? 0) + (provenance['cache-permitted'] ?? 0);
}

export function summarizeFacultyDepartureLaneAudit(
  facts: FacultyDepartureLaneFacts,
): FacultyDepartureLaneAuditReport {
  const plan = facts.plan;
  const wouldSuppress = plan?.suppress_departed ?? 0;
  const wouldAct = plan
    ? plan.refresh_present +
      plan.record_first_absence +
      plan.suppress_departed +
      plan.clear_departed
    : 0;
  const everEvaluated = laneHasEverEvaluatedARow(facts);
  const blockingGate = blockingDepartureLaneGate(facts);

  const narrative = everEvaluated
    ? `the lane has evaluated rows here: ${facts.entitiesWithLastSeen} carry a last-seen roster date and ${facts.entitiesWithAbsenceRecorded} carry a recorded first absence`
    : `the lane has never evaluated a row in this database, so its ${facts.entitiesReasonDeparted} \`departed\` row(s) measure other producers rather than departure activity`;

  return {
    everEvaluated,
    blockingGate,
    wouldAct,
    wouldSuppress,
    narrative: `${narrative}; blocking gate: ${blockingGate}`,
    facts,
  };
}

/**
 * One department's roster-health history, newest snapshot last.
 *
 * Age is carried per snapshot rather than derived from a single date, because a
 * standing freeze is defined by how long the department has been in that state and the
 * only record of that is the run series.
 */
export interface DepartmentRosterHealthHistoryEntry {
  department: string;
  observedAt: string;
  authoritative: boolean;
  discovered: number;
  rosterGoverned: number;
  verdict: 'pass' | 'freeze' | 'governs-nothing' | 'not-authoritative';
}

export interface StandingRosterFreeze {
  department: string;
  discovered: number;
  rosterGoverned: number;
  standingSinceObservedAt: string;
  standingForDays: number;
  consecutiveFrozenSnapshots: number;
}

export interface StandingRosterFreezeReport {
  departmentsWithHistory: number;
  departmentsWithAnyAuthoritativeSnapshot: number;
  departmentsWithNoAuthoritativeSnapshot: number;
  standingFreezes: StandingRosterFreeze[];
  longestStandingFreezeDays: number;
}

/**
 * Every department whose most recent authoritative read is frozen, with how long that
 * has been true.
 *
 * Deliberately not scoped to a run. The plan half of this audit reads one run because a
 * plan belongs to a run, and that made `frozenDepartments` true and useless: it
 * reported 1 while six departments stood frozen and the oldest had stood eleven days,
 * because the latest run happened to cover one department. A question about state
 * cannot be answered by a reading of the last event (#3302).
 *
 * The caller must pass history including superseded observations. Each roster run
 * supersedes the last, so the live set is always only the newest run and the duration
 * of a freeze is legible nowhere else.
 */
export function summarizeStandingRosterFreezes(
  history: readonly DepartmentRosterHealthHistoryEntry[],
  now: Date,
): StandingRosterFreezeReport {
  const byDepartment = new Map<string, DepartmentRosterHealthHistoryEntry[]>();
  for (const entry of history) {
    if (!byDepartment.has(entry.department)) byDepartment.set(entry.department, []);
    byDepartment.get(entry.department)!.push(entry);
  }

  const standingFreezes: StandingRosterFreeze[] = [];
  let departmentsWithAnyAuthoritativeSnapshot = 0;
  for (const [department, entries] of byDepartment) {
    const ordered = [...entries].sort((a, b) => a.observedAt.localeCompare(b.observedAt));
    const authoritative = ordered.filter((entry) => entry.authoritative);
    if (authoritative.length === 0) continue;
    departmentsWithAnyAuthoritativeSnapshot += 1;
    const latest = authoritative[authoritative.length - 1];
    if (latest.verdict !== 'freeze') continue;
    let consecutive = 0;
    for (let index = authoritative.length - 1; index >= 0; index -= 1) {
      if (authoritative[index].verdict !== 'freeze') break;
      consecutive += 1;
    }
    const since = authoritative[authoritative.length - consecutive];
    standingFreezes.push({
      department,
      discovered: latest.discovered,
      rosterGoverned: latest.rosterGoverned,
      standingSinceObservedAt: since.observedAt,
      standingForDays: Math.max(
        0,
        Math.round((now.getTime() - new Date(since.observedAt).getTime()) / 86_400_000),
      ),
      consecutiveFrozenSnapshots: consecutive,
    });
  }

  standingFreezes.sort((a, b) => b.standingForDays - a.standingForDays);
  return {
    departmentsWithHistory: byDepartment.size,
    departmentsWithAnyAuthoritativeSnapshot,
    departmentsWithNoAuthoritativeSnapshot:
      byDepartment.size - departmentsWithAnyAuthoritativeSnapshot,
    standingFreezes,
    longestStandingFreezeDays: standingFreezes[0]?.standingForDays ?? 0,
  };
}

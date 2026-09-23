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
  liveEntities: number;
  /** Rows the lane has ever recorded as present in a complete roster. */
  entitiesWithLastSeen: number;
  /** Rows the lane has ever recorded a first absence for. */
  entitiesWithAbsenceRecorded: number;
  /** Rows currently carrying the `departed` reason, from any producer. */
  entitiesReasonDeparted: number;
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
  | 'invalid-run-id'
  | 'none';

export interface FacultyDepartureLaneAuditReport {
  /** Has the lane ever evaluated a single row in this database? */
  everEvaluated: boolean;
  /** The first gate in the lane's own order that would stop it writing. */
  blockingGate: FacultyDepartureLaneGate;
  /** Rows the lane would act on today if it were enabled, before the link probe. */
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
  if (facts.planOutcome === 'no-authoritative-departments') return 'no-authoritative-departments';
  return 'none';
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

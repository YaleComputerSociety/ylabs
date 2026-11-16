export interface RunWriteCounts {
  observationCount?: unknown;
  storedObservationCountAtReconcile?: unknown;
}

const countOf = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;

/**
 * How many observations a run wrote, as far as anyone can now tell (#6291). A run killed
 * mid-write can keep `observationCount` at 0 while its observations exist, so a reconcile
 * stores the recount as `storedObservationCountAtReconcile`, and only where it is higher
 * (#6269). The stored count is a floor rather than the answer, because rows rolled back,
 * retired or superseded after the run are gone from the store, so this never reads lower
 * than the run's own claim. Every reader that decides something from a run's write count
 * goes through here.
 */
export function effectiveObservationCount(run: RunWriteCounts | null | undefined): number {
  if (!run) return 0;
  return Math.max(countOf(run.observationCount), countOf(run.storedObservationCountAtReconcile));
}

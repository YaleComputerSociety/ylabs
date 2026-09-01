// PR #484 cut saved research planning over to canonical ResearchPlan, but these 3
// fields stayed declared on the User schema pending a Development backfill. The
// backfill is confirmed complete (Development, Beta, and Production all show zero
// real stored values), so this retires the stale values ahead of dropping the
// schema declarations in the same #725 cleanup.
export const STALE_SAVED_PLAN_FIELDS = [
  'savedResearchEntityPlans',
  'savedResearchEntityPlanMigrationConflicts',
  'savedPathwayPlans',
] as const;

export function assertStaleSavedPlanFieldsFullyUnset(presentAfter: number): void {
  if (presentAfter !== 0) {
    throw new Error(
      `retire:stale-saved-plan-fields invariant violated: ${presentAfter} users documents still carry a stale saved-plan field after apply.`,
    );
  }
}

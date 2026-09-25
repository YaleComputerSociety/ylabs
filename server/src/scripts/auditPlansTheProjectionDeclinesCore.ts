/**
 * Which repair scripts plan a value the projection would decline.
 *
 * `backfillResearchEntityNames` resolved a name from the row's own observations with a
 * plain `resolveField` while `materializeEntity` applies eight name-identity authority
 * predicates the script does not import. It planned 146 field changes over 79 rows and a
 * re-materialize reached none of them, so it would have renamed 79 rows to values the
 * projection deliberately declines (#3362).
 *
 * The general shape: a repair written before an authority predicate existed will
 * confidently reassert what that predicate now refuses, and it looks perfectly reasonable
 * while doing so. An import scan over-reports, because a script may take its value from an
 * observation the authority already screened, so only dry-run-then-compare decides.
 *
 * Three verdicts, never two. Collapsing `no-rows-planned` into either of the others is how
 * a spent script and a wrong one get the same treatment, and this week both were deleted
 * for opposite reasons.
 */
export type PlanAuditVerdict = 'declines' | 'reproduces' | 'no-rows-planned' | 'unknown';

export interface PlannedFieldChange {
  entityKey: string;
  field: string;
  plannedValue: unknown;
}

export interface PlanAuditRow {
  script: string;
  verdict: PlanAuditVerdict;
  planned: number;
  declined: number;
  reproduced: number;
  /** Why the audit could not evaluate it. A script it cannot dry-run is an unknown, never a pass. */
  unknownReason?: string;
  examples?: Array<{ field: string; reason: 'not-in-planned-set' | 'planned-set-differs' }>;
}

export function verdictForScript(input: {
  planned: number;
  declined: number;
  unknownReason?: string;
}): PlanAuditVerdict {
  if (input.unknownReason) return 'unknown';
  if (input.planned === 0) return 'no-rows-planned';
  return input.declined > 0 ? 'declines' : 'reproduces';
}

/**
 * Whether the projection would produce the planned value for this field.
 *
 * A field absent from `plannedSet` is a decline rather than a match: the projection writes
 * only what it resolved, so an absent field leaves the stored value standing and the
 * script's value never arrives from evidence.
 */
export function comparePlannedFieldToProjection(
  change: PlannedFieldChange,
  plannedSet: Record<string, unknown> | undefined,
): { reproduced: boolean; reason?: 'not-in-planned-set' | 'planned-set-differs' } {
  if (!plannedSet || !Object.prototype.hasOwnProperty.call(plannedSet, change.field)) {
    return { reproduced: false, reason: 'not-in-planned-set' };
  }
  const projected = plannedSet[change.field];
  const same = JSON.stringify(projected ?? null) === JSON.stringify(change.plannedValue ?? null);
  return same ? { reproduced: true } : { reproduced: false, reason: 'planned-set-differs' };
}

export function summarizePlanAudit(
  rows: readonly PlanAuditRow[],
): Record<PlanAuditVerdict, number> {
  const summary: Record<PlanAuditVerdict, number> = {
    declines: 0,
    reproduces: 0,
    'no-rows-planned': 0,
    unknown: 0,
  };
  for (const row of rows) summary[row.verdict] += 1;
  return summary;
}

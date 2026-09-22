/**
 * Decides which `manuallyLockedFields` entries may be handed back to the engine.
 *
 * A repair that could not teach the engine anything made its correction durable by
 * locking the field, which removed that field on that row from derivation for good:
 * the correct value of the day was frozen together with every later improvement to
 * it (#2612). `fieldLockProvenance` (#2616) separates an operator's decision, which
 * outranks the engine permanently, from a repair standing in for a capability the
 * engine lacked, which must re-open once that capability lands - but nothing read
 * the distinction, so every lock in the corpus was permanent whatever it recorded.
 *
 * This is the reader, and it is deliberately an operation rather than a
 * materializer side effect. `fieldRetraction.ts` already drew that line: a sweep
 * must not silently unfreeze rows, because unlocking is exactly how a value someone
 * removed comes back.
 *
 * Two questions per lock, in order.
 *
 * 1. May the engine be asked? `isRevisitableFieldLockOnEntity` says yes on a
 *    positive `engine_gap_workaround` record, and on a lock that holds no value at
 *    all, which is a hand-rolled retraction and so a workaround by construction. A
 *    lock that pins a VALUE with no record stays `unknown` and stays shut: the
 *    repo's rule is that a lock re-opens on evidence it was a workaround, never on
 *    the absence of a record.
 * 2. Does the engine agree? The answer comes from a `dryRun` materialization run
 *    with `reviseRevisitableFieldLocks`, so it is the real resolve-and-project path
 *    reporting what it would write, not a reimplementation of it. The lock is
 *    released only when that answer is the value the row already holds, which makes
 *    a release value-preserving by construction rather than by estimate: nothing a
 *    student reads changes on the day of the release, and the field is back under
 *    derivation for every improvement after it.
 *
 * Disagreement is the expected majority case and is not a failure. It says the gap
 * the lock stands in for is still open - typically a source still asserting the
 * value a repair cleared, which needs a retraction (#2542/#2646) rather than an
 * unlock - so the lock stays and is reported.
 *
 * A row the materializer declines to project (no live observation at all) is
 * reported as silent rather than as agreement. "It would have written nothing" is a
 * claim about a code path, and only a plan counts as an answer.
 */
import {
  fieldLockReason,
  fieldLockReleaseAgrees,
  isRevisitableFieldLockOnEntity,
  lockedFieldAssertsNoValue,
  type FieldLockReason,
} from '../utils/researchEntityFieldLocks';

export type FieldLockReleaseVerdict =
  | 'release'
  | 'keep_not_revisitable'
  | 'keep_engine_disagrees'
  | 'keep_engine_silent';

export interface LockedFieldEntity {
  slug?: unknown;
  manuallyLockedFields?: unknown;
  fieldLockProvenance?: unknown;
  archived?: unknown;
  studentVisibilityTier?: unknown;
  [field: string]: unknown;
}

/** The plan a `dryRun` materialization reports, or `undefined` when it made none. */
export interface MaterializerProjectionAnswer {
  plannedSet?: Record<string, unknown>;
  plannedUnset?: Record<string, unknown>;
}

export interface FieldLockReleaseDecision {
  slug: string;
  field: string;
  reason: FieldLockReason;
  assertsNoValue: boolean;
  revisitable: boolean;
  verdict: FieldLockReleaseVerdict;
  storedValue: unknown;
  engineValue: unknown;
}

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];

/**
 * What the row would hold for `field` after the projection the answer describes.
 * A field in neither map is one the projection decided not to write, so the stored
 * value stands; that is an answer, not a silence.
 */
export function plannedFieldValue(
  answer: MaterializerProjectionAnswer,
  field: string,
  storedValue: unknown,
): unknown {
  if (answer.plannedUnset && field in answer.plannedUnset) return undefined;
  if (answer.plannedSet && field in answer.plannedSet) return answer.plannedSet[field];
  return storedValue;
}

export function decideFieldLockReleases(
  entity: LockedFieldEntity,
  answer: MaterializerProjectionAnswer | undefined,
): FieldLockReleaseDecision[] {
  const slug = typeof entity.slug === 'string' ? entity.slug : '';
  return asStringArray(entity.manuallyLockedFields).map((field) => {
    const storedValue = entity[field];
    const revisitable = isRevisitableFieldLockOnEntity(entity, field);
    const base = {
      slug,
      field,
      reason: fieldLockReason(entity.fieldLockProvenance, field),
      assertsNoValue: lockedFieldAssertsNoValue(storedValue),
      revisitable,
      storedValue,
    };
    if (!revisitable) {
      return { ...base, verdict: 'keep_not_revisitable' as const, engineValue: undefined };
    }
    if (!answer) {
      return { ...base, verdict: 'keep_engine_silent' as const, engineValue: undefined };
    }
    const engineValue = plannedFieldValue(answer, field, storedValue);
    return {
      ...base,
      engineValue,
      verdict: fieldLockReleaseAgrees(engineValue, storedValue)
        ? ('release' as const)
        : ('keep_engine_disagrees' as const),
    };
  });
}

export const releasedFieldsFromDecisions = (
  decisions: readonly FieldLockReleaseDecision[],
): string[] =>
  decisions.filter((decision) => decision.verdict === 'release').map((decision) => decision.field);

export interface FieldLockReleaseSummary {
  rowsWithLocks: number;
  lockedInstances: number;
  released: number;
  keptNotRevisitable: number;
  keptEngineDisagrees: number;
  keptEngineSilent: number;
  releasedByField: Record<string, number>;
  keptByField: Record<string, number>;
  rowsReleased: number;
}

export function summarizeFieldLockReleaseDecisions(
  decisions: readonly FieldLockReleaseDecision[],
): FieldLockReleaseSummary {
  const summary: FieldLockReleaseSummary = {
    rowsWithLocks: new Set(decisions.map((decision) => decision.slug)).size,
    lockedInstances: decisions.length,
    released: 0,
    keptNotRevisitable: 0,
    keptEngineDisagrees: 0,
    keptEngineSilent: 0,
    releasedByField: {},
    keptByField: {},
    rowsReleased: new Set(
      decisions.filter((decision) => decision.verdict === 'release').map((d) => d.slug),
    ).size,
  };
  for (const decision of decisions) {
    if (decision.verdict === 'release') {
      summary.released += 1;
      summary.releasedByField[decision.field] = (summary.releasedByField[decision.field] ?? 0) + 1;
      continue;
    }
    summary.keptByField[decision.field] = (summary.keptByField[decision.field] ?? 0) + 1;
    if (decision.verdict === 'keep_not_revisitable') summary.keptNotRevisitable += 1;
    else if (decision.verdict === 'keep_engine_disagrees') summary.keptEngineDisagrees += 1;
    else summary.keptEngineSilent += 1;
  }
  return summary;
}

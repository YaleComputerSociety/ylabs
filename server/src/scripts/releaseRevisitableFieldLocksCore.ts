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
 *    derivation for every improvement after it. "Nothing a student reads" is wider
 *    than the locked field, because a lock's presence in the list can gate a sibling
 *    field's derivation; `siblingFieldsGatedByFieldLock` names those pairs and the
 *    answer has to agree about the sibling too.
 *
 * Disagreement is the expected majority case and is not a failure. It says the gap
 * the lock stands in for is still open - typically a source still asserting the
 * value a repair cleared, which needs a retraction (#2542/#2646) rather than an
 * unlock - so the lock stays and is reported.
 *
 * A row the materializer declines to project (no live observation at all) is
 * reported as silent rather than as agreement. "It would have written nothing" is a
 * claim about a code path, and only a plan counts as an answer. On a field whose
 * collection the lock itself stops, silence about that one field is reported the same
 * way, because there the absence of evidence is the lock's own effect.
 *
 * A lock a materialization cannot answer for at all is refused before either
 * question: `fieldLockGatesNonMaterializerWriteLane` names the fields whose lock
 * holds a reconciler shut rather than a projection, and those reconcilers flip a row
 * between student-visible and suppressed.
 */
import { workPlannerSourcePolicies } from '../scrapers/workPlanner';
import {
  fieldLockGatesNonMaterializerWriteLane,
  fieldLockReason,
  fieldLockReleaseAgrees,
  isRevisitableFieldLockOnEntity,
  lockedFieldAssertsNoValue,
  siblingFieldsGatedByFieldLock,
  type FieldLockReason,
} from '../utils/researchEntityFieldLocks';

export type FieldLockReleaseVerdict =
  | 'release'
  | 'keep_not_revisitable'
  | 'keep_gates_other_writer'
  | 'keep_engine_disagrees'
  | 'keep_engine_silent'
  | 'keep_sibling_field_moves';

export interface LockedFieldEntity {
  slug?: unknown;
  manuallyLockedFields?: unknown;
  fieldLockProvenance?: unknown;
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
  movedSiblingFields?: string[];
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

export function projectionNamesField(answer: MaterializerProjectionAnswer, field: string): boolean {
  return Boolean(
    (answer.plannedUnset && field in answer.plannedUnset) ||
    (answer.plannedSet && field in answer.plannedSet),
  );
}

/**
 * Fields whose collection the lock itself stops, so for them "no observation" is
 * not evidence that the engine derives nothing - it is the lock's own effect.
 *
 * The four sources that pass `manuallyLockedFields` to `workPlanner` are exactly the
 * four carrying a planner policy, and the planner answers `shouldFetch: false,
 * reason: 'manual-lock'` for any locked target field of theirs;
 * `labMicrositeUndergradLLMExtractor` additionally drops an `undergradAccessEvidence`
 * observation outright while that field is locked. On these fields the stored-value
 * fallback above would read the lock's own suppression as agreement and hand the
 * field back to a lane that then restores the value someone cleared, so a release
 * needs a plan that names the field.
 */
const LOCK_SUPPRESSED_COLLECTION_FIELDS: ReadonlySet<string> = new Set([
  ...workPlannerSourcePolicies.flatMap((policy) => policy.targetFields),
  'undergradAccessEvidence',
]);

export function lockSuppressesFieldCollection(field: string): boolean {
  return LOCK_SUPPRESSED_COLLECTION_FIELDS.has(field);
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
    if (fieldLockGatesNonMaterializerWriteLane(field)) {
      return { ...base, verdict: 'keep_gates_other_writer' as const, engineValue: undefined };
    }
    if (!revisitable) {
      return { ...base, verdict: 'keep_not_revisitable' as const, engineValue: undefined };
    }
    if (!answer) {
      return { ...base, verdict: 'keep_engine_silent' as const, engineValue: undefined };
    }
    if (!projectionNamesField(answer, field) && lockSuppressesFieldCollection(field)) {
      return { ...base, verdict: 'keep_engine_silent' as const, engineValue: undefined };
    }
    const engineValue = plannedFieldValue(answer, field, storedValue);
    if (!fieldLockReleaseAgrees(engineValue, storedValue)) {
      return { ...base, engineValue, verdict: 'keep_engine_disagrees' as const };
    }
    const movedSiblingFields = siblingFieldsGatedByFieldLock(field).filter(
      (sibling) =>
        !fieldLockReleaseAgrees(
          plannedFieldValue(answer, sibling, entity[sibling]),
          entity[sibling],
        ),
    );
    if (movedSiblingFields.length > 0) {
      return {
        ...base,
        engineValue,
        verdict: 'keep_sibling_field_moves' as const,
        movedSiblingFields,
      };
    }
    return { ...base, engineValue, verdict: 'release' as const };
  });
}

export const releasedFieldsFromDecisions = (
  decisions: readonly FieldLockReleaseDecision[],
): string[] =>
  decisions.filter((decision) => decision.verdict === 'release').map((decision) => decision.field);

/**
 * The row's verdicts, asking the engine until its answer describes the exact set of
 * locks that is about to be released.
 *
 * One question per row is not enough on a row with several revisitable locks. A
 * kept lock still pins a value other fields' derivation reads - `websiteUrl` feeds
 * the identity-name authority loop, for one - so a plan produced with every
 * revisitable lock ignored does not describe what happens when only the agreeing
 * subset is released. Asking again about that subset does, and the subset only ever
 * shrinks, so the loop runs at most once per lock on the row.
 *
 * A field that drops out keeps the verdict from the pass that asked about it, which
 * is the disagreement that removed it.
 */
export async function resolveFieldLockReleases(
  entity: LockedFieldEntity,
  askEngine: (
    revisedFields: readonly string[],
  ) => Promise<MaterializerProjectionAnswer | undefined>,
): Promise<FieldLockReleaseDecision[]> {
  const unasked = decideFieldLockReleases(entity, undefined);
  const byField = new Map(unasked.map((decision) => [decision.field, decision]));
  let revised = unasked
    .filter((decision) => decision.verdict === 'keep_engine_silent')
    .map((decision) => decision.field);
  while (revised.length > 0) {
    const pass = decideFieldLockReleases(entity, await askEngine(revised));
    for (const decision of pass) {
      if (revised.includes(decision.field)) byField.set(decision.field, decision);
    }
    const agreed = releasedFieldsFromDecisions(pass).filter((field) => revised.includes(field));
    if (agreed.length === revised.length) break;
    revised = agreed;
  }
  return unasked.map((decision) => byField.get(decision.field) ?? decision);
}

/**
 * The plan, counted per verdict. Every count here is what the decisions say should
 * happen; what a run actually wrote is `appliedReleases` and `releasedRows` on the
 * runner's result, because a conditional write that lost its optimistic-concurrency
 * check releases nothing (#2440: a repair counter that overstates its deliveries is
 * itself a defect).
 */
export interface FieldLockReleaseSummary {
  rowsWithLocks: number;
  lockedInstances: number;
  plannedReleases: number;
  plannedRowsReleased: number;
  keptNotRevisitable: number;
  keptGatesOtherWriter: number;
  keptEngineDisagrees: number;
  keptEngineSilent: number;
  keptSiblingFieldMoves: number;
  plannedReleasesByField: Record<string, number>;
  keptByField: Record<string, number>;
}

export function summarizeFieldLockReleaseDecisions(
  decisions: readonly FieldLockReleaseDecision[],
): FieldLockReleaseSummary {
  const summary: FieldLockReleaseSummary = {
    rowsWithLocks: new Set(decisions.map((decision) => decision.slug)).size,
    lockedInstances: decisions.length,
    plannedReleases: 0,
    plannedRowsReleased: new Set(
      decisions.filter((decision) => decision.verdict === 'release').map((d) => d.slug),
    ).size,
    keptNotRevisitable: 0,
    keptGatesOtherWriter: 0,
    keptEngineDisagrees: 0,
    keptEngineSilent: 0,
    keptSiblingFieldMoves: 0,
    plannedReleasesByField: {},
    keptByField: {},
  };
  for (const decision of decisions) {
    if (decision.verdict === 'release') {
      summary.plannedReleases += 1;
      summary.plannedReleasesByField[decision.field] =
        (summary.plannedReleasesByField[decision.field] ?? 0) + 1;
      continue;
    }
    summary.keptByField[decision.field] = (summary.keptByField[decision.field] ?? 0) + 1;
    if (decision.verdict === 'keep_not_revisitable') summary.keptNotRevisitable += 1;
    else if (decision.verdict === 'keep_gates_other_writer') summary.keptGatesOtherWriter += 1;
    else if (decision.verdict === 'keep_engine_disagrees') summary.keptEngineDisagrees += 1;
    else if (decision.verdict === 'keep_sibling_field_moves') summary.keptSiblingFieldMoves += 1;
    else summary.keptEngineSilent += 1;
  }
  return summary;
}

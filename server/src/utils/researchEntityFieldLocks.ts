/**
 * Lock provenance for `manuallyLockedFields` (#2612).
 *
 * A lock overrides evidence at resolve time. `confidenceResolver.resolveField` and
 * `resolveFieldRanked` short-circuit a locked field to the value the document
 * already holds, at confidence 1.0 with `contributingSources: ['manual']`, so no
 * observation can outrank it. It is not primarily a collection stop: `workPlanner`
 * does report `shouldFetch: false, reason: 'manual-lock'`, but only 4 of the 30
 * files under `scrapers/sources/` pass the lock list to the planner, so most
 * sources keep observing a locked field and the resolver is what discards them.
 *
 * Two very different decisions share that one mechanism. An operator judging a
 * value by hand is a decision no later engine improvement may override. A repair
 * script locking a field because the engine cannot retract a value it no longer
 * has evidence for (#2542) is a workaround, and must be revisitable the moment
 * that gap closes. Before this module the two were indistinguishable, so neither
 * could be acted on.
 *
 * A lock can assert absence rather than a value. `entityMaterializer` builds
 * `manualValues` only from document fields that are not `undefined`, so a locked
 * field with nothing stored resolves to `value: undefined` at confidence 1.0 - a
 * confident assertion that there is no value, which is #2542 hand-rolled. That
 * case needs no separate reason: the reason axis records why the lock exists, and
 * a lock asserting absence exists because the engine cannot retract, so it is an
 * `engine_gap_workaround`. Whether a given lock asserts a value or its absence is
 * read from the row, not duplicated into this record.
 *
 * This module owns the vocabulary and both directions of it: `planFieldLock`
 * returns the lock and its reason as one `$set` fragment, so a writer cannot
 * record the lock without recording why, and `fieldLockReason` reads it back with
 * an absent record - every lock applied before this landed - reported as
 * `unknown`. `unknown` is deliberately not revisitable: a lock is only ever
 * re-opened on a positive record that it was a workaround, never on the absence
 * of a record.
 *
 * `operator_decision` has no writer today, and that is not an oversight to fix
 * here: `manuallyLockedFields` appears in no route, controller, or request body,
 * and the DTO never serves it, so every lock in the corpus was applied by a script
 * rather than by anyone using the product. The value exists because the
 * distinction is the whole point of the record, not because a product path
 * produces it.
 *
 * Serve and materialize behaviour is unchanged by the reason: a locked field still
 * overrides evidence at confidence 1.0 whatever its record says. What reads the
 * reason is the release direction, `isRevisitableFieldLockOnEntity` plus
 * `fieldLockReleaseAgrees`, driven by `research-entity:release-field-locks`. It is
 * a reviewed operation rather than a materializer side effect, which is the line
 * `fieldRetraction.ts` already drew: re-opening a lock is its own operation, and
 * the engine never does it silently on a sweep.
 */
import { fieldLockReasons, type FieldLockReason } from '../models/modelPrimitives';

export { fieldLockReasons };
export type { FieldLockReason };

export const FIELD_LOCK_PROVENANCE_PATH = 'fieldLockProvenance';

export interface FieldLockProvenance {
  reason: FieldLockReason;
  lockedBy: string;
  lockedAt: Date;
  note: string;
}

/**
 * `unknown` is a reading, never a declaration: it is what an absent or
 * unclassifiable record reports. Accepting it from a writer would mint a lock
 * indistinguishable from the pre-#2612 corpus while appearing to record why.
 */
export type WritableFieldLockReason = Exclude<FieldLockReason, 'unknown'>;

export const writableFieldLockReasons: readonly WritableFieldLockReason[] = fieldLockReasons.filter(
  (reason): reason is WritableFieldLockReason => reason !== 'unknown',
);

export interface FieldLockDeclaration {
  field: string;
  reason: WritableFieldLockReason;
  lockedBy: string;
  note?: string;
  lockedAt?: Date;
}

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];

const mapEntry = (container: unknown, key: string): unknown => {
  if (!container || typeof container !== 'object') return undefined;
  if (container instanceof Map) return container.get(key);
  return (container as Record<string, unknown>)[key];
};

/**
 * A field name reaches Mongo as a dotted update path, so a name carrying `.` or
 * `$` would write somewhere other than the field it claims to lock.
 */
function assertLockableFieldName(field: string): void {
  if (!field || field !== field.trim() || /[.$]/.test(field)) {
    throw new Error(`Cannot lock an unusable field name: ${JSON.stringify(field)}`);
  }
}

export function fieldLockProvenancePath(field: string): string {
  assertLockableFieldName(field);
  return `${FIELD_LOCK_PROVENANCE_PATH}.${field}`;
}

/**
 * The `$set` fragment that locks one field and records why, given the row's
 * current lock list. Returns both keys together because a lock without a recorded
 * reason is the state this exists to eliminate; the provenance is written under a
 * dotted path so it merges into whatever the row already records for other fields
 * rather than replacing the map.
 */
export function planFieldLock(
  currentLockedFields: unknown,
  declaration: FieldLockDeclaration,
): Record<string, unknown> {
  const { field, reason, lockedBy } = declaration;
  assertLockableFieldName(field);
  if (!writableFieldLockReasons.includes(reason)) {
    throw new Error(`Unknown field lock reason: ${JSON.stringify(reason)}`);
  }
  if (!lockedBy.trim()) {
    throw new Error(`A field lock must name what applied it (field: ${field}).`);
  }
  const locked = asStringArray(currentLockedFields);
  const provenance: FieldLockProvenance = {
    reason,
    lockedBy: lockedBy.trim(),
    lockedAt: declaration.lockedAt ?? new Date(),
    note: declaration.note ?? '',
  };
  return {
    manuallyLockedFields: locked.includes(field) ? locked : [...locked, field],
    [fieldLockProvenancePath(field)]: provenance,
  };
}

/**
 * Why `field` is locked on this row. `unknown` covers both a lock with no record
 * and a record that could not classify itself, because neither licenses treating
 * the lock as a workaround.
 */
export function fieldLockReason(fieldLockProvenance: unknown, field: string): FieldLockReason {
  const entry = mapEntry(fieldLockProvenance, field);
  if (!entry || typeof entry !== 'object') return 'unknown';
  const reason = (entry as { reason?: unknown }).reason;
  return typeof reason === 'string' && (fieldLockReasons as readonly string[]).includes(reason)
    ? (reason as FieldLockReason)
    : 'unknown';
}

/**
 * Whether an engine improvement may re-derive a locked field. Only a positive
 * `engine_gap_workaround` record allows it: an operator decision outranks the
 * engine, and an unclassified lock is left alone rather than guessed at.
 */
export function isRevisitableFieldLock(fieldLockProvenance: unknown, field: string): boolean {
  return fieldLockReason(fieldLockProvenance, field) === 'engine_gap_workaround';
}

/**
 * Whether a lock asserts that the field has NO value rather than pinning one.
 * `entityMaterializer` builds `manualValues` only from fields that are not
 * `undefined`, so an empty string or an empty array reaches the resolver as a
 * confident assertion of emptiness exactly as a missing field does.
 */
export function lockedFieldAssertsNoValue(storedValue: unknown): boolean {
  if (storedValue === undefined || storedValue === null) return true;
  if (typeof storedValue === 'string') return storedValue.trim() === '';
  if (Array.isArray(storedValue)) return storedValue.length === 0;
  return false;
}

/**
 * Locks that gate a write lane `materializeEntity` does not run, so no
 * materialization can report what releasing them would do.
 *
 * `ysmLabDelistingReconciler.suppressionReasonIsWritable` and
 * `researchEntityYaleStatus.yaleStatusCacheIsWritable` read the lock list and
 * update the row themselves. A dry-run projection asked to ignore such a lock
 * answers for the projection only, so it reports agreement while the lane the lock
 * actually holds shut stays unexercised - and those lanes flip a row between
 * student-visible and suppressed. Releasing one of these needs its own operation
 * that exercises the reconcilers; adding a lane that gates on a lock means adding
 * its field here.
 *
 * `inheritSchoolFromLeadPi` is the same shape from inside `materializeEntity`:
 * `leadPiSchoolInheritanceGate` returns `locked` when the row locks `school` or
 * `departments`, and the call sits behind `if (!options.dryRun)`, so the lane that
 * writes `school`, `departments` and `schools` is exactly the one a dry run cannot
 * run. Its values are served and faceted, so a release judged only on the
 * projection would move a browse facet from an operation that promises it moves
 * nothing.
 */
const FIELDS_WHOSE_LOCK_GATES_A_NON_MATERIALIZER_LANE: readonly string[] = [
  'studentVisibilitySuppressionReason',
  'activeAtYaleCache',
  'yaleStatusCache',
  'school',
  'schools',
  'departments',
];

export function fieldLockGatesNonMaterializerWriteLane(field: string): boolean {
  return FIELDS_WHOSE_LOCK_GATES_A_NON_MATERIALIZER_LANE.includes(field);
}

/**
 * Fields whose derivation the PRESENCE of another field's lock gates, so releasing
 * that lock can move them even when the locked field itself does not move.
 *
 * Almost every lock gate in `projectFromLog` reads `set[field] ?? entityDoc[field]`,
 * which is the same value once the locked field agrees with what is stored, so
 * comparing the locked field alone is enough. `fullDescription` is the exception:
 * its gate also decides whether the body restates the stored card, and only the
 * unlocked path can raise that flag, which reopens `shortDescription` - a served,
 * indexed field - for re-derivation. Checking the locked field alone would let a
 * release move student-facing card text, which the operation promises it never does.
 * A new gate that changes a sibling's derivation rather than its own field belongs
 * here.
 */
const SIBLING_FIELDS_GATED_BY_FIELD_LOCK: Readonly<Record<string, readonly string[]>> = {
  fullDescription: ['shortDescription'],
};

export function siblingFieldsGatedByFieldLock(field: string): readonly string[] {
  return SIBLING_FIELDS_GATED_BY_FIELD_LOCK[field] ?? [];
}

/**
 * Whether `field` may be re-derived on THIS row, which is the record plus one
 * property of the row itself.
 *
 * The second arm is not a guess from a missing record. A lock holding no value is
 * a hand-rolled retraction: the engine could not be told that a value it still has
 * evidence for is wrong, so the only way to stop serving it was to store nothing
 * and pin that. `researchEntityFieldLocks`' own header, `fieldRetraction.ts` and
 * `docs/research-data-pipeline.md` all already record that classification - "a
 * lock asserting absence exists because the engine cannot retract, so it is an
 * `engine_gap_workaround`" - so reading it off the row is reading a positive
 * property, not licensing a lock on the absence of evidence. A lock that pins a
 * VALUE and carries no record stays `unknown` and stays put.
 *
 * Revisitable is not releasable. It says the engine may be asked what it would
 * derive; `fieldLockReleaseAgrees` decides whether the answer permits the release.
 * A lock a materialization cannot answer for is not revisitable at all, whatever it
 * records: see `fieldLockGatesNonMaterializerWriteLane`.
 */
export function isRevisitableFieldLockOnEntity(entity: unknown, field: string): boolean {
  if (fieldLockGatesNonMaterializerWriteLane(field)) return false;
  const row =
    entity && typeof entity === 'object' ? (entity as Record<string, unknown>) : undefined;
  const reason = fieldLockReason(row?.fieldLockProvenance, field);
  if (reason === 'engine_gap_workaround') return true;
  if (reason === 'operator_decision') return false;
  return lockedFieldAssertsNoValue(mapEntry(row, field));
}

/**
 * Whether the engine's own answer for a locked field permits releasing the lock.
 *
 * A release is only ever safe when it changes nothing a student reads, so the test
 * is that the value the engine would derive with the lock ignored is the value the
 * row already holds. Two kinds of no-value agree with each other, because a lock
 * asserting absence and a derivation that produces nothing are the same fact
 * written two ways.
 *
 * Disagreement is the ordinary case and is not a failure: it says the gap the lock
 * stands in for is still open, so the lock keeps doing its job.
 */
export function fieldLockReleaseAgrees(engineValue: unknown, storedValue: unknown): boolean {
  if (lockedFieldAssertsNoValue(engineValue) && lockedFieldAssertsNoValue(storedValue)) return true;
  if (engineValue === storedValue) return true;
  try {
    return JSON.stringify(engineValue) === JSON.stringify(storedValue);
  } catch {
    return false;
  }
}

export interface FieldLockReleaseUpdate {
  set: Record<string, unknown>;
  unset: Record<string, ''>;
}

/**
 * The update that hands `releasedFields` back to the engine: the remaining lock
 * list plus the removal of each released field's provenance record, so a row never
 * carries a reason for a lock it no longer has.
 */
export function planFieldLockRelease(
  currentLockedFields: unknown,
  releasedFields: readonly string[],
): FieldLockReleaseUpdate {
  const locked = asStringArray(currentLockedFields);
  const released = releasedFields.filter((field) => locked.includes(field));
  const unset: Record<string, ''> = {};
  for (const field of released) unset[fieldLockProvenancePath(field)] = '';
  return {
    set: { manuallyLockedFields: locked.filter((field) => !released.includes(field)) },
    unset,
  };
}

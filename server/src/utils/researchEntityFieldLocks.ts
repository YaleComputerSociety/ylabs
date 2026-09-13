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
 * Nothing branches on the reason yet. Behaviour is unchanged: a locked field
 * still overrides evidence at confidence 1.0 whatever its reason says.
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

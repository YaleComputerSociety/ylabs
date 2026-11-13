/**
 * Re-derives the co-derived closure of a field a refusal clears (#6155).
 *
 * `MATERIALIZER_DERIVED_FIELD_GROUPS` names the fields the materializer writes together.
 * Clearing one member alone leaves its siblings describing the cleared value: a refused
 * `school` stays in `schools`, and every surface that falls back to `schools[0]` keeps
 * serving it. A scoped rematerialize cannot repair that afterwards, because no observation
 * asserts the closure and the scope skips with `no-scoped-fields`, so the refusal has to
 * re-derive the closure in the same operation that clears it.
 *
 * The derivation is the engine's own, run over the row as it stands after the clear and with
 * the refusal being recorded already counted, so the refused school leaves every member of the
 * closure whichever route would derive it (`withoutRefusedSchools`). Only the
 * org-unit closure derives from stored fields alone; the grant and Yale-status closures
 * derive from observations and researcher rows, and `kind` maps `entityType` into another
 * vocabulary, so those closures are reported rather than re-derived here.
 */
import { MATERIALIZER_DERIVED_FIELD_GROUPS } from '../scrapers/entityMaterializer';
import { researchEntityOrgUnitProfileUrls } from '../scrapers/orgUnitCanonicalization';
import { fieldValueRefusalKey } from '../utils/researchEntityFieldValueRefusals';
import {
  planOrgUnitBackfillRow,
  type OrgUnitBackfillEntity,
} from './backfillResearchEntityOrgUnitsCore';

export type RefusalClosureRederivation =
  | { outcome: 'not-a-closure-member' }
  | { outcome: 'closure-does-not-carry-the-value'; closure: readonly string[] }
  | { outcome: 'no-stored-state-derivation'; closure: readonly string[] }
  | {
      outcome: 'rederived';
      closure: readonly string[];
      set: Record<string, unknown>;
      lockedFieldsLeftAsStored: string[];
      siblingsCarryingBefore: string[];
      siblingsCarryingAfter: string[];
    };

export function derivedClosureOf(field: string): readonly string[] | undefined {
  return MATERIALIZER_DERIVED_FIELD_GROUPS.find((group) => group.includes(field));
}

const ORG_UNIT_CLOSURE = derivedClosureOf('school') as readonly string[];

function storedEntries(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  return value === undefined || value === null ? [] : [value];
}

function siblingsCarryingValue(
  row: Record<string, unknown>,
  closure: readonly string[],
  field: string,
  refusedKey: string,
): string[] {
  return closure.filter((sibling) =>
    storedEntries(row[sibling]).some((entry) => fieldValueRefusalKey(field, entry) === refusedKey),
  );
}

async function rederiveOrgUnitClosure(
  rowAfterClear: Record<string, unknown>,
  fieldValueRefusals: unknown,
): Promise<Record<string, unknown>> {
  const entity: OrgUnitBackfillEntity = { id: String(rowAfterClear._id ?? ''), fieldValueRefusals };
  for (const field of ORG_UNIT_CLOSURE) {
    if (Object.prototype.hasOwnProperty.call(rowAfterClear, field)) {
      (entity as unknown as Record<string, unknown>)[field] = rowAfterClear[field];
    }
  }
  const plan = await planOrgUnitBackfillRow(
    entity,
    researchEntityOrgUnitProfileUrls({}, rowAfterClear),
  );
  return plan.update;
}

/**
 * Plans the closure re-derivation for one refusal. `clearsStoredValue` says whether the
 * refusal also clears the field itself; the derivation reads the row as it will stand after
 * that clear. A row whose refused field is already clear is planned the same way, which is
 * how a refusal recorded before #6155 is repaired: re-recording it is idempotent, and the
 * closure is re-derived.
 */
export async function planRefusalClosureRederivation(input: {
  row: Record<string, unknown>;
  field: string;
  value: unknown;
  clearsStoredValue: boolean;
  fieldValueRefusalsAfterRecord: unknown;
}): Promise<RefusalClosureRederivation> {
  const closure = derivedClosureOf(input.field);
  if (!closure) return { outcome: 'not-a-closure-member' };
  if (closure !== ORG_UNIT_CLOSURE) return { outcome: 'no-stored-state-derivation', closure };

  const refusedKey = fieldValueRefusalKey(input.field, input.value);
  const rowAfterClear = { ...input.row };
  if (input.clearsStoredValue) delete rowAfterClear[input.field];
  const siblingsCarryingBefore = siblingsCarryingValue(
    rowAfterClear,
    closure,
    input.field,
    refusedKey,
  );
  if (!input.clearsStoredValue && siblingsCarryingBefore.length === 0) {
    return { outcome: 'closure-does-not-carry-the-value', closure };
  }
  const locked = new Set(
    Array.isArray(input.row.manuallyLockedFields)
      ? (input.row.manuallyLockedFields as string[])
      : [],
  );
  const derived = Object.fromEntries(
    Object.entries(
      await rederiveOrgUnitClosure(rowAfterClear, input.fieldValueRefusalsAfterRecord),
    ).filter(([field]) => !input.clearsStoredValue || field !== input.field),
  );
  const set = Object.fromEntries(Object.entries(derived).filter(([field]) => !locked.has(field)));
  return {
    outcome: 'rederived',
    closure,
    set,
    lockedFieldsLeftAsStored: Object.keys(derived).filter((field) => locked.has(field)),
    siblingsCarryingBefore,
    siblingsCarryingAfter: siblingsCarryingValue(
      { ...rowAfterClear, ...set },
      closure,
      input.field,
      refusedKey,
    ),
  };
}

/**
 * Correct a harvest text defect in a STORED field, on every resolve, whether or not
 * an observation still asserts it.
 *
 * `observationFieldSanitizer` handles a value on its way in, and
 * `sanitizeProjectedField` handles a value the projection plans, so between them the
 * invisible format character (#2874) and the lost sentence-boundary space (#3096) are
 * corrected for every field the projection writes. Neither reaches a field no live
 * observation asserts: the projection plans no value for it, so the stored text keeps
 * whatever it was written with, forever, and the only thing that can correct it is a
 * script someone remembers to run. That is why both defects shipped a one-off repair
 * after the ingest fix, and why 147 of 157 script planning modules are reachable from
 * nothing but their own script (#3408).
 *
 * This stage closes that gap. It is a derivation and not a repair: it reads the stored
 * value, applies the same pure normalizers ingest applies, asserts nothing the corpus
 * did not already assert, and so needs no `manuallyLockedFields` entry to survive. Run
 * it twice and the second run plans nothing, because the corpus is clean rather than
 * because a marker says the first run happened.
 *
 * It corrects the defect and never judges the value. Dropping a list element or
 * refusing a name is a different act with a different contract (a refusal, which the
 * operator owns), so nothing here removes a value: a normalizer that would empty a
 * non-empty field has refused that value rather than learned the field is empty, which
 * is the projection failure #2958 recorded, so the field is left standing and counted.
 */
import type { ObservedEntityType } from '../models/observation';
import { withHarvestTextDefectsCorrected } from './observationFieldSanitizer';

/**
 * The stored fields this stage may rewrite, per entity type.
 *
 * An allowlist rather than a walk of the document, because the normalizers are safe for
 * text and identity fields are not text: `slug` addresses the row in a URL a student may
 * have followed, and correcting a character in it would move the page rather than fix it.
 * `withHarvestTextDefectsCorrected` scopes the boundary restore to prose by field name on
 * its own, so listing a name field here only exposes it to the invisible-character strip.
 *
 * The three entity types are the three collections `data:repair-glued-sentence-boundaries`
 * had to sweep by hand. Covering one of them would leave that script load-bearing, which
 * is the thing this stage exists to end.
 *
 * `fname` and `lname` are deliberately absent. Person-name noise is refusal-shaped rather
 * than normalization-shaped - `planPersonNameRepair` refuses an identifier instead of
 * rewriting it, because nothing can recover a name from a slug (#2385) - so it belongs to
 * a lane that can find a real name, not to a text pass.
 */
export const NORMALIZABLE_STORED_TEXT_FIELDS: Partial<
  Record<ObservedEntityType, readonly string[]>
> = {
  researchEntity: ['name', 'displayName', 'shortDescription', 'fullDescription'],
  user: ['displayName', 'title'],
  fellowship: ['title', 'summary', 'description'],
};

export function normalizableStoredTextFields(entityType: ObservedEntityType): readonly string[] {
  return NORMALIZABLE_STORED_TEXT_FIELDS[entityType] ?? [];
}

export type StoredTextNormalizationRefusal = 'would-empty-the-field' | 'field-is-locked';

export interface StoredTextNormalizationPlan {
  set: Record<string, string>;
  refused: Array<{ field: string; reason: StoredTextNormalizationRefusal }>;
}

const EMPTY_PLAN: StoredTextNormalizationPlan = { set: {}, refused: [] };

const normalizedText = (field: string, value: string): string =>
  withHarvestTextDefectsCorrected(field, value) as string;

/**
 * Plan the stored-text corrections for one document.
 *
 * A field the projection already planned is skipped silently and without being counted:
 * that value came through `sanitizeProjectedField`, so it is already corrected and the
 * projection owns it. A locked field is skipped but counted, because a lock is an
 * operator instruction not to write the field and "a pinned value still carries a
 * harvest defect" is worth reading rather than worth acting on.
 */
export function planStoredTextNormalization(input: {
  entityType: ObservedEntityType;
  stored: Record<string, unknown> | null | undefined;
  plannedFields: ReadonlySet<string>;
  lockedFields: readonly string[];
}): StoredTextNormalizationPlan {
  if (!input.stored) return EMPTY_PLAN;
  const plan: StoredTextNormalizationPlan = { set: {}, refused: [] };
  const locked = new Set(input.lockedFields);
  for (const field of normalizableStoredTextFields(input.entityType)) {
    if (input.plannedFields.has(field)) continue;
    const stored = input.stored[field];
    if (typeof stored !== 'string' || stored.length === 0) continue;
    const corrected = normalizedText(field, stored);
    if (corrected === stored) continue;
    if (locked.has(field)) {
      plan.refused.push({ field, reason: 'field-is-locked' });
      continue;
    }
    if (corrected.trim().length === 0) {
      plan.refused.push({ field, reason: 'would-empty-the-field' });
      continue;
    }
    plan.set[field] = corrected;
  }
  return plan;
}

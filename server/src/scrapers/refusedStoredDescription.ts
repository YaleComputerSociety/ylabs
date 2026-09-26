/**
 * Clear a stored description the row's own refusals condemn, on every resolve, whether or
 * not an observation still asserts it.
 *
 * `refusedResolverObservations` screens the resolver, so a refused value cannot win a
 * field today. It cannot reach a value already stored, and for prose nothing else can
 * either: `fullDescription` and `shortDescription` are not in
 * `CLEARABLE_ON_EMPTY_RESEARCH_ENTITY_FIELDS`, and `assertDeclarableRetractionField`
 * refuses every quality-guarded prose field so field retraction is barred as well. The
 * projection is the only path in the engine that clears them.
 *
 * Measured on Development before this existed, on the two rows #3438's first apply
 * refused: the refusal screen logged `dropped 1 refused observation(s)`, the projection
 * planned no `fullDescription` at all, and the stored prose was still served. Clearing the
 * field by hand and rematerializing once put it straight back. So a recorded refusal was
 * durable and inert at the same time, which is the worst of both: the operator's judgement
 * is on the row and the student still reads the value.
 *
 * It is a derivation and not a repair, on the same terms as
 * `planRefusedStoredWebsiteUrlClear` (#3462). It asks the row the same question the
 * resolver screen already asks, so it asserts nothing new, needs no `manuallyLockedFields`
 * entry to survive, and a second pass clears nothing because the value is gone rather than
 * because a marker says the first pass happened.
 *
 * Clearing frees the slot, which is the correct outcome rather than a side effect to
 * suppress: a rival observation the resolver still admits, or
 * `deriveShortDescriptionFromFullDescription`, may refill it on the same pass or the next
 * one, and a value derived from a surviving body is a different value and so is not
 * refused. Read the resulting field rather than asserting it ends empty.
 *
 * Both description fields are planned independently, and that is safe only because of the
 * rule #3464 put in the refusal recorder: a card is never refused while its body survives.
 * Without that, clearing a card alone would hand the row `missing_card_description`, a hard
 * blocker, over prose nobody objected to. The two halves belong together - a refusal
 * recorder that could refuse a card alone plus a projection stage that clears whatever is
 * refused would demote rows as a matter of course.
 *
 * What this stage can NEVER reach, which bounds the approach rather than this file:
 * `materializeEntity` is driven by the observation log, so a row with no observations at
 * all never runs `projectFromLog` and no projection stage sees it. A refusal recorded on
 * such a row stays inert and needs a row-driven pass, which is the one thing a repair
 * script has that a derivation does not.
 */
import { valueIsRefused } from '../utils/researchEntityFieldValueRefusals';

export const REFUSABLE_STORED_DESCRIPTION_FIELDS = ['fullDescription', 'shortDescription'] as const;

export type RefusedStoredDescriptionField = (typeof REFUSABLE_STORED_DESCRIPTION_FIELDS)[number];

export type RefusedStoredDescriptionSkip = 'field-is-locked';

export interface RefusedStoredDescriptionClear {
  field: RefusedStoredDescriptionField;
  skipped: RefusedStoredDescriptionSkip | null;
}

/**
 * Plan the clears for one row, against the value the pass will leave standing: the value
 * the projection staged when it staged one, and the stored value otherwise.
 *
 * Reading the staged value matters because the description arms above assign into the
 * `$set` from several places - the resolver's winner, the card derivation, the grounded
 * card, the program-like restatement blank - so reading the outcome is the only way to
 * cover all of them rather than one. A staged value is this pass's own choice and is
 * screened by `refusedResolverObservations` upstream, so in the ordinary case this plans
 * nothing; the case it exists for is the stored value no arm staged, which is precisely
 * what the resolver screen leaves behind when it drops a field's only candidate.
 *
 * A locked field is skipped but reported. A lock is an operator instruction not to write
 * the field, and "a pinned value is one this row refuses" is worth reading rather than
 * worth overriding - the two records disagree and only a person can say which is current.
 */
export function planRefusedStoredDescriptionClears(input: {
  stored: Record<string, unknown> | null | undefined;
  staged?: Record<string, unknown>;
  lockedFields: readonly string[];
}): RefusedStoredDescriptionClear[] {
  const staged = input.staged ?? {};
  const refusals = input.stored?.fieldValueRefusals;
  if (!refusals) return [];
  const clears: RefusedStoredDescriptionClear[] = [];
  for (const field of REFUSABLE_STORED_DESCRIPTION_FIELDS) {
    const current = field in staged ? staged[field] : input.stored?.[field];
    if (typeof current !== 'string' || current.trim().length === 0) continue;
    if (!valueIsRefused(refusals, field, current)) continue;
    clears.push({
      field,
      skipped: input.lockedFields.includes(field) ? 'field-is-locked' : null,
    });
  }
  return clears;
}

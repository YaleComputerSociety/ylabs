/**
 * Clear a stored `websiteUrl` the write gate refuses, on every resolve, whether or not
 * an observation still asserts it.
 *
 * `researchHomeWebsiteUrlWriteRefusal` screens both write paths in `projectFromLog`, so
 * an inadmissible URL cannot be adopted today. It cannot reach a value already stored,
 * and its own docblock says so: the gate refuses an ADOPTION and never clears. Every
 * value written before an arm existed therefore stays served forever, which is why the
 * corpus grew four separate `retire*WebsiteUrls` repair scripts, one per arm, each
 * reachable from nothing but itself (#3428, #3432).
 *
 * Measured before any write: 21 unlocked live rows store a value the gate refuses, 18 of
 * them served, across six arms. Only two of those arms have a repair script at all, so
 * the per-arm scripts were never going to reach the cohort; one stage reading the gate's
 * own verdict covers every arm including the ones added next.
 *
 * It is a derivation and not a repair. It asks the gate the same question the gate
 * already answers on the write path, so it asserts nothing new, it needs no
 * `manuallyLockedFields` entry to survive, and a second pass clears nothing because the
 * value is gone rather than because a marker says the first pass happened. #3178 found a
 * bare clear did not hold, and the reason was specifically that the citation-promotion
 * path re-adopted the value; that path is now gated, which is what makes a clear durable
 * without a lock.
 *
 * Clearing frees the slot, so the promotion path may fill it from an admissible citation
 * on the same pass. That is the correct outcome and not a side effect to suppress: the
 * row gets the best citation it can evidence rather than the first one it ever stored.
 * Read the resulting value rather than asserting the field ends empty.
 *
 * What this stage can NEVER reach, which bounds the whole approach rather than this file:
 * `materializeEntity` is driven by the observation log, so a row with no observations at
 * all never runs `projectFromLog` and no projection stage can see it. Of the 21 refused
 * stored values measured, 8 sit on such rows and this stage reaches 13. A row outside the
 * observation log needs a row-driven pass, which is the one thing a repair script has
 * that a derivation does not.
 *
 * Those same 8 are also the reason this stage must not be widened into a blanket "clear
 * whatever the gate refuses". They are `INITIATIVE` rows whose `websiteUrl` is the
 * departmental undergraduate-research page the row exists to describe, refused by the
 * `department-programme-page` arm. A refusal that is right as "do not adopt this onto a
 * person" is not automatically right as "delete what is already here", because the same
 * URL can be a graft on one row and the subject of another. Refusing an adoption is
 * conservative; clearing is destructive, so the arms are not interchangeable between the
 * two acts.
 */
import {
  researchHomeWebsiteUrlWriteRefusal,
  type ResearchEntityHostOwnerIdentity,
  type ResearchHomeWebsiteUrlRefusal,
} from '../utils/researchHomeWebsiteUrl';

export type RefusedStoredWebsiteUrlSkip = 'field-is-locked';

export interface RefusedStoredWebsiteUrlPlan {
  clear: boolean;
  refusal: ResearchHomeWebsiteUrlRefusal | null;
  skipped: RefusedStoredWebsiteUrlSkip | null;
}

const NOTHING_TO_DO: RefusedStoredWebsiteUrlPlan = {
  clear: false,
  refusal: null,
  skipped: null,
};

/**
 * Plan the clear for one row, against the value the pass will leave standing: the value
 * the projection staged when it staged one, and the stored value otherwise.
 *
 * Reading the staged value matters for the same reason it does in
 * `planStoredTextNormalization`: the projection has around a dozen arms that assign into
 * the `$set`, so reading the outcome is the only way to cover all of them rather than
 * one. A staged value has already passed the gate, so it is admissible and this plans
 * nothing; the case this exists for is the stored value no arm staged.
 *
 * A locked field is skipped but reported, because a lock is an operator instruction not
 * to write the field, and "a pinned value is one the gate refuses" is worth reading
 * rather than worth overriding.
 */
export function planRefusedStoredWebsiteUrlClear(input: {
  stored: Record<string, unknown> | null | undefined;
  staged?: Record<string, unknown>;
  identity: ResearchEntityHostOwnerIdentity;
  lockedFields: readonly string[];
}): RefusedStoredWebsiteUrlPlan {
  const staged = input.staged ?? {};
  const current = 'websiteUrl' in staged ? staged.websiteUrl : input.stored?.websiteUrl;
  if (typeof current !== 'string' || current.trim().length === 0) return NOTHING_TO_DO;
  const refusal = researchHomeWebsiteUrlWriteRefusal(current, input.identity);
  if (!refusal) return NOTHING_TO_DO;
  if (input.lockedFields.includes('websiteUrl')) {
    return { clear: false, refusal, skipped: 'field-is-locked' };
  }
  return { clear: true, refusal, skipped: null };
}

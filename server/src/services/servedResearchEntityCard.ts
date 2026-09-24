/**
 * The single owner of "what card line does a student actually read on this row".
 *
 * It lived inside `researchEntityDto` while the DTO was its only caller, and the
 * visibility gate resolved its own card from a three-step subset of the serve
 * sanitizer instead. That divergence is #3097: the gate's card and the served card
 * were resolved by two different expressions, so a row could clear the card
 * invariant on a line no surface renders and reach students as a name with nothing
 * under it. Three mechanisms reached it - the off-entity card guard (#3067) blanks
 * the card at serve, chip hygiene drops the chips a chip summary names, and body
 * hygiene shortens the body a derived card came from - and all three are steps of
 * `sanitizeServedResearchEntityCopyFields` the gate did not run.
 *
 * So both the DTO and `buildResearchEntityPublicDescriptionRepresentation` call
 * `servedResearchEntityCardDescription` here. Adding a card guard to either surface
 * now moves the gate verdict with it.
 */
import {
  asResearchEntityType,
  mapResearchGroupKindToEntityType,
} from '../models/researchAccessTypes';
import type { ResearchEntityType } from '../models/researchAccessTypes';
import { redactDirectContactInfo } from '../utils/contactRedaction';
import { sanitizeResearchEntityShortDescription } from '../utils/descriptionHygiene';
import { sanitizeServedResearchEntityCopyFields } from '../utils/researchEntityDescriptionText';
import {
  gateAcceptedDerivedCardSubstitute,
  isUngroundedSynthesizedCard,
  researchAreasGroundedInFullDescription,
  resolveServedShortDescriptionOutcome,
  storedShortPastRenderingPreferenceIsServable,
} from '../utils/groundedCardSynthesis';
import { buildResearchAreasCardSummary } from '../utils/researchEntityDescriptionQuality';

export const MAX_SERVED_RESEARCH_ENTITY_ARRAY_ITEMS = 100;
export const MAX_SERVED_RESEARCH_ENTITY_TEXT_LENGTH = 5000;

const SERVED_COPY_TEXT_FIELDS = [
  'shortDescription',
  'fullDescription',
  'profileSynthesisDescription',
  'summary',
] as const;

const SERVED_COPY_NAME_FIELDS = ['name', 'displayName'] as const;
const SERVED_COPY_ARRAY_FIELDS = ['researchAreas', 'profileResearchAreas'] as const;

/**
 * Run the single canonical serve-time sanitizer over an entity's copy, name, and
 * research-area chip fields so every surface applies the full guard union (text
 * re-voicing/relabel/fail-close, descriptionHygiene, doubled-suffix name collapse,
 * and research-area chip hygiene) from one place (#1269/#1374). Inputs are bounded
 * to the public caps first so the union never traverses past the DTO's array/text
 * limits on a polluted input; the sanitizer clamps copy to its own sentence/word
 * boundary after.
 *
 * `leadMemberNames` unlocks the one guard in that union that cannot run without
 * them: the mismatched-person-name strip, which repairs copy opening on a
 * possessive person name that is NOT one of this record's own leads. Passing an
 * empty list is not a weaker run of the same guard, it is a structural no-op, so
 * a serve path that omits the names serves a card attributing the record's
 * research to somebody else while the detail page repairs it (#2240).
 */
export function servedResearchEntityCopy(
  group: Record<string, any>,
  leadMemberNames: readonly string[] = [],
): Record<string, any> {
  const bounded: Record<string, any> = { ...group };
  for (const field of SERVED_COPY_TEXT_FIELDS) {
    if (typeof bounded[field] === 'string') {
      bounded[field] = bounded[field].slice(0, MAX_SERVED_RESEARCH_ENTITY_TEXT_LENGTH);
    }
  }
  for (const field of SERVED_COPY_NAME_FIELDS) {
    if (typeof bounded[field] === 'string') {
      bounded[field] = bounded[field].slice(0, MAX_SERVED_RESEARCH_ENTITY_TEXT_LENGTH);
    }
  }
  for (const field of SERVED_COPY_ARRAY_FIELDS) {
    if (Array.isArray(bounded[field])) {
      bounded[field] = bounded[field].slice(0, MAX_SERVED_RESEARCH_ENTITY_ARRAY_ITEMS);
    }
  }
  return sanitizeServedResearchEntityCopyFields(bounded, leadMemberNames);
}

export function servedShortDescriptionString(value: unknown): string {
  const text = String(value || '').slice(0, MAX_SERVED_RESEARCH_ENTITY_TEXT_LENGTH);
  return sanitizeResearchEntityShortDescription(text);
}

export function servedPublicTextString(value: unknown): string {
  const text = String(value || '').slice(0, MAX_SERVED_RESEARCH_ENTITY_TEXT_LENGTH);
  return redactDirectContactInfo(text);
}

/**
 * The self-contained card short for a research entity: the sanitized stored
 * shortDescription, or empty when it is a wrong-topic synthesized card that
 * would only be an improvement to discard. A "Studies X" card whose distinctive
 * topic tokens are absent from the entity's own fullDescription can be a
 * wrong-entity graft (#1212), but discarding it is only better when the
 * fallback (the sanitized full, itself already relabeled/hygiene-cleaned by
 * `servedResearchEntityCopy`) is a self-contained summary. When the full opens
 * with a bare-pronoun/CV-bio clause the fallback is strictly worse, so the
 * self-contained short is kept rather than surrendered to it (#1832). When this
 * returns empty, callers fall back via `servedShortDescriptionFallback`, which
 * is itself hygiene-guarded and never a raw bio.
 *
 * A stored line past the card's 200-character rendering preference is held to the
 * same card bar the visibility gate will judge it with
 * (`storedShortPastRenderingPreferenceIsServable`). That band only became
 * servable at all in #1878, and the card field reads this function rather than
 * the resolver, so checking it in only one of the two places would let the list
 * and detail payloads serve a line the gate cleared the row on a chip summary
 * for - a student_ready verdict computed on copy no surface renders.
 *
 * A stored line the gate refuses is swapped for one derived from the row's own
 * body when that derived line clears the same bar
 * (`gateAcceptedDerivedCardSubstitute`), and the substitute is returned here
 * rather than left to `servedShortDescriptionFallback` so this path serves
 * exactly the line the gate cleared instead of re-deriving it under a different
 * bar.
 *
 * The ungrounded-card arm additionally reads the value the fallback will actually
 * serve, because #1832's body check alone still surrendered the card on the rows
 * whose fallback is a `researchAreas` chip summary rather than a summary of the
 * body at all (#2299, see `surrenderingTheCardReachesTheBody`).
 */
export function groundedShortDescriptionString(
  shortValue: unknown,
  served: Record<string, any>,
  entityType: ResearchEntityType | undefined,
): string {
  const shortDescription = servedShortDescriptionString(shortValue);
  if (!shortDescription) return '';
  const fullValue = served.fullDescription;
  if (
    !storedShortPastRenderingPreferenceIsServable({
      shortDescription,
      fullDescription: fullValue,
      researchAreas: served.researchAreas,
      entityType,
      kind: served.kind,
    })
  ) {
    return '';
  }
  const substitute = gateAcceptedDerivedCardSubstitute({
    shortDescription,
    fullDescription: fullValue,
    researchAreas: served.researchAreas,
    entityType,
    kind: served.kind,
  });
  if (substitute) return substitute;
  if (isUngroundedSynthesizedCard({ card: shortDescription, body: fullValue })) {
    return surrenderingTheCardReachesTheBody(served, entityType) ? '' : shortDescription;
  }
  return shortDescription;
}

/**
 * Whether giving up the stored card actually reaches a summary of this entity's own
 * body: the body must survive the card sanitizer (#1832), and the value
 * `servedShortDescriptionFallback` will serve must not be a `researchAreas` chip
 * summary, which summarizes the chip row beside the card rather than the body.
 *
 * Asking only #1832's question is not enough, because a body that fails the card
 * sanitizer sends the fallback to the chip row rather than to the body. The chips
 * are taken in stored order, which on a MeSH-harvested row is alphabetical, so the
 * surrender can card a neuroimaging-methods body with four clinical specialties.
 * Measured on Development, 227 of the 361 served cards that were nothing but chips
 * reached that state through this surrender, and on 215 of them nothing but chips
 * was available, so the row's own stored research prose was given up for a topic
 * row that supports it no better (#2299).
 *
 * Both questions are asked rather than only the second, so this can only ever
 * surrender fewer rows than #1832 did. Dropping #1832's question would newly
 * surrender the rows whose body fails the card sanitizer but still yields a
 * derivable sentence, and on those the gate judged the stored card, so serving the
 * derived line instead would widen the divergence #2299 exists to close.
 *
 * There are three fallback forms to recognise, not two. A withheld topic card
 * (#2972) makes the fallback empty, and giving up a stored card for nothing is a
 * strictly worse trade than giving it up for a chip row, so the empty-fallback
 * refusal above covers that case and must not be relaxed into "empty means the
 * body".
 */
function surrenderingTheCardReachesTheBody(
  served: Record<string, any>,
  entityType: ResearchEntityType | undefined,
): boolean {
  if (!servedShortDescriptionString(served.fullDescription)) return false;
  const fallback = servedShortDescriptionFallback(served, entityType);
  if (!fallback) return false;
  return !isResearchAreasChipSummary(fallback, served);
}

/**
 * Whether a candidate card line is the chip row restated rather than a summary of the
 * body. Both the stored-order summary and the body-grounded subset #2972 introduced
 * count, because either is the chip row: comparing only against the unfiltered form
 * read a grounded subset as a body summary and surrendered the stored card to it.
 */
function isResearchAreasChipSummary(candidate: string, served: Record<string, any>): boolean {
  if (candidate === buildResearchAreasCardSummary(served.researchAreas)) return true;
  return (
    candidate ===
    buildResearchAreasCardSummary(
      researchAreasGroundedInFullDescription(served.researchAreas, served.fullDescription),
    )
  );
}

/**
 * The guarded fallback served when no self-contained stored short survives
 * (#1832). Rather than serving the raw fullDescription verbatim - which leaked
 * bare-pronoun and CV-bio openers onto the card - derive a fresh self-contained
 * short from the entity's own full via the same canonical resolver the
 * detail-page gate uses (`resolveServedShortDescriptionOutcome`); when nothing
 * derives (a program whose admin copy is not a research summary), serve the full
 * only if it clears the shortDescription hygiene guard, so acceptable admin copy
 * survives while a bare-pronoun/CV opener fails closed to empty. This value is a
 * card derived from the entity's own full, never a stored short, so it is
 * assigned only to the served shortDescription: a restatement comparison must
 * read a stored short, never a short derived from the very full it is judging.
 *
 * The body is reached only when the resolver had nothing to derive. When it
 * withheld a topic-chip summary the row's body supports no chip of, the body is
 * NOT the consolation prize: it is the text that failed to yield a card one step
 * earlier, so serving it whole in a card slot is worse than serving nothing
 * (#2972). That row carries no card, which the visibility gate reads as
 * `missing_card_description`.
 */
export function servedShortDescriptionFallback(
  served: Record<string, any>,
  entityType: ResearchEntityType | undefined,
): string {
  const outcome = resolveServedShortDescriptionOutcome({
    shortDescription: '',
    fullDescription: served.fullDescription,
    researchAreas: served.researchAreas,
    entityType,
    kind: served.kind,
  });
  if (outcome.card) return outcome.card;
  if (outcome.topicCardWithheld) return '';
  return servedShortDescriptionString(served.fullDescription);
}

/**
 * The card line a student reads on this row, resolved from copy the canonical
 * serve sanitizer has already cleaned.
 *
 * `served` must be the output of `servedResearchEntityCopy`, not a stored
 * document: every one of the three #3097 mechanisms is a sanitizer step, so
 * resolving a card from unsanitized copy is exactly the divergence this function
 * exists to remove.
 */
export function servedResearchEntityCardDescription(
  served: Record<string, any>,
  entityType?: ResearchEntityType,
): string {
  const resolvedEntityType =
    entityType === undefined
      ? asResearchEntityType(served.entityType || mapResearchGroupKindToEntityType(served.kind))
      : entityType;
  return (
    groundedShortDescriptionString(served.shortDescription || '', served, resolvedEntityType) ||
    servedShortDescriptionFallback(served, resolvedEntityType)
  );
}

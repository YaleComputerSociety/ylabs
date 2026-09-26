import {
  buildResearchAreasCardSummary,
  deriveProgramCardShortDescription,
  deriveShortDescriptionFromFullDescription,
  describesResearchFocus,
} from '../utils/researchEntityDescriptionQuality';
import { resolveGroundedCardDescription } from '../utils/groundedCardSynthesis';
import { isCareerBiographyDescription } from '../utils/careerBiographyDescription';
import { isHighConfidencePersonBio } from '../utils/researchHomeDescriptionSelection';
import { classifyFullDescription, sanitizeDescriptionText } from './backfillDescriptionQualityCore';
import { isBlockingVisibilityReason } from '../services/studentVisibilityGateService';
import { buildResearchEntityPublicDescriptionRepresentation } from '../services/researchEntityPublicDescription';
import { isProgramLikeResearchEntity } from '../utils/researchEntityProgramLike';
import {
  asResearchEntityType,
  mapResearchGroupKindToEntityType,
} from '../models/researchAccessTypes';

export const CARD_BLOCKER_REASON = 'missing_card_description';

/**
 * Whether a card names what its subject works on, in the idioms a CARD uses.
 *
 * `describesResearchFocus` is the body test, and its phrase battery is tuned for
 * body prose: "our research focuses on", "we study", "his research interests
 * include". A card compresses the same claim into an apposition a body rarely uses
 * - "is a historian specializing in Chinese religious and legal history", "is a
 * pathologist specializing in brain diseases, focusing on neuropathology" - so the
 * body test reads those as naming no research at all.
 *
 * It matters because `isCareerBiographyDescription` fires on every one of them: the
 * role noun IS a career fact. Selecting them for rewrite is the #2200 mistake, and a
 * hand read of the lane's proposals confirmed it - one traded a clean statement of a
 * historian's own fields for a topic list belonging to an initiative they lead.
 *
 * Deliberately local rather than added to `hasResearchFocusPhrase`: that function
 * decides `classifyFullDescription` for every body in the corpus, and widening it to
 * catch a card idiom would move body verdicts nothing here has measured.
 */
const CARD_NAMES_WHAT_IS_STUDIED = [
  /\bspecializ(?:es|ing)\s+in\b/i,
  /\bfocus(?:es|ing|ed)?\s+on\b/i,
  /\bconducts?\s+research\s+(?:on|in|into)\b/i,
  /\bresearch\s+interests?\b/i,
  /\bworks?\s+on\b/i,
  /\bexpertise\s+(?:is\s+)?in\b/i,
];

const cardNamesWhatIsStudied = (value: string): boolean =>
  CARD_NAMES_WHAT_IS_STUDIED.some((pattern) => pattern.test(value));

export interface CardBackfillEntity {
  id: string;
  slug?: string;
  entityType?: string;
  kind?: string;
  shortDescription?: unknown;
  fullDescription?: unknown;
  researchAreas?: unknown;
  visibilityReasons?: string[];
  leadMemberNames?: readonly string[];
}

export type CardBackfillAction =
  | 'short-ok'
  | 'not-genuine-full'
  | 'card-derived'
  | 'card-synthesized'
  | 'no-card';

export interface CardBackfillRow {
  id: string;
  slug?: string;
  entityType?: string;
  action: CardBackfillAction;
  proposedShort: string | null;
  gainedCard: boolean;
  wouldPromote: boolean;
}

export type CardSynthesizeFn = (fullDescription: string) => Promise<string>;

const cardIsSoleBlocker = (reasons?: string[]): boolean => {
  const blockers = new Set((reasons || []).filter(isBlockingVisibilityReason));
  return blockers.size === 1 && blockers.has(CARD_BLOCKER_REASON);
};

export async function planCardBackfillRow(
  entity: CardBackfillEntity,
  synthesize: CardSynthesizeFn,
): Promise<CardBackfillRow> {
  const full = sanitizeDescriptionText(entity.fullDescription).text;
  const short = sanitizeDescriptionText(entity.shortDescription).text;
  const base = { id: entity.id, slug: entity.slug, entityType: entity.entityType };
  const isProgramLike = isProgramLikeResearchEntity({
    kind: entity.kind,
    entityType: entity.entityType,
  });
  // A document persisted via a raw `$set` can carry `kind` without the
  // `entityType` the schema only backfills as a Mongoose default on document
  // creation, so falling back to the same kind-derived mapping the serve path
  // uses (#1732) keeps the entityType-gated topic-label-list/chip-echo guards
  // below from silently never firing here the way they already do at serve
  // time - otherwise this planner can believe a bare researchArea-chip-list
  // short/card is fine when the serve gate would reject it (#1730/#1680 class).
  const resolvedEntityType = asResearchEntityType(
    entity.entityType || (entity.kind ? mapResearchGroupKindToEntityType(entity.kind) : undefined),
  );
  /**
   * A card is useful only if the gate would call it useful, and the gate assesses the
   * SERVED representation rather than the stored fields: four sanitizers and a chrome
   * strip run first, keyed on the lead member names. Asking `shortDescriptionQuality`
   * about the stored text instead answers a different question, and answers it
   * wrongly at scale: on Development all 142 rows this planner called `short-ok` are
   * held by the gate under `missing_card_description`, because the sanitizers change
   * the short on 105 of them and empty it outright on 30 (#2671).
   */
  const servedRepresentation = (candidateShort: string) =>
    buildResearchEntityPublicDescriptionRepresentation({
      entity: { ...entity, entityType: resolvedEntityType, shortDescription: candidateShort },
      leadMemberNames: entity.leadMemberNames ?? [],
    });
  const servedCardIsComplete = (candidateShort: string): boolean =>
    servedRepresentation(candidateShort).quality.cardState === 'complete';

  // A complete card is not an acceptable card when it is a career biography with no
  // research focus in it: it tells a student where the person trained and what they
  // were appointed to rather than what they study, and `cardState` cannot see the
  // difference because it scores card shape and grounding (#3098).
  //
  // All three clauses are required, and the two protections are not belt-and-braces. A
  // hand read of what the lane proposed on the rows `isCareerBiographyDescription`
  // alone selects found that most of them carry a card like "is a historian
  // specializing in Chinese religious and legal history" or "is a medical oncologist
  // who focuses on gastrointestinal cancers": the role noun is a career fact, so the
  // detector fires, but the sentence states the research all the same and a student is
  // well served by it. Rewriting those is the #2200 mistake in a new guise - 99 good
  // descriptions were replaced on Development the last time a lane selected on a
  // detector rather than on the absence of what the card is for.
  //
  // The selector is also never `isHighConfidencePersonBio`, which fires on
  // name-framed research prose. That is the right check on this lane's OUTPUT and the
  // wrong one on its INPUT.
  //
  // Judged on the SERVED card rather than the stored one, for the same reason
  // `servedCardIsComplete` is: four sanitizers and a chrome strip run first, so the
  // stored text is a different question.
  const servedCard = sanitizeDescriptionText(
    servedRepresentation(short).entity.shortDescription,
  ).text;
  const servedCardIsCareerBiography =
    isCareerBiographyDescription(servedCard) &&
    !describesResearchFocus(servedCard) &&
    !cardNamesWhatIsStudied(servedCard);
  // This lane has two arms now, and only one of them has anything to lose. A row whose
  // card is already complete is a REPLACEMENT, and a row whose card is not is the
  // GAIN this lane has always made. Keying the refusals below on the biography verdict
  // alone applied a replacement's caution to a gain: on Development the widened run
  // gained 36 cards where the unwidened one gained 48, because a held row whose card
  // is a biography had its derivation refused even though no student was reading that
  // card. A gain must behave exactly as it did before (#3098).
  const cardWouldBeReplaced = Boolean(short) && servedCardIsComplete(short);

  if (cardWouldBeReplaced && !servedCardIsCareerBiography) {
    return {
      ...base,
      action: 'short-ok',
      proposedShort: null,
      gainedCard: false,
      wouldPromote: false,
    };
  }
  // classifyFullDescription's "genuine" bar (research-focus phrasing, a 120-char
  // thin-full floor) is tuned for lab prose; a program's fullDescription is
  // legitimately terse and describes what it offers rather than what it
  // studies, so program-like entities skip straight to card resolution.
  if (!isProgramLike && classifyFullDescription(full) !== 'genuine') {
    return {
      ...base,
      action: 'not-genuine-full',
      proposedShort: null,
      gainedCard: false,
      wouldPromote: false,
    };
  }

  // Replacing a card is the one arm with something to lose, so it carries refusals the
  // gaining arm does not need. When every arm is refused the row keeps its stored card.
  //
  // The deterministic derivation is refused on a replacement, which is the opposite of
  // the ordering every other caller wants. It is refused because it was measured: a
  // hand read of what it proposes on this cohort found it trades a card naming a
  // disease plus clinical, translational, trial and genomic work for one naming the
  // disease plus trials, and a card naming three cancers plus reconstructive work for
  // one naming the three cancers. It compresses the same body the stored card already
  // summarises, so on a row that HAS a card it can only ever be a lossier statement of
  // it. On a gain it stays the first arm, because there a lossy sentence beats nothing.
  //
  // A replacement that is itself a career biography or any person-voiced prose is
  // churn, and a bare research-area chip summary trades a sentence for the chip row
  // already shown beside the card, which the serve path reaches on its own without a
  // stored write (#3098).
  const derivedFromBody = isProgramLike
    ? deriveProgramCardShortDescription(full)
    : deriveShortDescriptionFromFullDescription(full);
  const refuseCandidate = cardWouldBeReplaced
    ? (candidate: string): boolean =>
        candidate === derivedFromBody ||
        isCareerBiographyDescription(candidate) ||
        isHighConfidencePersonBio(candidate) ||
        candidate === buildResearchAreasCardSummary(entity.researchAreas)
    : undefined;
  const card = await resolveGroundedCardDescription({
    fullDescription: full,
    researchAreas: entity.researchAreas,
    entityType: resolvedEntityType,
    isProgramLike,
    synthesize,
    refuseCandidate,
  });
  if (!card || card === short || !servedCardIsComplete(card)) {
    return {
      ...base,
      action: 'no-card',
      proposedShort: null,
      gainedCard: false,
      wouldPromote: false,
    };
  }

  const action: CardBackfillAction = card === derivedFromBody ? 'card-derived' : 'card-synthesized';
  return {
    ...base,
    action,
    proposedShort: card,
    gainedCard: true,
    wouldPromote: cardIsSoleBlocker(entity.visibilityReasons),
  };
}

export interface CardBackfillSummary {
  total: number;
  actions: Record<CardBackfillAction, number>;
  cardsGained: number;
  cardsDerived: number;
  cardsSynthesized: number;
  wouldPromote: number;
}

const emptyActionCounts = (): Record<CardBackfillAction, number> => ({
  'short-ok': 0,
  'not-genuine-full': 0,
  'card-derived': 0,
  'card-synthesized': 0,
  'no-card': 0,
});

export function summarizeCardBackfill(rows: CardBackfillRow[]): CardBackfillSummary {
  const actions = emptyActionCounts();
  let cardsGained = 0;
  let cardsDerived = 0;
  let cardsSynthesized = 0;
  let wouldPromote = 0;
  for (const row of rows) {
    actions[row.action] += 1;
    if (row.gainedCard) cardsGained += 1;
    if (row.action === 'card-derived') cardsDerived += 1;
    if (row.action === 'card-synthesized') cardsSynthesized += 1;
    if (row.wouldPromote) wouldPromote += 1;
  }
  return { total: rows.length, actions, cardsGained, cardsDerived, cardsSynthesized, wouldPromote };
}

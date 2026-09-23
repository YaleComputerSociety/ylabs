import {
  buildResearchAreasCardSummary,
  deriveProgramCardShortDescription,
  deriveShortDescriptionFromFullDescription,
} from '../utils/researchEntityDescriptionQuality';
import { resolveGroundedCardDescription } from '../utils/groundedCardSynthesis';
import { isCareerBiographyDescription } from '../utils/careerBiographyDescription';
import { isHighConfidencePersonBio } from '../utils/researchHomeDescriptionSelection';
import { classifyFullDescription, sanitizeDescriptionText } from './backfillDescriptionQualityCore';
import { isBlockingVisibilityReason } from '../services/studentVisibilityGateService';
import { buildResearchEntityPublicDescriptionRepresentation } from '../services/researchEntityPublicDescription';
import { isProgramLikeResearchEntity } from '../utils/researchEntityProgramLike';
import { mapResearchGroupKindToEntityType } from '../models/researchAccessTypes';

export const CARD_BLOCKER_REASON = 'missing_card_description';

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
  const resolvedEntityType =
    entity.entityType || (entity.kind ? mapResearchGroupKindToEntityType(entity.kind) : undefined);
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

  // A complete card is not an acceptable card when it is a career biography: it tells
  // a student where the person trained and what they were appointed to rather than
  // what they research, and `cardState` cannot see the difference because it scores
  // card shape and grounding. 34 served `student_ready` rows read this way, all of
  // them with a body that passes `fullDescription` quality with zero flags, so the
  // material for a real card is already on the row and only this early return
  // withheld it (#3098).
  //
  // The detector is the narrow `isCareerBiographyDescription` and must stay narrow.
  // The wide `isHighConfidencePersonBio` fires on name-framed research prose, which
  // is exactly what a student needs, and selecting rewrite targets with it replaced
  // 99 good descriptions on Development. It is the right check on this lane's OUTPUT
  // and the wrong one on its INPUT.
  //
  // Judged on the SERVED card rather than the stored one, for the same reason
  // `servedCardIsComplete` is: four sanitizers and a chrome strip run first, so the
  // stored text is a different question.
  const servedCard = sanitizeDescriptionText(
    servedRepresentation(short).entity.shortDescription,
  ).text;
  const servedCardIsCareerBiography = isCareerBiographyDescription(servedCard);

  if (short && servedCardIsComplete(short) && !servedCardIsCareerBiography) {
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

  // Replacing a career-biography card is the one arm with something to lose, so it
  // carries a refusal the others do not need. A replacement that is itself a career
  // biography or any person-voiced prose is churn, and a bare research-area chip
  // summary trades a fluent sentence for the chip row already shown beside the card,
  // which the serve path can reach on its own without a stored write. When every arm
  // is refused the row keeps its stored card (#3098).
  const refuseCandidate = servedCardIsCareerBiography
    ? (candidate: string): boolean =>
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

  const derived = isProgramLike
    ? deriveProgramCardShortDescription(full)
    : deriveShortDescriptionFromFullDescription(full);
  const action: CardBackfillAction = card === derived ? 'card-derived' : 'card-synthesized';
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

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

  // A complete card is not an acceptable card when it is a career biography with no
  // research focus in it: it tells a student where the person trained and what they
  // were appointed to rather than what they study, and `cardState` cannot see the
  // difference because it scores card shape and grounding (#3098).
  //
  // BOTH halves are required, and the second is not belt-and-braces. A hand read of
  // the rows `isCareerBiographyDescription` alone selects found that most of them
  // carry a card like "is a historian specializing in Chinese religious and legal
  // history" or "is a medical oncologist who focuses on gastrointestinal cancers":
  // the role noun is a career fact, so the detector fires, but the sentence states
  // the research all the same and a student is well served by it. Rewriting those is
  // the #2200 mistake in a new guise - 99 good descriptions were replaced on
  // Development the last time a lane selected on a detector rather than on the
  // absence of what the card is for. `describesResearchFocus` is the same phrase test
  // `classifyFullDescription` uses for the body, asked here of the card.
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
    isCareerBiographyDescription(servedCard) && !describesResearchFocus(servedCard);

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

  // Replacing a card is the one arm with something to lose, so it carries refusals the
  // gaining arm does not need. When every arm is refused the row keeps its stored card.
  //
  // The deterministic derivation is refused outright here, which is the opposite of
  // the ordering every other caller wants. It is refused because it was measured: a
  // hand read of what it proposes on this cohort found it trades a card naming a
  // disease plus clinical, translational, trial and genomic work for one naming the
  // disease plus trials, and a card naming three cancers plus reconstructive work for
  // one naming the three cancers. It compresses the same body the stored card already
  // summarises, so on a row that HAS a card it can only ever be a lossier statement
  // of it. On a row with no card it is still the first arm, because there a lossy
  // sentence beats nothing.
  //
  // A replacement that is itself a career biography or any person-voiced prose is
  // churn, and a bare research-area chip summary trades a sentence for the chip row
  // already shown beside the card, which the serve path reaches on its own without a
  // stored write (#3098).
  const derivedFromBody = isProgramLike
    ? deriveProgramCardShortDescription(full)
    : deriveShortDescriptionFromFullDescription(full);
  const refuseCandidate = servedCardIsCareerBiography
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

  const action: CardBackfillAction =
    card === derivedFromBody ? 'card-derived' : 'card-synthesized';
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

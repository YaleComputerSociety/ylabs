import {
  deriveProgramCardShortDescription,
  deriveShortDescriptionFromFullDescription,
  programCardShortDescriptionQuality,
  shortDescriptionQuality,
} from '../utils/researchEntityDescriptionQuality';
import { resolveGroundedCardDescription } from '../utils/groundedCardSynthesis';
import { classifyFullDescription, sanitizeDescriptionText } from './backfillDescriptionQualityCore';
import { isBlockingVisibilityReason } from '../services/studentVisibilityGateService';
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

/**
 * The Mongo filter selecting entities the card-synthesis lane will consider.
 *
 * A corpus scan pre-filters on the persisted `studentVisibilityReasons` flag as
 * a cheap index hit. But that stored reason array can lag a fresh recompute: an
 * entity re-gated in memory still carries its older persisted reasons until the
 * gate is applied, so a document that a fresh recompute shows as sole
 * card-blocked can still be missing the flag on disk (and vice versa). When the
 * caller names ids explicitly via `--record-id`, re-applying that stale flag
 * would silently drop the very ids the caller scoped - so an explicit scope is
 * queried by `_id` alone, and the per-row `planStudentVisibilityGate` recompute
 * plus the `wouldPromote` (sole-blocker) gate decide what actually gets a card.
 */
export function buildCardSynthesisQuery(hasScopedIds: boolean): Record<string, unknown> {
  return hasScopedIds
    ? { archived: { $ne: true } }
    : { archived: { $ne: true }, studentVisibilityReasons: CARD_BLOCKER_REASON };
}

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
  const isShortUseful = (text: string): boolean =>
    isProgramLike
      ? programCardShortDescriptionQuality(text, full).isUseful
      : shortDescriptionQuality(text, full, entity.researchAreas, { entityType: resolvedEntityType })
          .isUseful;

  if (short && isShortUseful(short)) {
    return { ...base, action: 'short-ok', proposedShort: null, gainedCard: false, wouldPromote: false };
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

  const card = await resolveGroundedCardDescription({
    fullDescription: full,
    researchAreas: entity.researchAreas,
    entityType: resolvedEntityType,
    isProgramLike,
    synthesize,
  });
  if (!card || !isShortUseful(card)) {
    return { ...base, action: 'no-card', proposedShort: null, gainedCard: false, wouldPromote: false };
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

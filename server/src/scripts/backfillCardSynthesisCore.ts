import {
  deriveShortDescriptionFromFullDescription,
  shortDescriptionQuality,
} from '../utils/researchEntityDescriptionQuality';
import { resolveGroundedCardDescription } from '../utils/groundedCardSynthesis';
import { classifyFullDescription, sanitizeDescriptionText } from './backfillDescriptionQualityCore';
import { isBlockingVisibilityReason } from '../services/studentVisibilityGateService';

export const CARD_BLOCKER_REASON = 'missing_card_description';

export interface CardBackfillEntity {
  id: string;
  slug?: string;
  entityType?: string;
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

export async function planCardBackfillRow(
  entity: CardBackfillEntity,
  synthesize: CardSynthesizeFn,
): Promise<CardBackfillRow> {
  const full = sanitizeDescriptionText(entity.fullDescription).text;
  const short = sanitizeDescriptionText(entity.shortDescription).text;
  const base = { id: entity.id, slug: entity.slug, entityType: entity.entityType };

  if (short && shortDescriptionQuality(short, full).isUseful) {
    return { ...base, action: 'short-ok', proposedShort: null, gainedCard: false, wouldPromote: false };
  }
  if (classifyFullDescription(full) !== 'genuine') {
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
    synthesize,
  });
  if (!card || !shortDescriptionQuality(card, full).isUseful) {
    return { ...base, action: 'no-card', proposedShort: null, gainedCard: false, wouldPromote: false };
  }

  const action: CardBackfillAction =
    card === deriveShortDescriptionFromFullDescription(full) ? 'card-derived' : 'card-synthesized';
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

import { describe, expect, it, vi } from 'vitest';

import {
  planCardBackfillRow,
  summarizeCardBackfill,
  type CardBackfillRow,
} from '../backfillCardSynthesisCore';
import { deriveShortDescriptionFromFullDescription } from '../../utils/researchEntityDescriptionQuality';

const RICH_FIRST_PERSON_FULL =
  'Our lab is broadly interested in the biology of aging and the ways that metabolism shapes lifespan across species. Over the past decade we have built a range of experimental systems, from yeast to zebrafish, and we continue to expand these tools while training the next generation of scientists.';

const DERIVABLE_FULL =
  'The Rivera Lab studies how immune cells detect and respond to viral infection. Ongoing projects map the antiviral signaling pathways that shape the earliest stages of the response.';

const GROUNDED_CARD =
  'Studies the biology of aging and how metabolism shapes lifespan across species.';

const neverSynthesize = vi.fn(async () => 'Studies something the grounding check should reject.');

describe('planCardBackfillRow', () => {
  it('keeps an entity that already has a usable card', async () => {
    const row = await planCardBackfillRow(
      {
        id: '000000000000000000000001',
        slug: 'aging-lab',
        shortDescription: GROUNDED_CARD,
        fullDescription: RICH_FIRST_PERSON_FULL,
      },
      neverSynthesize,
    );
    expect(row.action).toBe('short-ok');
    expect(row.gainedCard).toBe(false);
    expect(neverSynthesize).not.toHaveBeenCalled();
  });

  it('skips an entity whose full description is not genuine source prose', async () => {
    const row = await planCardBackfillRow(
      {
        id: '000000000000000000000002',
        fullDescription:
          'Welcome to the Smith Lab website. Thank you for your interest in our lab.',
      },
      neverSynthesize,
    );
    expect(row.action).toBe('not-genuine-full');
    expect(row.gainedCard).toBe(false);
  });

  it('uses the deterministic derivation when it produces a card', async () => {
    const synthesize = vi.fn(async () => GROUNDED_CARD);
    const row = await planCardBackfillRow(
      { id: '000000000000000000000003', fullDescription: DERIVABLE_FULL },
      synthesize,
    );
    expect(row.action).toBe('card-derived');
    expect(row.proposedShort).toBe(deriveShortDescriptionFromFullDescription(DERIVABLE_FULL));
    expect(synthesize).not.toHaveBeenCalled();
  });

  it('synthesizes a grounded card when the derivation returns nothing', async () => {
    const synthesize = vi.fn(async () => GROUNDED_CARD);
    const row = await planCardBackfillRow(
      {
        id: '000000000000000000000004',
        fullDescription: RICH_FIRST_PERSON_FULL,
        visibilityReasons: ['missing_card_description'],
      },
      synthesize,
    );
    expect(synthesize).toHaveBeenCalledOnce();
    expect(row.action).toBe('card-synthesized');
    expect(row.proposedShort).toBe(GROUNDED_CARD);
    expect(row.gainedCard).toBe(true);
    expect(row.wouldPromote).toBe(true);
  });

  it('counts a promotion when evidence reasons accompany the sole card blocker', async () => {
    const synthesize = vi.fn(async () => GROUNDED_CARD);
    const row = await planCardBackfillRow(
      {
        id: '000000000000000000000007',
        fullDescription: RICH_FIRST_PERSON_FULL,
        visibilityReasons: [
          'concrete_next_step',
          'missing_card_description',
          'source_backed_description',
        ],
      },
      synthesize,
    );
    expect(row.action).toBe('card-synthesized');
    expect(row.gainedCard).toBe(true);
    expect(row.wouldPromote).toBe(true);
  });

  it('does not count a promotion when other blockers remain', async () => {
    const synthesize = vi.fn(async () => GROUNDED_CARD);
    const row = await planCardBackfillRow(
      {
        id: '000000000000000000000005',
        fullDescription: RICH_FIRST_PERSON_FULL,
        visibilityReasons: ['missing_card_description', 'missing_lead'],
      },
      synthesize,
    );
    expect(row.action).toBe('card-synthesized');
    expect(row.gainedCard).toBe(true);
    expect(row.wouldPromote).toBe(false);
  });

  it('fails closed to no-card when synthesis is not confident', async () => {
    const synthesize = vi.fn(async () => '');
    const row = await planCardBackfillRow(
      { id: '000000000000000000000006', fullDescription: RICH_FIRST_PERSON_FULL },
      synthesize,
    );
    expect(row.action).toBe('no-card');
    expect(row.gainedCard).toBe(false);
    expect(row.proposedShort).toBeNull();
  });
});

describe('summarizeCardBackfill', () => {
  it('tallies actions, cards gained, and promotions', () => {
    const rows: CardBackfillRow[] = [
      { id: '1', action: 'card-synthesized', proposedShort: 'x', gainedCard: true, wouldPromote: true },
      { id: '2', action: 'card-derived', proposedShort: 'y', gainedCard: true, wouldPromote: false },
      { id: '3', action: 'no-card', proposedShort: null, gainedCard: false, wouldPromote: false },
      { id: '4', action: 'short-ok', proposedShort: null, gainedCard: false, wouldPromote: false },
    ];
    const summary = summarizeCardBackfill(rows);
    expect(summary.total).toBe(4);
    expect(summary.cardsGained).toBe(2);
    expect(summary.cardsSynthesized).toBe(1);
    expect(summary.cardsDerived).toBe(1);
    expect(summary.wouldPromote).toBe(1);
    expect(summary.actions['no-card']).toBe(1);
    expect(summary.actions['short-ok']).toBe(1);
  });
});

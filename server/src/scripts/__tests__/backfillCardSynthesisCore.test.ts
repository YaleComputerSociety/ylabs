import { describe, expect, it, vi } from 'vitest';

import {
  planCardBackfillRow,
  summarizeCardBackfill,
  buildCardSynthesisQuery,
  CARD_BLOCKER_REASON,
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

const LABEL_LIST_FULL =
  "Jordan Ellis's research interests include comparative constitutional law, transnational legal governance, the history of federalist theory, judicial independence, and political risk analysis.";

const LABEL_LIST_SHORT =
  'Studies comparative constitutional law, transnational legal governance, the history of federalist theory, judicial independence, and political risk analysis.';

const LABEL_LIST_AREAS = ['Political Science'];

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

  it('derives a program card from its own terse description instead of rejecting it as not-genuine (#1425)', async () => {
    const programFull =
      'Yale Economics summer research opportunities that match undergraduate students with faculty research projects.';
    const row = await planCardBackfillRow(
      {
        id: '000000000000000000000008',
        entityType: 'RA_PROGRAM',
        kind: 'program',
        fullDescription: programFull,
        visibilityReasons: ['missing_card_description'],
      },
      neverSynthesize,
    );
    expect(neverSynthesize).not.toHaveBeenCalled();
    expect(row.action).toBe('card-derived');
    expect(row.proposedShort).toBe(programFull);
    expect(row.gainedCard).toBe(true);
    expect(row.wouldPromote).toBe(true);
  });
});

describe('planCardBackfillRow topic-label-list awareness (#1730/#1680)', () => {
  it('holds rather than fabricates when a stored bare label-list short would be rejected at serve time', async () => {
    const emptySynthesize = vi.fn(async () => '');
    const row = await planCardBackfillRow(
      {
        id: '00000000000000000000000a',
        slug: 'jordan-ellis',
        entityType: 'FACULTY_RESEARCH_AREA',
        shortDescription: LABEL_LIST_SHORT,
        fullDescription: LABEL_LIST_FULL,
        researchAreas: LABEL_LIST_AREAS,
        visibilityReasons: ['missing_card_description'],
      },
      emptySynthesize,
    );
    expect(row.action).toBe('no-card');
    expect(row.gainedCard).toBe(false);
  });

  it('still detects the label-list short via a kind-derived entityType fallback when entityType is unset (#1732 parity)', async () => {
    const emptySynthesize = vi.fn(async () => '');
    const row = await planCardBackfillRow(
      {
        id: '00000000000000000000000b',
        slug: 'jordan-ellis-raw-set',
        kind: 'individual',
        shortDescription: LABEL_LIST_SHORT,
        fullDescription: LABEL_LIST_FULL,
        researchAreas: LABEL_LIST_AREAS,
        visibilityReasons: ['missing_card_description'],
      },
      emptySynthesize,
    );
    expect(row.action).toBe('no-card');
    expect(row.gainedCard).toBe(false);
  });

  it('promotes a genuinely different synthesized sentence instead of restating the stored label-list', async () => {
    const rewordedCard =
      'Examines comparative constitutional law, transnational legal governance, the history of federalist theory, judicial independence, and political risk analysis.';
    const synthesize = vi.fn(async () => rewordedCard);
    const row = await planCardBackfillRow(
      {
        id: '00000000000000000000000c',
        slug: 'jordan-ellis-resynthesized',
        entityType: 'FACULTY_RESEARCH_AREA',
        shortDescription: LABEL_LIST_SHORT,
        fullDescription: LABEL_LIST_FULL,
        researchAreas: LABEL_LIST_AREAS,
        visibilityReasons: ['missing_card_description'],
      },
      synthesize,
    );
    expect(row.action).toBe('card-synthesized');
    expect(row.proposedShort).toBe(rewordedCard);
    expect(row.gainedCard).toBe(true);
    expect(row.wouldPromote).toBe(true);
  });
});

describe('buildCardSynthesisQuery', () => {
  it('pre-filters a corpus scan on the stored card-blocker reason', () => {
    const query = buildCardSynthesisQuery(false);
    expect(query).toEqual({
      archived: { $ne: true },
      studentVisibilityReasons: CARD_BLOCKER_REASON,
    });
  });

  it('drops the stored-reason filter for an explicit id scope so stale reasons cannot hide named ids', () => {
    const query = buildCardSynthesisQuery(true);
    expect(query).toEqual({ archived: { $ne: true } });
    expect(query).not.toHaveProperty('studentVisibilityReasons');
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

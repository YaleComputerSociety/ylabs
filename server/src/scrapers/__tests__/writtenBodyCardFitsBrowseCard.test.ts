import { describe, expect, it, vi } from 'vitest';

import { resolveWrittenBodyCard, writtenBodyCardShowsWhole } from '../entityMaterializer';
import { cardLineFitsBrowseCard } from '../../utils/groundedCardSynthesis';

const BODY =
  'The Fixture Lab investigates how regulatory T cells and tolerogenic antigen-presenting cells shape immune responses in cancer and autoimmunity. It uses genetic, biochemical, chemical biology and sequencing approaches across translational models.';

const LONG_CARD =
  'Investigates how regulatory T cells, T cell anergy, and tolerogenic antigen-presenting cells shape immune responses in cancer, autoimmunity, transplantation, and reproductive health using genetic, biochemical, chemical biology, sequencing, and translational models.';

const FITTING_CARD =
  'Investigates how regulatory T cells and tolerogenic antigen-presenting cells shape immune responses in cancer and autoimmunity.';

const base = {
  body: BODY,
  observedCards: [],
  researchAreas: [],
  servingBarAccepts: () => true,
};

describe('resolveWrittenBodyCard prefers a line that shows whole (#4809)', () => {
  it('passes over a stored card the browse card would cut for a fitting one', async () => {
    expect(cardLineFitsBrowseCard(LONG_CARD)).toBe(false);
    const choice = await resolveWrittenBodyCard({
      ...base,
      storedCard: LONG_CARD,
      synthesize: vi.fn().mockResolvedValue(FITTING_CARD),
    });

    expect('card' in choice && cardLineFitsBrowseCard(choice.card)).toBe(true);
    expect('card' in choice && choice.card).not.toBe(LONG_CARD);
  });

  it('keeps the stored card when nothing that fits is found', async () => {
    const choice = await resolveWrittenBodyCard({
      ...base,
      body: `${LONG_CARD} ${BODY}`,
      storedCard: LONG_CARD,
      synthesize: vi.fn().mockResolvedValue(''),
    });

    expect(choice).toEqual({ kind: 'stored', card: LONG_CARD });
  });
});

describe('resolveWrittenBodyCard prefers a line the serve chain shows (#4809)', () => {
  const UNSTATED_CARD =
    'Investigates how regulatory T cells and tolerogenic antigen-presenting cells shape immune responses in pediatric melanoma and lupus.';

  it('reads a fitting card naming what the body does not as not shown whole', () => {
    expect(cardLineFitsBrowseCard(UNSTATED_CARD)).toBe(true);
    expect(writtenBodyCardShowsWhole(UNSTATED_CARD, BODY)).toBe(false);
    expect(writtenBodyCardShowsWhole(FITTING_CARD, BODY)).toBe(true);
  });

  it('passes over such a stored card for a synthesized line the body states', async () => {
    const choice = await resolveWrittenBodyCard({
      ...base,
      body: `${LONG_CARD} ${BODY}`,
      storedCard: UNSTATED_CARD,
      synthesize: vi.fn().mockResolvedValue(FITTING_CARD),
    });

    expect(choice).toEqual({ kind: 'synthesized', card: FITTING_CARD });
  });

  it('keeps the stored card when no synthesizer is handed over', async () => {
    const choice = await resolveWrittenBodyCard({
      ...base,
      body: `${LONG_CARD} ${BODY}`,
      storedCard: UNSTATED_CARD,
    });

    expect(choice).toEqual({ kind: 'stored', card: UNSTATED_CARD });
  });
});

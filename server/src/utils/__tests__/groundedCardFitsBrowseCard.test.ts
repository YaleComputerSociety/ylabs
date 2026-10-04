import { describe, expect, it, vi } from 'vitest';

import { resolveMaterializedShortDescription } from '../../scrapers/entityMaterializer';
import {
  CARD_SYNTHESIS_MAX_CHARACTERS,
  cardLineFitsBrowseCard,
  resolveGroundedCardDescription,
  synthesizeGroundedCardDescription,
} from '../groundedCardSynthesis';
import { deriveShortDescriptionFromFullDescription } from '../researchEntityDescriptionQuality';

const LONG_LEAD_FULL =
  'The Fixture Lab investigates how regulatory T cells, T cell anergy, and tolerogenic antigen-presenting cells shape immune responses in cancer, autoimmunity, transplantation, and reproductive health using genetic, biochemical, chemical biology, sequencing, and translational models. Ongoing projects test new ways to restore tolerance in patients.';

const FITTING_CARD =
  'Investigates how regulatory T cells and tolerogenic antigen-presenting cells shape immune responses in cancer and autoimmunity.';

const LONG_CARD = deriveShortDescriptionFromFullDescription(LONG_LEAD_FULL);

describe('card lines that show whole on the browse card (#4809)', () => {
  it('reads a single sentence past the 200-character render as not fitting', () => {
    expect(LONG_CARD.length).toBeGreaterThan(200);
    expect(cardLineFitsBrowseCard(LONG_CARD)).toBe(false);
    expect(cardLineFitsBrowseCard(FITTING_CARD)).toBe(true);
  });

  it('asks for a length limit and retries once with the long answer to shorten it', async () => {
    const callLLM = vi.fn().mockResolvedValueOnce(LONG_CARD).mockResolvedValueOnce(FITTING_CARD);

    const card = await synthesizeGroundedCardDescription({
      fullDescription: LONG_LEAD_FULL,
      callLLM,
    });

    expect(card).toBe(FITTING_CARD);
    expect(callLLM).toHaveBeenCalledTimes(2);
    expect(callLLM.mock.calls[0][0]).toMatchObject({
      maxCharacters: CARD_SYNTHESIS_MAX_CHARACTERS,
    });
    expect(callLLM.mock.calls[1][0]).toMatchObject({ previousAttempt: LONG_CARD });
  });

  it('keeps the long grounded line when the retry still does not fit', async () => {
    const callLLM = vi.fn().mockResolvedValue(LONG_CARD);

    expect(
      await synthesizeGroundedCardDescription({ fullDescription: LONG_LEAD_FULL, callLLM }),
    ).toBe(LONG_CARD);
    expect(callLLM).toHaveBeenCalledTimes(2);
  });

  it('prefers a synthesized line that fits over a derived line the card would cut', async () => {
    const synthesize = vi.fn().mockResolvedValue(FITTING_CARD);

    expect(
      await resolveGroundedCardDescription({ fullDescription: LONG_LEAD_FULL, synthesize }),
    ).toBe(FITTING_CARD);
  });

  it('still serves the long derived line when nothing that fits is available', async () => {
    expect(
      await resolveGroundedCardDescription({
        fullDescription: LONG_LEAD_FULL,
        synthesize: () => Promise.resolve(''),
      }),
    ).toBe(LONG_CARD);
  });

  it('replaces a stored card the browse card cuts only with a line that shows whole', async () => {
    const replaced = await resolveMaterializedShortDescription({
      fullDescription: LONG_LEAD_FULL,
      currentShortDescription: LONG_CARD,
      synthesize: () => Promise.resolve(FITTING_CARD),
    });
    const kept = await resolveMaterializedShortDescription({
      fullDescription: LONG_LEAD_FULL,
      currentShortDescription: LONG_CARD,
      synthesize: () => Promise.resolve(''),
    });

    expect(replaced).toBe(FITTING_CARD);
    expect(kept).toBeNull();
  });
});

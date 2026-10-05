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

  it('reconsiders a stored card the browse card cuts without card synthesis on a routine pass', async () => {
    const synthesize = vi.fn().mockResolvedValue(FITTING_CARD);

    expect(
      await resolveMaterializedShortDescription({
        fullDescription: LONG_LEAD_FULL,
        currentShortDescription: LONG_CARD,
        synthesize,
      }),
    ).toBeNull();
    expect(synthesize).not.toHaveBeenCalled();
  });

  it('replaces a stored card the browse card cuts only with a line that shows whole when resynthesis is asked for', async () => {
    const replaced = await resolveMaterializedShortDescription({
      fullDescription: LONG_LEAD_FULL,
      currentShortDescription: LONG_CARD,
      resynthesizeCutCards: true,
      synthesize: () => Promise.resolve(FITTING_CARD),
    });
    const kept = await resolveMaterializedShortDescription({
      fullDescription: LONG_LEAD_FULL,
      currentShortDescription: LONG_CARD,
      resynthesizeCutCards: true,
      synthesize: () => Promise.resolve(''),
    });

    expect(replaced).toBe(FITTING_CARD);
    expect(kept).toBeNull();
  });

  it('still synthesizes a first card when the stored card is empty', async () => {
    const synthesize = vi.fn().mockResolvedValue(FITTING_CARD);

    expect(
      await resolveMaterializedShortDescription({
        fullDescription: LONG_LEAD_FULL,
        currentShortDescription: '',
        synthesize,
      }),
    ).toBe(FITTING_CARD);
    expect(synthesize).toHaveBeenCalledTimes(1);
  });
});

describe('card lines the serve chain keeps (#4809)', () => {
  const BODY =
    'Our laboratory studies the mechanism by which a single history of chronic stress alters one physical property of the hippocampus. We uphold a preregistered protocol and we analyze each interaction between cortisol and neuronal structure across the dataset.';
  const INFLECTED =
    'Studies mechanisms, histories of chronic stress, physical properties, and interactions between cortisol and neuronal structure in the hippocampus.';
  const VERBATIM =
    'Studies how chronic stress alters one physical property of the hippocampus and the interaction between cortisol and neuronal structure.';

  it('retries a fitting card the serve chain would surrender and takes a line it keeps', async () => {
    const callLLM = vi.fn().mockResolvedValueOnce(INFLECTED).mockResolvedValueOnce(VERBATIM);

    expect(await synthesizeGroundedCardDescription({ fullDescription: BODY, callLLM })).toBe(
      VERBATIM,
    );
    expect(callLLM).toHaveBeenCalledTimes(2);
  });

  it('still accepts the inflected card when the retry yields nothing better', async () => {
    const callLLM = vi.fn().mockResolvedValue(INFLECTED);

    expect(await synthesizeGroundedCardDescription({ fullDescription: BODY, callLLM })).toBe(
      INFLECTED,
    );
  });

  it('reconsiders a stored card the serve chain would surrender only when resynthesis is asked for', async () => {
    const synthesize = vi.fn().mockResolvedValue(VERBATIM);

    const routine = await resolveMaterializedShortDescription({
      fullDescription: BODY,
      currentShortDescription: INFLECTED,
      synthesize,
    });
    expect(synthesize).not.toHaveBeenCalled();

    const resynthesized = await resolveMaterializedShortDescription({
      fullDescription: BODY,
      currentShortDescription: INFLECTED,
      synthesize,
      resynthesizeCutCards: true,
    });
    expect(routine === null || cardLineFitsBrowseCard(routine)).toBe(true);
    expect(resynthesized).not.toBeNull();
    expect(resynthesized).not.toBe(INFLECTED);
    expect(cardLineFitsBrowseCard(resynthesized ?? '')).toBe(true);
  });
});

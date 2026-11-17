import { describe, expect, it, vi } from 'vitest';

import { resolveWrittenBodyCard } from '../entityMaterializer';

const BODY =
  'The Fixture Lab investigates how regulatory T cells and tolerogenic antigen-presenting cells shape immune responses in cancer and autoimmunity. It uses genetic, biochemical, chemical biology and sequencing approaches across translational models.';

const STORED_CARD =
  'Investigates how regulatory T cells shape immune responses in cancer and autoimmunity.';

const CACHED_CARD =
  'Investigates how tolerogenic antigen-presenting cells shape immune responses in cancer and autoimmunity.';

const base = {
  body: BODY,
  observedCards: [] as unknown[],
  researchAreas: [],
  servingBarAccepts: () => true,
};

describe('resolveWrittenBodyCard serves the card written for the served body (#6486)', () => {
  it('ranks the card cached for this body above a fitting stored card', async () => {
    const choice = await resolveWrittenBodyCard({
      ...base,
      storedCard: STORED_CARD,
      cachedCard: CACHED_CARD,
    });

    expect(choice).toEqual({ kind: 'synthesized', card: CACHED_CARD });
  });

  it('ranks the cached card above a fitting observed card', async () => {
    const choice = await resolveWrittenBodyCard({
      ...base,
      storedCard: '',
      observedCards: [STORED_CARD],
      cachedCard: CACHED_CARD,
    });

    expect(choice).toEqual({ kind: 'synthesized', card: CACHED_CARD });
  });

  it('keeps the stored card when no card is cached for the body', async () => {
    const synthesize = vi.fn().mockResolvedValue('');
    const choice = await resolveWrittenBodyCard({
      ...base,
      storedCard: STORED_CARD,
      cachedCard: '',
      synthesize,
    });

    expect(choice).toEqual({ kind: 'stored', card: STORED_CARD });
    expect(synthesize).not.toHaveBeenCalled();
  });

  it('falls through to the stored card when the cached card is unacceptable', async () => {
    const choice = await resolveWrittenBodyCard({
      ...base,
      storedCard: STORED_CARD,
      cachedCard: BODY,
    });

    expect(choice).toEqual({ kind: 'stored', card: STORED_CARD });
  });

  it('falls through when the serving bar refuses the cached card', async () => {
    const choice = await resolveWrittenBodyCard({
      ...base,
      servingBarAccepts: (card: string) => card !== CACHED_CARD,
      storedCard: STORED_CARD,
      cachedCard: CACHED_CARD,
    });

    expect(choice).toEqual({ kind: 'stored', card: STORED_CARD });
  });
});

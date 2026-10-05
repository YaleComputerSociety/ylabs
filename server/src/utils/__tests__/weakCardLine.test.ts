import { describe, expect, it, vi } from 'vitest';

import { resolveWrittenBodyCard } from '../../scrapers/entityMaterializer';
import { isWeakCardLine } from '../groundedCardSynthesis';
import { buildResearchAreasCardSummary } from '../researchEntityDescriptionQuality';

const BODY =
  'The Fixture Lab investigates how regulatory T cells shape immune responses in cancer. It uses single-cell sequencing and mouse models to test new ways to restore tolerance.';

const SHORT_CARD = 'Studies immune responses.';

const FULL_CARD =
  'Uses single-cell sequencing and mouse models to study how regulatory T cells shape immune responses in cancer.';

const researchAreas = ['Immunology', 'Cancer Biology'];

describe('isWeakCardLine (#4809)', () => {
  it('reads a short line as weak', () => {
    expect(isWeakCardLine(SHORT_CARD, { researchAreas })).toBe(true);
  });

  it('reads the topic chips restated as a sentence as weak', () => {
    const echo = buildResearchAreasCardSummary(researchAreas);
    expect(isWeakCardLine(echo, { researchAreas })).toBe(true);
  });

  it('reads a line that stops on a list colon as weak', () => {
    expect(
      isWeakCardLine(
        'Studies condensed matter physics and statistical mechanics in these areas:.',
        {
          researchAreas,
        },
      ),
    ).toBe(true);
  });

  it('keeps a line that says what is studied', () => {
    expect(isWeakCardLine(FULL_CARD, { researchAreas })).toBe(false);
  });

  it('never reads an empty card as weak', () => {
    expect(isWeakCardLine('', { researchAreas })).toBe(false);
  });
});

describe('resolveWrittenBodyCard with a weak-card test (#4809)', () => {
  const base = {
    body: BODY,
    observedCards: [],
    researchAreas: [],
    servingBarAccepts: () => true,
    isWeak: (card: string) => isWeakCardLine(card, { researchAreas }),
  };

  it('passes over a weak stored card for a line that is not weak', async () => {
    const choice = await resolveWrittenBodyCard({
      ...base,
      storedCard: SHORT_CARD,
      synthesize: vi.fn().mockResolvedValue(FULL_CARD),
    });

    expect('card' in choice && choice.card).not.toBe(SHORT_CARD);
    expect('card' in choice && isWeakCardLine(choice.card, { researchAreas })).toBe(false);
  });

  it('keeps the stored card when every line it could take is weak', async () => {
    const choice = await resolveWrittenBodyCard({
      ...base,
      isWeak: () => true,
      storedCard: SHORT_CARD,
      synthesize: vi.fn().mockResolvedValue(SHORT_CARD),
    });

    expect(choice).toEqual({ kind: 'stored', card: SHORT_CARD });
  });
});

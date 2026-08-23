import { describe, expect, it, vi } from 'vitest';

import {
  cardGroundingScore,
  isCardGroundedInFullDescription,
  isUngroundedGeneratedCardSummary,
  normalizeCardText,
  resolveGroundedCardDescription,
  resolveServedCardShortDescription,
  synthesizeGroundedCardDescription,
} from '../groundedCardSynthesis';
import {
  deriveShortDescriptionFromFullDescription,
  shortDescriptionQuality,
} from '../researchEntityDescriptionQuality';

const RICH_FIRST_PERSON_FULL =
  'Our lab is broadly interested in the biology of aging and the ways that metabolism shapes lifespan across species. Over the past decade we have built a range of experimental systems, from yeast to zebrafish, and we continue to expand these tools while training the next generation of scientists.';

const DERIVABLE_FULL =
  'The Rivera Lab studies how immune cells detect and respond to viral infection. Ongoing projects map the antiviral signaling pathways that shape the earliest stages of the response.';

describe('grounding', () => {
  it('grounds a card whose content words all appear in the full description', () => {
    const card = 'Studies the biology of aging and how metabolism shapes lifespan across species.';
    expect(isCardGroundedInFullDescription(card, RICH_FIRST_PERSON_FULL)).toBe(true);
    expect(cardGroundingScore(card, RICH_FIRST_PERSON_FULL)).toBe(1);
  });

  it('rejects a card that introduces content absent from the full description', () => {
    const hallucinated = 'Studies quantum gravity near black hole thermodynamics.';
    expect(isCardGroundedInFullDescription(hallucinated, RICH_FIRST_PERSON_FULL)).toBe(false);
  });

  it('treats a verbatim slice of the full description as grounded', () => {
    expect(
      isCardGroundedInFullDescription('the biology of aging', RICH_FIRST_PERSON_FULL),
    ).toBe(true);
  });
});

describe('normalizeCardText', () => {
  it('strips wrapping quotes, keeps one sentence, and adds a terminal period', () => {
    expect(normalizeCardText('"Studies antiviral signaling in immune cells"')).toBe(
      'Studies antiviral signaling in immune cells.',
    );
  });

  it('reduces multi-sentence output to its first sentence', () => {
    expect(
      normalizeCardText('Studies antiviral signaling. It also trains students.'),
    ).toBe('Studies antiviral signaling.');
  });

  it('returns empty for empty input', () => {
    expect(normalizeCardText('   ')).toBe('');
    expect(normalizeCardText(null)).toBe('');
  });
});

describe('synthesizeGroundedCardDescription', () => {
  it('returns a grounded, quality-passing card from rich prose the regex funnel cannot card', async () => {
    expect(deriveShortDescriptionFromFullDescription(RICH_FIRST_PERSON_FULL)).toBe('');

    const callLLM = vi.fn().mockResolvedValue(
      'Studies the biology of aging and how metabolism shapes lifespan across species.',
    );
    const card = await synthesizeGroundedCardDescription({
      fullDescription: RICH_FIRST_PERSON_FULL,
      callLLM,
    });

    expect(callLLM).toHaveBeenCalledOnce();
    expect(card).toBe(
      'Studies the biology of aging and how metabolism shapes lifespan across species.',
    );
    expect(shortDescriptionQuality(card, RICH_FIRST_PERSON_FULL).isUseful).toBe(true);
  });

  it('fails closed when the model hallucinates content not in the source', async () => {
    const callLLM = vi
      .fn()
      .mockResolvedValue('Studies quantum gravity near black hole thermodynamics.');
    const card = await synthesizeGroundedCardDescription({
      fullDescription: RICH_FIRST_PERSON_FULL,
      callLLM,
    });
    expect(card).toBe('');
  });

  it('fails closed when the model output does not pass the card quality bar', async () => {
    const callLLM = vi.fn().mockResolvedValue('We study aging.');
    const card = await synthesizeGroundedCardDescription({
      fullDescription: RICH_FIRST_PERSON_FULL,
      callLLM,
    });
    expect(card).toBe('');
  });

  it('never calls the model for a full description that is not source-useful', async () => {
    const callLLM = vi.fn().mockResolvedValue('Studies something.');
    const card = await synthesizeGroundedCardDescription({
      fullDescription: 'Welcome to the Smith Lab website. Thank you for your interest in our lab.',
      callLLM,
    });
    expect(callLLM).not.toHaveBeenCalled();
    expect(card).toBe('');
  });

  it('fails closed when the model call throws', async () => {
    const callLLM = vi.fn().mockRejectedValue(new Error('network'));
    const card = await synthesizeGroundedCardDescription({
      fullDescription: RICH_FIRST_PERSON_FULL,
      callLLM,
    });
    expect(card).toBe('');
  });
});

describe('resolveGroundedCardDescription', () => {
  it('keeps the deterministic derivation and never synthesizes when the derivation already cards', async () => {
    const derived = deriveShortDescriptionFromFullDescription(DERIVABLE_FULL);
    expect(derived).not.toBe('');

    const synthesize = vi.fn(async () => 'Studies something else entirely.');
    const resolved = await resolveGroundedCardDescription({
      fullDescription: DERIVABLE_FULL,
      synthesize,
    });

    expect(synthesize).not.toHaveBeenCalled();
    expect(resolved).toBe(derived);
  });

  it('falls back to grounded synthesis only when the derivation returns nothing', async () => {
    expect(deriveShortDescriptionFromFullDescription(RICH_FIRST_PERSON_FULL)).toBe('');

    const synthesize = vi.fn(async () =>
      'Studies the biology of aging and how metabolism shapes lifespan across species.',
    );
    const resolved = await resolveGroundedCardDescription({
      fullDescription: RICH_FIRST_PERSON_FULL,
      synthesize,
    });

    expect(synthesize).toHaveBeenCalledOnce();
    expect(resolved).toBe(
      'Studies the biology of aging and how metabolism shapes lifespan across species.',
    );
  });

  it('returns the empty derivation when no synthesizer is provided', async () => {
    const resolved = await resolveGroundedCardDescription({
      fullDescription: RICH_FIRST_PERSON_FULL,
    });
    expect(resolved).toBe('');
  });
});

const UNGROUNDABLE_FULL = 'Welcome to the lab website. Thank you for your interest in our group.';

describe('resolveGroundedCardDescription research-areas fallback (#952)', () => {
  it('falls back to a research-areas card when prose yields no groundable summary', async () => {
    expect(deriveShortDescriptionFromFullDescription(UNGROUNDABLE_FULL)).toBe('');
    const resolved = await resolveGroundedCardDescription({
      fullDescription: UNGROUNDABLE_FULL,
      researchAreas: ['Biostatistics', 'Public Health', 'Cancer Research', 'Clinical Trials'],
    });
    expect(resolved).toBe(
      'Studies Biostatistics, Public Health, Cancer Research, and Clinical Trials.',
    );
  });

  it('fails closed to empty rather than fabricating when no clean research areas exist', async () => {
    const resolved = await resolveGroundedCardDescription({
      fullDescription: UNGROUNDABLE_FULL,
      researchAreas: [],
    });
    expect(resolved).toBe('');
  });
});

const WYRTZEN_FULL =
  'The lab studies the formation of the colonial and post-colonial state in Morocco and across North Africa, drawing on historical sociology and the politics of empire.';

const RIVERA_FULL =
  'The Rivera Lab studies how immune cells detect and respond to viral infection. Ongoing projects map the antiviral signaling pathways that shape the earliest stages of the response.';

describe('isUngroundedGeneratedCardSummary (#1212)', () => {
  it('flags a generated scaffold one-liner whose topic is absent from the full description', () => {
    expect(isUngroundedGeneratedCardSummary('Studies Texas from the first.', WYRTZEN_FULL)).toBe(
      true,
    );
    expect(isUngroundedGeneratedCardSummary('Studies Italian Cooking.', WYRTZEN_FULL)).toBe(true);
  });

  it('does not flag a generated card that is grounded in the full description', () => {
    expect(
      isUngroundedGeneratedCardSummary(
        'Studies antiviral signaling in immune cells.',
        RIVERA_FULL,
      ),
    ).toBe(false);
  });

  it('does not flag hand-authored summaries that lack a card-lead verb', () => {
    expect(
      isUngroundedGeneratedCardSummary('A soft-robotics lab in Texas.', WYRTZEN_FULL),
    ).toBe(false);
  });

  it('does not flag when either description is missing', () => {
    expect(isUngroundedGeneratedCardSummary('Studies Texas from the first.', '')).toBe(false);
    expect(isUngroundedGeneratedCardSummary('', WYRTZEN_FULL)).toBe(false);
  });
});

describe('resolveServedCardShortDescription (#1212)', () => {
  it('keeps a grounded card unchanged', () => {
    const card = 'Studies antiviral signaling in immune cells.';
    expect(
      resolveServedCardShortDescription({ shortDescription: card, fullDescription: RIVERA_FULL }),
    ).toBe(card);
  });

  it('replaces an ungrounded generated card with a grounded derivation from the full description', () => {
    const resolved = resolveServedCardShortDescription({
      shortDescription: 'Studies antiviral pathways in Antarctica.',
      fullDescription: RIVERA_FULL,
    });
    expect(resolved).not.toBe('Studies antiviral pathways in Antarctica.');
    expect(resolved).not.toBe('');
    expect(isCardGroundedInFullDescription(resolved, RIVERA_FULL)).toBe(true);
  });

  it('replaces a fabricated card with the entity own grounded full description', () => {
    const resolved = resolveServedCardShortDescription({
      shortDescription: 'Studies Texas from the first.',
      fullDescription: WYRTZEN_FULL,
    });
    expect(resolved).not.toBe('Studies Texas from the first.');
    expect(isCardGroundedInFullDescription(resolved, WYRTZEN_FULL)).toBe(true);
  });

  it('fails closed to empty when no groundable derivation exists', () => {
    expect(deriveShortDescriptionFromFullDescription(UNGROUNDABLE_FULL)).toBe('');
    expect(
      resolveServedCardShortDescription({
        shortDescription: 'Studies antiviral pathways in Antarctica.',
        fullDescription: UNGROUNDABLE_FULL,
      }),
    ).toBe('');
  });

  it('leaves a hand-authored summary untouched even when ungrounded', () => {
    const card = 'A soft-robotics lab.';
    expect(
      resolveServedCardShortDescription({ shortDescription: card, fullDescription: WYRTZEN_FULL }),
    ).toBe(card);
  });
});

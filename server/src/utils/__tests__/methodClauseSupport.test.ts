import { describe, expect, it } from 'vitest';
import { withoutUnsupportedMethodClauses } from '../methodClauseSupport';
import { synthesizeGroundedCardDescription } from '../groundedCardSynthesis';
import { coverageSynthesisDecision } from '../../scrapers/coverageSynthesis';
import { resolveWrittenBodyCard } from '../../scrapers/entityMaterializer';
import {
  CARD_SYNTHESIS_PROMPT,
  COVERAGE_SYNTHESIS_PROMPT,
  SYNTHESIS_FIDELITY_RULES,
} from '../../scrapers/prompts';
import { synthesisSystemPromptFor } from '../../scripts/labDescriptionSynthesis';

const INTERESTS =
  'Research interests include theoretical machine learning, statistics, optimization and game theory.';

describe('a method clause must be a method the evidence states (#4914)', () => {
  it('strips listed interests restated as methods', () => {
    const outcome = withoutUnsupportedMethodClauses(
      'Investigates theoretical machine learning using statistics and optimization.',
      [INTERESTS],
    );
    expect(outcome.text).toBe('Investigates theoretical machine learning.');
    expect(outcome.stripped).toBe(1);
  });

  it('strips an organizational unit name presented as the method', () => {
    const outcome = withoutUnsupportedMethodClauses(
      'Studies nutrition and cancer biomarkers using metabolic epidemiology.',
      [
        'She works in the Metabolic Epidemiology Branch. Her interests include nutrition, cancer and biomarkers.',
      ],
    );
    expect(outcome.text).toBe('Studies nutrition and cancer biomarkers.');
  });

  it('strips publication topics turned into a means of study', () => {
    const outcome = withoutUnsupportedMethodClauses(
      'Studies forest governance through environmental law, forestry history and environmental ethics.',
      [
        'Studies forest governance. Publications address environmental law, the history of forestry sciences and environmental ethics.',
      ],
    );
    expect(outcome.text).toBe('Studies forest governance.');
  });

  it('keeps a method the evidence states, across inflection and hyphenation', () => {
    const text =
      'Studies immune cell fate using CRISPR screen and single‑cell sequencing, with multidisciplinary approaches.';
    expect(
      withoutUnsupportedMethodClauses(text, [
        'We study immune cell fate using CRISPR screens and single-cell sequencing.',
      ]).stripped,
    ).toBe(0);
  });

  it('keeps "through" when it names a span rather than a method', () => {
    const text = 'Studies learning from infancy through early adolescence.';
    expect(withoutUnsupportedMethodClauses(text, ['Studies learning in childhood.']).stripped).toBe(
      0,
    );
  });

  it('judges nothing when there is no evidence', () => {
    expect(withoutUnsupportedMethodClauses('Studies X using Y.', []).stripped).toBe(0);
  });

  it('returns nothing when the strip leaves no sentence', () => {
    expect(withoutUnsupportedMethodClauses('Using statistics.', [INTERESTS]).text).toBeNull();
  });
});

describe('the written body refuses an unsupported method clause (#4914)', () => {
  const snippets = [
    { text: INTERESTS, sourceUrl: 'https://ml.example.edu/', sourceName: 'synthetic-profile' },
  ];
  const decide = (fullDescription: string) =>
    coverageSynthesisDecision({
      snippets,
      entityName: 'Synthetic Learning Group',
      callLLM: async () => ({ fullDescription, usedSnippetIndexes: [0] }),
    });

  it('strips the clause from a body', async () => {
    const decision = await decide(
      'Studies theoretical machine learning, statistics, optimization and game theory using statistics and optimization.',
    );
    expect(decision.result?.description ?? '').not.toMatch(/using/);
  });

  it('refuses a body that is only the clause, naming that arm', async () => {
    const decision = await decide('Using statistics and optimization.');
    expect(decision.refusal).toBe('unsupported-method-clause');
  });
});

describe('the card refuses an unsupported method clause (#4914)', () => {
  const BODY =
    'Studies theoretical machine learning, with interests in statistics, optimization and game theory, and how learning algorithms behave in strategic settings.';

  it('strips the clause from a synthesized card', async () => {
    const card = await synthesizeGroundedCardDescription({
      fullDescription: BODY,
      evidenceTexts: [INTERESTS],
      callLLM: async () =>
        'Studies theoretical machine learning using statistics and optimization.',
    });
    expect(card).not.toMatch(/using/);
  });

  it('does not keep a stored card beside a written body when its method clause is unsupported', async () => {
    const choice = await resolveWrittenBodyCard({
      body: BODY,
      storedCard: 'Studies theoretical machine learning using statistics and optimization.',
      observedCards: [],
      researchAreas: [],
      servingBarAccepts: () => true,
      evidenceTexts: [INTERESTS],
    });
    expect(choice.kind).not.toBe('stored');
  });
});

describe('every prompt that writes a card or a body carries the shared rules (#4914)', () => {
  it('states each overreach rule once, in one shared text', () => {
    for (const rule of [
      /only when the evidence itself states that the group uses it/,
      /clinical practice, patient care, teaching/,
      /motivation, background, vision or mission/,
      /join topics the evidence lists separately/,
      /past, one-off or planned work/,
    ]) {
      expect(SYNTHESIS_FIDELITY_RULES).toMatch(rule);
    }
  });

  it('composes the rules into the card, body and backfill writers', () => {
    for (const prompt of [
      CARD_SYNTHESIS_PROMPT,
      COVERAGE_SYNTHESIS_PROMPT,
      synthesisSystemPromptFor('LAB'),
      synthesisSystemPromptFor('FACULTY_RESEARCH_AREA'),
    ]) {
      expect(prompt).toContain(SYNTHESIS_FIDELITY_RULES);
    }
  });
});

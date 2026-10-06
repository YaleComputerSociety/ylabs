import { describe, expect, it } from 'vitest';
import {
  coverageSynthesisDecision,
  type CoverageSnippet,
  type CoverageSynthesisLLMFn,
} from '../coverageSynthesis';
import { isSourcePageNarrationDescription } from '../../utils/researchEntityDescriptionText';
import { isNonResearchCardSentence } from '../../utils/nonResearchCardSentence';

const SNIPPETS: CoverageSnippet[] = [
  {
    text: 'The laboratory uses novel neuromonitoring techniques to optimize cerebral blood flow after acute neurovascular injury.',
    sourceUrl: 'https://example.edu/lab',
    sourceName: 'lab-page',
  },
  {
    text: 'Clinical work focuses on preventing neurologic worsening after ischemic stroke and after subarachnoid hemorrhage.',
    sourceUrl: 'https://example.edu/research',
    sourceName: 'research-page',
  },
];

const stub =
  (fullDescription: string): CoverageSynthesisLLMFn =>
  async () => ({ fullDescription, usedSnippetIndexes: [0, 1] });

const decide = (fullDescription: string) =>
  coverageSynthesisDecision({
    snippets: SNIPPETS,
    entityName: 'Synthetic Neurocritical Care Lab',
    callLLM: stub(fullDescription),
  });

describe('a body reporting its own evidence was cut short is refused', () => {
  it('reads a parenthetical truncation note as source narration', () => {
    expect(
      isSourcePageNarrationDescription(
        'Studies how the cell-surface proteome shapes cellular membranes, including the molecular machine for membrane (text truncated in source).',
      ),
    ).toBe(true);
  });

  it('keeps research prose that happens to describe a truncated molecule', () => {
    const researchProse = [
      'Studies how a truncated receptor isoform alters downstream signaling in epithelial cells.',
      'Examines truncated protein variants that escape degradation.',
    ];
    for (const text of researchProse) expect(isSourcePageNarrationDescription(text)).toBe(false);
  });

  it('refuses the writer body that carries the note, naming the source-narration arm', async () => {
    const decision = await decide(
      'Uses novel neuromonitoring techniques to optimize cerebral blood flow after acute neurovascular injury and to prevent neurologic worsening (text truncated in source).',
    );
    expect(decision.refusal).toBe('source-narration');
  });
});

describe('a card that opens by dating itself is refused', () => {
  it('refuses temporal framing openers', () => {
    const openers = [
      "In the last few years, the lab's clinical research focus has been preventing neurologic worsening after stroke.",
      'Since 2006, her clinical practice has focused on pediatric thyroid disorders.',
      'In recent years, the group has turned to coastal carbon storage.',
      'Over the past decade, the centre has studied tidal flooding.',
    ];
    for (const card of openers) expect(isNonResearchCardSentence(card)).toBe(true);
  });

  it('keeps a card that names the research first', () => {
    const cards = [
      'Studies cerebral blood flow after acute neurovascular injury.',
      'Investigates pediatric thyroid disorders, including nodules and Graves disease.',
      'Develops single-cell sequencing methods for immune cell differentiation.',
    ];
    for (const card of cards) expect(isNonResearchCardSentence(card)).toBe(false);
  });
});

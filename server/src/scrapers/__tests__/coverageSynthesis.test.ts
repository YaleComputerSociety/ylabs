import { describe, expect, it } from 'vitest';
import {
  coverageSynthesisDecision,
  gatherCoverageSnippets,
  hasInternalVocabulary,
  synthesizeCoverageDescription,
  type CoverageSnippet,
  type CoverageSynthesisLLMFn,
} from '../coverageSynthesis';

const SNIPPETS: CoverageSnippet[] = [
  {
    text: 'The laboratory develops single-cell sequencing methods and computational models of gene regulatory networks controlling immune cell differentiation.',
    sourceUrl: 'https://example.edu/lab',
    sourceName: 'lab-page',
  },
  {
    text: 'Recent projects apply CRISPR screens and machine learning to predict transcription factor activity in immune cells.',
    sourceUrl: 'https://example.edu/research',
    sourceName: 'research-page',
  },
];

const stub =
  (result: unknown): CoverageSynthesisLLMFn =>
  async () =>
    result as never;

describe('hasInternalVocabulary', () => {
  it("refuses the repo's own record noun as the body's subject (#3217)", () => {
    expect(
      hasInternalVocabulary(
        'The entity studies melanocytic and non-melanocytic neoplasms and other skin conditions, including granulomatous disorders.',
      ),
    ).toBe(true);
  });

  it('refuses an internal-noun subject after a sentence boundary, not only at the lead', () => {
    expect(
      hasInternalVocabulary(
        'Studies immune cell differentiation. This entity investigates gene regulation.',
      ),
    ).toBe(true);
  });

  it('refuses retired product vocabulary anywhere in the body', () => {
    expect(hasInternalVocabulary('Studies coastal erosion across several research areas.')).toBe(
      true,
    );
    expect(hasInternalVocabulary('Investigates the research home of the group.')).toBe(true);
  });

  /**
   * Every noun in the set is ordinary research prose somewhere in this corpus, so the
   * rule is subject position plus a research verb rather than a bare word ban. These
   * four are the false positives a word ban would produce, and each is a real shape.
   */
  it('keeps a body that uses an internal noun as a topic rather than a subject', () => {
    expect(
      hasInternalVocabulary('Develops named entity recognition methods for clinical narratives.'),
    ).toBe(false);
    expect(
      hasInternalVocabulary('Studies cardiovascular outcomes using electronic health records.'),
    ).toBe(false);
    expect(hasInternalVocabulary('Examines the fossil record of early tetrapods.')).toBe(false);
    expect(
      hasInternalVocabulary('Builds document classification models for historical archives.'),
    ).toBe(false);
  });

  it('keeps a generic but true subject, which is a copy preference and not a defect', () => {
    expect(hasInternalVocabulary('The research examines Black spatial thought and practice.')).toBe(
      false,
    );
    expect(
      hasInternalVocabulary('The research program studies prevention of cardiovascular disease.'),
    ).toBe(false);
  });

  it('never matches the stored field name or identifier form', () => {
    expect(hasInternalVocabulary('Populates researchAreas and researchHome for each row.')).toBe(
      false,
    );
  });
});

describe('synthesizeCoverageDescription', () => {
  it('accepts a grounded, useful description and returns its cited source urls', async () => {
    const result = await synthesizeCoverageDescription({
      snippets: SNIPPETS,
      entityName: 'Immunology Lab',
      callLLM: stub({
        fullDescription:
          'Develops single-cell sequencing methods and computational models of gene regulatory networks controlling immune cell differentiation, using CRISPR screens and machine learning to predict transcription factor activity in immune cells.',
        usedSnippetIndexes: [0, 1],
      }),
    });
    expect(result).not.toBeNull();
    expect(result?.sourceUrls).toEqual(['https://example.edu/lab', 'https://example.edu/research']);
  });

  it('rejects fluent off-topic text (overlap gate)', async () => {
    const result = await synthesizeCoverageDescription({
      snippets: SNIPPETS,
      entityName: 'Immunology Lab',
      callLLM: stub({
        fullDescription:
          'Studies medieval European history and the economics of trade routes across the Mediterranean during the fourteenth century.',
        usedSnippetIndexes: [0],
      }),
    });
    expect(result).toBeNull();
  });

  it('redacts contact info from the output and never leaks an email', async () => {
    const result = await synthesizeCoverageDescription({
      snippets: SNIPPETS,
      entityName: 'Immunology Lab',
      callLLM: stub({
        fullDescription:
          'Develops single-cell sequencing methods and computational models of gene regulatory networks controlling immune cell differentiation. Email labpi@example.edu.',
        usedSnippetIndexes: [0],
      }),
    });
    // Fail-closed OR redacted - either way an email can never reach the output.
    if (result) expect(result.description).not.toMatch(/@/);
  });

  /**
   * The body below scores 0.654 against the snippet corpus: comfortably over the
   * lane's declared COVERAGE_MIN_OVERLAP of 0.45, and under the MIN_CARD_GROUNDING
   * of 0.9 that the removed `ungrounded-card` arm applied through a one-sentence-card
   * predicate. It also opens with "Develops", one of SYNTHESIS_CARD_LEAD_PATTERN's
   * verbs, which is the shape this prompt asks for and so the shape that arm gated on.
   */
  it('accepts a grounded body between the declared overlap floor and the card bar (#3201)', async () => {
    const decision = await coverageSynthesisDecision({
      snippets: SNIPPETS,
      entityName: 'Immunology Lab',
      callLLM: stub({
        fullDescription:
          'Develops single-cell sequencing methods to study gene regulatory networks in immune cells. The group applies CRISPR screens and machine learning approaches, with an emphasis on transcription factor activity during differentiation and on building predictive computational tools for experimental design.',
        usedSnippetIndexes: [0, 1],
      }),
    });
    expect(decision.refusal).toBeNull();
    expect(decision.result).not.toBeNull();
  });

  it('still refuses a body that misses the declared overlap floor, naming that arm (#3201)', async () => {
    const decision = await coverageSynthesisDecision({
      snippets: SNIPPETS,
      entityName: 'Immunology Lab',
      callLLM: stub({
        fullDescription:
          'Studies medieval European history and the economics of trade routes across the Mediterranean during the fourteenth century.',
        usedSnippetIndexes: [0],
      }),
    });
    expect(decision.refusal).toBe('grounding-overlap-below-floor');
    expect(decision.result).toBeNull();
  });

  it('refuses an otherwise-acceptable body whose subject is an internal noun, naming that arm (#3217)', async () => {
    const DERM: CoverageSnippet[] = [
      {
        text: 'Clinical and research work addresses melanocytic and non-melanocytic neoplasms, granulomatous disorders, and infectious skin diseases including borreliosis, within a multidisciplinary melanoma care program.',
        sourceUrl: 'https://example.edu/derm',
        sourceName: 'derm-page',
      },
    ];
    const body =
      'The entity studies melanocytic and non-melanocytic neoplasms and other skin conditions, including granulomatous disorders and infectious diseases such as borreliosis, and participates in multidisciplinary melanoma care.';
    const decision = await coverageSynthesisDecision({
      snippets: DERM,
      entityName: 'Dermatology',
      callLLM: stub({ fullDescription: body, usedSnippetIndexes: [0] }),
    });
    expect(decision.refusal).toBe('internal-vocabulary');
    expect(decision.result).toBeNull();

    // Same body, same snippets, internal subject replaced: the arm above is the only
    // thing refusing it, so this pins that the refusal is the wording and not the row.
    const accepted = await coverageSynthesisDecision({
      snippets: DERM,
      entityName: 'Dermatology',
      callLLM: stub({
        fullDescription: body.replace(/^The entity studies/, 'Studies'),
        usedSnippetIndexes: [0],
      }),
    });
    expect(accepted.refusal).toBeNull();
    expect(accepted.result).not.toBeNull();
  });

  it('returns null when no snippets cited', async () => {
    const result = await synthesizeCoverageDescription({
      snippets: SNIPPETS,
      entityName: 'Immunology Lab',
      callLLM: stub({
        fullDescription:
          'Develops single-cell sequencing methods and computational models of gene regulatory networks controlling immune cell differentiation.',
        usedSnippetIndexes: [],
      }),
    });
    expect(result).toBeNull();
  });

  it('is fail-closed on empty, malformed, and throwing LLM output', async () => {
    expect(
      await synthesizeCoverageDescription({
        snippets: SNIPPETS,
        entityName: 'X',
        callLLM: stub({ fullDescription: '', usedSnippetIndexes: [] }),
      }),
    ).toBeNull();
    expect(
      await synthesizeCoverageDescription({
        snippets: SNIPPETS,
        entityName: 'X',
        callLLM: stub({}),
      }),
    ).toBeNull();
    expect(
      await synthesizeCoverageDescription({
        snippets: SNIPPETS,
        entityName: 'X',
        callLLM: stub(undefined),
      }),
    ).toBeNull();
    const thrower: CoverageSynthesisLLMFn = async () => {
      throw new Error('boom');
    };
    expect(
      await synthesizeCoverageDescription({
        snippets: SNIPPETS,
        entityName: 'X',
        callLLM: thrower,
      }),
    ).toBeNull();
  });

  it('returns null with no snippets to work from', async () => {
    const result = await synthesizeCoverageDescription({
      snippets: [],
      entityName: 'X',
      callLLM: stub({ fullDescription: 'anything', usedSnippetIndexes: [0] }),
    });
    expect(result).toBeNull();
  });
});

describe('gatherCoverageSnippets', () => {
  it('keeps description-like fields, redacts contact, drops rejected sources, and dedupes', () => {
    const snippets = gatherCoverageSnippets([
      {
        field: 'fullDescription',
        value: 'Studies coral reef resilience under ocean warming and acidification.',
        sourceUrl: 'https://example.edu/a',
        sourceName: 'a',
      },
      {
        field: 'fullDescription',
        value: 'Studies coral reef resilience under ocean warming and acidification.',
        sourceUrl: 'https://example.edu/dup',
        sourceName: 'dup',
      },
      {
        field: 'shortDescription',
        value: 'Contact the reef ecology group at reef@example.edu for details on projects.',
        sourceUrl: 'https://example.edu/b',
        sourceName: 'b',
      },
      { field: 'websiteUrl', value: 'https://example.edu', sourceUrl: 'https://example.edu' },
    ]);
    expect(snippets.length).toBe(2);
    expect(snippets.some((s) => s.text.includes('reef@example.edu'))).toBe(false);
  });
});

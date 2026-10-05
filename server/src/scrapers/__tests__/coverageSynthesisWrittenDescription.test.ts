import { describe, expect, it } from 'vitest';
import {
  MAX_WRITTEN_DESCRIPTION_WORDS,
  coverageSynthesisDecision,
  gatherCoverageSnippets,
  isPastCareerClauseSentence,
  isWriterEvidenceObservation,
  withoutPastCareerSentences,
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

const GROUNDED =
  'Develops single-cell sequencing methods and computational models of gene regulatory networks controlling immune cell differentiation.';

const stub =
  (fullDescription: string): CoverageSynthesisLLMFn =>
  async () => ({ fullDescription, usedSnippetIndexes: [0, 1] });

const decide = (fullDescription: string) =>
  coverageSynthesisDecision({
    snippets: SNIPPETS,
    entityName: 'Synthetic Immunology Lab',
    callLLM: stub(fullDescription),
  });

describe('the written description refusal arms (#4788)', () => {
  it('accepts a grounded research-first body', async () => {
    const decision = await decide(
      `${GROUNDED} It applies CRISPR screens and machine learning to predict transcription factor activity in immune cells.`,
    );
    expect(decision.refusal).toBeNull();
  });

  it('strips a past-career sentence and keeps the research', async () => {
    const decision = await decide(
      `${GROUNDED} Previously led a sequencing core facility at another institution.`,
    );
    expect(decision.refusal).toBeNull();
    expect(decision.result?.description).toBe(GROUNDED);
  });

  it('refuses a body that is only a past-career clause, naming that arm', async () => {
    const decision = await decide('Previously directed an immune cell sequencing program.');
    expect(decision.refusal).toBe('past-career-clause');
  });

  it('refuses a body that narrates its sources, naming that arm', async () => {
    const decision = await decide(
      `${GROUNDED} The lab website describes CRISPR screens and machine learning that predict transcription factor activity in immune cells.`,
    );
    expect(decision.refusal).toBe('source-narration');
  });

  it('refuses a body over the word cap, naming that arm', async () => {
    const LONG_EVIDENCE =
      'The laboratory studies how coastal salt marshes store carbon, how tidal flooding shapes plant roots, how crabs and snails graze marsh grasses, how nitrogen from farms changes microbial communities in sediment, how sea level rise drowns low marsh platforms, how restored marshes recover their soils, how storms move sediment across estuaries, how drought kills cordgrass stands, how invasive reeds displace native plants, how fish nurseries depend on creek networks, and how remote sensing tracks marsh loss across decades along the Atlantic coast of North America.';
    const body = `${LONG_EVIDENCE.replace('The laboratory studies', 'Studies')} It also compares marsh carbon budgets with nearby seagrass meadows and mudflats.`;
    expect(body.split(/\s+/).length).toBeGreaterThan(MAX_WRITTEN_DESCRIPTION_WORDS);
    const decision = await coverageSynthesisDecision({
      snippets: [
        { text: LONG_EVIDENCE, sourceUrl: 'https://example.edu/marsh', sourceName: 'lab-page' },
        {
          text: 'Comparisons of marsh carbon budgets with nearby seagrass meadows and mudflats.',
          sourceUrl: 'https://example.edu/carbon',
          sourceName: 'lab-page',
        },
      ],
      entityName: 'Synthetic Marsh Lab',
      callLLM: stub(body),
    });
    expect(decision.refusal).toBe('over-length');
  });
});

describe('isPastCareerClauseSentence', () => {
  it('flags a past post in subject position', () => {
    for (const sentence of [
      'Previously led a sequencing core facility.',
      'Formerly, the group was based at another university.',
      'She previously directed a clinical trials unit.',
      'Studies immune signaling; previously developed assays for a biotech firm.',
      'Before joining Yale, worked on vaccine design.',
      'Earlier in her career she studied plant pathogens.',
    ]) {
      expect(isPastCareerClauseSentence(sentence)).toBe(true);
    }
  });

  it('keeps research prose that merely uses the adverb', () => {
    for (const sentence of [
      'Combines new and previously developed methods for imaging the retina.',
      'Identifies previously uncharacterized genes in the zebrafish heart.',
      'Previously unknown regulators of autophagy are mapped with CRISPR screens.',
    ]) {
      expect(isPastCareerClauseSentence(sentence)).toBe(false);
    }
  });

  it('returns null when nothing but past-career sentences remain', () => {
    expect(withoutPastCareerSentences('Previously led a lab elsewhere.')).toBeNull();
  });
});

describe('writer evidence (#4788)', () => {
  const research = 'Studies coral reef resilience under ocean warming and acidification.';

  it("never reads the writer's own output", () => {
    expect(
      isWriterEvidenceObservation({
        field: 'fullDescription',
        value: research,
        sourceName: 'coverage-synthesis-llm',
      }),
    ).toBe(false);
  });

  it('reads an admin description as ordinary evidence', () => {
    expect(
      isWriterEvidenceObservation({
        field: 'fullDescription',
        value: research,
        sourceName: 'manual-admin-edit',
      }),
    ).toBe(true);
  });

  it('excludes an admin description that narrates its sources', () => {
    const snippets = gatherCoverageSnippets([
      {
        field: 'fullDescription',
        value:
          'The profile lists reef ecology and the official next source for students to review.',
        sourceName: 'manual-admin-edit',
        sourceUrl: 'https://example.edu/admin',
      },
      {
        field: 'fullDescription',
        value: research,
        sourceName: 'ysm-atoz-index',
        sourceUrl: 'https://example.edu/reef',
      },
    ]);
    expect(snippets.map((snippet) => snippet.text)).toEqual([research]);
  });
});

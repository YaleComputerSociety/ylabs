import { describe, expect, it } from 'vitest';
import {
  adoptedWrittenBodyStillSupported,
  coverageSynthesisDecision,
  type CoverageSnippet,
  type CoverageSynthesisRefusal,
} from '../../coverageSynthesis';
import {
  coversResearchPage,
  hasFirstPerson,
  hasFusedPageHeading,
  hasGreetingText,
  researchPageFrequentTerms,
  ungroundedContentTerms,
} from '../writtenDescriptionChecks';

const PAGE_TEXT = [
  'Coral Reef Recovery',
  'We study how coral reefs recover after marine heatwaves and bleaching events.',
  'Our field surveys follow coral colonies and reef fish across the Caribbean.',
  'Algae Competition',
  'We test how algae compete with coral for space on damaged reefs.',
].join('\n');

const pageEvidence = [{ text: PAGE_TEXT, isResearchPageText: true }];
const profileEvidence = [
  { text: 'Research examines coral reefs and marine heatwaves.', isResearchPageText: false },
];

const SNIPPETS: CoverageSnippet[] = [
  {
    text: PAGE_TEXT,
    sourceName: 'research-page-text',
    sourceUrl: 'https://reef.example.edu/research',
  },
];

const decide = async (fullDescription: string): Promise<CoverageSynthesisRefusal | null> =>
  (
    await coverageSynthesisDecision({
      snippets: SNIPPETS,
      entityName: 'Reef Lab',
      callLLM: async () => ({ fullDescription, usedSnippetIndexes: [0] }),
      coverageWriterChecks: true,
    })
  ).refusal;

const GOOD =
  'Studies how coral reefs recover after marine heatwaves and bleaching events. Field surveys follow coral colonies and reef fish across the Caribbean, and test how algae compete with coral for space on damaged reefs.';

describe('grounding: every specific term is in the evidence (#5537)', () => {
  it('passes a body whose terms inflect evidence words', () => {
    expect(
      ungroundedContentTerms('Surveys recovering corals after heatwaves.', pageEvidence),
    ).toEqual([]);
  });

  it('names the specific terms no evidence word supports', () => {
    expect(
      ungroundedContentTerms('Studies coral reefs and Symbiodinium in Belize.', pageEvidence),
    ).toEqual(['symbiodinium', 'belize']);
  });

  it('refuses such a body as ungrounded-content-term', async () => {
    expect(await decide(GOOD)).toBeNull();
    expect(
      await decide(`${GOOD} The lab also studies how Symbiodinium loss slows reef recovery.`),
    ).toBe('ungrounded-content-term');
  });
});

describe('coverage: the body names the research page subject (#5537)', () => {
  it('ranks the page terms by frequency', () => {
    expect(researchPageFrequentTerms([PAGE_TEXT]).slice(0, 2)).toEqual(['coral', 'algae']);
  });

  it('accepts a body naming a heading or a frequent term, and refuses one naming neither', () => {
    expect(coversResearchPage('Studies algae competition on damaged sites.', pageEvidence)).toBe(
      true,
    );
    expect(coversResearchPage('Studies coral colonies.', pageEvidence)).toBe(true);
    expect(coversResearchPage('Studies Caribbean fish surveys.', pageEvidence)).toBe(false);
  });

  it('has nothing to cover when the row has no research page text', () => {
    expect(coversResearchPage('Studies Caribbean fish surveys.', profileEvidence)).toBe(true);
  });

  it('refuses an uncovering body as missing-research-page-coverage', async () => {
    expect(
      await decide(
        'Follows fish across the Caribbean through field surveys after marine heatwaves and bleaching events, and tests how they recover and compete for space.',
      ),
    ).toBe('missing-research-page-coverage');
  });
});

describe('hygiene (#5537)', () => {
  it('finds first person but not a country or a roman numeral', () => {
    expect(hasFirstPerson('We study coral reefs.')).toBe(true);
    expect(hasFirstPerson('Our surveys follow coral colonies.')).toBe(true);
    expect(hasFirstPerson('Studies US coral reef policy and type I interferon.')).toBe(false);
  });

  it('refuses a first-person body as first-person', async () => {
    expect(await decide(GOOD.replace(/^Studies/, 'We study'))).toBe('first-person');
  });

  it('finds a page heading run into the next sentence', () => {
    expect(
      hasFusedPageHeading('Coral Reef Recovery The lab studies bleaching.', pageEvidence),
    ).toBe(true);
    expect(hasFusedPageHeading('Research Overview The lab studies reefs.', profileEvidence)).toBe(
      true,
    );
    expect(
      hasFusedPageHeading('Studies coral reef recovery. The lab surveys reefs.', pageEvidence),
    ).toBe(false);
  });

  it('refuses a fused heading as fused-page-heading', async () => {
    expect(
      await decide(
        'Coral Reef Recovery The coral reefs recover after marine heatwaves and bleaching events across the Caribbean.',
      ),
    ).toBe('fused-page-heading');
  });

  it('finds welcome text but not a lab that welcomes students', () => {
    expect(hasGreetingText('Welcome to the reef lab, which studies coral.')).toBe(true);
    expect(hasGreetingText('Thank you for visiting. Studies coral.')).toBe(true);
    expect(hasGreetingText('Studies coral reefs and welcomes undergraduates.')).toBe(false);
  });

  it('refuses a greeting as greeting-text', async () => {
    const welcomeSnippets: CoverageSnippet[] = [
      { ...SNIPPETS[0], text: `Welcome to the coral reef lab.\n${PAGE_TEXT}` },
    ];
    const decision = await coverageSynthesisDecision({
      snippets: welcomeSnippets,
      entityName: 'Reef Lab',
      callLLM: async () => ({
        fullDescription: `Welcome to the coral reef lab. ${GOOD}`,
        usedSnippetIndexes: [0],
      }),
      coverageWriterChecks: true,
    });
    expect(decision.refusal).toBe('greeting-text');
  });
});

describe('the five checks belong to the coverage writer only (#5537)', () => {
  const firstPerson = GOOD.replace(/^Studies/, 'We study');

  it('leaves the shared judge and the adopted-body check as they were', async () => {
    const shared = await coverageSynthesisDecision({
      snippets: SNIPPETS,
      entityName: 'Reef Lab',
      callLLM: async () => ({ fullDescription: firstPerson, usedSnippetIndexes: [0] }),
    });
    expect(shared.refusal).not.toBe('first-person');
    expect(await decide(firstPerson)).toBe('first-person');
    expect(adoptedWrittenBodyStillSupported({ body: GOOD, snippets: SNIPPETS })).toBe(
      (
        await coverageSynthesisDecision({
          snippets: SNIPPETS,
          entityName: 'Reef Lab',
          callLLM: async () => ({ fullDescription: GOOD, usedSnippetIndexes: [0] }),
        })
      ).refusal === null,
    );
  });
});

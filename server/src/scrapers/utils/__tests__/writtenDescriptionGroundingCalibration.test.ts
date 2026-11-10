import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { coverageSynthesisDecision, type CoverageSnippet } from '../../coverageSynthesis';
import {
  americanSpellingOf,
  ungroundedContentTerms,
  type WrittenDescriptionEvidence,
} from '../writtenDescriptionChecks';

interface PilotDraft {
  label: string;
  fullDescription: string;
  snippets: Array<{ text: string; sourceName: string }>;
}

const PILOT_DRAFTS = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'writerGroundingPilotDrafts.json'), 'utf8'),
) as PilotDraft[];

const evidenceOf = (snippets: PilotDraft['snippets']): WrittenDescriptionEvidence[] =>
  snippets.map((snippet) => ({
    text: snippet.text,
    isResearchPageText: snippet.sourceName === 'research-page-text',
  }));

const on = (text: string): WrittenDescriptionEvidence[] => [{ text, isResearchPageText: false }];

describe('accepted set: the five pilot drafts are grounded (#5537)', () => {
  it('holds five drafts, four of which the first matcher refused', () => {
    expect(PILOT_DRAFTS).toHaveLength(5);
  });

  it.each(PILOT_DRAFTS.map((draft) => [draft.label, draft] as const))(
    'grounds every term of the %s draft',
    async (_label, draft) => {
      expect(ungroundedContentTerms(draft.fullDescription, evidenceOf(draft.snippets))).toEqual([]);
      const decision = await coverageSynthesisDecision({
        snippets: draft.snippets as CoverageSnippet[],
        entityName: draft.label,
        callLLM: async () => ({
          fullDescription: draft.fullDescription,
          usedSnippetIndexes: draft.snippets.map((_snippet, index) => index),
        }),
        coverageWriterChecks: true,
      });
      expect(decision.refusal).not.toBe('ungrounded-content-term');
    },
  );
});

const PLANTED: ReadonlyArray<readonly [string, string, string]> = [
  ['household economics profile', 'It also studies malaria transmission.', 'malaria'],
  ['emotion and stress psychophysiology lab', 'The lab also uses zebrafish.', 'zebrafish'],
  ['instrument prototyping facility', 'It also performs X-ray crystallography.', 'crystallography'],
  ['cancer metabolomics lab', 'It also studies glaucoma.', 'glaucoma'],
  ['bioinformatics support program', 'It also screens Drosophila mutants.', 'drosophila'],
];

const INVENTED_FORMS: ReadonlyArray<readonly [string, string]> = [
  ['It also studies tuberculosis.', 'tuberculosis'],
  ['It also models tumourigenesis.', 'tumourigenesis'],
  ['It also uses optogenetics (OPTO).', 'optogenetics'],
  ['It also studies Parkinsonism.', 'parkinsonism'],
  ['It also runs XYZQ assays on retinal tissue.', 'retinal'],
];

const EXISTING_REFUSALS: ReadonlyArray<readonly [string, string, string, string]> = [
  [
    'the #3201 body that clears the overlap floor',
    'The laboratory develops single-cell sequencing methods and computational models of gene regulatory networks controlling immune cell differentiation. Recent projects apply CRISPR screens and machine learning to predict transcription factor activity in immune cells.',
    'Develops single-cell sequencing methods to study gene regulatory networks in immune cells. The group applies CRISPR screens and machine learning approaches, with an emphasis on transcription factor activity during differentiation and on building predictive computational tools for experimental design.',
    'emphasis',
  ],
  [
    'the reef body naming ocean acidification',
    'We study how coral reefs recover after marine heatwaves and bleaching events.',
    'Studies how coral reefs recover after marine heatwaves, and how ocean acidification slows reef recovery.',
    'acidification',
  ],
  [
    'the FRA body with an unsupported emphasis',
    'Our laboratory investigates how mucosal immune cells restrain inflammation in the human intestine, using organoid co-culture and single-cell sequencing to map the signals that keep the epithelial barrier intact.',
    'Investigates how mucosal immune cells restrain inflammation in the human intestine, with an emphasis on predictive tools.',
    'predictive',
  ],
  [
    'the FRA body that published widely',
    'Our laboratory investigates how mucosal immune cells restrain inflammation in the human intestine.',
    'Investigates how mucosal immune cells restrain inflammation. Her group has published widely on inflammatory bowel disease relapse.',
    'bowel',
  ],
];

describe('refused set: invented terms are still refused (#5537)', () => {
  const byLabel = new Map(PILOT_DRAFTS.map((draft) => [draft.label, draft]));

  it.each(PLANTED)(
    'refuses an invented term planted in the %s draft',
    async (label, plant, term) => {
      const draft = byLabel.get(label)!;
      const planted = `${draft.fullDescription} ${plant}`;
      expect(ungroundedContentTerms(planted, evidenceOf(draft.snippets))).toContain(term);
      const decision = await coverageSynthesisDecision({
        snippets: draft.snippets as CoverageSnippet[],
        entityName: label,
        callLLM: async () => ({
          fullDescription: planted,
          usedSnippetIndexes: draft.snippets.map((_snippet, index) => index),
        }),
        coverageWriterChecks: true,
      });
      if (decision.refusal === 'ungrounded-content-term') {
        expect(decision.refusalDetails?.ungroundedTerms).toContain(term);
      } else {
        expect(decision.result).toBeNull();
      }
    },
  );

  it.each(PILOT_DRAFTS.flatMap((draft) => INVENTED_FORMS.map((form) => [draft.label, ...form])))(
    'refuses, in the %s draft, the invented "%s"',
    (label, sentence, term) => {
      const draft = byLabel.get(label)!;
      expect(
        ungroundedContentTerms(`${draft.fullDescription} ${sentence}`, evidenceOf(draft.snippets)),
      ).toContain(term);
    },
  );

  it.each(EXISTING_REFUSALS)('still refuses %s', (_label, evidence, body, term) => {
    expect(ungroundedContentTerms(body, on(evidence))).toContain(term);
  });
});

describe('what the matcher normalizes (#5537)', () => {
  it('reads British and American spellings as one word', () => {
    expect(americanSpellingOf('behaviour')).toBe('behavior');
    expect(americanSpellingOf('modelling')).toBe('modeling');
    expect(americanSpellingOf('programmes')).toBe('programs');
    expect(americanSpellingOf('leukaemia')).toBe('leukemia');
    expect(ungroundedContentTerms('Studies labour behaviour.', on('labor behavior'))).toEqual([]);
    expect(ungroundedContentTerms('Studies tumour centres.', on('tumor centers'))).toEqual([]);
  });

  it('reads hyphenated and joined compounds either way, whatever the hyphen character', () => {
    expect(
      ungroundedContentTerms('Analyses microarray data.', on('micro array data analysis')),
    ).toEqual([]);
    expect(
      ungroundedContentTerms('Analyses single-cell data.', on('single cell data analysis')),
    ).toEqual([]);
    expect(
      ungroundedContentTerms('Supports in‑silico hypothesis work.', on('hypothesis in silico')),
    ).toEqual([]);
    expect(
      ungroundedContentTerms(
        'Applies mass spectrometry–based metabolomics.',
        on('metabolomics using mass spectrometry'),
      ),
    ).toEqual([]);
  });

  it('accepts an abbreviation the body spells out, and one the evidence spells out, only in capitals', () => {
    expect(
      ungroundedContentTerms(
        'Analyses next generation sequencing (NGSX) data.',
        on('next generation sequencing data analysis'),
      ),
    ).toEqual(['ngsx']);
    expect(
      ungroundedContentTerms(
        'Uses magnetic resonance spectroscopy imaging (MRSI).',
        on('magnetic resonance spectroscopy imaging'),
      ),
    ).toEqual([]);
    expect(
      ungroundedContentTerms(
        'Analyses NGSQ data.',
        on('next generation sequencing quality data analysis'),
      ),
    ).toEqual([]);
    expect(
      ungroundedContentTerms(
        'Analyses ngsq data.',
        on('next generation sequencing quality data analysis'),
      ),
    ).toEqual(['ngsq']);
  });

  it('ignores e.g. and including, and matches other inflections', () => {
    expect(
      ungroundedContentTerms(
        'Uses measures (e.g., heart rate), including skin conductance.',
        on('heart rate and skin conductance measures'),
      ),
    ).toEqual([]);
    expect(
      ungroundedContentTerms('Studies emotions and decisions.', on('emotion decision')),
    ).toEqual([]);
    expect(
      ungroundedContentTerms('Studies developmental emotion.', on('child development, emotional')),
    ).toEqual([]);
    expect(ungroundedContentTerms('Studies early childhood.', on('early child years'))).toEqual([]);
  });

  it('does not join unrelated neighbours or derive across meaning', () => {
    expect(ungroundedContentTerms('Counts rates.', on('accurate statistics'))).toEqual([
      'counts',
      'rates',
    ]);
    expect(ungroundedContentTerms('Studies neuronal firing.', on('neuron firing'))).toEqual([
      'neuronal',
    ]);
    expect(ungroundedContentTerms('Studies parenthood.', on('child care'))).toEqual(['parenthood']);
  });
});

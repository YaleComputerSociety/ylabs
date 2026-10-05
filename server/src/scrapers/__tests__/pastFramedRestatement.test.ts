import { describe, expect, it } from 'vitest';
import {
  coverageSynthesisDecision,
  isPastCareerClauseSentence,
  type CoverageSnippet,
} from '../coverageSynthesis';
import { isAcceptableWrittenBodyCard } from '../entityMaterializer';
import {
  carriesPastContextMarker,
  restatesPastFramedEvidence,
  statesPersonalPastFraming,
} from '../utils/extractedDescriptionScope';

const CURRENT =
  'The laboratory studies how coastal salt marshes store carbon and how tidal flooding shapes plant roots.';
const POSTDOC_TRAINING =
  'During her postdoctoral training she mapped synaptic vesicle recycling in cultured hippocampal neurons.';
const PREVIOUS_POSITION =
  'Before joining the faculty she directed a biotech assay group that screened kinase inhibitors for fibrotic disease.';

const SNIPPETS: CoverageSnippet[] = [
  { text: CURRENT, sourceUrl: 'https://example.edu/lab', sourceName: 'lab-page' },
  {
    text: `${POSTDOC_TRAINING} ${PREVIOUS_POSITION}`,
    sourceUrl: 'https://example.edu/profile',
    sourceName: 'profile-page',
  },
];

const GROUNDED =
  'Studies how coastal salt marshes store carbon and how tidal flooding shapes plant roots.';

const decide = (fullDescription: string) =>
  coverageSynthesisDecision({
    snippets: SNIPPETS,
    entityName: 'Synthetic Marsh Lab',
    callLLM: async () => ({ fullDescription, usedSnippetIndexes: [0, 1] }),
  });

describe('the writer never serves past-framed evidence as current work (#4915)', () => {
  it('strips a sentence restating postdoctoral training as current work', async () => {
    const decision = await decide(
      `${GROUNDED} Maps synaptic vesicle recycling in cultured hippocampal neurons.`,
    );
    expect(decision.refusal).toBeNull();
    expect(decision.result?.description).toBe(GROUNDED);
  });

  it('strips a sentence restating a previous position as current work', async () => {
    const decision = await decide(
      `${GROUNDED} Screens kinase inhibitors for fibrotic disease in a biotech assay group.`,
    );
    expect(decision.result?.description).toBe(GROUNDED);
  });

  it('refuses a body that is nothing but a restatement, naming its own arm', async () => {
    const decision = await decide(
      'Maps synaptic vesicle recycling in cultured hippocampal neurons and screens kinase inhibitors.',
    );
    expect(decision.refusal).toBe('past-framed-restatement');
  });

  it('drops a sentence that states its own past framing rather than serving it', async () => {
    for (const sentence of [
      'During her postdoctoral training she studied retinal ganglion cell degeneration.',
      'As a postdoc, she studied retinal ganglion cell degeneration.',
      'She was previously at another university, where she studied retinal degeneration.',
    ]) {
      const decision = await decide(`${GROUNDED} ${sentence}`);
      expect(decision.result?.description, sentence).toBe(GROUNDED);
    }
  });

  it("keeps the writer's own training patterns beside the extractor's markers", () => {
    for (const sentence of [
      'While a graduate student she studied plant pathogens.',
      'During her fellowship she studied plant pathogens.',
      'Her PhD work examined plant pathogens.',
      'Prior to arriving at Yale she studied plant pathogens.',
      'As a doctoral fellow she studied plant pathogens.',
    ]) {
      expect(isPastCareerClauseSentence(sentence), sentence).toBe(true);
    }
  });

  it('keeps research prose that uses "previously" as an adjective', async () => {
    const snippets: CoverageSnippet[] = [
      {
        text: 'The group combines new and previously developed methods to identify previously uncharacterized genes in the zebrafish heart.',
        sourceUrl: 'https://example.edu/heart',
        sourceName: 'lab-page',
      },
      { text: POSTDOC_TRAINING, sourceUrl: 'https://example.edu/bio', sourceName: 'profile-page' },
    ];
    const body =
      'Combines new and previously developed methods to identify previously uncharacterized genes in the zebrafish heart.';
    const decision = await coverageSynthesisDecision({
      snippets,
      entityName: 'Synthetic Heart Lab',
      callLLM: async () => ({ fullDescription: body, usedSnippetIndexes: [0] }),
    });
    expect(decision.refusal).toBeNull();
    expect(decision.result?.description).toBe(body);
  });

  it("keeps a program's current postdoctoral research and training", () => {
    for (const sentence of [
      'Supports cross-disciplinary postdoctoral research in partnership with faculty.',
      'Runs a curriculum that spans postdoctoral research training through career development awards.',
    ]) {
      expect(isPastCareerClauseSentence(sentence), sentence).toBe(false);
      expect(carriesPastContextMarker(sentence), sentence).toBe(true);
    }
  });
});

describe('restatesPastFramedEvidence', () => {
  it('frames only the clauses at or after the marker as past', () => {
    const evidence = [
      'Her academic interests include the evaluation of cryptogenic strokes in young adults, and she previously served as site investigator for a prevention trial.',
    ];
    expect(
      restatesPastFramedEvidence(
        'Studies the evaluation of cryptogenic strokes in young adults.',
        evidence,
      ),
    ).toBe(false);
    expect(
      restatesPastFramedEvidence('Serves as site investigator for a prevention trial.', evidence),
    ).toBe(true);
  });

  it('carries a framing forward to a later clause of its sentence', () => {
    const evidence = [
      'Before joining the school she helped start a philanthropy firm, supporting grassroots organizations through education and job creation.',
    ];
    expect(
      restatesPastFramedEvidence(
        'Supports grassroots organizations through education and job creation.',
        evidence,
      ),
    ).toBe(true);
  });

  it('ends a framing where the sentence moves on to what came after', () => {
    const evidence = [
      'He cloned a vascular enzyme as a post-doc and subsequently identified its trafficking and lipidation as mechanisms governing vascular tone.',
    ];
    expect(
      restatesPastFramedEvidence(
        'Investigates enzyme trafficking and lipidation as mechanisms governing vascular tone.',
        evidence,
      ),
    ).toBe(false);
  });

  it('does not frame a sentence the splitter joined after an initialism', () => {
    const evidence = [
      'He previously served as a fellow at an agency in Washington, D.C. Over the last decade his research has focused on occupant safety and motor vehicle crash injury.',
    ];
    expect(
      restatesPastFramedEvidence(
        'Studies occupant safety and motor vehicle crash injury.',
        evidence,
      ),
    ).toBe(false);
  });

  it('keeps content the evidence also states as current work', () => {
    expect(
      restatesPastFramedEvidence('Maps synaptic vesicle recycling in hippocampal neurons.', [
        POSTDOC_TRAINING,
        'Her lab now maps synaptic vesicle recycling in hippocampal neurons.',
      ]),
    ).toBe(false);
  });

  it('reads a postdoc phase as past only when it is someone’s', () => {
    expect(statesPersonalPastFraming('Her postdoctoral work examined water chemistry.')).toBe(true);
    expect(statesPersonalPastFraming('Supports postdoctoral research on water chemistry.')).toBe(
      false,
    );
  });
});

describe('the written body card never serves past-framed evidence as current (#4915)', () => {
  const BODY = GROUNDED;
  const accepts = (card: string) =>
    isAcceptableWrittenBodyCard({
      card,
      body: BODY,
      researchAreas: [],
      servingBarAccepts: () => true,
      requireGrounding: false,
      evidenceTexts: [POSTDOC_TRAINING],
    });

  it('does not keep a card restating postdoctoral training as current work', () => {
    expect(accepts('Maps synaptic vesicle recycling in cultured hippocampal neurons.')).toBe(false);
  });

  it('does not keep a card that states its own past framing', () => {
    expect(accepts('During her postdoctoral training she mapped synaptic vesicle recycling.')).toBe(
      false,
    );
  });

  it('keeps a card grounded in current work', () => {
    expect(accepts('Studies how salt marshes store carbon.')).toBe(true);
  });
});

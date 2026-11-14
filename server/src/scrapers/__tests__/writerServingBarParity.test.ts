import { describe, expect, it } from 'vitest';
import { coverageSynthesisDecision, type CoverageSnippet } from '../coverageSynthesis';
import { servingBarAcceptsFullDescription } from '../utils/fullDescriptionServingBar';
import type { CardSynthesisDerivationStore } from '../cardSynthesisDerivation';
import { runCardImport, type CardRequest } from '../../scripts/cardSynthesisCore';
import { writerServingRow } from '../../scripts/coverageSynthesisEvidence';

const AREAS = ['Kelp Forest Recovery', 'Marine Heatwaves', 'Sea Urchin Grazing'];
const ROW = {
  slug: 'kelp-lab',
  name: 'Kelp Lab',
  entityType: 'FACULTY_RESEARCH_AREA',
  researchAreas: AREAS,
};
const SERVING_ROW = { entity: ROW, leadPersonName: '' };
const PROSE =
  'Her research examines kelp forest recovery after marine heatwaves and the sea urchin grazing that follows them.';
const ECHO = 'Studies kelp forest recovery, marine heatwaves and sea urchin grazing.';
const NORMAL =
  'Examines how kelp forests recover after marine heatwaves and how the sea urchin grazing that follows them shapes recovery.';

const decide = (draft: string, servingRow: typeof SERVING_ROW | null) =>
  coverageSynthesisDecision({
    snippets: [{ text: PROSE, sourceName: 'lab-page' } as CoverageSnippet],
    entityName: 'Kelp Lab',
    entityType: 'FACULTY_RESEARCH_AREA',
    researchAreas: AREAS,
    callLLM: async () => ({ fullDescription: draft, usedSnippetIndexes: [0] }),
    coverageWriterChecks: true,
    servingRow,
  });

describe('the writer refuses a draft the serving bar refuses (#5982)', () => {
  it('refuses a topic-list echo its cited prose supports, because the row cannot serve it', async () => {
    expect(servingBarAcceptsFullDescription(ROW, {}, ECHO, '')).toBe(false);
    expect((await decide(ECHO, null)).refusal).toBeNull();
    const decision = await decide(ECHO, SERVING_ROW);
    expect(decision.refusal).toBe('refused-by-serving-bar');
    expect(decision.result).toBeNull();
  });

  it('still accepts a research-first draft the row serves', async () => {
    expect(servingBarAcceptsFullDescription(ROW, {}, NORMAL, '')).toBe(true);
    const decision = await decide(NORMAL, SERVING_ROW);
    expect(decision.refusal).toBeNull();
    expect(decision.result?.description).toBe(NORMAL);
  });

  it("judges in the row's served fields, not only the writer's evidence fields", () => {
    const servingEntity = { ...ROW, kind: 'individual', displayName: 'Kelp Lab' };
    expect(
      writerServingRow({ entity: { slug: 'kelp-lab', servingEntity }, leadNames: ['A Lead'] }),
    ).toEqual({ entity: servingEntity, leadPersonName: 'A Lead' });
    expect(writerServingRow({ entity: ROW })).toEqual({ entity: ROW, leadPersonName: '' });
  });
});

const TOPICS = ['Clinical Trials', 'Medical Oncology', 'Lung Neoplasms', 'Prostatic Neoplasms'];
const TOPIC_BODY =
  'Research interests include clinical trials, medical oncology, lung neoplasms and prostatic neoplasms.';
const TOPIC_ROW = {
  slug: 'faculty-topic-row',
  name: 'Topic Row',
  entityType: 'FACULTY_RESEARCH_AREA',
  researchAreas: TOPICS,
};
const CARD = 'Studies lung and prostatic neoplasms through clinical trials in medical oncology.';
const store = (): CardSynthesisDerivationStore => ({
  find: async () => null,
  save: async () => {},
});
const request = (servingRow?: CardRequest['servingRow']): CardRequest => ({
  slug: 'faculty-topic-row',
  entityName: 'Topic Row',
  fullDescription: TOPIC_BODY,
  evidenceTexts: [],
  researchAreas: TOPICS,
  ...(servingRow ? { servingRow } : {}),
});
const importCard = (servingRow?: CardRequest['servingRow']) =>
  runCardImport({
    requests: [request(servingRow)],
    drafts: [{ slug: 'faculty-topic-row', writer: 'claude-agent:1', card: CARD }],
    store: store(),
    validateOnly: true,
  });

describe("the card import applies the materializer's written-body card acceptance (#5982)", () => {
  it('refuses a card the materializer would refuse beside this body on this row', async () => {
    const report = await importCard({ entity: TOPIC_ROW, leadPersonName: '' });
    expect(report.rows[0]).toMatchObject({
      outcome: 'refused',
      refusalReason: 'written-body-card-acceptance',
      card: '',
    });
  });

  it('fails closed on a request with no row to judge the card in', async () => {
    const report = await importCard();
    expect(report.rows[0]).toMatchObject({ outcome: 'refused', refusalReason: 'no-serving-row' });
  });
});

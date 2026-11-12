import { describe, expect, it, vi } from 'vitest';
import {
  CURRENT_CARD_INPUTS,
  cardInputHash,
  judgeImportedCard,
  resolveCard,
  type CardSynthesisDerivationStore,
  type StoredCardSynthesisDerivation,
} from '../cardSynthesisDerivation';
import {
  parseCardRequests,
  runCardImport,
  type CardRequest,
} from '../../scripts/cardSynthesisCore';

const BODY =
  'The Tidepool Lab studies how coastal kelp forests recover after marine heatwaves, using long-term field surveys of kelp canopy and sea urchin grazing across rocky shores.';
const CARD = 'Studies how coastal kelp forests recover after marine heatwaves.';
const BAD_CARD = 'Studies volcanic glaciers on distant moons.';
const subject = { fullDescription: BODY, entityName: 'Tidepool Lab' };

function memoryStore(entries: StoredCardSynthesisDerivation[] = []) {
  const byHash = new Map(entries.map((entry) => [entry.inputHash, entry]));
  const store: CardSynthesisDerivationStore & { entries: typeof byHash } = {
    entries: byHash,
    find: async (inputHash) => byHash.get(inputHash) ?? null,
    save: async (record) => {
      byHash.set(record.inputHash, record);
    },
  };
  return store;
}

const entry = (rawCards: string[], promptHash = CURRENT_CARD_INPUTS.promptHash) => ({
  inputHash: cardInputHash(BODY),
  promptHash,
  model: CURRENT_CARD_INPUTS.model,
  writer: CURRENT_CARD_INPUTS.writer,
  rawCards,
  derivedAt: new Date('2026-11-01T00:00:00Z'),
});

describe('the card cache (#5537)', () => {
  it('keys on the normalized body, never on the prompt', () => {
    expect(cardInputHash(BODY)).toBe(cardInputHash(`  ${BODY.replace(/ /g, '  ')} `));
    expect(cardInputHash(BODY)).not.toBe(cardInputHash(`${BODY} More.`));
    expect(entry([CARD], 'prompt-a').inputHash).toBe(entry([CARD], 'prompt-b').inputHash);
  });

  it('serves a cached card with zero model calls and re-judges it', async () => {
    const model = vi.fn(async () => 'never read');
    const hit = await resolveCard({ subject, store: memoryStore([entry([CARD])]), callLLM: model });
    expect(hit).toMatchObject({ step: 'cache-hit', card: CARD, modelCalled: false });
    const refused = await resolveCard({
      subject,
      store: memoryStore([entry([BAD_CARD])]),
      callLLM: model,
    });
    expect(refused).toMatchObject({ step: 'refused', card: '', modelCalled: false });
    expect(model).not.toHaveBeenCalled();
  });

  it('keeps a passing card across a prompt-only change and re-calls only a failing one', async () => {
    const model = vi.fn(async () => CARD);
    const kept = await resolveCard({
      subject,
      store: memoryStore([entry([CARD], 'older-prompt')]),
      callLLM: model,
    });
    expect(kept).toMatchObject({ step: 'carried-over-prompt-change', card: CARD });
    expect(model).not.toHaveBeenCalled();

    const store = memoryStore([entry([BAD_CARD], 'older-prompt')]);
    const redrawn = await resolveCard({ subject, store, callLLM: model });
    expect(redrawn).toMatchObject({ step: 'synthesized', card: CARD, modelCalled: true });
    expect(model).toHaveBeenCalled();
    expect(store.entries.get(cardInputHash(BODY))?.promptHash).toBe(CURRENT_CARD_INPUTS.promptHash);
  });

  it('plans a needed call in a dry run and stores nothing', async () => {
    const store = memoryStore();
    const planned = await resolveCard({ subject, store, callLLM: null });
    expect(planned.step).toBe('planned');
    expect(store.entries.size).toBe(0);
  });
});

describe('imported cards (#5537)', () => {
  const servingRow = (slug: string, name: string) => ({
    entity: { slug, name, entityType: 'LAB' },
    leadPersonName: '',
  });
  const requests: CardRequest[] = [
    {
      slug: 'tidepool-lab',
      entityName: 'Tidepool Lab',
      fullDescription: BODY,
      evidenceTexts: [],
      servingRow: servingRow('tidepool-lab', 'Tidepool Lab'),
    },
  ];

  it('accepts a passing external card with its provenance', async () => {
    const verdict = await judgeImportedCard(subject, { writer: 'claude-agent:1', card: CARD });
    expect(verdict.outcome).toBe('accepted');
    expect(verdict.record).toMatchObject({ writer: 'claude-agent:1', rawCards: [CARD] });
    const store = memoryStore();
    const report = await runCardImport({
      requests,
      drafts: [{ slug: 'tidepool-lab', writer: 'claude-agent:1', card: CARD }],
      store,
      validateOnly: false,
    });
    expect(report.rows[0]).toMatchObject({ outcome: 'accepted', stored: true });
    expect(store.entries.get(cardInputHash(BODY))?.writer).toBe('claude-agent:1');
  });

  it('stores a refused external card for a later re-judgement, and validate-only writes nothing', async () => {
    const store = memoryStore();
    const refused = await runCardImport({
      requests,
      drafts: [{ slug: 'tidepool-lab', writer: 'claude-agent:1', card: BAD_CARD }],
      store,
      validateOnly: false,
    });
    expect(refused.rows[0]).toMatchObject({ outcome: 'refused', stored: true });
    expect(store.entries.get(cardInputHash(BODY))?.rawCards).toEqual([BAD_CARD]);
    const untouched = memoryStore();
    const validated = await runCardImport({
      requests,
      drafts: [{ slug: 'tidepool-lab', writer: 'claude-agent:1', card: BAD_CARD }],
      store: untouched,
      validateOnly: true,
    });
    expect(validated.rows[0]).toMatchObject({ outcome: 'refused', stored: false });
    expect(untouched.entries.size).toBe(0);
  });

  it('refuses at import a card the written-body card bar would refuse at materialize', async () => {
    const cardLengthBody =
      'The Tidepool Lab studies how coastal kelp forests recover after marine heatwaves, using field surveys of kelp canopy.';
    const restatement =
      'Studies how coastal kelp forests recover after marine heatwaves, using field surveys of kelp canopy.';
    const chipBody =
      'The Shoreline Lab studies marine ecology and kelp forests through long-term field surveys along rocky shores.';
    const chipEcho = 'Studies marine ecology and kelp forests.';
    const barRequests = parseCardRequests([
      { slug: 'tidepool-lab', entityName: 'Tidepool Lab', fullDescription: cardLengthBody },
      {
        slug: 'shoreline-lab',
        entityName: 'Shoreline Lab',
        fullDescription: chipBody,
        researchAreas: ['Marine Ecology', 'Kelp Forests'],
      },
      {
        slug: 'kelp-lab',
        entityName: 'Kelp Lab',
        fullDescription: BODY,
        servingRow: servingRow('kelp-lab', 'Kelp Lab'),
      },
    ]);
    expect(barRequests[1].researchAreas).toEqual(['Marine Ecology', 'Kelp Forests']);
    expect(barRequests[2].servingRow).toEqual(servingRow('kelp-lab', 'Kelp Lab'));
    const store = memoryStore();
    const report = await runCardImport({
      requests: barRequests,
      drafts: [
        { slug: 'tidepool-lab', writer: 'claude-agent:1', card: restatement },
        { slug: 'shoreline-lab', writer: 'claude-agent:1', card: chipEcho },
        { slug: 'kelp-lab', writer: 'claude-agent:1', card: CARD },
        { slug: 'absent-lab', writer: 'claude-agent:1', card: CARD },
      ],
      store,
      validateOnly: false,
    });
    for (const row of report.rows.slice(0, 2)) {
      expect(row).toMatchObject({
        outcome: 'refused',
        refusalReason: 'written-body-card-bar',
        stored: true,
        card: '',
      });
    }
    expect(store.entries.get(cardInputHash(cardLengthBody))?.rawCards).toEqual([restatement]);
    expect(report.rows[2]).toMatchObject({ outcome: 'accepted', stored: true, card: CARD });
    expect(report.rows[2].refusalReason).toBeUndefined();
    expect(report.byReason).toEqual({
      'written-body-card-bar': 2,
      accepted: 1,
      'missing-request': 1,
    });
  });

  it('names the card synthesizer as the reason when its own checks refuse a card', async () => {
    const report = await runCardImport({
      requests,
      drafts: [{ slug: 'tidepool-lab', writer: 'claude-agent:1', card: BAD_CARD }],
      store: memoryStore(),
      validateOnly: true,
    });
    expect(report.rows[0]).toMatchObject({
      outcome: 'refused',
      refusalReason: 'card-synthesis-checks',
    });
    expect(report.byReason).toEqual({ 'card-synthesis-checks': 1 });
  });
});

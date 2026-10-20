import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assertDeriveResearchTopicsApplyAllowed,
  deriveResearchTopicsForRows,
  parseDeriveResearchTopicsArgs,
  researchTopicsUserMessage,
  type ResearchTopicsDerivationRecord,
  type ResearchTopicsDerivationStore,
  type ResearchTopicsModelFn,
} from '../deriveResearchTopicsCore';
import { researchTopicsDerivationInputHash } from '../../scrapers/researchPageTopicsDerivation';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOME = 'https://tidepool-lab.example.org/';
const RESEARCH = 'https://tidepool-lab.example.org/research/';
const pages = [
  { url: HOME, text: 'We study how coastal kelp forests recover after marine heatwaves.' },
  {
    url: RESEARCH,
    text: 'Our projects follow sea urchin grazing on kelp. Marine ecology is the field we work in.',
  },
];
const row = { entityKey: 'tidepool-lab', value: pages };

function memoryStore(seed: string[] = []) {
  const records = new Map<string, ResearchTopicsDerivationRecord>();
  const cachedHashes = new Set(seed);
  const store: ResearchTopicsDerivationStore = {
    has: vi.fn(async (inputHash: string) => cachedHashes.has(inputHash) || records.has(inputHash)),
    save: vi.fn(async (record: ResearchTopicsDerivationRecord) => {
      records.set(record.inputHash, record);
    }),
  };
  return { store, records };
}

const modelAnswer: Awaited<ReturnType<ResearchTopicsModelFn>> = {
  topics: [
    { topic: 'Kelp forests', quote: 'how coastal kelp forests recover', url: HOME },
    { topic: 'Marine heatwaves', quote: 'recover after marine heatwaves', url: HOME },
    { topic: 'Sea urchin grazing', quote: 'follow sea urchin grazing on kelp', url: RESEARCH },
    { topic: 'Coral bleaching', quote: 'coral bleaching events', url: RESEARCH },
    { topic: 'Coastal', quote: 'how coastal kelp forests', url: HOME },
  ],
  field: { topic: 'Marine ecology', quote: 'Marine ecology is the field', url: RESEARCH },
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('deriveResearchTopicsForRows', () => {
  it('makes no model call on a dry run and reports the call it would make', async () => {
    const { store } = memoryStore();
    const result = await deriveResearchTopicsForRows({ rows: [row], callModel: null, store });
    expect(result.plannedModelCalls).toBe(1);
    expect(result.modelCalls).toBe(0);
    expect(store.save).not.toHaveBeenCalled();
    expect(result.rows[0].outcome).toBe('planned');
  });

  it('makes no model call when the input hash is cached', async () => {
    const { store } = memoryStore([researchTopicsDerivationInputHash(pages)]);
    const callModel = vi.fn<ResearchTopicsModelFn>(async () => modelAnswer);
    const result = await deriveResearchTopicsForRows({ rows: [row], callModel, store });
    expect(callModel).not.toHaveBeenCalled();
    expect(result.cached).toBe(1);
    expect(store.save).not.toHaveBeenCalled();
  });

  it('on a miss, caches the raw reading and previews what the filters keep', async () => {
    const { store, records } = memoryStore();
    const callModel = vi.fn<ResearchTopicsModelFn>(async () => modelAnswer);
    const result = await deriveResearchTopicsForRows({
      rows: [row],
      callModel,
      store,
      now: () => new Date('2026-10-19T00:00:00Z'),
    });
    expect(callModel).toHaveBeenCalledTimes(1);
    expect(callModel.mock.calls[0][0].pages).toEqual(pages);
    expect(result).toMatchObject({ modelCalls: 1, derived: 1, derivedWithTopics: 1 });
    const record = records.get(researchTopicsDerivationInputHash(pages));
    expect(record).toMatchObject({
      extractedTopics: modelAnswer.topics,
      extractedField: modelAnswer.field,
      derivedAt: new Date('2026-10-19T00:00:00Z'),
    });
    expect(record).not.toHaveProperty('topics');
    expect(record).not.toHaveProperty('filterContract');
    expect(result.rows[0].topics).toEqual([
      'Kelp forests',
      'Marine heatwaves',
      'Sea urchin grazing',
      'Marine ecology',
    ]);
    expect(result.rows[0].refusals).toEqual([
      { reason: 'quote-not-on-page', count: 1 },
      { reason: 'split-fragment', count: 1 },
    ]);
  });

  it('asks once when two rows carry the same text, and a re-run asks nothing', async () => {
    const { store } = memoryStore();
    const callModel = vi.fn<ResearchTopicsModelFn>(async () => modelAnswer);
    const twin = { entityKey: 'tidepool-lab-twin', value: pages };
    const first = await deriveResearchTopicsForRows({ rows: [row, twin], callModel, store });
    expect(callModel).toHaveBeenCalledTimes(1);
    expect(first.derived + first.cached).toBe(2);
    const second = await deriveResearchTopicsForRows({ rows: [row, twin], callModel, store });
    expect(callModel).toHaveBeenCalledTimes(1);
    expect(second.cached).toBe(2);
  });

  it('stores nothing when the call fails, so the next run retries', async () => {
    const { store } = memoryStore();
    const callModel = vi.fn<ResearchTopicsModelFn>(async () => {
      throw new Error('upstream unavailable');
    });
    const result = await deriveResearchTopicsForRows({ rows: [row], callModel, store });
    expect(result.modelFailures).toBe(1);
    expect(store.save).not.toHaveBeenCalled();
  });

  it('skips a row with no stored text', async () => {
    const { store } = memoryStore();
    const callModel = vi.fn<ResearchTopicsModelFn>(async () => modelAnswer);
    const result = await deriveResearchTopicsForRows({
      rows: [{ entityKey: 'empty', value: [] }],
      callModel,
      store,
    });
    expect(result.noText).toBe(1);
    expect(callModel).not.toHaveBeenCalled();
  });

  it('never fetches a page', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { store } = memoryStore();
    await deriveResearchTopicsForRows({
      rows: [row],
      callModel: async () => modelAnswer,
      store,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    for (const file of ['../deriveResearchTopicsCore.ts', '../deriveResearchTopics.ts']) {
      const source = fs.readFileSync(path.resolve(HERE, file), 'utf8');
      expect(source).not.toMatch(/httpFetch|fetchPage|snapshotCache|labMicrositeDescription/);
    }
  });
});

describe('the spend guard', () => {
  it('lets a dry run through with no key', () => {
    expect(() =>
      assertDeriveResearchTopicsApplyAllowed(
        { apply: false, confirm: false },
        'cluster/Prod',
        undefined,
      ),
    ).not.toThrow();
  });

  it('refuses an apply without confirmation, off Development, or without a key', () => {
    expect(() =>
      assertDeriveResearchTopicsApplyAllowed(
        { apply: true, confirm: false },
        'cluster/development',
        'key',
      ),
    ).toThrow(/--confirm-research-topics-derivation/);
    expect(() =>
      assertDeriveResearchTopicsApplyAllowed({ apply: true, confirm: true }, 'cluster/beta', 'key'),
    ).toThrow(/Development database/);
    expect(() =>
      assertDeriveResearchTopicsApplyAllowed(
        { apply: true, confirm: true },
        'cluster/development',
        undefined,
      ),
    ).toThrow(/OPENAI_API_KEY/);
    expect(() =>
      assertDeriveResearchTopicsApplyAllowed(
        { apply: true, confirm: true },
        'cluster/development',
        'key',
      ),
    ).not.toThrow();
  });

  it('parses a dry run by default and refuses unknown flags', () => {
    expect(parseDeriveResearchTopicsArgs([])).toMatchObject({ apply: false, limit: 100 });
    expect(
      parseDeriveResearchTopicsArgs([
        '--apply',
        '--confirm-research-topics-derivation',
        '--slugs=a,b',
      ]),
    ).toMatchObject({ apply: true, confirm: true, slugs: ['a', 'b'] });
    expect(() => parseDeriveResearchTopicsArgs(['--force-llm'])).toThrow(/Unknown/);
  });
});

describe('researchTopicsUserMessage', () => {
  it('names each page by the URL the quotes must cite', () => {
    expect(researchTopicsUserMessage(pages)).toBe(
      `Page URL: ${HOME}\n\n${pages[0].text}\n\n---\n\nPage URL: ${RESEARCH}\n\n${pages[1].text}`,
    );
  });
});

import { describe, expect, it } from 'vitest';

import { researchTopicsDerivationInputHash } from '../../scrapers/researchPageTopicsDerivation';
import {
  researchPageTextEntries,
  researchPageTextEntriesWithoutChrome,
} from '../../scrapers/utils/researchPageText';
import type { ResearchTopicsDerivationRecord } from '../deriveResearchTopicsCore';
import {
  parseRekeyResearchTopicsArgs,
  rekeyResearchTopicsToStrippedText,
  type RekeyResearchTopicsStore,
} from '../rekeyResearchTopicsToStrippedTextCore';

const URL_A = 'https://synthetic-lab-a.example.edu/research';
const URL_B = 'https://synthetic-lab-b.example.edu/research';
const URL_C = 'https://synthetic-lab-c.example.edu/research';
const URL_D = 'https://synthetic-lab-d.example.edu/research';

const RESEARCH =
  'The lab studies coastal wetland carbon storage using stable isotope tracing and field sampling.';
const MENU_TOPIC_LINE = 'Careers in coastal ecology';
const MENU_ONLY_TOPIC = 'coastal ecology';

const valueWithChrome = (url: string, extra: string[] = []) => [
  {
    url,
    text: ['Skip to main content', RESEARCH, ...extra, 'Make a gift to support our research.'].join(
      '\n',
    ),
  },
];
const cleanValue = (url: string) => [{ url, text: RESEARCH }];

const memoryStore = (records: ResearchTopicsDerivationRecord[]) => {
  const byHash = new Map(records.map((record) => [record.inputHash, record]));
  const inserted: ResearchTopicsDerivationRecord[] = [];
  const store: RekeyResearchTopicsStore = {
    find: async (inputHash) => byHash.get(inputHash) ?? null,
    insert: async (record) => {
      if (!byHash.has(record.inputHash)) {
        byHash.set(record.inputHash, record);
        inserted.push(record);
      }
    },
  };
  return { store, inserted, byHash };
};

const readingFor = (
  value: Array<{ url: string; text: string }>,
  topics: string[],
): ResearchTopicsDerivationRecord => ({
  inputHash: researchTopicsDerivationInputHash(researchPageTextEntries(value)),
  promptHash: 'synthetic-prompt',
  model: 'synthetic-model',
  extractedTopics: topics.map((topic) => ({ topic, quote: topic, url: value[0].url })),
  derivedAt: new Date('2026-11-01T00:00:00Z'),
});

describe('research-topics:rekey-stripped (#5577)', () => {
  const rowA = { entityKey: 'synthetic-row-a', value: valueWithChrome(URL_A) };
  const rowB = { entityKey: 'synthetic-row-b', value: valueWithChrome(URL_B, [MENU_TOPIC_LINE]) };
  const rowClean = { entityKey: 'synthetic-row-clean', value: cleanValue(URL_C) };
  const rowNoReading = { entityKey: 'synthetic-row-unread', value: valueWithChrome(URL_D) };
  const readings = () => [
    readingFor(rowA.value, ['coastal wetland carbon storage', 'stable isotope tracing']),
    readingFor(rowB.value, ['coastal wetland carbon storage', MENU_ONLY_TOPIC]),
    readingFor(rowClean.value, ['coastal wetland carbon storage']),
  ];

  it('plans a copy under the stripped-text key without writing on a dry run', async () => {
    const { store, inserted } = memoryStore(readings());

    const report = await rekeyResearchTopicsToStrippedText({
      rows: [rowA, rowB, rowClean, rowNoReading],
      store,
      apply: false,
    });

    expect(report).toMatchObject({
      rowsRead: 4,
      unchangedText: 1,
      noReading: 1,
      wouldRekey: 2,
      rekeyed: 0,
    });
    expect(inserted).toEqual([]);
  });

  it('copies each reading to the key the stripped text gives, unchanged otherwise', async () => {
    const { store, inserted } = memoryStore(readings());

    await rekeyResearchTopicsToStrippedText({ rows: [rowA], store, apply: true });

    const strippedKey = researchTopicsDerivationInputHash(
      researchPageTextEntriesWithoutChrome(rowA.value),
    );
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toEqual({ ...readings()[0], inputHash: strippedKey });
  });

  it('counts a topic quoted only from a chrome line as trimmed, and keeps the rest', async () => {
    const { store } = memoryStore(readings());

    const report = await rekeyResearchTopicsToStrippedText({
      rows: [rowA, rowB],
      store,
      apply: true,
    });

    expect(report).toMatchObject({
      topicsIdentical: 1,
      topicsTrimmed: 1,
      topicsLostAll: 0,
      topicsChanged: 0,
    });
    expect(report.rows.find((row) => row.entityKey === 'synthetic-row-b')?.droppedTopics).toEqual([
      MENU_ONLY_TOPIC,
    ]);
  });

  it('is a no-op the second time it runs', async () => {
    const { store, inserted } = memoryStore(readings());
    await rekeyResearchTopicsToStrippedText({ rows: [rowA, rowB, rowClean], store, apply: true });
    const firstRunWrites = inserted.length;

    const second = await rekeyResearchTopicsToStrippedText({
      rows: [rowA, rowB, rowClean],
      store,
      apply: true,
    });

    expect(firstRunWrites).toBe(2);
    expect(inserted).toHaveLength(2);
    expect(second).toMatchObject({ alreadyRekeyed: 2, unchangedText: 1, rekeyed: 0 });
  });

  it('counts every all-chrome row as losing its topics and writes no shared empty-text key', async () => {
    const allChrome = (url: string) => [
      { url, text: ['Skip to main content', 'Make a gift to support our research.'].join('\n') },
    ];
    const first = { entityKey: 'synthetic-row-chrome-1', value: allChrome(URL_A) };
    const second = { entityKey: 'synthetic-row-chrome-2', value: allChrome(URL_B) };
    const { store, inserted } = memoryStore([
      readingFor(first.value, ['coastal wetland carbon storage']),
      readingFor(second.value, ['stable isotope tracing']),
    ]);

    const report = await rekeyResearchTopicsToStrippedText({
      rows: [first, second],
      store,
      apply: true,
    });

    expect(report).toMatchObject({ allChrome: 2, topicsLostAll: 2, alreadyRekeyed: 0, rekeyed: 0 });
    expect(report.rows.map((row) => row.outcome)).toEqual(['all-chrome', 'all-chrome']);
    expect(inserted).toEqual([]);
  });

  it('refuses an apply without the confirmation flag', () => {
    expect(() => parseRekeyResearchTopicsArgs(['--apply'])).toThrow(
      '--confirm-research-topics-rekey',
    );
    expect(parseRekeyResearchTopicsArgs([])).toMatchObject({ apply: false });
  });
});

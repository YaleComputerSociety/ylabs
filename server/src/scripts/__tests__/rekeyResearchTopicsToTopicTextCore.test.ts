import { describe, expect, it } from 'vitest';

import { researchTopicsDerivationInputHash } from '../../scrapers/researchPageTopicsDerivation';
import {
  researchPageTextEntriesForTopics,
  researchPageTextEntriesWithoutChrome,
} from '../../scrapers/utils/researchPageText';
import type { ResearchTopicsDerivationRecord } from '../deriveResearchTopicsCore';
import type { RekeyResearchTopicsStore } from '../rekeyResearchTopicsToStrippedTextCore';
import {
  parseRekeyTopicTextArgs,
  REKEY_TOPIC_TEXT_CONFIRM_FLAG,
  rekeyResearchTopicsToTopicText,
} from '../rekeyResearchTopicsToTopicTextCore';

const url = (name: string) => `https://synthetic-${name}.example.edu/research`;
const RESEARCH =
  'The lab studies coastal wetland carbon storage using stable isotope tracing and field sampling.';
const MENU = [
  'Facts & Figures',
  'Leadership, Administration & Governance',
  'Committees & Workgroups',
  'Organization Charts',
  'Departments & Centers',
  'Find People',
  'Historical Milestones',
  'Giving to Example School',
  'Biomedical Data Science',
  'Office of the Dean',
  'Degree Programs',
  'How to Apply',
];
const ROTATED_MENU = [...MENU.slice(0, 11), 'Financial Aid', 'Contact Us'];
const CITATION =
  'Quill A, Marsh B. Salt marsh methane fluxes. Journal Of Wetland Science 2025, 12: 101-110. PMID: 40000001, DOI: 10.0000/jws.2025.1.';

const page = (name: string, lines: string[]) => [{ url: url(name), text: lines.join('\n') }];

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
  return { store, inserted };
};

const readingOf = (
  value: Array<{ url: string; text: string }>,
  quotes: string[],
): ResearchTopicsDerivationRecord => ({
  inputHash: researchTopicsDerivationInputHash(researchPageTextEntriesWithoutChrome(value)),
  promptHash: 'synthetic-prompt',
  model: 'synthetic-model',
  extractedTopics: quotes.map((quote) => ({ topic: quote, quote, url: value[0].url })),
  derivedAt: new Date('2026-11-01T00:00:00Z'),
});

const topicKeyOf = (value: unknown) =>
  researchTopicsDerivationInputHash(researchPageTextEntriesForTopics(value));

describe('research-topics:rekey-topic-text (#5882)', () => {
  const menuRow = { entityKey: 'synthetic-menu', value: page('menu', [RESEARCH, ...MENU]) };
  const priorValue = page('rotated', [RESEARCH, ...MENU]);
  const rotatedRow = {
    entityKey: 'synthetic-rotated',
    value: page('rotated', [RESEARCH, ...ROTATED_MENU]),
    priorValues: [priorValue],
  };
  const rewrittenRow = {
    entityKey: 'synthetic-rewritten',
    value: page('rewritten', ['The lab now studies seagrass meadows and their blue carbon.']),
    priorValues: [page('rewritten', [RESEARCH, ...MENU])],
  };
  const cleanRow = { entityKey: 'synthetic-clean', value: page('clean', [RESEARCH]) };
  const listedRow = { entityKey: 'synthetic-listed', value: page('listed', [RESEARCH, CITATION]) };
  const listingOnlyRow = {
    entityKey: 'synthetic-listing-only',
    value: page('listing-only', [RESEARCH, CITATION]),
  };
  const readings = () => [
    readingOf(menuRow.value, ['coastal wetland carbon storage']),
    readingOf(priorValue, ['stable isotope tracing']),
    readingOf(rewrittenRow.priorValues[0], ['coastal wetland carbon storage']),
    readingOf(cleanRow.value, ['coastal wetland carbon storage']),
    readingOf(listedRow.value, ['coastal wetland carbon storage', 'Salt marsh methane fluxes']),
    readingOf(listingOnlyRow.value, ['Salt marsh methane fluxes']),
  ];
  const rows = [menuRow, rotatedRow, rewrittenRow, cleanRow, listedRow, listingOnlyRow];

  it('plans copies from the current text and from an equal prior text, writing nothing', async () => {
    const { store, inserted } = memoryStore(readings());
    const report = await rekeyResearchTopicsToTopicText({ rows, store, apply: false });

    expect(inserted).toEqual([]);
    expect(report.rows.map((row) => [row.entityKey, row.outcome, row.readingSource])).toEqual([
      ['synthetic-menu', 'would-rekey', 'current-text'],
      ['synthetic-rotated', 'would-rekey', 'prior-text'],
      ['synthetic-rewritten', 'no-reading', undefined],
      ['synthetic-clean', 'unchanged-key', undefined],
      ['synthetic-listed', 'would-rekey', 'current-text'],
      ['synthetic-listing-only', 'held', 'current-text'],
    ]);
    expect(report).toMatchObject({
      rowsRead: 6,
      wouldRekey: 3,
      fromCurrentText: 2,
      fromPriorText: 1,
      noReading: 1,
      unchangedKey: 1,
      topicsIdentical: 2,
      topicsTrimmed: 1,
      held: 1,
      heldLostAll: 1,
      heldChanged: 0,
      gates: { lostAll: 0, changed: 0 },
    });
    expect(report.rows[4].droppedTopics).toEqual(['Salt marsh methane fluxes']);
  });

  it('copies on apply, never a held row, and plans nothing on a rerun', async () => {
    const { store, inserted } = memoryStore(readings());
    const applied = await rekeyResearchTopicsToTopicText({ rows, store, apply: true });

    expect(applied.rekeyed).toBe(3);
    expect(inserted.map((record) => record.inputHash)).toEqual([
      topicKeyOf(menuRow.value),
      topicKeyOf(rotatedRow.value),
      topicKeyOf(listedRow.value),
    ]);
    expect(inserted[1].extractedTopics).toEqual(readings()[1].extractedTopics);
    expect(inserted.map((record) => record.inputHash)).not.toContain(
      topicKeyOf(listingOnlyRow.value),
    );

    const rerun = await rekeyResearchTopicsToTopicText({ rows, store, apply: false });
    expect(rerun.wouldRekey).toBe(0);
    expect(rerun.alreadyRekeyed).toBe(3);
  });

  it('requires the confirm flag to apply', () => {
    expect(() => parseRekeyTopicTextArgs(['--apply'])).toThrow(REKEY_TOPIC_TEXT_CONFIRM_FLAG);
    expect(parseRekeyTopicTextArgs(['--apply', REKEY_TOPIC_TEXT_CONFIRM_FLAG])).toMatchObject({
      apply: true,
    });
    expect(parseRekeyTopicTextArgs([])).toMatchObject({ apply: false });
    expect(() => parseRekeyTopicTextArgs(['--all'])).toThrow();
  });
});

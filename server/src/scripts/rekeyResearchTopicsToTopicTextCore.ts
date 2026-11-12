import { researchTopicsDerivationInputHash } from '../scrapers/researchPageTopicsDerivation';
import { derivePageQuotedResearchTopics } from '../scrapers/utils/pageQuotedResearchTopics';
import {
  researchPageTextEntries,
  researchPageTextEntriesForTopics,
  researchPageTextEntriesWithoutChrome,
  type ResearchPageTextEntry,
} from '../scrapers/utils/researchPageText';
import type { ResearchTopicsDerivationRecord } from './deriveResearchTopicsCore';
import type {
  RekeyResearchTopicsStore,
  RekeyTopicEffect,
} from './rekeyResearchTopicsToStrippedTextCore';

export const REKEY_TOPIC_TEXT_CONFIRM_FLAG = '--confirm-research-topics-topic-text-rekey';

export interface RekeyTopicTextArgs {
  apply: boolean;
  confirm: boolean;
  offset: number;
  limit?: number;
  output?: string;
}

const nonNegativeInteger = (flag: string, raw: string): number => {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) throw new Error(`${flag} needs a whole number.`);
  return value;
};

export function parseRekeyTopicTextArgs(argv: readonly string[]): RekeyTopicTextArgs {
  const args: RekeyTopicTextArgs = { apply: false, confirm: false, offset: 0 };
  for (const arg of argv) {
    if (arg === '--') continue;
    if (arg === '--apply') args.apply = true;
    else if (arg === '--dry-run') args.apply = false;
    else if (arg === REKEY_TOPIC_TEXT_CONFIRM_FLAG) args.confirm = true;
    else if (arg.startsWith('--offset=')) {
      args.offset = nonNegativeInteger('--offset', arg.slice('--offset='.length));
    } else if (arg.startsWith('--limit=')) {
      args.limit = nonNegativeInteger('--limit', arg.slice('--limit='.length));
    } else if (arg.startsWith('--output=')) args.output = arg.slice('--output='.length);
    else throw new Error(`Unknown research-topics:rekey-topic-text argument: ${arg}`);
  }
  if (args.apply && !args.confirm) {
    throw new Error(`${REKEY_TOPIC_TEXT_CONFIRM_FLAG} is required with --apply.`);
  }
  return args;
}

export interface TopicTextRekeyRow {
  entityKey?: string;
  entityId?: string;
  value: unknown;
  /** Superseded page-text values of the same row, newest first. */
  priorValues?: readonly unknown[];
}

/** One chunk of the rows in load order, so a long apply can run as several short processes. */
export function topicTextRekeyChunk<T>(
  rows: readonly T[],
  args: Pick<RekeyTopicTextArgs, 'offset' | 'limit'>,
): T[] {
  return rows.slice(args.offset, args.limit === undefined ? undefined : args.offset + args.limit);
}

export type TopicTextRekeyOutcome =
  | 'unchanged-key'
  | 'all-chrome'
  | 'already-rekeyed'
  | 'no-reading'
  | 'held'
  | 'would-rekey'
  | 'rekeyed';

export type TopicTextReadingSource = 'current-text' | 'prior-text';

export interface TopicTextRekeyRowReport {
  entityKey?: string;
  entityId?: string;
  outcome: TopicTextRekeyOutcome;
  readingSource?: TopicTextReadingSource;
  topicEffect?: RekeyTopicEffect;
  droppedTopics?: string[];
}

export interface RekeyTopicTextReport {
  rowsRead: number;
  unchangedKey: number;
  allChrome: number;
  alreadyRekeyed: number;
  noReading: number;
  held: number;
  wouldRekey: number;
  rekeyed: number;
  fromCurrentText: number;
  fromPriorText: number;
  topicsIdentical: number;
  topicsTrimmed: number;
  /** Rows the copy would have emptied or changed; they are held, never written. */
  heldLostAll: number;
  heldChanged: number;
  /** Over the rows planned for a copy, so both read 0 by construction. */
  gates: { lostAll: number; changed: number };
  rows: TopicTextRekeyRowReport[];
}

const topicEffect = (before: readonly string[], after: readonly string[]): RekeyTopicEffect => {
  if (before.join('\n') === after.join('\n')) return 'identical';
  if (before.length > 0 && after.length === 0) return 'lost-all';
  return after.every((topic) => before.includes(topic)) ? 'trimmed' : 'changed';
};

const keyOf = (pages: readonly ResearchPageTextEntry[]) => researchTopicsDerivationInputHash(pages);

interface ReadingCandidate {
  source: TopicTextReadingSource;
  pages: ResearchPageTextEntry[];
}

/**
 * The texts whose reading may serve the topic-text key: the current text under the chrome
 * strip the materializer read until now, then each superseded text that is the same text
 * under the topic helper, read under the chrome strip and raw, as readings were keyed before
 * #5577's re-key.
 */
function readingCandidates(row: TopicTextRekeyRow, topicKey: string): ReadingCandidate[] {
  const candidates: ReadingCandidate[] = [
    { source: 'current-text', pages: researchPageTextEntriesWithoutChrome(row.value) },
  ];
  for (const prior of row.priorValues ?? []) {
    const priorTopicPages = researchPageTextEntriesForTopics(prior);
    if (priorTopicPages.length === 0 || keyOf(priorTopicPages) !== topicKey) continue;
    candidates.push(
      { source: 'prior-text', pages: researchPageTextEntriesWithoutChrome(prior) },
      { source: 'prior-text', pages: researchPageTextEntries(prior) },
    );
  }
  return candidates.filter((candidate) => candidate.pages.length > 0);
}

async function firstReading(
  candidates: readonly ReadingCandidate[],
  store: RekeyResearchTopicsStore,
): Promise<{ reading: ResearchTopicsDerivationRecord; candidate: ReadingCandidate } | null> {
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const key = keyOf(candidate.pages);
    if (seen.has(key)) continue;
    seen.add(key);
    const reading = await store.find(key);
    if (reading) return { reading, candidate };
  }
  return null;
}

/**
 * `research-topics:rekey-topic-text` (#5882): copies each row's existing topic reading to the
 * key of its text under `researchPageTextEntriesForTopics`, so moving the topic reading onto
 * that helper withdraws no topic and makes no model call. A row whose current text has no
 * reading takes its previous text's reading when the two texts are equal under the helper,
 * which is what a page-text re-observation that only rotated menu lines looks like. A copy
 * that would empty or change the row's topics is held rather than written.
 */
export async function rekeyResearchTopicsToTopicText(input: {
  rows: readonly TopicTextRekeyRow[];
  store: RekeyResearchTopicsStore;
  apply: boolean;
}): Promise<RekeyTopicTextReport> {
  const report: RekeyTopicTextReport = {
    rowsRead: input.rows.length,
    unchangedKey: 0,
    allChrome: 0,
    alreadyRekeyed: 0,
    noReading: 0,
    held: 0,
    wouldRekey: 0,
    rekeyed: 0,
    fromCurrentText: 0,
    fromPriorText: 0,
    topicsIdentical: 0,
    topicsTrimmed: 0,
    heldLostAll: 0,
    heldChanged: 0,
    gates: { lostAll: 0, changed: 0 },
    rows: [],
  };
  for (const stored of input.rows) {
    const row: TopicTextRekeyRowReport = {
      ...(stored.entityKey ? { entityKey: stored.entityKey } : {}),
      ...(stored.entityId ? { entityId: stored.entityId } : {}),
      outcome: 'no-reading',
    };
    report.rows.push(row);
    const topicPages = researchPageTextEntriesForTopics(stored.value);
    const topicKey = keyOf(topicPages);
    const strippedPages = researchPageTextEntriesWithoutChrome(stored.value);
    if (topicPages.length === 0) {
      row.outcome = 'all-chrome';
      report.allChrome += 1;
      if (strippedPages.length > 0 && (await input.store.find(keyOf(strippedPages)))) {
        row.topicEffect = 'lost-all';
        report.heldLostAll += 1;
      }
      continue;
    }
    if (await input.store.find(topicKey)) {
      const unchanged = keyOf(strippedPages) === topicKey;
      row.outcome = unchanged ? 'unchanged-key' : 'already-rekeyed';
      if (unchanged) report.unchangedKey += 1;
      else report.alreadyRekeyed += 1;
      continue;
    }
    const found = await firstReading(readingCandidates(stored, topicKey), input.store);
    if (!found) {
      report.noReading += 1;
      continue;
    }
    row.readingSource = found.candidate.source;
    const extraction = {
      topics: found.reading.extractedTopics ?? [],
      field: found.reading.extractedField ?? null,
    };
    const before = derivePageQuotedResearchTopics(extraction, found.candidate.pages).topics;
    const after = derivePageQuotedResearchTopics(extraction, topicPages).topics;
    row.topicEffect = topicEffect(before, after);
    if (row.topicEffect !== 'identical') {
      row.droppedTopics = before.filter((topic) => !after.includes(topic));
    }
    if (row.topicEffect === 'lost-all' || row.topicEffect === 'changed') {
      row.outcome = 'held';
      report.held += 1;
      if (row.topicEffect === 'lost-all') report.heldLostAll += 1;
      else report.heldChanged += 1;
      continue;
    }
    if (row.topicEffect === 'identical') report.topicsIdentical += 1;
    else report.topicsTrimmed += 1;
    if (found.candidate.source === 'current-text') report.fromCurrentText += 1;
    else report.fromPriorText += 1;
    if (input.apply) {
      await input.store.insert({ ...found.reading, inputHash: topicKey });
      row.outcome = 'rekeyed';
      report.rekeyed += 1;
    } else {
      row.outcome = 'would-rekey';
      report.wouldRekey += 1;
    }
  }
  return report;
}

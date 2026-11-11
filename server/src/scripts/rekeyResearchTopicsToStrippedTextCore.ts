import { researchTopicsDerivationInputHash } from '../scrapers/researchPageTopicsDerivation';
import { derivePageQuotedResearchTopics } from '../scrapers/utils/pageQuotedResearchTopics';
import {
  researchPageTextEntries,
  researchPageTextEntriesWithoutChrome,
} from '../scrapers/utils/researchPageText';
import type {
  ResearchTopicsDerivationRecord,
  StoredResearchPageTextRow,
} from './deriveResearchTopicsCore';

export const REKEY_RESEARCH_TOPICS_CONFIRM_FLAG = '--confirm-research-topics-rekey';

export interface RekeyResearchTopicsArgs {
  apply: boolean;
  confirm: boolean;
  output?: string;
}

export function parseRekeyResearchTopicsArgs(argv: readonly string[]): RekeyResearchTopicsArgs {
  const args: RekeyResearchTopicsArgs = { apply: false, confirm: false };
  for (const arg of argv) {
    if (arg === '--') continue;
    if (arg === '--apply') args.apply = true;
    else if (arg === '--dry-run') args.apply = false;
    else if (arg === REKEY_RESEARCH_TOPICS_CONFIRM_FLAG) args.confirm = true;
    else if (arg.startsWith('--output=')) args.output = arg.slice('--output='.length);
    else throw new Error(`Unknown research-topics:rekey-stripped argument: ${arg}`);
  }
  if (args.apply && !args.confirm) {
    throw new Error(`${REKEY_RESEARCH_TOPICS_CONFIRM_FLAG} is required with --apply.`);
  }
  return args;
}

export interface RekeyResearchTopicsStore {
  find(inputHash: string): Promise<ResearchTopicsDerivationRecord | null>;
  insert(record: ResearchTopicsDerivationRecord): Promise<void>;
}

export type RekeyRowOutcome =
  'unchanged-text' | 'all-chrome' | 'already-rekeyed' | 'no-reading' | 'rekeyed' | 'would-rekey';

export type RekeyTopicEffect = 'identical' | 'trimmed' | 'lost-all' | 'changed';

export interface RekeyRowReport {
  entityKey?: string;
  entityId?: string;
  outcome: RekeyRowOutcome;
  topicEffect?: RekeyTopicEffect;
  droppedTopics?: string[];
}

export interface RekeyResearchTopicsReport {
  rowsRead: number;
  unchangedText: number;
  allChrome: number;
  alreadyRekeyed: number;
  noReading: number;
  rekeyed: number;
  wouldRekey: number;
  topicsIdentical: number;
  topicsTrimmed: number;
  topicsLostAll: number;
  topicsChanged: number;
  rows: RekeyRowReport[];
}

const topicEffect = (before: readonly string[], after: readonly string[]): RekeyTopicEffect => {
  if (before.join('\n') === after.join('\n')) return 'identical';
  if (before.length > 0 && after.length === 0) return 'lost-all';
  return after.every((topic) => before.includes(topic)) ? 'trimmed' : 'changed';
};

export async function rekeyResearchTopicsToStrippedText(input: {
  rows: readonly StoredResearchPageTextRow[];
  store: RekeyResearchTopicsStore;
  apply: boolean;
}): Promise<RekeyResearchTopicsReport> {
  const report: RekeyResearchTopicsReport = {
    rowsRead: input.rows.length,
    unchangedText: 0,
    allChrome: 0,
    alreadyRekeyed: 0,
    noReading: 0,
    rekeyed: 0,
    wouldRekey: 0,
    topicsIdentical: 0,
    topicsTrimmed: 0,
    topicsLostAll: 0,
    topicsChanged: 0,
    rows: [],
  };
  for (const stored of input.rows) {
    const row: RekeyRowReport = {
      ...(stored.entityKey ? { entityKey: stored.entityKey } : {}),
      ...(stored.entityId ? { entityId: stored.entityId } : {}),
      outcome: 'unchanged-text',
    };
    report.rows.push(row);
    const rawPages = researchPageTextEntries(stored.value);
    const strippedPages = researchPageTextEntriesWithoutChrome(stored.value);
    const rawKey = researchTopicsDerivationInputHash(rawPages);
    const strippedKey = researchTopicsDerivationInputHash(strippedPages);
    if (rawKey === strippedKey) {
      report.unchangedText += 1;
      continue;
    }
    if (strippedPages.length === 0) {
      // All-chrome rows share one empty-text key that the materializer never reads.
      row.outcome = 'all-chrome';
      report.allChrome += 1;
      if (await input.store.find(rawKey)) {
        row.topicEffect = 'lost-all';
        report.topicsLostAll += 1;
      }
      continue;
    }
    if (await input.store.find(strippedKey)) {
      row.outcome = 'already-rekeyed';
      report.alreadyRekeyed += 1;
      continue;
    }
    const reading = await input.store.find(rawKey);
    if (!reading) {
      row.outcome = 'no-reading';
      report.noReading += 1;
      continue;
    }
    const extraction = {
      topics: reading.extractedTopics ?? [],
      field: reading.extractedField ?? null,
    };
    const before = derivePageQuotedResearchTopics(extraction, rawPages).topics;
    const after = derivePageQuotedResearchTopics(extraction, strippedPages).topics;
    row.topicEffect = topicEffect(before, after);
    if (row.topicEffect !== 'identical') {
      row.droppedTopics = before.filter((topic) => !after.includes(topic));
    }
    if (row.topicEffect === 'identical') report.topicsIdentical += 1;
    else if (row.topicEffect === 'trimmed') report.topicsTrimmed += 1;
    else if (row.topicEffect === 'lost-all') report.topicsLostAll += 1;
    else report.topicsChanged += 1;
    if (input.apply) {
      await input.store.insert({ ...reading, inputHash: strippedKey });
      row.outcome = 'rekeyed';
      report.rekeyed += 1;
    } else {
      row.outcome = 'would-rekey';
      report.wouldRekey += 1;
    }
  }
  return report;
}

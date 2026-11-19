import fs from 'fs';
import path from 'path';
import type { OwnerLeadLabel, OwnerLeadVerdict } from './laneScorecardCore';

export const LEAD_BALLOT_FILE = 'ballot.md';
export const LEAD_BALLOT_KEY_FILE = 'key.json';

export interface LeadBallotKeyItem {
  item: number;
  entityKey: string;
  personId: string;
}

export interface LeadBallotKey {
  benchmarkId: string;
  seed: string;
  items: LeadBallotKeyItem[];
}

export interface OwnerLeadBallot {
  benchmarkId: string;
  items: number;
  marked: number;
  unmarked: number[];
  labels: OwnerLeadLabel[];
}

const BOX_VERDICTS: ReadonlyArray<[string, OwnerLeadVerdict]> = [
  ['correct lead', 'correct_lead'],
  ['not the lead', 'not_the_lead'],
  ["can't tell", 'cant_tell'],
];

const ITEM_HEADING = /^## Item (\d+)\s*$/gm;

function verdictLines(markdown: string): Map<number, string> {
  const headings = [...markdown.matchAll(ITEM_HEADING)];
  const byItem = new Map<number, string>();
  headings.forEach((heading, index) => {
    const item = Number(heading[1]);
    if (byItem.has(item)) throw new Error(`ballot repeats item ${item}`);
    const section = markdown.slice(heading.index, headings[index + 1]?.index ?? markdown.length);
    const lines = section.split('\n').filter((line) => line.trimStart().startsWith('Verdict:'));
    if (lines.length !== 1) throw new Error(`ballot item ${item} needs exactly one Verdict line`);
    byItem.set(item, lines[0]);
  });
  return byItem;
}

function markedVerdict(item: number, line: string): OwnerLeadVerdict | undefined {
  const checked = BOX_VERDICTS.filter(([wording]) => {
    const box = line.match(new RegExp(`\\[([^\\]]?)\\]\\s*${wording}`, 'i'));
    if (!box) throw new Error(`ballot item ${item} has no "${wording}" box`);
    return box[1].trim() !== '';
  });
  if (checked.length > 1) throw new Error(`ballot item ${item} marks more than one verdict`);
  return checked[0]?.[1];
}

/**
 * Reads the owner's filled ballot against its blind key. Every keyed item must appear
 * exactly once, an item may mark at most one box, and an unmarked item is left unlabelled
 * rather than read as "can't tell".
 */
export function parseOwnerLeadBallot(markdown: string, key: LeadBallotKey): OwnerLeadBallot {
  const lines = verdictLines(markdown);
  const keyed = new Set(key.items.map((entry) => entry.item));
  for (const item of lines.keys())
    if (!keyed.has(item)) throw new Error(`ballot item ${item} is not in the key`);
  const labels: OwnerLeadLabel[] = [];
  const unmarked: number[] = [];
  for (const entry of [...key.items].sort((a, b) => a.item - b.item)) {
    const line = lines.get(entry.item);
    if (line === undefined) throw new Error(`ballot is missing item ${entry.item}`);
    const ownerVerdict = markedVerdict(entry.item, line);
    if (!ownerVerdict) unmarked.push(entry.item);
    else labels.push({ entityKey: entry.entityKey, personId: entry.personId, ownerVerdict });
  }
  return {
    benchmarkId: key.benchmarkId,
    items: key.items.length,
    marked: labels.length,
    unmarked,
    labels,
  };
}

export function readOwnerLeadBallot(directory: string): OwnerLeadBallot {
  const key = JSON.parse(
    fs.readFileSync(path.join(directory, LEAD_BALLOT_KEY_FILE), 'utf8'),
  ) as LeadBallotKey;
  if (!key?.benchmarkId || !Array.isArray(key.items))
    throw new Error(`${LEAD_BALLOT_KEY_FILE} needs a benchmarkId and items`);
  return parseOwnerLeadBallot(fs.readFileSync(path.join(directory, LEAD_BALLOT_FILE), 'utf8'), key);
}

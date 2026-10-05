import mongoose from 'mongoose';
import { Researcher } from '../models/researcher';
import { surnameFetchRegex, SURNAME_FETCH_LIMIT } from '../scrapers/utils/piNameMatch';
import type { ResearcherPersonNameResolution } from './researcherPersonNameResolver';

export interface StructuredPersonName {
  first?: string;
  middle?: string;
  last?: string;
}

export interface CorroborationCandidate {
  _id: mongoose.Types.ObjectId | string;
  displayName?: string;
  officialProfileUrls: string[];
}

const letters = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');

const nameTokens = (value: string | undefined): string[] =>
  (value ?? '').split(/\s+/).map(letters).filter(Boolean);

function surnameTail(candidateTokens: string[], surnameTokens: string[]): number {
  const joined = surnameTokens.join('');
  for (let start = candidateTokens.length - 1; start >= 1; start--) {
    if (candidateTokens.slice(start).join('') === joined) return start;
  }
  return -1;
}

function givenNameAgrees(candidateGiven: string[], nihGiven: string[]): boolean {
  const meaningful = candidateGiven.filter((token) => token.length > 1);
  const nihJoined = nihGiven.join('');
  return (
    meaningful.some((token) => nihGiven.includes(token)) ||
    (meaningful.length > 0 && meaningful.join('') === nihJoined)
  );
}

function urlLeafPieces(url: string): { pieces: string[]; joined: string } {
  let path = '';
  try {
    path = new URL(url).pathname;
  } catch {
    return { pieces: [], joined: '' };
  }
  const leaf = path.split('/').filter(Boolean).pop() ?? '';
  const pieces = leaf
    .split(/[-_.]+/)
    .map(letters)
    .filter(Boolean);
  return { pieces, joined: pieces.join('') };
}

function profileUrlSpellsPerson(url: string, surnameTokens: string[], nihGiven: string[]): boolean {
  const { pieces, joined } = urlLeafPieces(url);
  if (pieces.length < 2) return false;
  const surname = surnameTokens.join('');
  const namesSurname =
    surnameTokens.every((token) => pieces.includes(token)) || joined.includes(surname);
  const namesGiven =
    nihGiven.some((token) => token.length > 1 && pieces.includes(token)) ||
    nihGiven.some((token) => token.length > 3 && joined.startsWith(token)) ||
    (nihGiven.join('').length > 3 && joined.startsWith(nihGiven.join('')));
  return namesSurname && namesGiven;
}

/**
 * Settles a person the conservative name matcher could not, using a signal independent
 * of the display name: the candidate's own official Yale profile URL must spell the
 * source's surname and one of its given names. A candidate whose display name uses a
 * different given name than any the source records, or whose profile leaf is opaque,
 * is never chosen, and more than one passing candidate refuses (#4893).
 */
export function selectCorroboratedCandidate(
  name: StructuredPersonName,
  candidates: readonly CorroborationCandidate[],
): CorroborationCandidate | 'ambiguous' | undefined {
  const surnameTokens = nameTokens(name.last);
  const nihGiven = [...nameTokens(name.first), ...nameTokens(name.middle)];
  if (surnameTokens.length === 0 || nihGiven.length === 0) return undefined;
  const passing = candidates.filter((candidate) => {
    const tokens = nameTokens(candidate.displayName);
    const tail = surnameTail(tokens, surnameTokens);
    if (tail < 1) return false;
    if (!givenNameAgrees(tokens.slice(0, tail), nihGiven)) return false;
    return candidate.officialProfileUrls.some((url) =>
      profileUrlSpellsPerson(url, surnameTokens, nihGiven),
    );
  });
  if (passing.length > 1) return 'ambiguous';
  return passing[0];
}

async function defaultFindCandidates(surname: string): Promise<CorroborationCandidate[]> {
  const surnameRe = surnameFetchRegex(surname);
  if (!surnameRe) return [];
  const rows = (await Researcher.find(
    { displayName: surnameRe, archived: { $ne: true } },
    { _id: 1, displayName: 1, profileLinks: 1 },
  )
    .limit(SURNAME_FETCH_LIMIT)
    .lean()) as Array<{
    _id: mongoose.Types.ObjectId;
    displayName?: string;
    profileLinks?: Array<{ kind?: string; url?: string; healthStatus?: string }>;
  }>;
  return rows.map((row) => ({
    _id: row._id,
    displayName: row.displayName,
    officialProfileUrls: (row.profileLinks ?? [])
      .filter((link) => link.kind === 'YALE_OFFICIAL' && link.healthStatus !== 'UNAVAILABLE')
      .map((link) => String(link.url ?? ''))
      .filter(Boolean),
  }));
}

export async function resolveResearcherIdByCorroboratedName(
  name: StructuredPersonName,
  findCandidates: (surname: string) => Promise<CorroborationCandidate[]> = defaultFindCandidates,
): Promise<ResearcherPersonNameResolution> {
  const surname = (name.last ?? '').trim();
  if (!surname) return { status: 'absent' };
  const chosen = selectCorroboratedCandidate(name, await findCandidates(surname));
  if (chosen === 'ambiguous') return { status: 'ambiguous' };
  if (!chosen) return { status: 'absent' };
  const id = chosen._id;
  return {
    status: 'matched',
    researcherId:
      id instanceof mongoose.Types.ObjectId ? id : new mongoose.Types.ObjectId(String(id)),
  };
}

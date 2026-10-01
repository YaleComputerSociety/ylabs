import type { StudentVisibilityTier } from '../models/studentVisibility';
import { ENRICH_ONLY_FELLOWSHIP_SOURCES } from '../scrapers/fellowshipSourcePrecedence';

export interface ProgramDuplicateCandidate {
  id: string;
  title?: string;
  description?: string;
  sourceName?: string;
  tier: StudentVisibilityTier | string | undefined;
}

// A CommunityForce fund page is reached through an encrypted query that differs from link
// to link, so one fund carries several FundDetails URLs and the URL cannot identify it
// (#3988). Neither the title nor the description can identify a fund alone: distinct funds
// share titles, and each residential college's copy of a fund shares one description word
// for word, differing only in the college its title names. The two together can.
const MIN_IDENTIFYING_DESCRIPTION_LENGTH = 80;
const PHRASE_LENGTH = 5;
const MIN_IDENTIFYING_PHRASES = 12;
const MIN_SHARED_PHRASE_RATIO = 0.8;

const normalizedText = (value: unknown): string =>
  String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

export function programFundTitleKey(title: unknown): string {
  return normalizedText(
    String(title || '')
      .replace(/&/g, ' and ')
      .replace(/['’]/g, ''),
  ).replace(/^the /, '');
}

function descriptionPhrases(description: string): Set<string> {
  const words = description.split(' ').filter(Boolean);
  const phrases = new Set<string>();
  for (let index = 0; index + PHRASE_LENGTH <= words.length; index += 1) {
    phrases.add(words.slice(index, index + PHRASE_LENGTH).join(' '));
  }
  return phrases;
}

interface FundDescription {
  text: string;
  phrases: Set<string>;
}

const fundDescription = (value: unknown): FundDescription => {
  const text = normalizedText(value);
  return { text, phrases: descriptionPhrases(text) };
};

// One lane stores the fund's own paragraph and another the page around it, so the same fund
// is recognised when the shorter description is the longer one, or nearly all of its
// phrases recur there.
function sameFundDescription(a: FundDescription, b: FundDescription): boolean {
  const [shorter, longer] = a.text.length <= b.text.length ? [a, b] : [b, a];
  if (shorter.text.length < MIN_IDENTIFYING_DESCRIPTION_LENGTH) return false;
  if (shorter.text === longer.text) return true;
  if (shorter.phrases.size < MIN_IDENTIFYING_PHRASES) return false;
  let shared = 0;
  for (const phrase of shorter.phrases) if (longer.phrases.has(phrase)) shared += 1;
  return shared / shorter.phrases.size >= MIN_SHARED_PHRASE_RATIO;
}

const TIER_PREFERENCE: Record<string, number> = {
  student_ready: 0,
  limited_but_safe: 1,
  operator_review: 2,
  suppressed: 3,
};

const tierPreference = (tier: unknown): number => TIER_PREFERENCE[String(tier)] ?? 4;

const ownerPreference = (sourceName: unknown): number =>
  ENRICH_ONLY_FELLOWSHIP_SOURCES.has(String(sourceName || '')) ? 1 : 0;

function preferredCopy(a: ProgramDuplicateCandidate, b: ProgramDuplicateCandidate): number {
  return (
    tierPreference(a.tier) - tierPreference(b.tier) ||
    ownerPreference(a.sourceName) - ownerPreference(b.sourceName) ||
    a.id.localeCompare(b.id)
  );
}

function fundsAmongSameTitleCopies(
  copies: readonly ProgramDuplicateCandidate[],
): ProgramDuplicateCandidate[][] {
  const descriptions = copies.map((copy) => fundDescription(copy.description));
  const fundOf = copies.map((_, index) => index);
  const root = (index: number): number => {
    while (fundOf[index] !== index) index = fundOf[index];
    return index;
  };
  for (let a = 0; a < copies.length; a += 1) {
    for (let b = a + 1; b < copies.length; b += 1) {
      if (sameFundDescription(descriptions[a], descriptions[b])) fundOf[root(b)] = root(a);
    }
  }
  const funds = new Map<number, ProgramDuplicateCandidate[]>();
  copies.forEach((copy, index) => {
    const fund = funds.get(root(index));
    if (fund) fund.push(copy);
    else funds.set(root(index), [copy]);
  });
  return [...funds.values()];
}

/**
 * Maps each redundant copy of a fund to the copy that is served in its place. The kept copy
 * is the one most fit to serve on its own, then the one an owning lane holds rather than the
 * enrich-only catalog, then the oldest row.
 */
export function selectDuplicateProgramCopies(
  programs: readonly ProgramDuplicateCandidate[],
): Map<string, string> {
  const copiesByTitle = new Map<string, ProgramDuplicateCandidate[]>();
  for (const program of programs) {
    const title = programFundTitleKey(program.title);
    if (!title) continue;
    const copies = copiesByTitle.get(title);
    if (copies) copies.push(program);
    else copiesByTitle.set(title, [program]);
  }

  const keptCopyById = new Map<string, string>();
  for (const copies of copiesByTitle.values()) {
    if (copies.length < 2) continue;
    for (const fund of fundsAmongSameTitleCopies(copies)) {
      if (fund.length < 2) continue;
      const [kept, ...redundant] = [...fund].sort(preferredCopy);
      for (const copy of redundant) keptCopyById.set(copy.id, kept.id);
    }
  }
  return keptCopyById;
}

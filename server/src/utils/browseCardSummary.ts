// Mirrors `cardSummary` in `client/src/utils/cardSummary.ts`; changing the rules
// here requires updating that copy. `contracts/browseCardSummary.cases.json` pins
// both, because the server cannot import a client util (its typecheck has no DOM).
const BROWSE_CARD_SUMMARY_MAX_CHARACTERS = 200;
const ELLIPSIS = '…';

const NON_TERMINAL_ABBREVIATIONS = new Set([
  'dr',
  'mr',
  'mrs',
  'ms',
  'prof',
  'st',
  'vs',
  'al',
  'eg',
  'ie',
  'etc',
  'inc',
  'jr',
  'sr',
  'no',
  'fig',
  'u.s',
]);

const isSentenceBoundary = (text: string, periodIndex: number): boolean => {
  const before = text.slice(0, periodIndex);
  const lastWord = (before.match(/([A-Za-z.]+)$/)?.[1] || '').toLowerCase();
  const normalizedWord = lastWord.replace(/\./g, '');
  if (NON_TERMINAL_ABBREVIATIONS.has(lastWord) || NON_TERMINAL_ABBREVIATIONS.has(normalizedWord)) {
    return false;
  }
  return !/^[a-z]$/i.test(normalizedWord);
};

const sentenceEndOffsets = (text: string): number[] => {
  const offsets: number[] = [];
  const boundary = /[.!?](?=\s+["'([]?[A-Z0-9])/g;
  let match: RegExpExecArray | null;
  while ((match = boundary.exec(text)) !== null) {
    if (match[0] !== '.' || isSentenceBoundary(text, match.index)) {
      offsets.push(match.index + 1);
    }
  }
  return offsets;
};

export const browseCardSummary = (
  value: string | undefined,
  maxCharacters: number = BROWSE_CARD_SUMMARY_MAX_CHARACTERS,
): string => {
  const text = (value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= maxCharacters) return text;

  const lastFittingSentenceEnd = sentenceEndOffsets(text)
    .filter((offset) => offset <= maxCharacters)
    .pop();
  if (lastFittingSentenceEnd) {
    return text.slice(0, lastFittingSentenceEnd);
  }

  const cut = text.slice(0, maxCharacters - 1);
  const lastSpace = cut.lastIndexOf(' ');
  const wordBoundaryCut = lastSpace > 0 ? cut.slice(0, lastSpace) : cut;
  return `${wordBoundaryCut.replace(/[\s,;:.-]+$/, '')}${ELLIPSIS}`;
};

export const browseCardIsCutMidSentence = (card: string): boolean => card.endsWith(ELLIPSIS);

const SIX_WORDS = 6;

export const browseCardHasSixWordsOrFewer = (card: string): boolean => {
  const words = card.split(/\s+/).filter(Boolean).length;
  return words > 0 && words <= SIX_WORDS;
};

import { readFileSync } from 'fs';
import { createRequire } from 'module';

const requireFromHere = createRequire(import.meta.url);

const LOWERCASE_ASCII_WORD = /^[a-z]+$/;

interface SortedWordList {
  text: string;
  starts: Uint32Array;
}

let wordList: SortedWordList | null = null;

// The list is about 275,000 words. Held as one string plus word offsets it costs about
// 4MB of heap, where a Set of the same words costs about 24MB.
const loadWordList = (): SortedWordList => {
  const listPath = requireFromHere.resolve('an-array-of-english-words');
  const words = (JSON.parse(readFileSync(listPath, 'utf8')) as unknown[])
    .filter((word): word is string => typeof word === 'string' && LOWERCASE_ASCII_WORD.test(word))
    .sort();
  const starts = new Uint32Array(words.length + 1);
  let offset = 0;
  words.forEach((word, index) => {
    starts[index] = offset;
    offset += word.length;
  });
  starts[words.length] = offset;
  return { text: words.join(''), starts };
};

export const isEnglishDictionaryWord = (word: string): boolean => {
  if (!LOWERCASE_ASCII_WORD.test(word)) return false;
  wordList ??= loadWordList();
  const { text, starts } = wordList;
  let low = 0;
  let high = starts.length - 2;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const candidate = text.slice(starts[middle], starts[middle + 1]);
    if (candidate === word) return true;
    if (candidate < word) low = middle + 1;
    else high = middle - 1;
  }
  return false;
};

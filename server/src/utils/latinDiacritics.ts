const UNDECOMPOSABLE_LATIN_LETTERS: Record<string, string> = {
  ı: 'i',
  ø: 'o',
  ł: 'l',
  đ: 'd',
  ð: 'd',
  ħ: 'h',
  ß: 'ss',
  æ: 'ae',
  œ: 'oe',
  þ: 'th',
};

export const foldLatinDiacritics = (value: string): string =>
  value
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/[ıøłđðħßæœþ]/g, (letter) => UNDECOMPOSABLE_LATIN_LETTERS[letter]);

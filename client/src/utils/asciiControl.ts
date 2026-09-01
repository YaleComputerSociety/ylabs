export const isAsciiControlCode = (code: number): boolean => code <= 0x1f || code === 0x7f;

export const containsAsciiControl = (value: string): boolean =>
  Array.from(value).some((character) => isAsciiControlCode(character.charCodeAt(0)));

export const replaceAsciiControls = (value: string, replacement: string): string =>
  Array.from(value, (character) =>
    isAsciiControlCode(character.charCodeAt(0)) ? replacement : character,
  ).join('');

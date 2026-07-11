import { isAsciiControlCode } from './asciiControl';

const startsWithSpreadsheetFormula = (value: string): boolean => {
  const prefixIndex = Array.from(value).findIndex((character) => {
    const code = character.charCodeAt(0);
    return !isAsciiControlCode(code) && !/\s/.test(character);
  });
  const firstContentCharacter = prefixIndex === -1 ? '' : Array.from(value)[prefixIndex];
  return (
    firstContentCharacter === '=' ||
    firstContentCharacter === '+' ||
    firstContentCharacter === '-' ||
    firstContentCharacter === '@'
  );
};

export function safeSpreadsheetCell(value: unknown): string {
  const text = String(value ?? '');
  return startsWithSpreadsheetFormula(text) ? `'${text}` : text;
}

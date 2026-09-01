import { isAsciiControlCode } from './asciiControl';

const startsWithSpreadsheetFormula = (value: string): boolean => {
  const characters = Array.from(value);
  const firstContentCharacter = characters.find((character) => {
    const code = character.charCodeAt(0);
    return !isAsciiControlCode(code) && !/\s/.test(character);
  });
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

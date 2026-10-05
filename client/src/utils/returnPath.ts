import { isAsciiControlCode } from './asciiControl';

const MAX_RETURN_PATH_LENGTH = 2048;

const hasUnsafeReturnPathCharacter = (value: string): boolean =>
  Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return isAsciiControlCode(code) || code === 0x20 || character === '\\';
  });

export const normalizeReturnPath = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_RETURN_PATH_LENGTH) return '';
  if (hasUnsafeReturnPathCharacter(trimmed)) return '';

  try {
    const url = new URL(trimmed, window.location.origin);
    if (url.origin !== window.location.origin) return '';
    const path = `${url.pathname}${url.search}${url.hash}`;
    if (!path.startsWith('/') || path.startsWith('//')) return '';
    if (/^\/%(?:2f|5c)/i.test(path) || /%(?:0a|0d)/i.test(path)) return '';
    return path;
  } catch {
    return '';
  }
};

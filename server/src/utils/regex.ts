const SPECIAL = /[.*+?^${}()|[\]\\]/g;

export const escapeRegex = (value: string): string => value.replace(SPECIAL, '\\$&');

const MAX_SEARCH_LEN = 100;

export const buildSafeSearchRegex = (input: string, options = 'i') => ({
  $regex: escapeRegex(input.slice(0, MAX_SEARCH_LEN)),
  $options: options,
});

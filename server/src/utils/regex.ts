const SPECIAL = /[.*+?^${}()|[\]\\]/g;
const SAFE_REGEX_OPTIONS = new Set(['i', 'm', 's', 'x']);

export const escapeRegex = (value: string): string => value.replace(SPECIAL, '\\$&');

const MAX_SEARCH_LEN = 100;

const normalizeRegexOptions = (options: string): string => {
  const normalized = Array.from(new Set(options.split('')))
    .filter((option) => SAFE_REGEX_OPTIONS.has(option))
    .join('');
  return normalized || 'i';
};

export const buildSafeSearchRegex = (input: string, options = 'i') => ({
  $regex: escapeRegex(input.trim().slice(0, MAX_SEARCH_LEN)),
  $options: normalizeRegexOptions(options),
});

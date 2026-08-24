const MIN_COMMAS_FOR_SPLIT = 2;

const ENUMERATION_CONJUNCTION_PATTERN = /(?:^|\s)(?:and|or)(?:\s|$)|&/i;

const COLON_ELABORATION_PATTERN = /:/;

export function splitDelimitedResearchArea(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed) return [];

  const commaCount = (trimmed.match(/,/g) || []).length;
  if (commaCount < MIN_COMMAS_FOR_SPLIT) return [trimmed];
  if (ENUMERATION_CONJUNCTION_PATTERN.test(trimmed)) return [trimmed];
  if (COLON_ELABORATION_PATTERN.test(trimmed)) return [trimmed];

  return trimmed
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

export function normalizeResearchAreaList(values: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    if (typeof value !== 'string') continue;
    for (const part of splitDelimitedResearchArea(value)) {
      const key = part.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(part);
    }
  }

  return out;
}

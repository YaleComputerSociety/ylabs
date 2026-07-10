export const normalizeText = (value) => String(value || '').replace(/\s+/g, ' ').trim();

export function hasExpectedEntityName(expectedName, bodyText, ui = {}) {
  const expected = normalizeText(expectedName).toLowerCase();
  if (!expected) return true;

  const searchableText = normalizeText([bodyText, ui.h1, ui.title].filter(Boolean).join(' '))
    .toLowerCase();
  return searchableText.includes(expected);
}

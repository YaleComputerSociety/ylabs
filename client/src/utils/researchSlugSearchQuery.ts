const SLUG_SOURCE_PREFIX_TOKENS = new Set([
  'ysm',
  'yse',
  'ysph',
  'dept',
  'faculty',
  'research',
  'area',
  'nih',
  'nsf',
  'pi',
  'bbs',
]);

const MAX_QUERY_WORDS = 6;
const MAX_WORD_LENGTH = 40;

const decodedSlug = (slug: string): string => {
  try {
    return decodeURIComponent(slug);
  } catch {
    return '';
  }
};

export const searchQueryFromResearchSlug = (slug: string | undefined): string => {
  if (!slug) return '';
  const words = decodedSlug(slug)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 1 && word.length <= MAX_WORD_LENGTH && !/^\d+$/.test(word));
  const firstContentWord = words.findIndex((word) => !SLUG_SOURCE_PREFIX_TOKENS.has(word));
  if (firstContentWord === -1) return '';
  const departmentCodeFollowsDept = words[0] === 'dept' && firstContentWord === 1;
  const contentWords = words.slice(firstContentWord + (departmentCodeFollowsDept ? 1 : 0));
  return contentWords.slice(0, MAX_QUERY_WORDS).join(' ');
};

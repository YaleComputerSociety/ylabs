const NAME_SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'md', 'phd', 'mph', 'dphil']);

const nameTokens = (name: string): string[] =>
  name
    .replace(/\([^)]*\)/g, ' ')
    .split(/[\s,]+/)
    .map((token) => token.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, ''))
    .filter(Boolean);

const isSuffix = (token: string): boolean => NAME_SUFFIXES.has(token.toLowerCase());

export const personInitials = (name: string): string => {
  const tokens = nameTokens(name);
  if (tokens.length === 0) return '';
  const first = tokens[0];
  const surnameCandidates = tokens.slice(1).filter((token) => !isSuffix(token));
  const last = surnameCandidates[surnameCandidates.length - 1];
  return `${first.charAt(0)}${last ? last.charAt(0) : ''}`.toUpperCase();
};

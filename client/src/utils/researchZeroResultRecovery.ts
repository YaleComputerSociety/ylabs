export const relaxResearchQuery = (query: string): string | null => {
  const terms = query.trim().split(/\s+/).filter(Boolean);
  if (terms.length < 2) return null;
  return terms.slice(0, -1).join(' ');
};

const tokenizeForOverlap = (value: string): Set<string> =>
  new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length > 1),
  );

const sharedTokenCount = (a: Set<string>, b: Set<string>): number => {
  let count = 0;
  a.forEach((token) => {
    if (b.has(token)) count += 1;
  });
  return count;
};

export const suggestCorpusResearchAreas = (
  areas: Array<{ name: string }>,
  query: string,
  excluded: string[] = [],
  limit = 6,
): string[] => {
  const trimmedQuery = query.trim().toLowerCase();
  const excludedKeys = new Set(
    [...excluded, trimmedQuery]
      .map((value) => value.trim().toLowerCase())
      .filter((value) => value.length > 0),
  );
  const queryTokens = tokenizeForOverlap(query);
  const seen = new Set<string>();
  const candidates: Array<{ name: string; score: number }> = [];

  for (const area of areas) {
    const name = (area?.name || '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (excludedKeys.has(key) || seen.has(key)) continue;
    seen.add(key);
    candidates.push({ name, score: sharedTokenCount(tokenizeForOverlap(name), queryTokens) });
  }

  return candidates
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, Math.max(0, limit))
    .map((candidate) => candidate.name);
};

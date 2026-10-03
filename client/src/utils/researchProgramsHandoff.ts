const PROGRAMS_INTENT_WORDS = new Set([
  'freshman',
  'freshmen',
  'sophomore',
  'sophomores',
  'beginner',
  'beginners',
  'paid',
  'stipend',
  'stipends',
  'summer',
  'funding',
  'funded',
  'fellowship',
  'fellowships',
  'internship',
  'internships',
  'scholarship',
  'scholarships',
  'grant',
  'grants',
]);

const PROGRAMS_INTENT_PHRASES = [
  'first year',
  'no experience',
  'without experience',
  'get started',
  'getting started',
  'how to start',
  'for credit',
];

const queryWords = (query: string): string[] =>
  query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

export const queryCarriesProgramsIntent = (query: string): boolean => {
  const words = queryWords(query);
  if (words.some((word) => PROGRAMS_INTENT_WORDS.has(word))) return true;
  const spaced = ` ${words.join(' ')} `;
  return PROGRAMS_INTENT_PHRASES.some((phrase) => spaced.includes(` ${phrase} `));
};

export const PROGRAMS_QUERY_PARAM = 'q';

export const programsSearchHref = (query: string): string => {
  const trimmed = query.trim();
  if (!trimmed) return '/programs';
  return `/programs?${new URLSearchParams({ [PROGRAMS_QUERY_PARAM]: trimmed }).toString()}`;
};

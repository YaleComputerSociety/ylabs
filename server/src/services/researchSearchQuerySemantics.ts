export interface ResearchSearchQuerySemantics {
  originalQuery: string;
  normalizedQuery: string;
  phrases: string[];
  concepts: string[];
  methods: string[];
  expansionQueries: string[];
}

interface QuerySemanticRule {
  terms: string[];
  concepts: string[];
  methods: string[];
  expansions: string[];
}

const QUERY_SEMANTIC_RULES: QuerySemanticRule[] = [
  {
    terms: ['wet lab', 'bench research', 'experimental biology'],
    concepts: ['biomedical research'],
    methods: ['wet lab'],
    expansions: [
      'molecular biology',
      'cell biology',
      'bench research',
      'biology chemistry neuroscience',
    ],
  },
  {
    terms: ['archival research', 'archives', 'archive research'],
    concepts: ['archives and collections'],
    methods: ['archival research'],
    expansions: [
      'archives',
      'archival',
      'manuscripts',
      'special collections',
      'library collections',
      'museum collections',
      'curatorial',
      'rare books',
      'primary sources',
      'oral history',
      'material culture',
    ],
  },
  {
    terms: ['digital humanities'],
    concepts: ['digital humanities'],
    methods: ['computational text analysis'],
    expansions: [
      'digital humanities',
      'computational text analysis',
      'archives collections',
    ],
  },
  {
    terms: ['climate policy'],
    concepts: ['climate policy'],
    methods: ['policy analysis'],
    expansions: ['climate change', 'environmental policy', 'energy policy'],
  },
  {
    terms: ['public health'],
    concepts: ['public health'],
    methods: ['population health'],
    expansions: ['epidemiology', 'health policy', 'population health prevention'],
  },
  {
    terms: ['social science data'],
    concepts: ['social science data'],
    methods: ['quantitative analysis'],
    expansions: [
      'political science data',
      'economics statistics',
      'survey experiment quantitative',
    ],
  },
  {
    terms: ['machine learning', 'ml', 'ai'],
    concepts: ['machine learning'],
    methods: ['computational modeling'],
    expansions: ['artificial intelligence', 'data science', 'statistical learning'],
  },
];

const normalizeSearchText = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const normalizedTokens = (value: string): string[] =>
  normalizeSearchText(value).split(/\s+/).filter(Boolean);

const matchesTerm = (normalizedQuery: string, queryTokens: string[], term: string): boolean => {
  const normalizedTerm = normalizeSearchText(term);
  if (!normalizedTerm) return false;
  const termTokens = normalizedTokens(normalizedTerm);
  if (termTokens.length <= 1 && normalizedTerm.length <= 2) {
    return queryTokens.includes(normalizedTerm);
  }
  return normalizedQuery.includes(normalizedTerm);
};

const unique = (values: string[]): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const value of values) {
    const trimmed = value.trim();
    const normalized = normalizeSearchText(trimmed);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(trimmed);
  }

  return out;
};

export function buildResearchSearchQuerySemantics(
  query: string,
): ResearchSearchQuerySemantics {
  const originalQuery = query.trim();
  const normalizedQuery = normalizeSearchText(originalQuery);
  const queryTokens = normalizedTokens(normalizedQuery);
  const matchedRules = QUERY_SEMANTIC_RULES.filter((rule) =>
    rule.terms.some((term) => matchesTerm(normalizedQuery, queryTokens, term)),
  );

  const concepts = unique(matchedRules.flatMap((rule) => rule.concepts));
  const methods = unique(matchedRules.flatMap((rule) => rule.methods));
  const expansions = unique(matchedRules.flatMap((rule) => rule.expansions));

  return {
    originalQuery,
    normalizedQuery,
    phrases: unique([originalQuery, ...matchedRules.flatMap((rule) => rule.terms)]),
    concepts,
    methods,
    expansionQueries: unique([originalQuery, ...expansions]),
  };
}

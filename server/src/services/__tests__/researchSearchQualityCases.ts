export interface ResearchSearchQualityCase {
  query: string;
  expectedConcepts: string[];
  expectedMethods: string[];
  expectedExpansionIncludes: string[];
}

export const RESEARCH_SEARCH_QUALITY_CASES: ResearchSearchQualityCase[] = [
  {
    query: 'wet lab',
    expectedConcepts: ['biomedical research'],
    expectedMethods: ['wet lab'],
    expectedExpansionIncludes: ['molecular biology', 'cell biology', 'bench research'],
  },
  {
    query: 'archival research',
    expectedConcepts: ['archives and collections'],
    expectedMethods: ['archival research'],
    expectedExpansionIncludes: ['manuscripts', 'special collections', 'library collections'],
  },
  {
    query: 'digital humanities',
    expectedConcepts: ['digital humanities'],
    expectedMethods: ['computational text analysis'],
    expectedExpansionIncludes: ['archives', 'collections', 'computational text analysis'],
  },
  {
    query: 'climate policy',
    expectedConcepts: ['climate policy'],
    expectedMethods: ['policy analysis'],
    expectedExpansionIncludes: ['climate change', 'environmental policy', 'energy policy'],
  },
  {
    query: 'public health',
    expectedConcepts: ['public health'],
    expectedMethods: ['population health'],
    expectedExpansionIncludes: ['epidemiology', 'health policy', 'prevention'],
  },
  {
    query: 'social science data',
    expectedConcepts: ['social science data'],
    expectedMethods: ['quantitative analysis'],
    expectedExpansionIncludes: ['survey experiment', 'statistics', 'political science data'],
  },
  {
    query: 'machine learning',
    expectedConcepts: ['machine learning'],
    expectedMethods: ['computational modeling'],
    expectedExpansionIncludes: ['artificial intelligence', 'data science', 'statistical learning'],
  },
];

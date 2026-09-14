import type { ResearchSearchRelevanceCase } from './researchSearchRelevanceCore';

// This repository is public and the corpus is scraped from Yale directories, so a
// case may carry only a query and topical markers. It must never carry expected
// result slugs: a faculty entity slug is person-bearing, and a committed file
// pairing one with a relevance judgement is exactly the pairing
// docs/person-identifier-convention.md forbids. Person-name coverage therefore
// comes from surnames the CLI samples from the corpus at run time.
export const RESEARCH_SEARCH_RELEVANCE_CASES: readonly ResearchSearchRelevanceCase[] = [
  {
    label: 'topic-machine-learning',
    queryClass: 'topic',
    query: 'machine learning',
    relevanceMarkers: [
      'machine learning',
      'deep learning',
      'neural network',
      'artificial intelligence',
      'statistical learning',
      'data science',
    ],
  },
  {
    label: 'topic-neuroscience',
    queryClass: 'topic',
    query: 'neuroscience',
    relevanceMarkers: ['neuro', 'brain', 'neural', 'cognitive', 'synap'],
  },
  {
    label: 'topic-cancer-biology',
    queryClass: 'topic',
    query: 'cancer biology',
    relevanceMarkers: ['cancer', 'oncolog', 'tumor', 'tumour', 'carcinom', 'metasta'],
  },
  {
    label: 'topic-climate-change',
    queryClass: 'topic',
    query: 'climate change',
    relevanceMarkers: ['climate', 'environment', 'atmospher', 'carbon', 'ecolog', 'sustainab'],
  },
  {
    label: 'topic-immunology',
    queryClass: 'topic',
    query: 'immunology',
    relevanceMarkers: ['immun', 'inflamm', 'antibod', 't cell', 'vaccin', 'pathogen'],
  },
  {
    label: 'topic-genomics',
    queryClass: 'topic',
    query: 'genomics',
    relevanceMarkers: ['genom', 'gene', 'dna', 'rna', 'sequenc', 'transcript'],
  },
  {
    label: 'topic-public-health',
    queryClass: 'topic',
    query: 'public health',
    relevanceMarkers: [
      'public health',
      'epidemiolog',
      'health polic',
      'population health',
      'global health',
    ],
  },
  {
    label: 'topic-economics',
    queryClass: 'topic',
    query: 'economics',
    relevanceMarkers: ['econom', 'market', 'finance', 'labor', 'labour', 'trade'],
  },
  {
    label: 'topic-psychology',
    queryClass: 'topic',
    query: 'psychology',
    relevanceMarkers: ['psycholog', 'behavio', 'cognitive', 'mental health', 'emotion'],
  },
  {
    label: 'topic-materials-science',
    queryClass: 'topic',
    query: 'materials science',
    relevanceMarkers: ['material', 'polymer', 'nanomater', 'semiconduct', 'crystal', 'alloy'],
  },
  {
    label: 'short-alias-ai',
    queryClass: 'short-alias',
    query: 'ai',
    relevanceMarkers: [
      'artificial intelligence',
      'machine learning',
      'deep learning',
      'neural',
      'data science',
    ],
  },
  {
    label: 'short-alias-nlp',
    queryClass: 'short-alias',
    query: 'nlp',
    relevanceMarkers: ['natural language', 'nlp', 'linguistic', 'language model', 'speech', 'text'],
  },
  {
    label: 'method-microscopy',
    queryClass: 'method',
    query: 'microscopy',
    relevanceMarkers: ['microscop', 'imaging', 'cryo', 'fluoresc', 'tomograph'],
  },
  {
    label: 'method-functional-mri',
    queryClass: 'method',
    query: 'functional mri',
    relevanceMarkers: ['fmri', 'mri', 'neuroimag', 'brain imaging', 'magnetic resonance'],
  },
  {
    label: 'semantic-phrase-wet-lab-beginner',
    queryClass: 'semantic-phrase',
    query: 'wet lab experience for a beginner',
    relevanceMarkers: ['experiment', 'bench', 'assay', 'protocol', 'wet lab', 'in vitro'],
  },
  {
    label: 'semantic-phrase-computational-biology',
    queryClass: 'semantic-phrase',
    query: 'computational methods applied to biology',
    relevanceMarkers: [
      'computational',
      'bioinformat',
      'biolog',
      'simulat',
      'algorithm',
      'modeling',
      'modelling',
    ],
  },
] as const;

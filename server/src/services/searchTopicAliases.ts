import { RESEARCH_AREA_ALIASES } from '../scrapers/researchAreaCanonicalization';

export type TopicAliasClusterKind = 'topical' | 'department';

export interface TopicAliasCluster {
  kind: TopicAliasClusterKind;
  canonical: string[];
  aliases: string[];
  shortAliases?: string[];
  queryOnly?: boolean;
  freeTextGuarded?: boolean;
  textTriggers?: string[];
}

const dedupeInOrder = (values: string[]): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const normalized = value.trim().replace(/\s+/g, ' ');
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
};

export const RESEARCH_TOPIC_ALIAS_CLUSTERS: TopicAliasCluster[] = [
  {
    kind: 'topical',
    canonical: ['artificial intelligence', 'machine learning', 'deep learning'],
    aliases: ['ai', 'ml'],
    shortAliases: ['ai', 'ml'],
    textTriggers: ['ai', 'artificial intelligence', 'ml', 'machine learning'],
  },
  {
    kind: 'topical',
    canonical: ['natural language processing', 'computational linguistics'],
    aliases: ['nlp'],
    shortAliases: ['nlp'],
    textTriggers: ['nlp', 'natural language processing'],
  },
  {
    kind: 'topical',
    canonical: [
      'computer vision',
      'computational vision',
      'image analysis',
      'visual recognition',
      'medical imaging',
    ],
    aliases: ['cv'],
    shortAliases: ['cv'],
    freeTextGuarded: true,
    textTriggers: ['cv', 'computer vision', 'computational vision'],
  },
  {
    kind: 'topical',
    canonical: ['neuroscience', 'neurology', 'neural', 'brain'],
    aliases: ['neuro'],
    textTriggers: ['neuro', 'neuroscience'],
  },
  {
    kind: 'topical',
    canonical: ['psychology', 'psychiatry', 'cognitive science', 'behavioral science'],
    aliases: ['psych'],
    textTriggers: ['psych', 'psychology'],
  },
  {
    kind: 'topical',
    canonical: ['oncology', 'cancer biology', 'tumor biology'],
    aliases: ['cancer', 'tumor'],
  },
  {
    kind: 'topical',
    canonical: ['cardiology', 'cardiovascular', 'cardiovascular disease'],
    aliases: ['heart', 'cardiac'],
    queryOnly: true,
  },
  {
    kind: 'topical',
    canonical: ['pediatrics', 'pediatric', 'child health'],
    aliases: ['children', 'kids'],
    queryOnly: true,
  },
  {
    kind: 'topical',
    canonical: ['genetics', 'genomics', 'gene expression'],
    aliases: ['genes', 'dna', 'genomic', 'genetic'],
    shortAliases: ['dna'],
  },
  {
    kind: 'topical',
    canonical: ['immunology', 'immunobiology', 'immune system'],
    aliases: ['immune', 'immunity', 'vaccine', 'vaccines'],
  },
  {
    kind: 'topical',
    canonical: ['climate change', 'environmental science', 'sustainability'],
    aliases: ['climate'],
    queryOnly: true,
  },
  {
    kind: 'topical',
    canonical: ['epidemiology', 'microbiology', 'infectious disease'],
    aliases: ['infectious disease', 'infectious diseases'],
  },
  {
    kind: 'topical',
    canonical: ['geriatrics', 'gerontology', 'aging'],
    aliases: ['aging', 'ageing'],
    queryOnly: true,
  },
  {
    kind: 'topical',
    canonical: ['pharmacology', 'drug discovery', 'therapeutics'],
    aliases: ['drugs', 'drug'],
    queryOnly: true,
  },
  {
    kind: 'topical',
    canonical: ['psychiatry', 'mental health'],
    aliases: ['mental health'],
    queryOnly: true,
  },
  {
    kind: 'topical',
    canonical: ['international relations', 'global affairs'],
    aliases: ['ir', 'international affairs'],
    shortAliases: ['ir'],
    queryOnly: true,
  },
  { kind: 'department', canonical: ['computer science'], aliases: ['cs', 'compsci', 'comp sci'] },
  { kind: 'department', canonical: ['economics'], aliases: ['econ'] },
  {
    kind: 'department',
    canonical: ['political science'],
    aliases: ['poli', 'polisci', 'poli sci', 'pol sci'],
  },
  { kind: 'department', canonical: ['biology'], aliases: ['bio', 'biol'] },
  { kind: 'department', canonical: ['chemistry'], aliases: ['chem'] },
  // `orgo` is the near-universal student name for the course and returned zero
  // rows before this entry; `ochem` reached only 6 of the 68 rows `organic
  // chemistry` reaches. Declared `department` rather than `topical` even though it
  // names a subfield: only the department path expands to the canonical term and
  // *drops* the shorthand, and neither abbreviation appears in any indexed field,
  // so the `topical` path's retained raw token would narrow the query instead of
  // widening it. That also keeps this query-only vernacular out of the corpus-side
  // Meili synonyms, which is the documented intent for vernacular.
  { kind: 'department', canonical: ['organic chemistry'], aliases: ['orgo', 'ochem'] },
  { kind: 'department', canonical: ['mathematics'], aliases: ['math'] },
  { kind: 'department', canonical: ['statistics'], aliases: ['stat', 'stats'] },
  { kind: 'department', canonical: ['sociology'], aliases: ['socio'] },
  { kind: 'department', canonical: ['anthropology'], aliases: ['anthro'] },
  { kind: 'department', canonical: ['philosophy'], aliases: ['phil', 'philo'] },
  { kind: 'department', canonical: ['linguistics'], aliases: ['ling'] },
  { kind: 'department', canonical: ['astronomy', 'astrophysics'], aliases: ['astro'] },
  { kind: 'department', canonical: ['history'], aliases: ['hist'] },
  { kind: 'department', canonical: ['literature'], aliases: ['lit'] },
  { kind: 'department', canonical: ['electrical engineering'], aliases: ['ee', 'elec eng'] },
  { kind: 'department', canonical: ['mechanical engineering'], aliases: ['meche', 'mech eng'] },
  { kind: 'department', canonical: ['biomedical engineering'], aliases: ['bme', 'biomed'] },
  { kind: 'department', canonical: ['ecology and evolutionary biology'], aliases: ['eeb'] },
  {
    kind: 'department',
    canonical: ['molecular cellular and developmental biology'],
    aliases: ['mcdb'],
  },
  {
    kind: 'department',
    canonical: ['molecular biophysics and biochemistry'],
    aliases: ['mbb'],
  },
  { kind: 'department', canonical: ['east asian languages and literatures'], aliases: ['eall'] },
  {
    kind: 'department',
    canonical: ['near eastern languages and civilizations'],
    aliases: ['nelc'],
  },
  { kind: 'department', canonical: ['women gender and sexuality studies'], aliases: ['wgss'] },
];

const topicalClusters = RESEARCH_TOPIC_ALIAS_CLUSTERS.filter((c) => c.kind === 'topical');
const departmentClusters = RESEARCH_TOPIC_ALIAS_CLUSTERS.filter((c) => c.kind === 'department');

const clusterFamily = (cluster: TopicAliasCluster): string[] =>
  dedupeInOrder([...cluster.canonical, ...cluster.aliases]);

const normalizeSynonymTerm = (value: string): string => value.normalize('NFKC').toLowerCase();

/**
 * Derives the Meili `synonyms` map from a single governed vocabulary: the
 * curated topical alias clusters (query-only vernacular excluded, as it must not
 * expand corpus recall) unioned with `RESEARCH_AREA_ALIASES`, the same
 * canonical->variant map ingest uses to tag entities. Each governed group emits
 * bidirectional, lower-cased, whitespace-normalized synonyms so a student query
 * for a known variant ("history of art", "population health", "hci") expands to
 * the canonical area the corpus actually carries. Groups accumulate per term, so
 * an alias present in both sources keeps the richer union rather than dropping
 * either. Pure (governed map in -> synonyms out) so search stays in sync with
 * ingest and cannot invent a topic outside the governed catalog.
 */
export function buildResearchEntityMeiliSynonyms(
  clusters: TopicAliasCluster[],
  governedAreaAliases: Record<string, string[]>,
): Record<string, string[]> {
  const families: string[][] = [
    ...clusters
      .filter((cluster) => cluster.kind === 'topical' && !cluster.queryOnly)
      .map(clusterFamily),
    ...Object.entries(governedAreaAliases).map(([canonical, aliases]) =>
      dedupeInOrder([canonical, ...aliases]),
    ),
  ];
  const synonyms: Record<string, string[]> = {};
  for (const family of families) {
    const normalized = dedupeInOrder(family.map(normalizeSynonymTerm));
    for (const term of normalized) {
      const others = normalized.filter((other) => other !== term);
      synonyms[term] = dedupeInOrder([...(synonyms[term] ?? []), ...others]);
    }
  }
  return synonyms;
}

export const RESEARCH_ENTITY_MEILI_SYNONYMS: Record<string, string[]> =
  buildResearchEntityMeiliSynonyms(RESEARCH_TOPIC_ALIAS_CLUSTERS, RESEARCH_AREA_ALIASES);

export const RESEARCH_ENTITY_MEILI_DISABLE_ON_WORDS: string[] = dedupeInOrder(
  topicalClusters.flatMap((cluster) => cluster.shortAliases ?? []),
);

export const STUDENT_TOPIC_TEXT_ALIASES: Record<string, string[]> = (() => {
  const aliases: Record<string, string[]> = {};
  for (const cluster of topicalClusters) {
    if (!cluster.textTriggers) continue;
    const family = clusterFamily(cluster);
    for (const trigger of cluster.textTriggers) {
      aliases[trigger] = family;
    }
  }
  return aliases;
})();

export const STUDENT_TOPIC_TEXT_ALIAS_FREE_TEXT_GUARDED: Set<string> = new Set(
  topicalClusters
    .filter((cluster) => cluster.freeTextGuarded)
    .flatMap((cluster) => cluster.shortAliases ?? []),
);

export const STUDENT_QUERY_ALIASES: Record<string, string[]> = (() => {
  const aliases: Record<string, string[]> = {};
  for (const cluster of topicalClusters) {
    for (const alias of cluster.aliases) {
      aliases[alias] = dedupeInOrder([...cluster.canonical, alias]);
    }
  }
  return aliases;
})();

export const DEPARTMENT_SHORTHAND_ALIASES: Record<string, string[]> = (() => {
  const aliases: Record<string, string[]> = {};
  for (const cluster of departmentClusters) {
    for (const alias of cluster.aliases) {
      aliases[alias] = [...cluster.canonical];
    }
  }
  return aliases;
})();

export const QUERY_TOPIC_ALIASES: Record<string, string[]> = {
  ...STUDENT_QUERY_ALIASES,
  ...DEPARTMENT_SHORTHAND_ALIASES,
};

export interface WorkingStylePhraseCluster {
  phrases: string[];
  canonical: string[];
}

// A working-style phrase names how a student would spend their time rather than
// what the work is about, and the corpus does not use the student's words for it:
// measured over the Development index's relevance text, "wet lab" and "dry lab"
// appear in 0 documents and "wet bench" in 1, while the vocabulary the corpus does
// carry appears in hundreds ("laboratory" 390, "computational" 336, "experiment"
// 311, "modeling" 282, "assay" 120, "in vivo" 106, "in vitro" 63). Query-only for
// that reason, and the typed phrase is replaced rather than kept beside the
// expansion, exactly as `orgo` is: retaining a phrase no document carries would
// narrow the query instead of widening it. See #2715.
export const RESEARCH_WORKING_STYLE_PHRASE_CLUSTERS: WorkingStylePhraseCluster[] = [
  {
    phrases: ['wet lab', 'wet labs', 'wet laboratory', 'wet laboratories', 'wet bench'],
    canonical: ['experimental', 'laboratory', 'bench', 'in vitro'],
  },
  {
    phrases: ['dry lab', 'dry labs', 'dry laboratory', 'dry laboratories'],
    canonical: ['computational', 'simulation', 'modeling'],
  },
];

export const WORKING_STYLE_PHRASE_ALIASES: Record<string, string[]> = (() => {
  const aliases: Record<string, string[]> = {};
  for (const cluster of RESEARCH_WORKING_STYLE_PHRASE_CLUSTERS) {
    for (const phrase of cluster.phrases) {
      const key = normalizeSynonymTerm(phrase).trim().replace(/\s+/g, ' ');
      if (key) aliases[key] = dedupeInOrder(cluster.canonical);
    }
  }
  return aliases;
})();

// Derived from the catalog rather than fixed at 2 so a longer phrase added above
// is actually scanned for instead of silently never matching.
export const WORKING_STYLE_PHRASE_MAX_TOKENS: number = Object.keys(
  WORKING_STYLE_PHRASE_ALIASES,
).reduce((longest, phrase) => Math.max(longest, phrase.split(' ').length), 0);

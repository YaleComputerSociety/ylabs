export type TopicAliasClusterKind = 'topical' | 'department';

export interface TopicAliasCluster {
  kind: TopicAliasClusterKind;
  canonical: string[];
  aliases: string[];
  shortAliases?: string[];
  queryOnly?: boolean;
  freeTextGuarded?: boolean;
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
  },
  {
    kind: 'topical',
    canonical: ['natural language processing', 'computational linguistics'],
    aliases: ['nlp'],
    shortAliases: ['nlp'],
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
  },
  {
    kind: 'topical',
    canonical: ['neuroscience', 'neurology', 'neural', 'brain'],
    aliases: ['neuro'],
  },
  {
    kind: 'topical',
    canonical: ['psychology', 'psychiatry', 'cognitive science', 'behavioral science'],
    aliases: ['psych'],
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

export const RESEARCH_ENTITY_MEILI_SYNONYMS: Record<string, string[]> = (() => {
  const synonyms: Record<string, string[]> = {};
  for (const cluster of topicalClusters) {
    if (cluster.queryOnly) continue;
    const family = clusterFamily(cluster);
    for (const key of family) {
      synonyms[key] = family.filter((term) => term.toLowerCase() !== key.toLowerCase());
    }
  }
  return synonyms;
})();

export const RESEARCH_ENTITY_MEILI_DISABLE_ON_WORDS: string[] = dedupeInOrder(
  topicalClusters.flatMap((cluster) => cluster.shortAliases ?? []),
);

export const STUDENT_TOPIC_TEXT_ALIASES: Record<string, string[]> = (() => {
  const aliases: Record<string, string[]> = {};
  for (const cluster of topicalClusters) {
    if (cluster.queryOnly) continue;
    const family = clusterFamily(cluster);
    for (const trigger of family) {
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

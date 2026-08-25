export interface ResearchTypeBucketDefinition {
  key: string;
  label: string;
  entityTypes: readonly string[];
}

export interface ResearchTypeBucketOption {
  key: string;
  label: string;
  count: number;
}

export const RESEARCH_TYPE_BUCKETS: readonly ResearchTypeBucketDefinition[] = [
  {
    key: 'labs',
    label: 'Research groups & labs',
    entityTypes: [
      'LAB',
      'GROUP',
      'INDIVIDUAL_RESEARCH',
      'FACULTY_RESEARCH_AREA',
      'FACULTY_PROJECT',
    ],
  },
  {
    key: 'centers',
    label: 'Centers & institutes',
    entityTypes: ['CENTER', 'INSTITUTE', 'INITIATIVE', 'CORE_FACILITY'],
  },
  {
    key: 'programs',
    label: 'Programs & fellowships',
    entityTypes: ['PROGRAM', 'COURSE_SEQUENCE'],
  },
  {
    key: 'collections',
    label: 'Collections, museum & digital humanities',
    entityTypes: [
      'ARCHIVE_OR_MUSEUM_PROJECT',
      'COLLECTIONS_INITIATIVE',
      'DIGITAL_HUMANITIES_PROJECT',
    ],
  },
];

const researchTypeBucketByKeyMap = new Map(
  RESEARCH_TYPE_BUCKETS.map((bucket) => [bucket.key, bucket]),
);

export const researchTypeBucketByKey = (key: string): ResearchTypeBucketDefinition | undefined =>
  researchTypeBucketByKeyMap.get(key);

export const researchTypeBucketLabel = (key: string): string =>
  researchTypeBucketByKeyMap.get(key)?.label ?? key;

export const readResearchTypeBucketKeys = (values: readonly string[]): string[] => {
  const selected = new Set(
    values.map((value) => value.trim()).filter((value) => researchTypeBucketByKeyMap.has(value)),
  );
  return RESEARCH_TYPE_BUCKETS.filter((bucket) => selected.has(bucket.key)).map(
    (bucket) => bucket.key,
  );
};

export const entityTypesForResearchTypeBuckets = (keys: readonly string[]): string[] => {
  const selected = new Set(keys);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const bucket of RESEARCH_TYPE_BUCKETS) {
    if (!selected.has(bucket.key)) continue;
    for (const entityType of bucket.entityTypes) {
      if (seen.has(entityType)) continue;
      seen.add(entityType);
      out.push(entityType);
    }
  }
  return out;
};

export const researchTypeBucketKeysForEntityTypes = (
  entityTypes: readonly string[] | undefined,
): string[] => {
  if (!entityTypes || entityTypes.length === 0) return [];
  const present = new Set(entityTypes);
  return RESEARCH_TYPE_BUCKETS.filter((bucket) =>
    bucket.entityTypes.every((entityType) => present.has(entityType)),
  ).map((bucket) => bucket.key);
};

export const aggregateResearchTypeBucketCounts = (
  entityTypeCounts: Record<string, number> | undefined,
): ResearchTypeBucketOption[] => {
  const counts = entityTypeCounts || {};
  return RESEARCH_TYPE_BUCKETS.map((bucket) => {
    const count = bucket.entityTypes.reduce((total, entityType) => {
      const value = counts[entityType];
      return Number.isFinite(value) && value > 0 ? total + value : total;
    }, 0);
    return { key: bucket.key, label: bucket.label, count };
  }).filter((option) => option.count > 0);
};

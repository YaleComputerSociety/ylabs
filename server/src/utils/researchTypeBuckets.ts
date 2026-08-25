/**
 * Server mirror of the client research-type buckets
 * (`client/src/utils/researchTypeBuckets.ts`), used to group a research area's
 * heterogeneous footprint on the per-area / per-field page (issue #1696).
 *
 * The bucket keys, labels, and entity-type membership are kept identical to the
 * client definition so the aggregated page groups the corpus the same way the
 * browse surface already does. Changing a bucket here also requires updating the
 * client copy so the two surfaces stay in agreement.
 */
export interface ResearchTypeBucketDefinition {
  key: string;
  label: string;
  entityTypes: readonly string[];
}

export const RESEARCH_TYPE_BUCKETS: readonly ResearchTypeBucketDefinition[] = [
  {
    key: 'labs',
    label: 'Research groups & labs',
    entityTypes: ['LAB', 'GROUP', 'INDIVIDUAL_RESEARCH', 'FACULTY_RESEARCH_AREA', 'FACULTY_PROJECT'],
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

const bucketKeyByEntityType = new Map<string, string>();
for (const bucket of RESEARCH_TYPE_BUCKETS) {
  for (const entityType of bucket.entityTypes) {
    bucketKeyByEntityType.set(entityType, bucket.key);
  }
}

export const OTHER_RESEARCH_TYPE_BUCKET_KEY = 'other';

export function researchTypeBucketKeyForEntityType(entityType: string | undefined): string {
  if (!entityType) return OTHER_RESEARCH_TYPE_BUCKET_KEY;
  return bucketKeyByEntityType.get(entityType) ?? OTHER_RESEARCH_TYPE_BUCKET_KEY;
}

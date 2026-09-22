/**
 * Batch recoverability classification for withheld research entities (#2821).
 *
 * `visibilityRecoverabilityAuditCore` decides a single record's bucket, and the audit
 * script assembles that record's inputs. Both the operator board and the repair-queue
 * runner need the same verdict, so the assembly lives here rather than in a script:
 * the release queue enqueued every held row regardless of whether any lane could act
 * on it, which is why a 200-item sweep repaired 7 and an operator board advertised
 * 1,228 workable items when 84 were.
 *
 * One batched observation read per chunk, not one per record, because both callers
 * classify a whole page of the queue at once.
 */
import { Observation } from '../models/observation';
import { ResearchEntity } from '../models/researchEntity';
import {
  BLOCKER_EVIDENCE_FIELDS,
  classifyRecoverability,
  hasRecordedGateVerdict,
  type RecoverabilityBucket,
  type RecoverabilityVerdict,
} from '../scripts/visibilityRecoverabilityAuditCore';
import { isBlockingVisibilityReason } from './studentVisibilityGateService';
import { isDisallowedResearchEntitySourceUrl } from '../utils/researchHomeWebsiteUrl';

const EVIDENCE_FIELDS = [
  ...new Set(
    Object.entries(BLOCKER_EVIDENCE_FIELDS)
      .filter(([reason]) => isBlockingVisibilityReason(reason))
      .flatMap(([, fields]) => fields),
  ),
];

/** The fields the canonical `hasSourceUrl` check reads, so citability matches the gate. */
const SOURCE_URL_FIELDS = ['sourceUrls', 'websiteUrl', 'website'];

const OBSERVATION_CHUNK_SIZE = 400;

const OBJECT_ID_RE = /^[a-f0-9]{24}$/i;

const hasUsableValue = (value: unknown): boolean => {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'string') return value.trim().length > 0;
  return value !== null && value !== undefined;
};

const serializedId = (value: unknown): string => (value ? String(value) : '');

/**
 * Every URL an acquisition lane could still crawl. Reads the same three fields as the
 * canonical `hasSourceUrl`: a bare `sourceUrls` is a known projection gap, so a row
 * with only a `websiteUrl` still has a page to fetch and must not be counted against
 * the promotion ceiling.
 */
const citableSourceUrlsFor = (record: Record<string, unknown>): string[] => [
  ...new Set(
    SOURCE_URL_FIELDS.flatMap((field) => {
      const value = record[field];
      return Array.isArray(value) ? value : [value];
    })
      .filter((url): url is string => typeof url === 'string' && /^https?:\/\//i.test(url.trim()))
      .map((url) => url.trim())
      .filter((url) => !isDisallowedResearchEntitySourceUrl(url)),
  ),
];

const chunked = <T>(values: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size)
    chunks.push(values.slice(index, index + size));
  return chunks;
};

export interface RecoverabilityLookup {
  byRecordId: Map<string, RecoverabilityVerdict>;
  bucketCounts: Record<RecoverabilityBucket, number>;
}

const emptyBucketCounts = (): Record<RecoverabilityBucket, number> => ({
  regate: 0,
  materialize: 0,
  acquire: 0,
  ceiling: 0,
});

/**
 * Classify the given research-entity record ids. A record id with no live entity is
 * omitted rather than defaulted: a verdict invented for a row nobody can read would
 * report phantom work, and the callers already treat a missing verdict as unknown.
 */
export async function classifyRecoverabilityForRecordIds(
  recordIds: string[],
  options: {
    /**
     * Blockers to classify per record, when the caller already knows which ones it will
     * act on. The repair runner works from a queue item's `blockerReasons`, which can
     * differ from the entity's stored `studentVisibilityReasons` because a queue item
     * outlives the gate run that wrote it. Classifying the entity's reasons while the
     * runner attempts the item's would route on one blocker set and work another, which
     * is how 64 `formalization_only` items were attempted by a run that had classified
     * them as unrepairable.
     */
    blockersByRecordId?: Map<string, string[]>;
  } = {},
): Promise<RecoverabilityLookup> {
  const byRecordId = new Map<string, RecoverabilityVerdict>();
  const bucketCounts = emptyBucketCounts();
  // A recordId that is not an ObjectId cannot be cast by the query and would throw for
  // the whole batch. Dropping it leaves the record unclassified, which the callers treat
  // as "route as before" rather than as unrepairable.
  const unique = [...new Set(recordIds.filter((id) => OBJECT_ID_RE.test(String(id || ''))))];
  if (unique.length === 0) return { byRecordId, bucketCounts };

  const entities = (await ResearchEntity.find({ _id: { $in: unique } })
    .select(
      `_id slug studentVisibilityTier studentVisibilityReasons studentVisibilityComputedAt studentVisibilityEvaluatedAt ${SOURCE_URL_FIELDS.join(' ')} ${EVIDENCE_FIELDS.join(' ')}`,
    )
    .lean()) as Record<string, unknown>[];
  if (entities.length === 0) return { byRecordId, bucketCounts };

  const slugToId = new Map(
    entities.map((entity) => [String(entity.slug || ''), serializedId(entity._id)]),
  );

  // A rolled-back or superseded observation is NOT evidence: it is exactly what a prior
  // repair retired, and counting it would report retired grafts as recoverable value.
  const observed = new Map<string, Set<string>>();
  for (const chunk of chunked(entities, OBSERVATION_CHUNK_SIZE)) {
    const observations = (await Observation.find({
      entityType: 'researchEntity',
      field: { $in: EVIDENCE_FIELDS },
      superseded: { $ne: true },
      'rollback.rolledBackAt': { $exists: false },
      $or: [
        { entityId: { $in: chunk.map((entity) => entity._id) } },
        { entityKey: { $in: chunk.map((entity) => String(entity.slug || '')) } },
      ],
    })
      .select('entityId entityKey field value')
      .lean()) as Record<string, unknown>[];

    for (const observation of observations) {
      if (!hasUsableValue(observation.value)) continue;
      const key =
        serializedId(observation.entityId) ||
        slugToId.get(String(observation.entityKey || '')) ||
        '';
      if (!key) continue;
      const set = observed.get(key) || new Set<string>();
      set.add(String(observation.field));
      observed.set(key, set);
    }
  }

  for (const entity of entities) {
    const recordId = serializedId(entity._id);
    if (!recordId) continue;
    const reasons =
      options.blockersByRecordId?.get(recordId) ??
      ((entity.studentVisibilityReasons as string[]) || []);
    const verdict = classifyRecoverability({
      recordId,
      slug: String(entity.slug || ''),
      blockers: reasons.filter((reason) => isBlockingVisibilityReason(reason)),
      gated: hasRecordedGateVerdict(entity),
      populatedFields: new Set(EVIDENCE_FIELDS.filter((field) => hasUsableValue(entity[field]))),
      observedFields: observed.get(recordId) || new Set<string>(),
      citableSourceUrls: citableSourceUrlsFor(entity),
    });
    byRecordId.set(recordId, verdict);
    bucketCounts[verdict.bucket] += 1;
  }

  return { byRecordId, bucketCounts };
}

import mongoose from 'mongoose';
import { ResearchEntity } from '../models/researchEntity';
import { Observation } from '../models/observation';
import { researchEntityIdsWithGateAttachedLead } from '../services/studentVisibilityGateService';
import { materializeInferredPiMembership } from './entityMaterializer';
import {
  runInferredPiLeadMaterializationBackfill,
  type InferredPiLagEntity,
  type InferredPiLeadMaterializationDeps,
  type InferredPiLeadMaterializationReport,
} from '../scripts/backfillInferredPiLeadMaterializationCore';

export type InferredPiLeadReclaimScope = 'grant-shells' | 'all';

const GRANT_SHELL_SLUG = '^(nsf|nih)-pi-';
const RESEARCH_ENTITY_OBSERVATION_TYPES = ['researchEntity', 'researchGroup'];
const INFERRED_PI_FIELDS = ['inferredPiUserId', 'inferredPiUserKey'];

function toEntityObjectId(entityId: string): mongoose.Types.ObjectId | null {
  return mongoose.Types.ObjectId.isValid(entityId) ? new mongoose.Types.ObjectId(entityId) : null;
}

/**
 * Whether the gate would judge these rows to already hold a lead, which is the only
 * question this lane may subtract by. It used to ask whether any non-`HISTORICAL`
 * lead role assignment existed, which is a weaker question in three ways at once: it
 * counted archived assignments, assignments whose person record is archived, and
 * leads the gate judges too weak to own a research home. A row failing any of those
 * looked linked here and leadless to the gate, so the lane never revisited it and the
 * row could not leave `operator_review` however good the key resolver became (#2931).
 */
async function gateAttachedLeadEntityIds(
  objectIds: mongoose.Types.ObjectId[],
): Promise<Set<string>> {
  return researchEntityIdsWithGateAttachedLead(objectIds);
}

export function createInferredPiLeadMaterializationDeps(
  scope: InferredPiLeadReclaimScope,
): InferredPiLeadMaterializationDeps {
  return {
    async findEntitiesWithInferredPiObservations() {
      const slugs = await Observation.distinct('entityKey', {
        entityType: { $in: RESEARCH_ENTITY_OBSERVATION_TYPES },
        field: { $in: INFERRED_PI_FIELDS },
        superseded: false,
        ...(scope === 'grant-shells'
          ? { entityKey: { $regex: GRANT_SHELL_SLUG, $options: 'i' } }
          : {}),
      });
      if (slugs.length === 0) return [];
      const docs = await ResearchEntity.find({
        slug: { $in: slugs },
        archived: { $ne: true },
      })
        .select('_id slug')
        .lean();
      return (docs as unknown as Array<{ _id: unknown; slug: string }>).map((doc) => ({
        entityId: String(doc._id),
        entityKey: doc.slug,
      }));
    },
    async findEntityIdsWithCurrentLead(entityIds) {
      const objectIds = entityIds
        .map(toEntityObjectId)
        .filter((value): value is mongoose.Types.ObjectId => value !== null);
      return gateAttachedLeadEntityIds(objectIds);
    },
    async loadCurrentObservationsForEntity(entity: InferredPiLagEntity) {
      const observations = await Observation.find({
        entityType: { $in: RESEARCH_ENTITY_OBSERVATION_TYPES },
        entityKey: entity.entityKey,
        superseded: false,
      })
        .select('field value sourceName sourceUrl observedAt confidence')
        .lean();
      return observations as Array<Record<string, unknown>>;
    },
    async materializeInferredPiLead(entityId, observations) {
      await materializeInferredPiMembership(entityId, observations);
    },
    // The same question as the candidate filter on purpose: asking a weaker one here
    // would report `materialized-lead` for every row that already held the archived or
    // weak edge the filter now looks past, so the lane's own yield count would be a
    // restatement of its input rather than a measurement of what it resolved.
    async hasCurrentLeadAfter(entityId) {
      const objectId = toEntityObjectId(entityId);
      if (!objectId) return false;
      return (await gateAttachedLeadEntityIds([objectId])).size > 0;
    },
  };
}

export async function reclaimInferredPiLeads(options: {
  apply: boolean;
  scope?: InferredPiLeadReclaimScope;
}): Promise<InferredPiLeadMaterializationReport> {
  const scope = options.scope ?? 'all';
  return runInferredPiLeadMaterializationBackfill(createInferredPiLeadMaterializationDeps(scope), {
    apply: options.apply,
  });
}

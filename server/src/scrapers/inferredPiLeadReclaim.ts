import mongoose from 'mongoose';
import { ResearchEntity } from '../models/researchEntity';
import { Observation } from '../models/observation';
import { RoleAssignment, type RoleAssignmentRole } from '../models/roleAssignment';
import { canonicalRoleForLegacy } from '../models/canonicalRoleMapping';
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
const LEGACY_LEAD_ROLES = ['pi', 'co-pi', 'director', 'co-director'];
const CANONICAL_LEAD_ROLES = LEGACY_LEAD_ROLES.map((role) => canonicalRoleForLegacy(role)).filter(
  (role): role is RoleAssignmentRole => Boolean(role),
);

function toEntityObjectId(entityId: string): mongoose.Types.ObjectId | null {
  return mongoose.Types.ObjectId.isValid(entityId)
    ? new mongoose.Types.ObjectId(entityId)
    : null;
}

async function currentLeadEntityIds(objectIds: mongoose.Types.ObjectId[]): Promise<string[]> {
  if (objectIds.length === 0) return [];
  const linked = await RoleAssignment.distinct('target.id', {
    'target.kind': 'RESEARCH_ENTITY',
    'target.id': { $in: objectIds },
    role: { $in: CANONICAL_LEAD_ROLES },
    state: { $ne: 'HISTORICAL' },
  });
  return linked.map((value) => String(value));
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
      return new Set(await currentLeadEntityIds(objectIds));
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
    async hasCurrentLeadAfter(entityId) {
      const objectId = toEntityObjectId(entityId);
      if (!objectId) return false;
      const linked = await currentLeadEntityIds([objectId]);
      return linked.length > 0;
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

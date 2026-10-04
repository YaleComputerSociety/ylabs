/**
 * Persistence + Meilisearch sync for the ResearchEntity browse-ranking score.
 *
 * The pure scorer lives in researchEntityBrowseRank.ts. This module gathers the
 * joins the scorer needs (lead members, whether the
 * entity hosts affiliated research homes), writes the
 * resulting `browseRankScore` onto the ResearchEntity document, and re-syncs the
 * affected docs to the `researchentities` Meilisearch index so the default
 * (no-query) browse can sort on it.
 */
import { ResearchEntity } from '../models/researchEntity';
import { ResearchEntityRelationship } from '../models/researchEntityRelationship';
import {
  BROWSE_RANK_SCORER_VERSION,
  computeResearchEntityBrowseRank,
} from './researchEntityBrowseRank';
import { entityHasHostedUndergraduates } from './accessAcceptanceLevel';
import { getResearchEntityRosterByEntityId } from './researchEntityMembershipAccessor';
import { LEAD_ROLE_LEGACY_LABELS } from '../models/canonicalRoleMapping';
import { syncEntity } from './meiliSyncService';
import { serializedDocumentId } from '../utils/idSerialization';
import { relatesTwoDistinctResearchEntities } from '../utils/researchEntityRelationshipEndpoints';

const browseRankDocumentId = (value: unknown): string => serializedDocumentId(value) || '';

const leadMembersByEntityId = async (entityIds: any[]): Promise<Map<string, any[]>> => {
  if (entityIds.length === 0) return new Map();
  const rosterByEntityId = await getResearchEntityRosterByEntityId(entityIds);
  const byId = new Map<string, any[]>();
  for (const [key, roster] of rosterByEntityId) {
    const leads = roster.filter((member) => LEAD_ROLE_LEGACY_LABELS.has(member.role));
    if (leads.length > 0) byId.set(key, leads);
  }
  return byId;
};

const entitiesHostingAffiliations = async (entityIds: any[]): Promise<Set<string>> => {
  if (entityIds.length === 0) return new Set();
  const sourceIds = await ResearchEntityRelationship.find({
    sourceResearchEntityId: { $in: entityIds },
    archived: { $ne: true },
  })
    .select('sourceResearchEntityId targetResearchEntityId')
    .lean();
  const hosting = new Set<string>();
  for (const relationship of (sourceIds as any[]).filter(relatesTwoDistinctResearchEntities)) {
    const key = browseRankDocumentId(relationship.sourceResearchEntityId);
    if (key) hosting.add(key);
  }
  return hosting;
};

export interface RecomputeBrowseRankOptions {
  /** When true, compute and report but do not write to Mongo or Meilisearch. */
  dryRun?: boolean;
  /** When true, re-sync each updated doc to Meilisearch (default true). */
  sync?: boolean;
  scorerVersion?: number;
}

export interface RecomputeBrowseRankResult {
  considered: number;
  updated: number;
  stamped: number;
  scoreDrifted: number;
  refusedNewerScorer: number;
  indexSyncFailures: number;
  scoresByEntityId: Map<string, number>;
}

const storedScorerVersion = (entity: Record<string, any>): number =>
  typeof entity.browseRankScorerVersion === 'number' ? entity.browseRankScorerVersion : 0;

const notScoredByANewerScorer = (scorerVersion: number) => ({
  $or: [
    { browseRankScorerVersion: { $exists: false } },
    { browseRankScorerVersion: null },
    { browseRankScorerVersion: { $lte: scorerVersion } },
  ],
});

/**
 * Recompute browseRankScore for the given entity ids (loaded with their lead
 * members), persist, and re-sync to Meilisearch.
 */
export async function recomputeBrowseRankForEntities(
  entityIds: any[],
  options: RecomputeBrowseRankOptions = {},
): Promise<RecomputeBrowseRankResult> {
  const sync = options.sync ?? true;
  const scorerVersion = options.scorerVersion ?? BROWSE_RANK_SCORER_VERSION;
  const scoresByEntityId = new Map<string, number>();
  if (entityIds.length === 0) {
    return {
      considered: 0,
      updated: 0,
      stamped: 0,
      scoreDrifted: 0,
      refusedNewerScorer: 0,
      indexSyncFailures: 0,
      scoresByEntityId,
    };
  }

  const entities = (await ResearchEntity.find({ _id: { $in: entityIds } }).lean()) as any[];
  const ids = entities.map((entity) => entity._id);
  const [leadMembers, hostingAffiliations] = await Promise.all([
    leadMembersByEntityId(ids),
    entitiesHostingAffiliations(ids),
  ]);

  let updated = 0;
  let stamped = 0;
  let scoreDrifted = 0;
  let refusedNewerScorer = 0;
  let indexSyncFailures = 0;
  for (const entity of entities) {
    const id = browseRankDocumentId(entity._id);
    if (!id) continue;
    if (storedScorerVersion(entity) > scorerVersion) {
      refusedNewerScorer += 1;
      continue;
    }
    const score = computeResearchEntityBrowseRank({
      entity,
      leadMembers: leadMembers.get(id) || [],
      hostsAffiliatedResearchHomes: hostingAffiliations.has(id),
    });
    scoresByEntityId.set(id, score);
    const undergradHostingEvidence = entityHasHostedUndergraduates(entity);

    const scoreUnchanged = (entity.browseRankScore ?? 0) === score;
    const hostingUnchanged =
      (entity.hasUndergradHostingEvidence ?? false) === undergradHostingEvidence;
    const servedFieldsUnchanged = scoreUnchanged && hostingUnchanged;
    const stampUnchanged = storedScorerVersion(entity) === scorerVersion;
    if (!scoreUnchanged) scoreDrifted += 1;
    if (servedFieldsUnchanged && stampUnchanged) continue;
    if (options.dryRun) {
      if (servedFieldsUnchanged) stamped += 1;
      else updated += 1;
      continue;
    }

    const write = await ResearchEntity.updateOne(
      { _id: entity._id, ...notScoredByANewerScorer(scorerVersion) },
      {
        $set: {
          browseRankScore: score,
          browseRankScorerVersion: scorerVersion,
          hasUndergradHostingEvidence: undergradHostingEvidence,
        },
      },
      { timestamps: false },
    );
    if (write.matchedCount === 0) {
      refusedNewerScorer += 1;
      continue;
    }
    if (servedFieldsUnchanged) {
      stamped += 1;
      continue;
    }
    updated += 1;
    if (sync) {
      const fresh = await ResearchEntity.findById(entity._id).lean();
      if (!fresh || !(await syncEntity('researchEntity', fresh))) indexSyncFailures += 1;
    }
  }

  return {
    considered: entities.length,
    updated,
    stamped,
    scoreDrifted,
    refusedNewerScorer,
    indexSyncFailures,
    scoresByEntityId,
  };
}

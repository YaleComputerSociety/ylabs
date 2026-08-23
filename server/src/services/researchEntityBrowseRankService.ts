/**
 * Persistence + Meilisearch sync for the ResearchEntity browse-ranking score.
 *
 * The pure scorer lives in researchEntityBrowseRank.ts. This module gathers the
 * joins the scorer needs (lead members, active access-signal types, whether the
 * entity hosts affiliated research homes), writes the
 * resulting `browseRankScore` onto the ResearchEntity document, and re-syncs the
 * affected docs to the `researchentities` Meilisearch index so the default
 * (no-query) browse can sort on it.
 */
import { ResearchEntity } from '../models/researchEntity';
import { ResearchEntityRelationship } from '../models/researchEntityRelationship';
import { Signal } from '../models/signal';
import { accessSignalTypes as ACCESS_SIGNAL_TYPES } from '../models/researchAccessTypes';
import { computeResearchEntityBrowseRank } from './researchEntityBrowseRank';
import {
  canonicalAcceptanceLevelFromSignals,
  type AccessAcceptanceLevel,
  type AccessSignalConfidenceInput,
} from './accessAcceptanceLevel';
import { getResearchEntityRosterByEntityId } from './researchEntityMembershipAccessor';
import { syncEntity } from './meiliSyncService';
import { serializedDocumentId } from '../utils/idSerialization';

const LEAD_ROLES = new Set(['pi', 'principal_investigator', 'lead', 'faculty_lead']);
const browseRankDocumentId = (value: unknown): string => serializedDocumentId(value) || '';

const leadMembersByEntityId = async (entityIds: any[]): Promise<Map<string, any[]>> => {
  if (entityIds.length === 0) return new Map();
  const rosterByEntityId = await getResearchEntityRosterByEntityId(entityIds);
  const byId = new Map<string, any[]>();
  for (const [key, roster] of rosterByEntityId) {
    const leads = roster.filter((member) => LEAD_ROLES.has(member.role));
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
    .select('sourceResearchEntityId')
    .lean();
  const hosting = new Set<string>();
  for (const relationship of sourceIds as any[]) {
    const key = browseRankDocumentId(relationship.sourceResearchEntityId);
    if (key) hosting.add(key);
  }
  return hosting;
};

const accessSignalsByEntityId = async (
  entityIds: any[],
): Promise<Map<string, AccessSignalConfidenceInput[]>> => {
  if (entityIds.length === 0) return new Map();
  const signals = await Signal.find({
    researchEntityId: { $in: entityIds },
    type: { $in: ACCESS_SIGNAL_TYPES },
    archived: { $ne: true },
  })
    .select('researchEntityId type confidence confidenceScore derivationKey')
    .lean();
  const byId = new Map<string, AccessSignalConfidenceInput[]>();
  for (const signal of signals as any[]) {
    const key = browseRankDocumentId(signal.researchEntityId);
    if (!key || !signal.type) continue;
    byId.set(key, [
      ...(byId.get(key) || []),
      {
        type: String(signal.type),
        confidence: signal.confidence,
        confidenceScore: signal.confidenceScore,
        derivationKey: signal.derivationKey,
      },
    ]);
  }
  return byId;
};

export interface RecomputeBrowseRankOptions {
  /** When true, compute and report but do not write to Mongo or Meilisearch. */
  dryRun?: boolean;
  /** When true, re-sync each updated doc to Meilisearch (default true). */
  sync?: boolean;
}

export interface RecomputeBrowseRankResult {
  considered: number;
  updated: number;
  scoresByEntityId: Map<string, number>;
  acceptanceLevelsByEntityId: Map<string, AccessAcceptanceLevel>;
}

/**
 * Recompute browseRankScore for the given entity ids (loaded with their lead
 * members and active access signals), persist, and re-sync to Meilisearch.
 */
export async function recomputeBrowseRankForEntities(
  entityIds: any[],
  options: RecomputeBrowseRankOptions = {},
): Promise<RecomputeBrowseRankResult> {
  const sync = options.sync ?? true;
  const scoresByEntityId = new Map<string, number>();
  const acceptanceLevelsByEntityId = new Map<string, AccessAcceptanceLevel>();
  if (entityIds.length === 0) {
    return { considered: 0, updated: 0, scoresByEntityId, acceptanceLevelsByEntityId };
  }

  const entities = (await ResearchEntity.find({ _id: { $in: entityIds } }).lean()) as any[];
  const ids = entities.map((entity) => entity._id);
  const [leadMembers, accessSignals, hostingAffiliations] = await Promise.all([
    leadMembersByEntityId(ids),
    accessSignalsByEntityId(ids),
    entitiesHostingAffiliations(ids),
  ]);

  let updated = 0;
  for (const entity of entities) {
    const id = browseRankDocumentId(entity._id);
    if (!id) continue;
    const entitySignals = accessSignals.get(id) || [];
    const score = computeResearchEntityBrowseRank({
      entity,
      leadMembers: leadMembers.get(id) || [],
      accessSignalTypes: entitySignals.flatMap((signal) => (signal.type ? [signal.type] : [])),
      hostsAffiliatedResearchHomes: hostingAffiliations.has(id),
    });
    scoresByEntityId.set(id, score);
    const acceptanceLevel = canonicalAcceptanceLevelFromSignals(entitySignals);
    acceptanceLevelsByEntityId.set(id, acceptanceLevel);

    const scoreUnchanged = (entity.browseRankScore ?? 0) === score;
    const levelUnchanged = (entity.accessAcceptanceLevel ?? 'none') === acceptanceLevel;
    if (scoreUnchanged && levelUnchanged) continue;
    updated += 1;
    if (options.dryRun) continue;

    await ResearchEntity.updateOne(
      { _id: entity._id },
      { $set: { browseRankScore: score, accessAcceptanceLevel: acceptanceLevel } },
      { timestamps: false },
    );
    if (sync) {
      const fresh = await ResearchEntity.findById(entity._id).lean();
      if (fresh) await syncEntity('researchEntity', fresh);
    }
  }

  return {
    considered: entities.length,
    updated,
    scoresByEntityId,
    acceptanceLevelsByEntityId,
  };
}

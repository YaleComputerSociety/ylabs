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
  hasUndergradHostingEvidenceFromSignals,
  hasDocumentedWayInFromSignals,
  type AccessAcceptanceLevel,
  type AccessSignalConfidenceInput,
} from './accessAcceptanceLevel';
import {
  currentUndergradAvailabilityFromSignals,
  undergradCompensationModelFromSignals,
  eligibleStudentLevelsFromSignals,
  type CurrentAvailabilitySignalInput,
  type CompensationSignalInput,
  type StudentLevelSignalInput,
} from '../scrapers/undergraduateLogisticsMaterializer';
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
    .select('researchEntityId type confidence confidenceScore derivationKey source.excerpt')
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
        excerpt: signal.source?.excerpt,
      },
    ]);
  }
  return byId;
};

const currentAvailabilitySignalsByEntityId = async (
  entityIds: any[],
): Promise<Map<string, CurrentAvailabilitySignalInput[]>> => {
  if (entityIds.length === 0) return new Map();
  const signals = await Signal.find({
    researchEntityId: { $in: entityIds },
    type: 'CURRENT_AVAILABILITY',
    archived: { $ne: true },
  })
    .select('researchEntityId type status value expiresAt')
    .lean();
  const byId = new Map<string, CurrentAvailabilitySignalInput[]>();
  for (const signal of signals as any[]) {
    const key = browseRankDocumentId(signal.researchEntityId);
    if (!key) continue;
    byId.set(key, [
      ...(byId.get(key) || []),
      {
        type: signal.type,
        status: signal.status,
        value: signal.value,
        expiresAt: signal.expiresAt,
      },
    ]);
  }
  return byId;
};

const compensationSignalsByEntityId = async (
  entityIds: any[],
): Promise<Map<string, CompensationSignalInput[]>> => {
  if (entityIds.length === 0) return new Map();
  const signals = await Signal.find({
    researchEntityId: { $in: entityIds },
    type: 'COMPENSATION',
    archived: { $ne: true },
  })
    .select('researchEntityId type status value expiresAt')
    .lean();
  const byId = new Map<string, CompensationSignalInput[]>();
  for (const signal of signals as any[]) {
    const key = browseRankDocumentId(signal.researchEntityId);
    if (!key) continue;
    byId.set(key, [
      ...(byId.get(key) || []),
      {
        type: signal.type,
        status: signal.status,
        value: signal.value,
        expiresAt: signal.expiresAt,
      },
    ]);
  }
  return byId;
};

const studentLevelSignalsByEntityId = async (
  entityIds: any[],
): Promise<Map<string, StudentLevelSignalInput[]>> => {
  if (entityIds.length === 0) return new Map();
  const signals = await Signal.find({
    researchEntityId: { $in: entityIds },
    type: 'STUDENT_LEVEL',
    archived: { $ne: true },
  })
    .select('researchEntityId type status value expiresAt')
    .lean();
  const byId = new Map<string, StudentLevelSignalInput[]>();
  for (const signal of signals as any[]) {
    const key = browseRankDocumentId(signal.researchEntityId);
    if (!key) continue;
    byId.set(key, [
      ...(byId.get(key) || []),
      {
        type: signal.type,
        status: signal.status,
        value: signal.value,
        expiresAt: signal.expiresAt,
      },
    ]);
  }
  return byId;
};

const eligibleStudentLevelsEqual = (left: string[], right: string[]): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index]);

export interface RecomputeBrowseRankOptions {
  /** When true, compute and report but do not write to Mongo or Meilisearch. */
  dryRun?: boolean;
  /** When true, re-sync each updated doc to Meilisearch (default true). */
  sync?: boolean;
  /** Injected for deterministic tests; defaults to the current time. */
  now?: Date;
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

  const now = options.now ?? new Date();
  const entities = (await ResearchEntity.find({ _id: { $in: entityIds } }).lean()) as any[];
  const ids = entities.map((entity) => entity._id);
  const [
    leadMembers,
    accessSignals,
    hostingAffiliations,
    currentAvailabilitySignals,
    compensationSignals,
    studentLevelSignals,
  ] = await Promise.all([
    leadMembersByEntityId(ids),
    accessSignalsByEntityId(ids),
    entitiesHostingAffiliations(ids),
    currentAvailabilitySignalsByEntityId(ids),
    compensationSignalsByEntityId(ids),
    studentLevelSignalsByEntityId(ids),
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
    const undergradHostingEvidence = hasUndergradHostingEvidenceFromSignals(entitySignals);
    const documentedWayIn = hasDocumentedWayInFromSignals(entitySignals);
    const currentAvailability = currentUndergradAvailabilityFromSignals(
      currentAvailabilitySignals.get(id) || [],
      now,
    );
    const compensationModel = undergradCompensationModelFromSignals(
      compensationSignals.get(id) || [],
      now,
    );
    const eligibleStudentLevels = eligibleStudentLevelsFromSignals(
      studentLevelSignals.get(id) || [],
      now,
    );

    const scoreUnchanged = (entity.browseRankScore ?? 0) === score;
    const levelUnchanged = (entity.accessAcceptanceLevel ?? 'none') === acceptanceLevel;
    const hostingUnchanged =
      (entity.hasUndergradHostingEvidence ?? false) === undergradHostingEvidence;
    const documentedWayInUnchanged =
      (entity.hasDocumentedWayIn ?? false) === documentedWayIn;
    const availabilityUnchanged =
      (entity.undergraduateCurrentAvailability ?? 'UNKNOWN') === currentAvailability;
    const compensationUnchanged =
      (entity.undergraduateCompensationModel ?? 'UNKNOWN') === compensationModel;
    const eligibleStudentLevelsUnchanged = eligibleStudentLevelsEqual(
      Array.isArray(entity.undergraduateEligibleStudentLevels)
        ? entity.undergraduateEligibleStudentLevels
        : [],
      eligibleStudentLevels,
    );
    if (
      scoreUnchanged &&
      levelUnchanged &&
      hostingUnchanged &&
      documentedWayInUnchanged &&
      availabilityUnchanged &&
      compensationUnchanged &&
      eligibleStudentLevelsUnchanged
    )
      continue;
    updated += 1;
    if (options.dryRun) continue;

    await ResearchEntity.updateOne(
      { _id: entity._id },
      {
        $set: {
          browseRankScore: score,
          accessAcceptanceLevel: acceptanceLevel,
          hasUndergradHostingEvidence: undergradHostingEvidence,
          hasDocumentedWayIn: documentedWayIn,
          undergraduateCurrentAvailability: currentAvailability,
          undergraduateCompensationModel: compensationModel,
          undergraduateEligibleStudentLevels: eligibleStudentLevels,
        },
      },
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

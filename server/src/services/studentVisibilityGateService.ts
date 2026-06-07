import { AccessSignal } from '../models/accessSignal';
import { EntryPathway } from '../models/entryPathway';
import { Fellowship } from '../models/fellowship';
import { Observation } from '../models/observation';
import { PostedOpportunity } from '../models/postedOpportunity';
import { ResearchEntity } from '../models/researchEntity';
import { ResearchGroupMember } from '../models/researchGroupMember';
import { User } from '../models/user';
import mongoose from 'mongoose';
import {
  publicStudentVisibilityTiers,
  type StudentVisibilityTier,
} from '../models/studentVisibility';
import {
  VisibilityReleaseQueueItem,
  type VisibilityReleaseQueueCollection,
  type VisibilityRepairStage,
  type VisibilityRepairStatus,
} from '../models/visibilityReleaseQueueItem';
import {
  computeProgramStudentVisibility,
  computeResearchEntityStudentVisibility,
  hasProfileAreaShellDuplicateRisk,
  STUDENT_VISIBILITY_VERSION,
} from './studentVisibilityTier';
import {
  selectSamePiDuplicateRiskEntityIds,
  type ResearchEntityPiDedupeRow,
} from '../scripts/researchEntityPiDedupeCore';
import { nextRepairActionForReasons } from '../scripts/studentVisibilityBackfillReport';
import { isConcreteResearchHomeEntity } from '../utils/profileAreaDuplicateRisk';

export type StudentVisibilityGateMode = 'dry-run' | 'apply';
export type StudentVisibilityGateCollection = VisibilityReleaseQueueCollection | 'all';
const MAX_RELEASE_QUEUE_PAGE = 1000;

export interface StudentVisibilityGateOptions {
  collection: StudentVisibilityGateCollection;
  mode: StudentVisibilityGateMode;
  sourceName?: string;
  recordIds?: string[];
  limit?: number;
}

export interface StudentVisibilityGatePlan {
  collection: VisibilityReleaseQueueCollection;
  recordId: string;
  label: string;
  currentTier?: string;
  computedTier: StudentVisibilityTier;
  tier: StudentVisibilityTier;
  reasons: string[];
  sourceNames: string[];
  nextRepairAction: string;
}

export interface VisibilityQueueUpsert {
  collection: VisibilityReleaseQueueCollection;
  recordId: string;
  label: string;
  currentTier?: string;
  computedTier: StudentVisibilityTier;
  targetTier: StudentVisibilityTier;
  blockerReasons: string[];
  evidenceSignals: string[];
  sourceNames: string[];
  nextRepairAction: string;
  repairStage?: VisibilityRepairStage;
  repairStatus?: VisibilityRepairStatus;
  remainingBlockers?: string[];
  status: 'open';
}

export interface StudentVisibilityGateDeps {
  updateRecordVisibility: (
    collection: VisibilityReleaseQueueCollection,
    recordId: string,
    patch: Record<string, any>,
  ) => Promise<void>;
  upsertOpenQueueItem: (item: VisibilityQueueUpsert) => Promise<void>;
  resolveQueueItem: (
    collection: VisibilityReleaseQueueCollection,
    recordId: string,
    metadata: { resolvedByTier: StudentVisibilityTier },
  ) => Promise<void>;
  resolveArchivedResearchQueueItems?: () => Promise<number>;
}

export interface StudentVisibilityGateReport {
  mode: StudentVisibilityGateMode;
  collection: StudentVisibilityGateCollection;
  scanned: number;
  counts: {
    scanned: number;
    promoted: number;
    held: number;
    resolved: number;
    changed: number;
  };
  reasonCounts: Record<string, number>;
  blockerCounts: Record<string, number>;
  sourceCounts: Record<string, number>;
  samples: StudentVisibilityGatePlan[];
}

const PUBLIC_TIERS = new Set<string>(publicStudentVisibilityTiers);

const FORMALIZATION_ONLY_ENTRY_PATHWAY_TYPES = [
  'COURSE_CREDIT',
  'SENIOR_THESIS',
  'FELLOWSHIP_FUNDED_PROJECT',
];

const evidenceReasons = new Set([
  'application_route',
  'concrete_next_step',
  'official_source',
  'source_backed_description',
  'undergraduate_relevant',
]);

const sourceDescriptionRepairReasons = new Set([
  'missing_description',
  'missing_card_description',
  'thin_description',
  'profile_fallback_only',
  'missing_source_url',
  'missing_official_source',
  'application_source_only',
]);
const piRepairReasons = new Set([
  'missing_lead',
  'duplicate_name_risk',
  'duplicate_risk',
  'pi_identity_conflict',
  'profile_identity_risk',
]);
const actionRepairReasons = new Set([
  'missing_action_evidence',
  'missing_application_route',
  'missing_source_route',
]);
const suppressionRepairReasons = new Set([
  'archive_review',
  'content_page_risk',
  'exact_url_duplicate_risk',
  'generic_directory_shell',
  'inactive_at_yale',
  'non_owner_grant_shell',
  'not_undergraduate_relevant',
  'profile_biography_shell',
  'research_infrastructure_only',
]);
const reviewExceptionReasons = new Set(['formalization_only']);

const repairStageForReasons = (reasons: string[]) => {
  if (reasons.some((reason) => reviewExceptionReasons.has(reason))) return 'review_exception';
  if (reasons.includes('exact_url_duplicate_risk')) return 'suppression';
  if (reasons.includes('generic_directory_shell')) return 'suppression';
  if (reasons.includes('profile_biography_shell')) return 'suppression';
  if (reasons.some((reason) => sourceDescriptionRepairReasons.has(reason))) {
    return 'source_description';
  }
  if (reasons.some((reason) => piRepairReasons.has(reason))) return 'pi_identity';
  if (reasons.some((reason) => actionRepairReasons.has(reason))) return 'action_evidence';
  if (reasons.some((reason) => suppressionRepairReasons.has(reason))) return 'suppression';
  return 'review_exception';
};

export function isBlockingVisibilityReason(reason: string): boolean {
  if (evidenceReasons.has(reason)) return false;
  return (
    reason.startsWith('missing_') ||
    reason.endsWith('_only') ||
    [
      'application_source_only',
      'archive_review',
      'content_page_risk',
      'duplicate_name_risk',
      'duplicate_risk',
      'exact_url_duplicate_risk',
      'formalization_only',
      'generic_directory_shell',
      'inactive_at_yale',
      'non_owner_grant_shell',
      'missing_card_description',
      'not_undergraduate_relevant',
      'pi_identity_conflict',
      'profile_biography_shell',
      'profile_fallback_only',
      'profile_identity_risk',
      'research_infrastructure_only',
      'thin_description',
    ].includes(reason)
  );
}

const uniqueStrings = (values: unknown[]): string[] =>
  Array.from(
    new Set(
      values
        .filter((value): value is string => typeof value === 'string')
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );

const exactDuplicateUrlRejectedPathPatterns = [
  /\/(?:people|faculty|professors|directory|members|humans\/faculty)\/?$/i,
  /\/(?:[^/]+\/)*membership\/directory\/?$/i,
];

function normalizedExactDuplicateUrl(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!/^https?:\/\//i.test(raw)) return '';
  try {
    const url = new URL(raw);
    url.hash = '';
    url.search = '';
    url.protocol = 'https:';
    url.hostname = url.hostname.toLowerCase();
    url.pathname = url.pathname.replace(/\/+$/g, '') || '/';
    if (url.hostname === 'medicine.yale.edu') {
      url.pathname = url.pathname.replace(/^\/[^/]+\/profile\//i, '/profile/');
    }
    return url.toString();
  } catch {
    return '';
  }
}

function isSpecificDuplicateSignalUrl(value: string): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    const path = url.pathname.replace(/\/+$/g, '') || '/';
    if (path === '/' && /(^|\.)yale\.edu$/i.test(url.hostname)) return false;
    if (exactDuplicateUrlRejectedPathPatterns.some((pattern) => pattern.test(path))) return false;
    return true;
  } catch {
    return false;
  }
}

const entityDuplicateUrls = (entity: any): string[] =>
  uniqueStrings([entity.websiteUrl, entity.website, ...(Array.isArray(entity.sourceUrls) ? entity.sourceUrls : [])])
    .map(normalizedExactDuplicateUrl)
    .filter(isSpecificDuplicateSignalUrl);

function exactDuplicateCanonicalScore(entity: any, leadCountsByEntityId: Map<string, number>): number {
  const id = String(entity._id || entity.id || '');
  const textScore =
    (typeof entity.fullDescription === 'string' && entity.fullDescription.trim().length >= 80 ? 35 : 0) +
    (typeof entity.shortDescription === 'string' && entity.shortDescription.trim().length >= 40 ? 20 : 0);
  return (
    (PUBLIC_TIERS.has(String(entity.studentVisibilityTier || '')) ? 80 : 0) +
    (isConcreteResearchHomeEntity(entity) ? 35 : 0) +
    (leadCountsByEntityId.get(id) || 0) * 15 +
    textScore +
    (entity.entityType === 'FACULTY_RESEARCH_AREA' ? 0 : 8)
  );
}

export function selectExactUrlDuplicateRiskEntityIds(
  entities: any[],
  leadRows: any[] = [],
): Set<string> {
  const leadCountsByEntityId = new Map<string, number>();
  for (const row of leadRows) {
    const id = String(row.researchEntityId || '').trim();
    if (!id) continue;
    leadCountsByEntityId.set(id, (leadCountsByEntityId.get(id) || 0) + 1);
  }

  const entitiesByUrl = new Map<string, any[]>();
  for (const entity of entities) {
    for (const url of entityDuplicateUrls(entity)) {
      entitiesByUrl.set(url, [...(entitiesByUrl.get(url) || []), entity]);
    }
  }

  const duplicateIds = new Set<string>();
  for (const group of entitiesByUrl.values()) {
    if (group.length <= 1 || group.length > 5) continue;
    const canonical = [...group].sort((a, b) => {
      const byScore =
        exactDuplicateCanonicalScore(b, leadCountsByEntityId) -
        exactDuplicateCanonicalScore(a, leadCountsByEntityId);
      if (byScore !== 0) return byScore;
      return String(a.slug || a._id || '').localeCompare(String(b.slug || b._id || ''));
    })[0];
    const canonicalId = String(canonical?._id || canonical?.id || '');
    for (const entity of group) {
      const id = String(entity._id || entity.id || '');
      if (id && id !== canonicalId) duplicateIds.add(id);
    }
  }
  return duplicateIds;
}

const increment = (counts: Record<string, number>, key: string) => {
  counts[key] = (counts[key] || 0) + 1;
};

const countByEntityId = (rows: Array<{ _id: unknown; count: number }>) =>
  new Map(rows.map((row) => [String(row._id), row.count]));

const profileAreaDuplicateCounterpartEntityTypes = new Set([
  'LAB',
  'GROUP',
  'FACULTY_PROJECT',
  'DIGITAL_HUMANITIES_PROJECT',
  'COLLECTIONS_INITIATIVE',
  'ARCHIVE_OR_MUSEUM_PROJECT',
]);

const profileAreaDuplicateCounterpartKinds = new Set(['lab', 'group', 'project']);

export function isProfileAreaDuplicateCounterpart(
  entity: Record<string, any>,
  leadRow: Record<string, any>,
): boolean {
  if (String(leadRow.role || '').toLowerCase() !== 'pi') return false;
  const entityType = String(entity.entityType || '').toUpperCase();
  const kind = String(entity.kind || '').toLowerCase();
  return (
    profileAreaDuplicateCounterpartEntityTypes.has(entityType) ||
    profileAreaDuplicateCounterpartKinds.has(kind)
  );
}

function buildSamePiVisibilityDedupeRows(args: {
  entities: any[];
  leadRows: any[];
  extraEntitiesByUserId?: Map<string, any[]>;
}): ResearchEntityPiDedupeRow[] {
  const entityById = new Map(args.entities.map((entity) => [String(entity._id), entity]));
  const leadRowsByUserId = new Map<string, any[]>();
  for (const row of args.leadRows) {
    const userId = row.userId === undefined || row.userId === null ? '' : String(row.userId).trim();
    if (!userId || row.role !== 'pi') continue;
    leadRowsByUserId.set(userId, [...(leadRowsByUserId.get(userId) || []), row]);
  }

  return Array.from(leadRowsByUserId.entries())
    .map(([userId, rows]) => {
      const entityIds = new Set<string>();
      const entities = [
        ...rows.map((row) => entityById.get(String(row.researchEntityId))).filter(Boolean),
        ...(args.extraEntitiesByUserId?.get(userId) || []),
      ]
        .filter((entity: any) => {
          const id = String(entity._id);
          if (entityIds.has(id)) return false;
          entityIds.add(id);
          return true;
        })
        .map(serializeEntityForDedupe);
      const lead = rows.find((row) => row.user) || rows[0] || {};
      return {
        userId,
        normalizedName: `same-pi:${userId}`,
        piFirstName: lead.user?.fname,
        piLastName: lead.user?.lname,
        entities,
      };
    })
    .filter((row) => row.entities.length > 1);
}

const normalizedDedupeName = (value: unknown): string =>
  String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');

function isFullPersonLabDedupeName(normalizedName: string): boolean {
  const tokens = normalizedName
    .replace(/\s+lab$/i, '')
    .split(/\s+/)
    .filter(Boolean);
  return /\s+lab$/i.test(normalizedName) && tokens.length >= 2;
}

function serializeEntityForDedupe(entity: any): ResearchEntityPiDedupeRow['entities'][number] {
  return {
    id: String(entity._id),
    slug: entity.slug,
    name: entity.name,
    kind: entity.kind,
    entityType: entity.entityType,
    websiteUrl: entity.websiteUrl,
    fullDescription: entity.fullDescription,
    shortDescription: entity.shortDescription,
    sourceUrls: entity.sourceUrls,
    departments: entity.departments,
    researchAreas: entity.researchAreas,
  };
}

function profileAreaNamesForVisibilityPi(firstName: unknown, lastName: unknown): string[] {
  const first = String(firstName || '').trim();
  const last = String(lastName || '').trim();
  if (!first || !last) return [];
  return [`${first} ${last} Lab`, `${first} ${last} Laboratory`, `${first} ${last} Research`];
}

function buildNameOnlyVisibilityDedupeRows(args: {
  entities: any[];
  leadsByEntityId: Map<string, any[]>;
}): ResearchEntityPiDedupeRow[] {
  const entitiesByName = new Map<string, any[]>();
  for (const entity of args.entities) {
    const normalizedName = normalizedDedupeName(entity.name);
    if (!normalizedName) continue;
    entitiesByName.set(normalizedName, [...(entitiesByName.get(normalizedName) || []), entity]);
  }

  return Array.from(entitiesByName.entries())
    .filter(([, entities]) => entities.length > 1)
    .map((entry): ResearchEntityPiDedupeRow | null => {
      const [normalizedName, entities] = entry;
      const piUserIds = new Set<string>();
      for (const entity of entities) {
        for (const lead of args.leadsByEntityId.get(String(entity._id)) || []) {
          const userId =
            lead.userId === undefined || lead.userId === null ? '' : String(lead.userId).trim();
          if (lead.role === 'pi' && userId) piUserIds.add(userId);
        }
      }
      if (piUserIds.size > 1) return null;
      if (piUserIds.size === 0 && !isFullPersonLabDedupeName(normalizedName)) return null;
      const userId = Array.from(piUserIds)[0] || `name:${normalizedName}`;
      return {
        userId,
        normalizedName,
        entities: entities.map(serializeEntityForDedupe),
      };
    })
    .filter((row): row is ResearchEntityPiDedupeRow => !!row);
}

const defaultGateDeps: StudentVisibilityGateDeps = {
  async updateRecordVisibility(collection, recordId, patch) {
    const model: any = collection === 'research' ? ResearchEntity : Fellowship;
    await model.updateOne({ _id: recordId }, { $set: patch });
  },
  async upsertOpenQueueItem(item) {
    const now = new Date();
    await VisibilityReleaseQueueItem.updateOne(
      { collection: item.collection, recordId: item.recordId, status: 'open' },
      {
        $set: {
          ...item,
          lastSeenAt: now,
          resolvedAt: undefined,
          resolvedByTier: '',
        },
        $setOnInsert: { firstSeenAt: now },
      },
      { upsert: true },
    );
  },
  async resolveQueueItem(collection, recordId, metadata) {
    const now = new Date();
    await VisibilityReleaseQueueItem.updateMany(
      { collection, recordId, status: 'open' },
      {
        $set: {
          status: 'resolved',
          resolvedAt: now,
          resolvedByTier: metadata.resolvedByTier,
          lastSeenAt: now,
        },
      },
    );
  },
  async resolveArchivedResearchQueueItems() {
    return resolveArchivedResearchQueueItems();
  },
};

const archivedQueueResolutionMessage =
  'Archived duplicate or suppressed research entity; no student-visible repair needed.';

function validObjectIdStrings(values: unknown[]): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => (typeof value === 'string' ? value.trim() : ''))
        .filter((value) => /^[a-f0-9]{24}$/i.test(value)),
    ),
  );
}

async function resolveArchivedResearchQueueItems(now = new Date()): Promise<number> {
  const openRows = await VisibilityReleaseQueueItem.find({
    collection: 'research',
    status: 'open',
  })
    .select('recordId')
    .lean();
  const recordIds = validObjectIdStrings(openRows.map((row) => row.recordId));
  if (recordIds.length === 0) return 0;

  const archivedEntities = await ResearchEntity.find({
    _id: { $in: recordIds.map((id) => new mongoose.Types.ObjectId(id)) },
    archived: true,
  })
    .select('_id')
    .lean();
  const archivedRecordIds = archivedEntities.map((entity) => String(entity._id));
  if (archivedRecordIds.length === 0) return 0;

  const result = await VisibilityReleaseQueueItem.updateMany(
    {
      collection: 'research',
      recordId: { $in: archivedRecordIds },
      status: 'open',
    },
    {
      $set: {
        status: 'suppressed',
        resolvedAt: now,
        resolvedByTier: 'suppressed',
        lastSeenAt: now,
        repairStatus: 'resolved',
        blockerReasons: ['archived_research_entity'],
        remainingBlockers: ['archived_research_entity'],
        nextRepairAction: archivedQueueResolutionMessage,
      },
    },
  );
  return result.modifiedCount || 0;
}

export async function runStudentVisibilityGateForPlans(
  plans: StudentVisibilityGatePlan[],
  options: {
    mode: StudentVisibilityGateMode;
    collection?: StudentVisibilityGateCollection;
    deps?: StudentVisibilityGateDeps;
  },
): Promise<StudentVisibilityGateReport> {
  const deps = options.deps || defaultGateDeps;
  const reasonCounts: Record<string, number> = {};
  const blockerCounts: Record<string, number> = {};
  const sourceCounts: Record<string, number> = {};
  const counts = {
    scanned: plans.length,
    promoted: 0,
    held: 0,
    resolved: 0,
    changed: 0,
  };

  for (const plan of plans) {
    const publicSafe = PUBLIC_TIERS.has(plan.tier);
    if (publicSafe) {
      counts.promoted += 1;
      counts.resolved += 1;
    } else {
      counts.held += 1;
    }
    if (plan.currentTier !== plan.tier) counts.changed += 1;
    for (const reason of plan.reasons) {
      increment(reasonCounts, reason);
      if (isBlockingVisibilityReason(reason)) increment(blockerCounts, reason);
    }
    for (const sourceName of plan.sourceNames) increment(sourceCounts, sourceName);

    if (options.mode !== 'apply') continue;

    await deps.updateRecordVisibility(plan.collection, plan.recordId, {
      studentVisibilityTier: plan.tier,
      studentVisibilityComputedTier: plan.computedTier,
      studentVisibilityReasons: plan.reasons,
      studentVisibilityComputedAt: new Date(),
      studentVisibilityVersion: STUDENT_VISIBILITY_VERSION,
    });

    if (publicSafe) {
      await deps.resolveQueueItem(plan.collection, plan.recordId, { resolvedByTier: plan.tier });
    } else if (plan.tier === 'suppressed') {
      await VisibilityReleaseQueueItem.updateMany(
        { collection: plan.collection, recordId: plan.recordId, status: 'open' },
        {
          $set: {
            status: 'suppressed',
            resolvedAt: new Date(),
            resolvedByTier: plan.tier,
            lastSeenAt: new Date(),
          },
        },
      );
    } else {
      const blockerReasons = plan.reasons.filter(isBlockingVisibilityReason);
      await deps.upsertOpenQueueItem({
        collection: plan.collection,
        recordId: plan.recordId,
        label: plan.label,
        currentTier: plan.currentTier,
        computedTier: plan.computedTier,
        targetTier: plan.tier,
        blockerReasons,
        evidenceSignals: plan.reasons.filter((reason) => !isBlockingVisibilityReason(reason)),
        sourceNames: plan.sourceNames,
        nextRepairAction: plan.nextRepairAction,
        repairStage: repairStageForReasons(blockerReasons),
        repairStatus: 'queued',
        remainingBlockers: blockerReasons,
        status: 'open',
      });
    }
  }

  if (options.mode === 'apply') {
    await deps.resolveArchivedResearchQueueItems?.();
  }

  return {
    mode: options.mode,
    collection: options.collection || 'all',
    scanned: plans.length,
    counts,
    reasonCounts,
    blockerCounts,
    sourceCounts,
    samples: plans.slice(0, 20),
  };
}

export async function applyStudentVisibilityGatePlans(
  plans: StudentVisibilityGatePlan[],
): Promise<void> {
  const now = new Date();
  const researchOps: any[] = [];
  const programOps: any[] = [];
  const queueOps: any[] = [];

  for (const plan of plans) {
    const visibilityUpdate = {
      studentVisibilityTier: plan.tier,
      studentVisibilityComputedTier: plan.computedTier,
      studentVisibilityReasons: plan.reasons,
      studentVisibilityComputedAt: now,
      studentVisibilityVersion: STUDENT_VISIBILITY_VERSION,
    };
    const recordOp = {
      updateOne: {
        filter: { _id: plan.recordId },
        update: { $set: visibilityUpdate },
      },
    };
    if (plan.collection === 'research') researchOps.push(recordOp);
    else programOps.push(recordOp);

    if (PUBLIC_TIERS.has(plan.tier)) {
      queueOps.push({
        updateMany: {
          filter: { collection: plan.collection, recordId: plan.recordId, status: 'open' },
          update: {
            $set: {
              status: 'resolved',
              resolvedAt: now,
              resolvedByTier: plan.tier,
              lastSeenAt: now,
            },
          },
        },
      });
      continue;
    }

    if (plan.tier === 'suppressed') {
      const blockerReasons = plan.reasons.filter(isBlockingVisibilityReason);
      queueOps.push({
        updateMany: {
          filter: { collection: plan.collection, recordId: plan.recordId, status: 'open' },
          update: {
            $set: {
              status: 'suppressed',
              resolvedAt: now,
              resolvedByTier: plan.tier,
              blockerReasons,
              remainingBlockers: blockerReasons,
              lastSeenAt: now,
            },
          },
        },
      });
      continue;
    }

    const blockerReasons = plan.reasons.filter(isBlockingVisibilityReason);
    queueOps.push({
      updateOne: {
        filter: { collection: plan.collection, recordId: plan.recordId, status: 'open' },
        update: {
          $set: {
            collection: plan.collection,
            recordId: plan.recordId,
            label: plan.label,
            currentTier: plan.currentTier || '',
            computedTier: plan.computedTier,
            targetTier: plan.tier,
            blockerReasons,
            evidenceSignals: plan.reasons.filter((reason) => !isBlockingVisibilityReason(reason)),
            sourceNames: plan.sourceNames,
            nextRepairAction: plan.nextRepairAction,
            repairStage: repairStageForReasons(blockerReasons),
            repairStatus: 'queued',
            remainingBlockers: blockerReasons,
            status: 'open',
            lastSeenAt: now,
            resolvedAt: undefined,
            resolvedByTier: '',
          },
          $setOnInsert: { firstSeenAt: now },
        },
        upsert: true,
      },
    });
  }

  await Promise.all([
    researchOps.length > 0 ? (ResearchEntity as any).bulkWrite(researchOps, { ordered: false }) : undefined,
    programOps.length > 0 ? (Fellowship as any).bulkWrite(programOps, { ordered: false }) : undefined,
    queueOps.length > 0
      ? (VisibilityReleaseQueueItem as any).bulkWrite(queueOps, { ordered: false })
      : undefined,
  ]);
  await resolveArchivedResearchQueueItems(now);
}

async function planResearchEntityGateUpdates(
  options: Pick<StudentVisibilityGateOptions, 'sourceName' | 'recordIds' | 'limit'>,
): Promise<StudentVisibilityGatePlan[]> {
  const match: Record<string, any> = { archived: { $ne: true } };
  if (options.recordIds?.length) match._id = { $in: options.recordIds };
  if (options.sourceName) {
    const [accessEntityIds, observationEntityIds, observationEntityKeys] = await Promise.all([
      AccessSignal.distinct('researchEntityId', {
        sourceName: options.sourceName,
        archived: false,
      }),
      Observation.distinct('entityId', {
        sourceName: options.sourceName,
        entityType: { $in: ['researchEntity', 'researchGroup'] },
        superseded: false,
        entityId: { $exists: true, $ne: null },
      }),
      Observation.distinct('entityKey', {
        sourceName: options.sourceName,
        entityType: { $in: ['researchEntity', 'researchGroup'] },
        superseded: false,
        entityKey: { $exists: true, $ne: '' },
      }),
    ]);
    const sourceEntityIds = [...accessEntityIds, ...observationEntityIds];
    const sourceClauses: Record<string, any>[] = [];
    if (sourceEntityIds.length > 0) sourceClauses.push({ _id: { $in: sourceEntityIds } });
    if (observationEntityKeys.length > 0) sourceClauses.push({ slug: { $in: observationEntityKeys } });
    if (match._id) {
      match._id = { $in: sourceEntityIds.filter((id: any) => options.recordIds?.includes(String(id))) };
    } else if (sourceClauses.length === 1) {
      Object.assign(match, sourceClauses[0]);
    } else if (sourceClauses.length > 1) {
      match.$or = sourceClauses;
    } else {
      match._id = { $in: [] };
    }
  }

  const query = ResearchEntity.find(match).sort({ name: 1 });
  if (options.limit && Number.isFinite(options.limit)) query.limit(options.limit);
  const entities = await query.lean();
  const needsDuplicateReferenceCorpus =
    Boolean(options.recordIds?.length) ||
    Boolean(options.sourceName) ||
    Boolean(options.limit && Number.isFinite(options.limit));
  const duplicateReferenceEntities = needsDuplicateReferenceCorpus
    ? await ResearchEntity.find({ archived: { $ne: true } })
        .select(
          '_id slug name kind entityType website websiteUrl sourceUrls departments researchAreas fullDescription shortDescription studentVisibilityTier',
        )
        .lean()
    : entities;
  const entityIds = entities.map((entity: any) => entity._id);

  const [leadRows, accessRows, pathwayRows, postedRows] = await Promise.all([
    ResearchGroupMember.find({
      researchEntityId: { $in: entityIds },
      isCurrentMember: { $ne: false },
      role: { $in: ['pi', 'co-pi', 'director', 'co-director'] },
    })
      .select('researchEntityId userId facultyMemberId name role')
      .lean(),
    AccessSignal.aggregate([
      {
        $match: {
          researchEntityId: { $in: entityIds },
          archived: false,
          sourceUrl: { $regex: '^https?://', $options: 'i' },
        },
      },
      {
        $group: {
          _id: '$researchEntityId',
          count: { $sum: 1 },
          sourceNames: { $addToSet: '$sourceName' },
        },
      },
    ]),
    EntryPathway.aggregate([
      {
        $match: {
          researchEntityId: { $in: entityIds },
          archived: false,
          pathwayType: { $nin: FORMALIZATION_ONLY_ENTRY_PATHWAY_TYPES },
          sourceUrls: { $elemMatch: { $regex: '^https?://', $options: 'i' } },
        },
      },
      { $group: { _id: '$researchEntityId', count: { $sum: 1 } } },
    ]),
    PostedOpportunity.aggregate([
      {
        $match: {
          researchEntityId: { $in: entityIds },
          archived: false,
          status: { $in: ['OPEN', 'ROLLING'] },
        },
      },
      { $group: { _id: '$researchEntityId', count: { $sum: 1 } } },
    ]),
  ]);

  const leadUserIds = uniqueStrings((leadRows as any[]).map((row) => String(row.userId || '')));
  const leadUsers = leadUserIds.length
    ? await User.find({ _id: { $in: leadUserIds } }).select('facultyMemberId fname lname title').lean()
    : [];
  const leadUsersById = new Map((leadUsers as any[]).map((user) => [String(user._id), user]));
  const profileAreaNamesByUserId = new Map<string, string[]>();
  const profileAreaNames = uniqueStrings(
    (leadUsers as any[]).flatMap((user) => {
      const names = profileAreaNamesForVisibilityPi(user.fname, user.lname);
      profileAreaNamesByUserId.set(String(user._id), names);
      return names;
    }),
  );
  const profileAreaEntities = profileAreaNames.length
    ? await ResearchEntity.find({ archived: { $ne: true }, name: { $in: profileAreaNames } })
        .select('_id slug name kind entityType websiteUrl sourceUrls departments researchAreas')
        .lean()
    : [];
  const profileAreaEntitiesByUserId = new Map<string, any[]>();
  for (const [userId, names] of profileAreaNamesByUserId.entries()) {
    const nameSet = new Set(names);
    const matches = (profileAreaEntities as any[]).filter((entity) => nameSet.has(entity.name));
    if (matches.length > 0) profileAreaEntitiesByUserId.set(userId, matches);
  }

  const leadsByEntityId = new Map<string, any[]>();
  for (const row of leadRows as any[]) {
    const user = row.userId ? leadUsersById.get(String(row.userId)) : undefined;
    if (user) row.user = user;
    const key = String(row.researchEntityId);
    leadsByEntityId.set(key, [...(leadsByEntityId.get(key) || []), row]);
  }
  const accessCounts = countByEntityId(accessRows as any[]);
  const pathwayCounts = countByEntityId(pathwayRows as any[]);
  const postedCounts = countByEntityId(postedRows as any[]);
  const sourceNamesByEntityId = new Map(
    (accessRows as any[]).map((row) => [String(row._id), uniqueStrings(row.sourceNames || [])]),
  );
  const entityById = new Map((entities as any[]).map((entity) => [String(entity._id), entity]));
  const samePiDuplicateRiskEntityIds = selectSamePiDuplicateRiskEntityIds(
    [
      ...buildSamePiVisibilityDedupeRows({
        entities: entities as any[],
        leadRows: leadRows as any[],
        extraEntitiesByUserId: profileAreaEntitiesByUserId,
      }),
      ...buildNameOnlyVisibilityDedupeRows({
        entities: entities as any[],
        leadsByEntityId,
      }),
    ],
  );
  const exactUrlDuplicateRiskEntityIds = selectExactUrlDuplicateRiskEntityIds(
    duplicateReferenceEntities as any[],
    leadRows as any[],
  );
  const concreteLeadEntityUserIds = new Set<string>();
  for (const row of leadRows as any[]) {
    const entity = entityById.get(String(row.researchEntityId));
    const userId = row.userId === undefined || row.userId === null ? '' : String(row.userId).trim();
    if (
      userId &&
      entity &&
      isConcreteResearchHomeEntity(entity) &&
      isProfileAreaDuplicateCounterpart(entity, row)
    ) {
      concreteLeadEntityUserIds.add(userId);
    }
  }

  return entities.map((entity: any) => {
    const recordId = String(entity._id);
    const leadMembers = leadsByEntityId.get(recordId) || [];
    const result = computeResearchEntityStudentVisibility({
      entity,
      leadMembers,
      accessSignalCount: accessCounts.get(recordId) || 0,
      actionablePathwayCount: pathwayCounts.get(recordId) || 0,
      openPostedOpportunityCount: postedCounts.get(recordId) || 0,
      duplicateRisk: hasProfileAreaShellDuplicateRisk({
        entity,
        leadMembers,
        concreteLeadEntityUserIds,
      }) || samePiDuplicateRiskEntityIds.has(recordId),
      exactUrlDuplicateRisk: exactUrlDuplicateRiskEntityIds.has(recordId),
    });
    return {
      collection: 'research' as const,
      recordId,
      label: entity.displayName || entity.name || entity.slug || recordId,
      currentTier: entity.studentVisibilityTier,
      tier: result.tier,
      computedTier: result.computedTier,
      reasons: result.reasons,
      sourceNames: sourceNamesByEntityId.get(recordId) || [],
      nextRepairAction: nextRepairActionForReasons(result.reasons),
    };
  });
}

async function planProgramGateUpdates(
  options: Pick<StudentVisibilityGateOptions, 'sourceName' | 'recordIds' | 'limit'>,
): Promise<StudentVisibilityGatePlan[]> {
  const match: Record<string, any> = { archived: false };
  if (options.recordIds?.length) match._id = { $in: options.recordIds };
  if (options.sourceName) match.sourceName = options.sourceName;
  const query = Fellowship.find(match).sort({ title: 1 });
  if (options.limit && Number.isFinite(options.limit)) query.limit(options.limit);
  const programs = await query.lean();

  return programs.map((program: any) => {
    const recordId = String(program._id);
    const result = computeProgramStudentVisibility(program);
    return {
      collection: 'programs' as const,
      recordId,
      label: program.title || recordId,
      currentTier: program.studentVisibilityTier,
      tier: result.tier,
      computedTier: result.computedTier,
      reasons: result.reasons,
      sourceNames: uniqueStrings([program.sourceName]),
      nextRepairAction: nextRepairActionForReasons(result.reasons),
    };
  });
}

export async function planStudentVisibilityGate(
  options: StudentVisibilityGateOptions,
): Promise<StudentVisibilityGatePlan[]> {
  const [research, programs] = await Promise.all([
    options.collection === 'all' || options.collection === 'research'
      ? planResearchEntityGateUpdates(options)
      : Promise.resolve([]),
    options.collection === 'all' || options.collection === 'programs'
      ? planProgramGateUpdates(options)
      : Promise.resolve([]),
  ]);
  return [...research, ...programs];
}

export async function runStudentVisibilityGate(
  options: StudentVisibilityGateOptions,
): Promise<StudentVisibilityGateReport> {
  const plans = await planStudentVisibilityGate(options);
  const report = await runStudentVisibilityGateForPlans(plans, {
    mode: 'dry-run',
    collection: options.collection,
  });
  report.mode = options.mode;
  if (options.mode === 'apply') await applyStudentVisibilityGatePlans(plans);
  return report;
}

export async function listVisibilityReleaseQueue(input: {
  collection?: VisibilityReleaseQueueCollection;
  reason?: string;
  sourceName?: string;
  status?: string;
  page?: number;
  pageSize?: number;
}) {
  const page = Math.min(MAX_RELEASE_QUEUE_PAGE, Math.max(1, Math.floor(input.page || 1)));
  const pageSize = Math.min(100, Math.max(1, Math.floor(input.pageSize || 25)));
  const filter: Record<string, any> = {};
  if (input.collection === 'research' || input.collection === 'programs') {
    filter.collection = input.collection;
  }
  filter.status = input.status || 'open';
  if (input.reason) filter.blockerReasons = input.reason;
  if (input.sourceName) filter.sourceNames = input.sourceName;

  const [items, total] = await Promise.all([
    VisibilityReleaseQueueItem.find(filter)
      .sort({ lastSeenAt: -1, _id: 1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean(),
    VisibilityReleaseQueueItem.countDocuments(filter),
  ]);

  return {
    items,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}

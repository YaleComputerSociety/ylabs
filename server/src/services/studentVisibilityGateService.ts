import { Signal } from '../models/signal';
import { accessSignalTypes } from '../models/researchAccessTypes';
import { Fellowship } from '../models/fellowship';
import { Observation } from '../models/observation';
import { ResearchEntity } from '../models/researchEntity';
import { getResearchEntityRosterByEntityId } from './researchEntityMembershipAccessor';
import mongoose from 'mongoose';
import {
  publicStudentVisibilityTiers,
  type StudentVisibilityTier,
} from '../models/studentVisibility';
import {
  VisibilityReleaseQueueItem,
  type VisibilityReleaseQueueCollection,
  type VisibilityReleaseQueueStatus,
  type VisibilityRepairStage,
  type VisibilityRepairStatus,
  visibilityReleaseQueueStatuses,
} from '../models/visibilityReleaseQueueItem';
import {
  computeProgramStudentVisibility,
  computeResearchEntityStudentVisibility,
  hasProfileAreaShellDuplicateRisk,
  isStudentReadyHardBlockerReason,
  isStudentReadySoftSignalReason,
  STUDENT_VISIBILITY_VERSION,
} from './studentVisibilityTier';
import {
  selectSamePiDuplicateRiskEntityIds,
  type ResearchEntityPiDedupeRow,
} from '../scripts/researchEntityPiDedupeCore';
import { nextRepairActionForReasons } from '../scripts/studentVisibilityBackfillReport';
import { countResearchEntityAlternateAccessPaths } from './researchEntityAlternateAccessPath';
import {
  evaluateRosterLeadResolution,
  type RosterLeadResolutionResult,
} from './rosterLeadResolutionGuard';
import { serializedDocumentId } from '../utils/idSerialization';
import { isConcreteResearchHomeEntity } from '../utils/profileAreaDuplicateRisk';
import { officialProfileUrlFromRosterEntry } from './leadProfileIdentity';
import { officialNonGrantSourceUrl } from '../scrapers/accessMaterializer';
import { IDENTIFIED_LEAD_FALLBACK_DERIVATION_KEYS } from './accessAcceptanceLevel';

export type StudentVisibilityGateMode = 'dry-run' | 'apply';
export type StudentVisibilityGateCollection = VisibilityReleaseQueueCollection | 'all';
const MAX_RELEASE_QUEUE_PAGE = 1000;
const MAX_RELEASE_QUEUE_FILTER_LENGTH = 120;
const STUDENT_VISIBILITY_GATE_OBJECT_ID_RE = /^[a-f0-9]{24}$/i;
const STUDENT_VISIBILITY_GATE_LEAD_ROLES = new Set(['pi', 'co-pi', 'director', 'co-director']);
const studentVisibilityGateDocumentId = (value: unknown): string =>
  serializedDocumentId(value) || '';
const studentVisibilityGateEntityIdKey = (entity: any): string =>
  studentVisibilityGateDocumentId(entity?._id) || studentVisibilityGateDocumentId(entity?.id);
const studentVisibilityGateEntitySortKey = (entity: any): string =>
  typeof entity?.slug === 'string' && entity.slug.trim()
    ? entity.slug.trim()
    : studentVisibilityGateEntityIdKey(entity);

export interface StudentVisibilityGateOptions {
  collection: StudentVisibilityGateCollection;
  mode: StudentVisibilityGateMode;
  sourceName?: string;
  recordIds?: string[];
  limit?: number;
  staleVersion?: boolean;
}

// A stale-version sweep targets records whose stored gate-logic generation no
// longer matches the current one - including never-gated records (no stored
// version) - so a gate-logic change (#1405) can be re-applied corpus-wide
// without a full unconditional rescan. Only honored when no explicit record or
// source scope is set, which always take precedence.
export function staleStudentVisibilityVersionClause(): Record<string, any> {
  return { studentVisibilityVersion: { $ne: STUDENT_VISIBILITY_VERSION } };
}

export interface StudentVisibilityGatePlan {
  collection: VisibilityReleaseQueueCollection;
  recordId: string;
  label: string;
  currentTier?: string;
  currentComputedTier?: string;
  currentReasons?: string[];
  computedTier: StudentVisibilityTier;
  tier: StudentVisibilityTier;
  reasons: string[];
  sourceNames: string[];
  nextRepairAction: string;
  hasResolvedLead?: boolean;
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

const evidenceReasons = new Set([
  'application_route',
  'concrete_next_step',
  'graduate_relevant',
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
  'blank_public_description',
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
  'missing_alternate_access_path',
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
  'non_research_entity',
  'non_research_program',
  'not_undergraduate_relevant',
  'profile_biography_shell',
  'research_infrastructure_only',
]);
const reviewExceptionReasons = new Set(['formalization_only']);
export const researchEntityGateProjection =
  '_id slug name displayName kind entityType website websiteUrl profileUrls sourceUrls departments researchAreas shortDescription fullDescription profileSynthesisDescription descriptionSource activeAtYaleCache yaleStatusCache studentVisibilityTier studentVisibilityComputedTier studentVisibilityOverrideTier studentVisibilityReasons';

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

// A repair blocker is exactly a HARD-blocker reason from the canonical
// student_ready taxonomy (issue #1802). SOFT enrichment signals never gate and
// are never blockers - including the `missing_*` ones that a blanket
// `startsWith('missing_')` rule would otherwise sweep in. The single source of
// truth is STUDENT_READY_HARD_BLOCKER_REASONS / STUDENT_READY_SOFT_SIGNAL_REASONS
// in studentVisibilityTier.ts. The residual `_only` clause keeps
// review-exception reasons (formalization_only, application_source_only,
// profile_fallback_only) blocking without enumerating each here.
export function isBlockingVisibilityReason(reason: string): boolean {
  if (evidenceReasons.has(reason)) return false;
  if (isStudentReadySoftSignalReason(reason)) return false;
  if (isStudentReadyHardBlockerReason(reason)) return true;
  return reason.endsWith('_only');
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

const sortedStrings = (values: string[]): string[] =>
  [...values].sort((a, b) => a.localeCompare(b));

const stringSetsEqual = (left: string[], right: string[]): boolean => {
  if (left.length !== right.length) return false;
  const sortedLeft = sortedStrings(left);
  const sortedRight = sortedStrings(right);
  return sortedLeft.every((value, index) => value === sortedRight[index]);
};

export function isStudentVisibilityGatePlanMateriallyChanged(
  plan: StudentVisibilityGatePlan,
): boolean {
  if (plan.currentTier !== plan.tier) return true;
  if (plan.currentComputedTier !== undefined && plan.currentComputedTier !== plan.computedTier) {
    return true;
  }
  if (Array.isArray(plan.currentReasons) && !stringSetsEqual(plan.currentReasons, plan.reasons)) {
    return true;
  }
  return false;
}

const exactDuplicateUrlRejectedPathPatterns = [
  /\/(?:people|faculty|professors|directory|members|humans\/faculty|labs|staff|team)\/?$/i,
  /\/(?:[^/]+\/)*membership\/directory\/?$/i,
  // Generic index / listing / opportunity / API pages: distinct research homes
  // legitimately share these, so they are NOT a same-entity duplicate signal.
  /(?:employment|research|undergraduate|volunteer)[-/]opportunities/i,
  /\/diversity\//i,
  /(?:awards?\.json|\/services\/)/i,
  // Institutional "about"/landing pages (and their index subtrees such as the
  // YSM A-to-Z lab index) are navigation furniture that many unrelated research
  // homes carry in sourceUrls, so they are never a same-entity duplicate signal.
  /^\/about(?:\/|$)/i,
];

// Hosts that serve generic API/listing endpoints rather than a specific
// research home, so a shared URL on them is not a duplicate signal.
const genericDuplicateSignalHosts = new Set(['api.nsf.gov', 'api.reporter.nih.gov']);

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
    if (genericDuplicateSignalHosts.has(url.hostname.toLowerCase())) return false;
    if (exactDuplicateUrlRejectedPathPatterns.some((pattern) => pattern.test(path))) return false;
    return true;
  } catch {
    return false;
  }
}

const entityDuplicateUrls = (entity: any): string[] =>
  uniqueStrings([
    entity.websiteUrl,
    entity.website,
    ...(Array.isArray(entity.sourceUrls) ? entity.sourceUrls : []),
  ])
    .map(normalizedExactDuplicateUrl)
    .filter(isSpecificDuplicateSignalUrl);

function exactDuplicateCanonicalScore(
  entity: any,
  leadCountsByEntityId: Map<string, number>,
): number {
  const id = studentVisibilityGateEntityIdKey(entity);
  const textScore =
    (typeof entity.fullDescription === 'string' && entity.fullDescription.trim().length >= 80
      ? 35
      : 0) +
    (typeof entity.shortDescription === 'string' && entity.shortDescription.trim().length >= 40
      ? 20
      : 0);
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
    const id = studentVisibilityGateDocumentId(row.researchEntityId);
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
      return studentVisibilityGateEntitySortKey(a).localeCompare(
        studentVisibilityGateEntitySortKey(b),
      );
    })[0];
    const canonicalId = studentVisibilityGateEntityIdKey(canonical);
    for (const entity of group) {
      const id = studentVisibilityGateEntityIdKey(entity);
      if (id && id !== canonicalId) duplicateIds.add(id);
    }
  }
  return duplicateIds;
}

const increment = (counts: Record<string, number>, key: string) => {
  counts[key] = (counts[key] || 0) + 1;
};

const countByEntityId = (rows: Array<{ _id: unknown; count: number }>) =>
  new Map(rows.map((row) => [studentVisibilityGateDocumentId(row._id), row.count]));

const REACH_OUT_PLAUSIBLE_SIGNAL_TYPE = 'REACH_OUT_PLAUSIBLE';

const hasHttpSourceUrl = (value: unknown): boolean =>
  typeof value === 'string' && /^https?:\/\//i.test(value.trim());

export interface ReachOutPlausibleGateSignal {
  type?: unknown;
  archived?: unknown;
  derivationKey?: unknown;
  source?: { url?: unknown; evidenceIds?: unknown; name?: unknown } | null;
}

// A REACH_OUT_PLAUSIBLE signal is a derived exploratory ways-in, so it inherently
// carries no external http `source.url`; requiring one hides an already-earned
// signal from the action-evidence gate. It still counts only when it is backed by
// a supporting source observation and the entity itself carries an official
// non-grant page, so no weaker or unbacked signal can pass. Signals that already
// carry an http `source.url` are counted by the primary aggregation and excluded
// here to avoid double counting.
export function reachOutPlausibleSignalCreditsActionEvidence(input: {
  signal: ReachOutPlausibleGateSignal;
  entity: { websiteUrl?: unknown; website?: unknown; sourceUrls?: unknown };
}): boolean {
  const { signal, entity } = input;
  if (signal.archived === true) return false;
  if (signal.type !== REACH_OUT_PLAUSIBLE_SIGNAL_TYPE) return false;
  if (
    typeof signal.derivationKey === 'string' &&
    IDENTIFIED_LEAD_FALLBACK_DERIVATION_KEYS.has(signal.derivationKey)
  ) {
    return false;
  }
  if (hasHttpSourceUrl(signal.source?.url)) return false;
  const evidenceIds = Array.isArray(signal.source?.evidenceIds) ? signal.source?.evidenceIds : [];
  if (evidenceIds.length === 0) return false;
  return Boolean(officialNonGrantSourceUrl(entity));
}

// Single source of truth for "does this access Signal count as action evidence"
// - the exact rule the gate applies when it decides student_ready. Both the gate
// corpus recompute and any backfill/promotion script must credit signals through
// this predicate so they cannot drift apart: an identified-lead fallback signal
// (a discovery hint, not access evidence, see #1359/#1388) never credits, while a
// non-fallback access signal credits when it carries an http source.url, and a
// derived REACH_OUT_PLAUSIBLE without an http source.url credits only when it is
// backed by a supporting observation and an official non-grant entity page.
export function accessSignalCreditsActionEvidence(input: {
  signal: ReachOutPlausibleGateSignal & { type?: unknown; source?: { url?: unknown } | null };
  entity: { websiteUrl?: unknown; website?: unknown; sourceUrls?: unknown };
}): boolean {
  const { signal, entity } = input;
  if (signal.archived === true) return false;
  if (typeof signal.type !== 'string' || !(accessSignalTypes as readonly string[]).includes(signal.type)) {
    return false;
  }
  if (
    typeof signal.derivationKey === 'string' &&
    IDENTIFIED_LEAD_FALLBACK_DERIVATION_KEYS.has(signal.derivationKey)
  ) {
    return false;
  }
  if (hasHttpSourceUrl(signal.source?.url)) return true;
  if (signal.type === REACH_OUT_PLAUSIBLE_SIGNAL_TYPE) {
    return reachOutPlausibleSignalCreditsActionEvidence({ signal, entity });
  }
  return false;
}

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
  const entityById = new Map(
    args.entities.map((entity) => [studentVisibilityGateDocumentId(entity._id), entity]),
  );
  const leadRowsByUserId = new Map<string, any[]>();
  for (const row of args.leadRows) {
    const userId = studentVisibilityGateDocumentId(row.userId);
    if (!userId || row.role !== 'pi') continue;
    leadRowsByUserId.set(userId, [...(leadRowsByUserId.get(userId) || []), row]);
  }

  return Array.from(leadRowsByUserId.entries())
    .map(([userId, rows]) => {
      const entityIds = new Set<string>();
      const entities = [
        ...rows
          .map((row) => entityById.get(studentVisibilityGateDocumentId(row.researchEntityId)))
          .filter(Boolean),
        ...(args.extraEntitiesByUserId?.get(userId) || []),
      ]
        .filter((entity: any) => {
          const id = studentVisibilityGateDocumentId(entity._id);
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
    id: studentVisibilityGateDocumentId(entity._id),
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
        for (const lead of args.leadsByEntityId.get(studentVisibilityGateDocumentId(entity._id)) ||
          []) {
          const userId = studentVisibilityGateDocumentId(lead.userId);
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

export function normalizeStudentVisibilityGateObjectId(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return STUDENT_VISIBILITY_GATE_OBJECT_ID_RE.test(trimmed) ? trimmed : undefined;
  }
  if (value instanceof mongoose.Types.ObjectId) return value.toHexString();
  return undefined;
}

function toStudentVisibilityGateObjectId(value: unknown): mongoose.Types.ObjectId | undefined {
  const id = normalizeStudentVisibilityGateObjectId(value);
  return id ? new mongoose.Types.ObjectId(id) : undefined;
}

function validObjectIdStrings(values: unknown[]): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => normalizeStudentVisibilityGateObjectId(value))
        .filter((value): value is string => Boolean(value)),
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
    _id: { $in: recordIds.map((id) => toStudentVisibilityGateObjectId(id)).filter(Boolean) },
    archived: true,
  })
    .select('_id')
    .lean();
  const archivedRecordIds = archivedEntities.map((entity) =>
    studentVisibilityGateDocumentId(entity._id),
  );
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
    if (isStudentVisibilityGatePlanMateriallyChanged(plan)) counts.changed += 1;
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

export interface StudentVisibilityGateApplyOps {
  researchOps: any[];
  programOps: any[];
  queueOps: any[];
}

const openQueueKey = (collection: string, recordId: unknown): string =>
  `${collection}:${String(recordId)}`;

export function buildStudentVisibilityGateApplyOps(
  plans: StudentVisibilityGatePlan[],
  openQueueKeys: Set<string>,
  now: Date,
): StudentVisibilityGateApplyOps {
  const researchOps: any[] = [];
  const programOps: any[] = [];
  const queueOps: any[] = [];

  for (const plan of plans) {
    const materiallyChanged = isStudentVisibilityGatePlanMateriallyChanged(plan);
    if (materiallyChanged) {
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
    }

    const hasOpenQueueItem = openQueueKeys.has(openQueueKey(plan.collection, plan.recordId));

    if (PUBLIC_TIERS.has(plan.tier)) {
      if (hasOpenQueueItem) {
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
      }
      continue;
    }

    if (plan.tier === 'suppressed') {
      if (hasOpenQueueItem) {
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
      }
      continue;
    }

    if (!materiallyChanged && hasOpenQueueItem) continue;

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

  return { researchOps, programOps, queueOps };
}

async function loadOpenReleaseQueueKeys(
  plans: StudentVisibilityGatePlan[],
): Promise<Set<string>> {
  const recordIds = Array.from(new Set(plans.map((plan) => plan.recordId)));
  if (recordIds.length === 0) return new Set();
  const openItems = await VisibilityReleaseQueueItem.find({
    status: 'open',
    recordId: { $in: recordIds },
  })
    .select('collection recordId')
    .lean();
  return new Set(
    (openItems as unknown as Array<{ collection: string; recordId: unknown }>).map((item) =>
      openQueueKey(item.collection, item.recordId),
    ),
  );
}

export async function applyStudentVisibilityGatePlans(
  plans: StudentVisibilityGatePlan[],
): Promise<void> {
  const now = new Date();
  const openQueueKeys = await loadOpenReleaseQueueKeys(plans);
  const { researchOps, programOps, queueOps } = buildStudentVisibilityGateApplyOps(
    plans,
    openQueueKeys,
    now,
  );

  await Promise.all([
    researchOps.length > 0
      ? (ResearchEntity as any).bulkWrite(researchOps, { ordered: false })
      : undefined,
    programOps.length > 0
      ? (Fellowship as any).bulkWrite(programOps, { ordered: false })
      : undefined,
    queueOps.length > 0
      ? (VisibilityReleaseQueueItem as any).bulkWrite(queueOps, { ordered: false })
      : undefined,
  ]);
  await resolveArchivedResearchQueueItems(now);
}

async function planResearchEntityGateUpdates(
  options: Pick<StudentVisibilityGateOptions, 'sourceName' | 'recordIds' | 'limit' | 'staleVersion'>,
): Promise<StudentVisibilityGatePlan[]> {
  const match: Record<string, any> = { archived: { $ne: true } };
  if (options.recordIds?.length) match._id = { $in: options.recordIds };
  if (options.staleVersion && !options.recordIds?.length && !options.sourceName) {
    Object.assign(match, staleStudentVisibilityVersionClause());
  }
  if (options.sourceName) {
    const [accessEntityIds, observationEntityIds, observationEntityKeys] = await Promise.all([
      Signal.distinct('researchEntityId', {
        type: { $in: accessSignalTypes },
        'source.name': options.sourceName,
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
    if (observationEntityKeys.length > 0)
      sourceClauses.push({ slug: { $in: observationEntityKeys } });
    if (match._id) {
      match._id = {
        $in: sourceEntityIds.filter((id: any) => {
          const normalizedId = studentVisibilityGateDocumentId(id);
          return normalizedId && options.recordIds?.includes(normalizedId);
        }),
      };
    } else if (sourceClauses.length === 1) {
      Object.assign(match, sourceClauses[0]);
    } else if (sourceClauses.length > 1) {
      match.$or = sourceClauses;
    } else {
      match._id = { $in: [] };
    }
  }

  const query = ResearchEntity.find(match).select(researchEntityGateProjection).sort({ name: 1 });
  if (options.limit && Number.isFinite(options.limit)) query.limit(options.limit);
  const entities = await query.lean();
  const needsDuplicateReferenceCorpus =
    Boolean(options.recordIds?.length) ||
    Boolean(options.sourceName) ||
    Boolean(options.limit && Number.isFinite(options.limit));
  const duplicateReferenceEntities = needsDuplicateReferenceCorpus
    ? await ResearchEntity.find({ archived: { $ne: true } })
        .select(researchEntityGateProjection)
        .lean()
    : entities;
  const entityIds = entities.map((entity: any) => entity._id);

  const [
    rosterByEntityId,
    accessRows,
    reachOutPlausibleWithoutHttpSource,
    alternateAccessPathCounts,
  ] = await Promise.all([
    getResearchEntityRosterByEntityId(entityIds),
    Signal.aggregate([
      {
        $match: {
          researchEntityId: { $in: entityIds },
          type: { $in: [...accessSignalTypes] },
          archived: false,
          'source.url': { $regex: '^https?://', $options: 'i' },
          derivationKey: { $nin: Array.from(IDENTIFIED_LEAD_FALLBACK_DERIVATION_KEYS) },
        },
      },
      {
        $group: {
          _id: '$researchEntityId',
          count: { $sum: 1 },
          sourceNames: { $addToSet: '$source.name' },
        },
      },
    ]),
    Signal.find({
      researchEntityId: { $in: entityIds },
      type: REACH_OUT_PLAUSIBLE_SIGNAL_TYPE,
      archived: false,
      'source.url': { $not: /^https?:\/\//i },
    })
      .select('researchEntityId type archived derivationKey source.url source.evidenceIds source.name')
      .lean(),
    countResearchEntityAlternateAccessPaths(entityIds),
  ]);

  const leadRows = Array.from(rosterByEntityId.values())
    .flat()
    .filter(
      (entry) => entry.state !== 'HISTORICAL' && STUDENT_VISIBILITY_GATE_LEAD_ROLES.has(entry.role),
    )
    .map((entry) => {
      const [fname = '', ...rest] = String(entry.name || '')
        .trim()
        .split(/\s+/);
      const lname = rest.join(' ');
      const officialProfileUrl = officialProfileUrlFromRosterEntry(entry);
      return {
        researchEntityId: entry.researchEntityId,
        role: entry.role,
        userId: entry.personId,
        name: entry.name,
        ...(entry.title ? { title: entry.title } : {}),
        user: {
          _id: entry.personId,
          netid: entry.netid,
          displayName: entry.name,
          fname,
          lname,
          ...(entry.title ? { title: entry.title } : {}),
          ...(entry.websiteUrl ? { websiteUrl: entry.websiteUrl } : {}),
          ...(officialProfileUrl ? { profileUrls: { official: officialProfileUrl } } : {}),
        },
      };
    });

  const profileAreaNamesByUserId = new Map<string, string[]>();
  for (const row of leadRows) {
    const userId = studentVisibilityGateDocumentId(row.userId);
    if (!userId || profileAreaNamesByUserId.has(userId)) continue;
    profileAreaNamesByUserId.set(
      userId,
      profileAreaNamesForVisibilityPi(row.user.fname, row.user.lname),
    );
  }
  const profileAreaNames = uniqueStrings(Array.from(profileAreaNamesByUserId.values()).flat());
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
  for (const row of leadRows) {
    const key = studentVisibilityGateDocumentId(row.researchEntityId);
    leadsByEntityId.set(key, [...(leadsByEntityId.get(key) || []), row]);
  }
  const accessCounts = countByEntityId(accessRows as any[]);
  const sourceNamesByEntityId = new Map(
    (accessRows as any[]).map((row) => [
      studentVisibilityGateDocumentId(row._id),
      uniqueStrings(row.sourceNames || []),
    ]),
  );
  const entityById = new Map(
    (entities as any[]).map((entity) => [studentVisibilityGateDocumentId(entity._id), entity]),
  );

  for (const signal of reachOutPlausibleWithoutHttpSource as any[]) {
    const entityId = studentVisibilityGateDocumentId(signal.researchEntityId);
    const entity = entityById.get(entityId);
    if (!entity) continue;
    if (!reachOutPlausibleSignalCreditsActionEvidence({ signal, entity })) continue;
    accessCounts.set(entityId, (accessCounts.get(entityId) || 0) + 1);
    const sourceName = typeof signal.source?.name === 'string' ? signal.source.name.trim() : '';
    sourceNamesByEntityId.set(
      entityId,
      uniqueStrings([...(sourceNamesByEntityId.get(entityId) || []), sourceName]),
    );
  }

  const samePiDuplicateRiskEntityIds = selectSamePiDuplicateRiskEntityIds([
    ...buildSamePiVisibilityDedupeRows({
      entities: entities as any[],
      leadRows: leadRows as any[],
      extraEntitiesByUserId: profileAreaEntitiesByUserId,
    }),
    ...buildNameOnlyVisibilityDedupeRows({
      entities: entities as any[],
      leadsByEntityId,
    }),
  ]);
  const exactUrlDuplicateRiskEntityIds = selectExactUrlDuplicateRiskEntityIds(
    duplicateReferenceEntities as any[],
    leadRows as any[],
  );
  const concreteLeadEntityUserIds = new Set<string>();
  for (const row of leadRows as any[]) {
    const entity = entityById.get(studentVisibilityGateDocumentId(row.researchEntityId));
    const userId = studentVisibilityGateDocumentId(row.userId);
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
    const recordId = studentVisibilityGateDocumentId(entity._id);
    const leadMembers = leadsByEntityId.get(recordId) || [];
    const result = computeResearchEntityStudentVisibility({
      entity,
      leadMembers,
      accessSignalCount: accessCounts.get(recordId) || 0,
      actionablePathwayCount: 0,
      openPostedOpportunityCount: 0,
      duplicateRisk:
        hasProfileAreaShellDuplicateRisk({
          entity,
          leadMembers,
          concreteLeadEntityUserIds,
        }) || samePiDuplicateRiskEntityIds.has(recordId),
      exactUrlDuplicateRisk: exactUrlDuplicateRiskEntityIds.has(recordId),
      relatedEntityAccessPathCount: alternateAccessPathCounts.get(recordId) || 0,
    });
    return {
      collection: 'research' as const,
      recordId,
      label: entity.displayName || entity.name || entity.slug || recordId,
      currentTier: entity.studentVisibilityTier,
      currentComputedTier: entity.studentVisibilityComputedTier,
      currentReasons: Array.isArray(entity.studentVisibilityReasons)
        ? entity.studentVisibilityReasons
        : [],
      tier: result.tier,
      computedTier: result.computedTier,
      reasons: result.reasons,
      sourceNames: sourceNamesByEntityId.get(recordId) || [],
      nextRepairAction: nextRepairActionForReasons(result.reasons),
      hasResolvedLead: leadMembers.length > 0,
    };
  });
}

async function planProgramGateUpdates(
  options: Pick<StudentVisibilityGateOptions, 'sourceName' | 'recordIds' | 'limit' | 'staleVersion'>,
): Promise<StudentVisibilityGatePlan[]> {
  const match: Record<string, any> = { archived: false };
  if (options.recordIds?.length) match._id = { $in: options.recordIds };
  if (options.staleVersion && !options.recordIds?.length && !options.sourceName) {
    Object.assign(match, staleStudentVisibilityVersionClause());
  }
  if (options.sourceName) match.sourceName = options.sourceName;
  const query = Fellowship.find(match).sort({ title: 1 });
  if (options.limit && Number.isFinite(options.limit)) query.limit(options.limit);
  const programs = await query.lean();

  return programs.map((program: any) => {
    const recordId = studentVisibilityGateDocumentId(program._id);
    const result = computeProgramStudentVisibility(program);
    return {
      collection: 'programs' as const,
      recordId,
      label: program.title || recordId,
      currentTier: program.studentVisibilityTier,
      currentComputedTier: program.studentVisibilityComputedTier,
      currentReasons: Array.isArray(program.studentVisibilityReasons)
        ? program.studentVisibilityReasons
        : [],
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

export function evaluateStudentVisibilityGateLeadResolution(
  plans: StudentVisibilityGatePlan[],
  options: { maxZeroLeadRatio?: number; minLeadRequiringEntities?: number } = {},
): RosterLeadResolutionResult {
  const researchPlans = plans.filter((plan) => plan.collection === 'research');
  const resolvedLeadEntityCount = researchPlans.filter((plan) => plan.hasResolvedLead).length;
  const zeroLeadEntityCount = researchPlans.filter((plan) =>
    plan.reasons.includes('missing_lead'),
  ).length;
  return evaluateRosterLeadResolution({
    resolvedLeadEntityCount,
    zeroLeadEntityCount,
    maxZeroLeadRatio: options.maxZeroLeadRatio,
    minLeadRequiringEntities: options.minLeadRequiringEntities,
  });
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
  if (options.mode === 'apply') {
    const leadResolution = evaluateStudentVisibilityGateLeadResolution(plans);
    if (!leadResolution.safe) {
      throw new Error(`Refusing to apply student visibility gate: ${leadResolution.blocker}`);
    }
    await applyStudentVisibilityGatePlans(plans);
  }
  return report;
}

export async function listVisibilityReleaseQueue(input: {
  collection?: VisibilityReleaseQueueCollection;
  reason?: string;
  sourceName?: string;
  status?: string;
  page?: unknown;
  pageSize?: unknown;
}) {
  const page = Math.min(MAX_RELEASE_QUEUE_PAGE, Math.max(1, Math.floor(Number(input.page) || 1)));
  const pageSize = Math.min(100, Math.max(1, Math.floor(Number(input.pageSize) || 25)));
  const filter: Record<string, any> = {};
  if (input.collection === 'research' || input.collection === 'programs') {
    filter.collection = input.collection;
  }
  filter.status = normalizeReleaseQueueStatus(input.status);
  const reason = normalizeReleaseQueueFilterValue(input.reason);
  const sourceName = normalizeReleaseQueueFilterValue(input.sourceName);
  if (reason) filter.blockerReasons = reason;
  if (sourceName) filter.sourceNames = sourceName;

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

const normalizeReleaseQueueFilterValue = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_RELEASE_QUEUE_FILTER_LENGTH) return undefined;
  return trimmed;
};

const normalizeReleaseQueueStatus = (value: unknown): VisibilityReleaseQueueStatus => {
  const status = normalizeReleaseQueueFilterValue(value);
  return status && (visibilityReleaseQueueStatuses as readonly string[]).includes(status)
    ? (status as VisibilityReleaseQueueStatus)
    : 'open';
};

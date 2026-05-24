/**
 * Reads pending Observations for a given entity, resolves field values via the
 * ConfidenceResolver, and writes the resolved values back to the entity collection.
 *
 * For Paper and User entities, also handles upsert when no entityId is yet known
 * (lookup by entityKey, e.g. DOI for Paper or netid for User).
 */
import mongoose from 'mongoose';
import { ResearchScholarlyAttribution } from '../models/researchScholarlyAttribution';
import { Observation, ObservedEntityType } from '../models/observation';
import { Fellowship } from '../models/fellowship';
import { ResearchScholarlyLink } from '../models/researchScholarlyLink';
import { User } from '../models/user';
import { ResearchEntity } from '../models/researchEntity';
import { ResearchEntityRelationship } from '../models/researchEntityRelationship';
import { ResearchGroupMember } from '../models/researchGroupMember';
import { ScrapeRun } from '../models/scrapeRun';
import { PostedOpportunity } from '../models/postedOpportunity';
import { AccessSignal } from '../models/accessSignal';
import { ContactRoute } from '../models/contactRoute';
import { EntryPathway } from '../models/entryPathway';
import { resolveAllFields, ResolverObservation, ResolvedField } from './confidenceResolver';
import { publicResearchAreaArray } from '../services/researchEntityDto';
import { syncEntity, isSyncableEntityType } from '../services/meiliSyncService';
import {
  bestMaterializerObservation,
  materializeAccessForResearchGroup,
  materializerStringValue,
  publicAccessExcerpt,
} from './accessMaterializer';
import type { ReportPostMaterializationMetrics } from './runReport';
import type { FellowshipCatalogMetrics } from './types';
import { isPubliclyExposableSourceUrl } from '../utils/publicSourceUrl';
import { upsertAccessSignal, type UpsertAccessSignalInput } from '../services/accessSignalService';
import { upsertContactRoute, type UpsertContactRouteInput } from '../services/contactRouteService';
import { upsertEntryPathway, type UpsertEntryPathwayInput } from '../services/entryPathwayService';
import {
  runPostMaterializationIntegrityGate,
  type PostMaterializationIntegritySummary,
} from './integrityGate';
import {
  canonicalizeDepartmentList,
  canonicalizeProfileDepartments,
} from '../services/departmentResolver';
import {
  cleanProfileText,
  isMaterializableUserBioCandidate,
  profileWordCount,
  researchNarrativeScore,
} from '../utils/profileBioQuality';
import { httpUrlHasHostSuffix } from '../utils/urlNormalization';

export { isMaterializableUserBioCandidate } from '../utils/profileBioQuality';
import {
  PAPER_AUTHORSHIP_EVIDENCE_FIELD,
  PaperAuthorshipEvidence,
  normalizePaperAuthorshipEvidence,
} from './paperAuthorshipPolicy';
import { isGenericResearchWebsiteIndexUrl } from '../utils/researchWebsiteUrl';

interface MaterializeOptions {
  dryRun?: boolean;
  syncMeilisearch?: boolean;
  skipAccessMaterialization?: boolean;
}

interface MaterializeResult {
  entityType: ObservedEntityType;
  entityId?: string;
  entityKey?: string;
  fieldsWritten: number;
  conflicts: number;
  created: boolean;
  resolved: Record<string, ResolvedField>;
  postMaterializationMetrics?: ReportPostMaterializationMetrics;
  skipped?: string;
}

interface ListingPostedOpportunityMetricDeps {
  observationModel?: Pick<typeof Observation, 'aggregate'>;
  postedOpportunityModel?: Pick<typeof PostedOpportunity, 'countDocuments'>;
}

interface InferredPiMembershipDeps {
  userModel?: Pick<typeof User, 'findById' | 'findOne' | 'find'>;
  observationModel?: Pick<typeof Observation, 'find'>;
  researchGroupMemberModel?: Pick<typeof ResearchGroupMember, 'findOne' | 'create' | 'updateOne'>;
}

interface ResolvedMemberMaterializationDeps {
  researchEntityModel?: Pick<typeof ResearchEntity, 'findOne'>;
  userModel?: Pick<typeof User, 'findOne'>;
  researchGroupMemberModel?: Pick<typeof ResearchGroupMember, 'findOne' | 'create' | 'updateOne'>;
}

interface ResolvedRelationshipMaterializationDeps {
  researchEntityModel?: Pick<typeof ResearchEntity, 'findOne' | 'find' | 'findById'>;
  relationshipModel?: Pick<typeof ResearchEntityRelationship, 'updateOne'>;
  researchGroupMemberModel?: Pick<typeof ResearchGroupMember, 'findOne' | 'create' | 'updateOne'>;
}

interface ProfileBackedFacultyResearchAreaMemberDeps {
  userModel?: Pick<typeof User, 'findById'>;
  researchGroupMemberModel?: Pick<typeof ResearchGroupMember, 'findOne' | 'create' | 'updateOne'>;
}

interface InferredPiMembershipResult {
  synced: boolean;
  created: boolean;
  userId?: string;
  skipped?: 'no-inferred-owner' | 'user-not-resolved';
}

interface ResolvedMemberMaterializationResult {
  synced: boolean;
  created: boolean;
  researchEntityId?: string;
  userId?: string;
  skipped?:
    | 'missing-keys'
    | 'entity-not-resolved'
    | 'user-not-resolved'
    | 'archived-entity-without-canonical';
}

interface ResolvedRelationshipMaterializationResult {
  synced: boolean;
  created: boolean;
  sourceResearchEntityId?: string;
  targetResearchEntityId?: string;
  skipped?: 'missing-keys' | 'source-not-resolved' | 'target-not-resolved';
}

interface OfficialProfileCoverageDeps {
  accessSignalModel?: Pick<typeof AccessSignal, 'findOne'>;
  contactRouteModel?: Pick<typeof ContactRoute, 'findOne'>;
  entryPathwayModel?: Pick<typeof EntryPathway, 'findOne'>;
  accessSignalService?: typeof upsertAccessSignal;
  contactRouteService?: typeof upsertContactRoute;
  entryPathwayService?: typeof upsertEntryPathway;
}

interface OfficialProfileCoverageResult {
  entryPathways: number;
  accessSignals: number;
  contactRoutes: number;
}

const DISCOVERY_ONLY_ACCESS_FIELD_SOURCES = new Set(['ysm-atoz-index', 'yse-centers-index']);
const USER_MATERIALIZATION_BLOCKED_SOURCES = new Set(['nih-reporter', 'nsf-award-search']);
const PUBLIC_QUOTE_FIELDS = new Set([
  'undergradEvidenceQuote',
  'undergradRoleEvidenceQuote',
  'contactInstructionsQuote',
  'undergradConstraintQuote',
]);
const ACCESS_MATERIALIZING_SOURCES = new Set([
  'lab-microsite-undergrad-llm',
  'undergrad-fellowships-recipients',
  'yale-college-fellowships-office',
  'dept-faculty-roster',
  'ylabs-listing',
  'manual-admin-edit',
  'manual-pi-edit',
]);
const ACCESS_MATERIALIZING_FIELDS = new Set([
  'acceptingUndergrads',
  'undergradAccessEvidence',
  'undergradEvidenceQuote',
  'undergradRoleEvidenceQuote',
  'undergradConstraintQuote',
  'contactInstructionsQuote',
  'joinPageUrl',
  'contactName',
  'contactEmail',
  'contactRole',
  'currentUndergradCount',
  'pastUndergradAdvisees',
  'courses',
]);

type MaterializerObservationLike = {
  field?: string;
  sourceName?: string;
  value?: unknown;
};

export function shouldMaterializeAccessForRunObservations(args: {
  entityType: ObservedEntityType;
  sourceNames?: string[];
  fields?: string[];
}): boolean {
  if (!isResearchEntityObservationType(args.entityType)) return false;
  if ((args.sourceNames || []).some((sourceName) => ACCESS_MATERIALIZING_SOURCES.has(sourceName))) {
    return true;
  }
  return (args.fields || []).some((field) => ACCESS_MATERIALIZING_FIELDS.has(field));
}

type PaperMaterializationObservation = {
  field: string;
  value: unknown;
  sourceName: string;
  confidence: number;
  observedAt: Date;
  sourceUrl?: string;
};

type PaperMaterializationPatch = {
  update: {
    $set: Record<string, unknown>;
    $addToSet?: Record<string, { $each: unknown[] }>;
  };
  fieldsWritten: number;
  conflicts: number;
  skipped?: string;
};

type FellowshipMaterializationObservation = {
  field: string;
  value: unknown;
  sourceName: string;
  confidence: number;
  observedAt: Date;
  sourceUrl?: string;
};

type FellowshipMaterializationPatch = {
  update: {
    $set: Record<string, unknown>;
  };
  fieldsWritten: number;
  conflicts: number;
  unchanged: boolean;
  skipped?: string;
};

function sourceUrlHostname(value: unknown): string {
  const url = cleanProfileText(value);
  if (!url) return '';
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function isOfficialYaleProfileObservation(observation: ResolverObservation): boolean {
  const hostname = sourceUrlHostname(observation.sourceUrl);
  return (
    observation.sourceName === 'official-profile-enrichment' ||
    (!!hostname &&
      (hostname === 'yale.edu' || hostname.endsWith('.yale.edu')) &&
      /\/(?:profile|people|person|faculty|directory|faculty-directory)(?:\/|$|-)/i.test(
        cleanProfileText(observation.sourceUrl),
      ))
  );
}

function isFacultyControlledProfileObservation(observation: ResolverObservation): boolean {
  const hostname = sourceUrlHostname(observation.sourceUrl);
  if (!hostname) return false;
  if (isOfficialYaleProfileObservation(observation)) return false;
  return (
    observation.sourceName === 'dept-faculty-roster' ||
    observation.sourceName === 'official-profile-enrichment'
  );
}

export function buildUserBioObservationScore(
  observation: ResolverObservation,
  baseScore: number,
): number {
  if (observation.field !== 'bio') return baseScore;
  if (!isMaterializableUserBioCandidate(observation.value)) return 0;

  let multiplier = researchNarrativeScore(observation.value);
  if (isFacultyControlledProfileObservation(observation)) multiplier += 0.45;
  else if (isOfficialYaleProfileObservation(observation)) multiplier += 0.1;

  return baseScore * multiplier;
}

function isResearchEntityObservationType(entityType: ObservedEntityType): boolean {
  return entityType === 'researchEntity' || entityType === 'researchGroup';
}

const firstStringValue = materializerStringValue;

function stringValues(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(stringValues);
  const text = firstStringValue(value);
  return text ? [text] : [];
}

function normalizeOfficialYaleLabUrl(value: unknown): string | null {
  const text = firstStringValue(value);
  if (!text) return null;
  try {
    const parsed = new URL(text);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.replace(/\/+$/, '');
    if (host !== 'medicine.yale.edu' || !/^\/lab\/[^/]+$/i.test(path)) return null;
    return `https://medicine.yale.edu${path.toLowerCase()}/`;
  } catch {
    return null;
  }
}

function bestObservationForField<
  T extends { field?: string; confidence?: number; observedAt?: Date },
>(observations: T[], field: string): T | undefined {
  return bestMaterializerObservation(
    observations.filter((observation) => observation.field === field),
  );
}

export function shouldIgnoreObservationForEntityMaterialization(
  entityType: ObservedEntityType,
  observation: MaterializerObservationLike,
): boolean {
  if (observation.field === 'lastObservedAt') {
    return true;
  }

  if (
    entityType === 'user' &&
    !!observation.sourceName &&
    USER_MATERIALIZATION_BLOCKED_SOURCES.has(observation.sourceName)
  ) {
    return true;
  }

  if (
    isResearchEntityObservationType(entityType) &&
    observation.field === 'websiteUrl' &&
    isGenericResearchWebsiteIndexUrl(observation.value)
  ) {
    return true;
  }

  return (
    isResearchEntityObservationType(entityType) &&
    observation.field === 'acceptingUndergrads' &&
    !!observation.sourceName &&
    DISCOVERY_ONLY_ACCESS_FIELD_SOURCES.has(observation.sourceName)
  );
}

export function shouldClearIgnoredAccessClaimForEntity(
  entityType: ObservedEntityType,
  observations: MaterializerObservationLike[],
  manuallyLockedFields: string[] = [],
): boolean {
  if (!isResearchEntityObservationType(entityType)) return false;
  if (manuallyLockedFields.includes('acceptingUndergrads')) return false;

  const acceptingObservations = observations.filter((obs) => obs.field === 'acceptingUndergrads');
  if (acceptingObservations.length === 0) return false;

  return acceptingObservations.every((obs) =>
    shouldIgnoreObservationForEntityMaterialization(entityType, obs),
  );
}

export function materializedFieldValue(
  entityType: ObservedEntityType,
  field: string,
  value: unknown,
): unknown {
  if (
    isResearchEntityObservationType(entityType) &&
    PUBLIC_QUOTE_FIELDS.has(field) &&
    typeof value === 'string'
  ) {
    return publicAccessExcerpt(value) || '';
  }
  if (isResearchEntityObservationType(entityType) && field === 'researchAreas') {
    return publicResearchAreaArray(value);
  }
  return value;
}

export function emptyPostMaterializationMetrics(): Required<ReportPostMaterializationMetrics> {
  return {
    entryPathways: 0,
    accessSignals: 0,
    contactRoutes: 0,
    postedOpportunities: 0,
    guardedContactRoutes: 0,
    staleEvidenceSkipped: 0,
    conflicts: 0,
    errors: 0,
  };
}

export function addPostMaterializationMetrics(
  aggregate: Required<ReportPostMaterializationMetrics>,
  next?: ReportPostMaterializationMetrics,
): void {
  if (!next) return;
  aggregate.entryPathways += next.entryPathways || 0;
  aggregate.accessSignals += next.accessSignals || 0;
  aggregate.contactRoutes += next.contactRoutes || 0;
  aggregate.postedOpportunities += next.postedOpportunities || 0;
  aggregate.guardedContactRoutes += next.guardedContactRoutes || 0;
  aggregate.staleEvidenceSkipped += next.staleEvidenceSkipped || 0;
  aggregate.conflicts += next.conflicts || 0;
  aggregate.errors += next.errors || 0;
}

function scrapeRunIdForQuery(scrapeRunId: string): string | mongoose.Types.ObjectId {
  return mongoose.Types.ObjectId.isValid(scrapeRunId)
    ? new mongoose.Types.ObjectId(scrapeRunId)
    : scrapeRunId;
}

export async function countListingBackedPostedOpportunitiesForRun(
  scrapeRunId: string,
  deps: ListingPostedOpportunityMetricDeps = {},
): Promise<number> {
  const observationModel = deps.observationModel || Observation;
  const postedOpportunityModel = deps.postedOpportunityModel || PostedOpportunity;
  const rows = await observationModel.aggregate([
    {
      $match: {
        scrapeRunId: scrapeRunIdForQuery(scrapeRunId),
        entityType: 'listing',
      },
    },
    {
      $project: {
        listingId: {
          $ifNull: ['$entityId', '$entityKey'],
        },
      },
    },
    {
      $group: {
        _id: '$listingId',
      },
    },
  ]);
  const listingIds = rows
    .map((row: { _id?: unknown }) => row._id)
    .filter((id): id is string | mongoose.Types.ObjectId => {
      if (!id) return false;
      if (id instanceof mongoose.Types.ObjectId) return true;
      return typeof id === 'string' && mongoose.Types.ObjectId.isValid(id);
    })
    .map((id) => (id instanceof mongoose.Types.ObjectId ? id : new mongoose.Types.ObjectId(id)));

  if (listingIds.length === 0) return 0;

  return postedOpportunityModel.countDocuments({
    listingId: { $in: listingIds },
  });
}

function entityModelFor(entityType: ObservedEntityType): mongoose.Model<any> | null {
  switch (entityType) {
    case 'fellowship':
      return Fellowship;
    case 'user':
      return User;
    case 'researchEntity':
    case 'researchGroup':
      return ResearchEntity;
    default:
      return null;
  }
}

function uniqueKeyFieldFor(entityType: ObservedEntityType): string | null {
  switch (entityType) {
    case 'paper':
      return 'openAlexId';
    case 'fellowship':
      return 'sourceKey';
    case 'user':
      return 'netid';
    case 'researchEntity':
    case 'researchGroup':
      return 'slug';
    default:
      return null;
  }
}

function isArxivPaperKey(entityKey?: string): boolean {
  if (!entityKey) return false;
  return /^(\d{4}\.\d{4,5}|[a-z-]+(\.[A-Z]{2})?\/\d{7})$/i.test(entityKey);
}

function isDoiPaperKey(entityKey?: string): boolean {
  if (!entityKey) return false;
  const normalized = entityKey.trim().replace(/^doi:/i, '');
  return /^10\.\S+\/\S+$/i.test(normalized);
}

function uniqueKeyFieldForIdentifier(
  entityType: ObservedEntityType,
  entityKey?: string,
): string | null {
  if (entityType === 'paper' && isArxivPaperKey(entityKey)) {
    return 'arxivId';
  }
  if (entityType === 'paper' && isDoiPaperKey(entityKey)) {
    return 'doi';
  }

  return uniqueKeyFieldFor(entityType);
}

export function uniqueKeyValueForIdentifier(
  entityType: ObservedEntityType,
  entityKey: string | undefined,
  obs: Array<{ field?: string; value?: unknown }>,
): string | undefined {
  if (entityType === 'user') {
    const observedNetid = obs.find((o) => o.field === 'netid' && typeof o.value === 'string')
      ?.value as string | undefined;
    if (observedNetid?.trim()) return observedNetid.trim();
    return entityKey?.replace(/^netid:/i, '').trim() || undefined;
  }

  if (entityType === 'paper') {
    const keyField = uniqueKeyFieldForIdentifier(entityType, entityKey);
    if (keyField === 'doi') {
      const observedDoi = obs
        .map((o) => (o.field === 'doi' ? normalizeDoiForMaterialization(o.value) : null))
        .find((value): value is string => !!value);
      if (observedDoi) return observedDoi;
      return normalizeDoiForMaterialization(entityKey?.replace(/^doi:/i, '')) || undefined;
    }
  }

  return entityKey;
}

export function normalizeDoiForMaterialization(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value
    .trim()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
    .replace(/^doi:/i, '')
    .toLowerCase();
  return normalized || null;
}

function normalizedScholarlyDoiFromObservations(
  obs: Array<{ field?: string; value?: any }>,
): string {
  const externalIds = obs.find((o) => o.field === 'externalIds')?.value || {};
  return normalizeDoiForMaterialization(externalIds.doi || externalIds.DOI) || '';
}

const USER_PROFILE_URL_LOOKUP_KEYS = [
  'departmental',
  'departmental2',
  'departmental3',
  'official',
  'ysmOfficial',
  'ysmOfficial2',
  'physics',
  'psychology',
  'math',
  'statistics',
  'astronomy',
  'eeb',
  'mcdb',
  'econ',
  'cs',
];

export function buildUserProfileUrlLookupClauses(
  obs: Array<{ field?: string; value?: unknown }>,
): Record<string, unknown>[] {
  const urls = new Set<string>();
  const keys = new Set<string>(USER_PROFILE_URL_LOOKUP_KEYS);
  for (const observation of obs) {
    if (observation.field !== 'profileUrls') continue;
    if (
      !observation.value ||
      typeof observation.value !== 'object' ||
      Array.isArray(observation.value)
    ) {
      continue;
    }
    for (const [key, rawUrl] of Object.entries(observation.value as Record<string, unknown>)) {
      const url = firstStringValue(rawUrl);
      if (!url) continue;
      keys.add(key);
      urls.add(url);
    }
  }

  const clauses: Record<string, unknown>[] = [];
  for (const url of urls) {
    for (const key of keys) {
      clauses.push({ [`profileUrls.${key}`]: url });
    }
  }
  return clauses;
}

export function buildScholarlyLinkLookupClauses(
  entityId: unknown,
  obs: Array<{ field?: string; value?: any }>,
): Record<string, unknown>[] {
  const clauses: Record<string, unknown>[] = [];
  const id = String(entityId || '').trim();
  if (id && mongoose.Types.ObjectId.isValid(id)) {
    clauses.push({ _id: id });
  }

  const scope: Record<string, unknown> = {};
  const userId = String(obs.find((o) => o.field === 'userId')?.value || '').trim();
  const researchEntityId = String(
    obs.find((o) => o.field === 'researchEntityId')?.value || '',
  ).trim();
  if (userId && mongoose.Types.ObjectId.isValid(userId)) scope.userId = userId;
  if (researchEntityId && mongoose.Types.ObjectId.isValid(researchEntityId)) {
    scope.researchEntityId = researchEntityId;
  }

  const doi = normalizedScholarlyDoiFromObservations(obs);
  if (doi && Object.keys(scope).length > 0) {
    clauses.push({ ...scope, 'externalIds.doi': doi });
  }

  const url = String(obs.find((o) => o.field === 'url')?.value || '').trim();
  if (url && Object.keys(scope).length > 0) {
    clauses.push({ ...scope, url });
  }

  return clauses;
}

function objectIdValue(value: unknown): mongoose.Types.ObjectId | null {
  if (value instanceof mongoose.Types.ObjectId) return value;
  if (!value || !mongoose.Types.ObjectId.isValid(String(value))) return null;
  return new mongoose.Types.ObjectId(String(value));
}

export function buildScholarlyAttributionWriteModels(input: {
  scholarlyLinkId: mongoose.Types.ObjectId;
  userId?: unknown;
  researchEntityId?: unknown;
  sourceName?: string;
  sourceUrl?: string;
  confidence?: number;
  observedAt?: Date | string;
}): any[] {
  const sourceName = String(input.sourceName || '').trim();
  const sourceUrl = String(input.sourceUrl || '').trim();
  const confidence =
    typeof input.confidence === 'number' && Number.isFinite(input.confidence)
      ? input.confidence
      : 0.7;
  const observedAt = input.observedAt ? new Date(input.observedAt) : new Date();
  const ops: any[] = [];
  const userId = objectIdValue(input.userId);
  if (userId) {
    const derivationKey = `scholarly-link:${String(input.scholarlyLinkId)}:user:${String(
      userId,
    )}:identity_authorship`;
    ops.push({
      updateOne: {
        filter: {
          scholarlyLinkId: input.scholarlyLinkId,
          targetUserId: userId,
          relationshipBasis: 'identity_authorship',
          derivationKey,
        },
        update: {
          $set: {
            scholarlyLinkId: input.scholarlyLinkId,
            targetUserId: userId,
            relationshipBasis: 'identity_authorship',
            evidenceLabel: 'Authored by a verified Yale faculty identity',
            sourceName,
            sourceUrl,
            confidence,
            observedAt,
            derivationKey,
            archived: false,
          },
        },
        upsert: true,
      },
    });
  }

  const researchEntityId = objectIdValue(input.researchEntityId);
  if (researchEntityId) {
    const derivationKey = `scholarly-link:${String(
      input.scholarlyLinkId,
    )}:researchEntity:${String(researchEntityId)}:explicit_entity_link`;
    ops.push({
      updateOne: {
        filter: {
          scholarlyLinkId: input.scholarlyLinkId,
          targetResearchEntityId: researchEntityId,
          relationshipBasis: 'explicit_entity_link',
          derivationKey,
        },
        update: {
          $set: {
            scholarlyLinkId: input.scholarlyLinkId,
            targetResearchEntityId: researchEntityId,
            relationshipBasis: 'explicit_entity_link',
            evidenceLabel: 'Linked to this research profile',
            sourceName,
            sourceUrl,
            confidence,
            observedAt,
            derivationKey,
            archived: false,
          },
        },
        upsert: true,
      },
    });
  }

  return ops;
}

function observedDoiValues(obs: any[]): string[] {
  return Array.from(
    new Set(
      obs
        .filter((o) => o.field === 'doi')
        .map((o) => normalizeDoiForMaterialization(o.value))
        .filter((value): value is string => !!value),
    ),
  );
}

async function findEntityDocByIdentifier(
  Model: mongoose.Model<any>,
  entityType: ObservedEntityType,
  identifier: { entityId?: string; entityKey?: string },
  obs: any[],
): Promise<any | null> {
  if (identifier.entityId && mongoose.Types.ObjectId.isValid(identifier.entityId)) {
    return Model.findById(identifier.entityId).lean();
  }

  if (!identifier.entityKey) return null;

  const keyField = uniqueKeyFieldForIdentifier(entityType, identifier.entityKey);
  if (!keyField) throw new Error(`No keyField for entityType=${entityType}`);

  const keyValue = uniqueKeyValueForIdentifier(entityType, identifier.entityKey, obs);
  if (!keyValue) return null;

  const exact = await Model.findOne({ [keyField]: keyValue }).lean();
  if (exact) return exact;

  if (isResearchEntityObservationType(entityType)) {
    const officialLabUrlEntity = await findExistingResearchEntityByOfficialLabUrl(Model, obs);
    if (officialLabUrlEntity) return officialLabUrlEntity;

    const facultyResearchAreaEntity = await findExistingResearchEntityByFacultyResearchAreaIdentity(
      Model,
      {
        entityKey: identifier.entityKey,
        name: bestObservationForField(obs, 'name')?.value,
        entityType: bestObservationForField(obs, 'entityType')?.value,
      },
    );
    if (facultyResearchAreaEntity) return facultyResearchAreaEntity;

    const samePiEntity = await findExistingResearchEntityByPiAndName(Model, obs);
    if (samePiEntity) return samePiEntity;

    const singleKnownPiEntity = await findExistingResearchEntityBySingleKnownPiAndName(Model, obs);
    if (singleKnownPiEntity) return singleKnownPiEntity;
  }

  if (entityType === 'user') {
    const emailObservation = obs.find((o) => o.field === 'email' && typeof o.value === 'string');
    const observedEmail =
      typeof emailObservation?.value === 'string'
        ? emailObservation.value.trim().toLowerCase()
        : '';
    if (observedEmail) {
      const byEmail = await Model.find({ email: observedEmail }).limit(2).lean();
      if (byEmail.length === 1) return byEmail[0];
    }

    const profileUrlClauses = buildUserProfileUrlLookupClauses(obs);
    if (profileUrlClauses.length > 0) {
      const byProfileUrl = await Model.find({ $or: profileUrlClauses }).limit(2).lean();
      if (byProfileUrl.length === 1) return byProfileUrl[0];
    }
  }

  if (entityType === 'paper') {
    const doiValues = observedDoiValues(obs);
    if (doiValues.length > 0) {
      const byDoi = await Model.find({ doi: { $in: doiValues } })
        .limit(2)
        .lean();
      if (byDoi.length === 1) return byDoi[0];
    }
  }

  return null;
}

export async function findExistingResearchEntityByOfficialLabUrl(
  Model: mongoose.Model<any>,
  obs: Array<{ field?: string; value?: unknown; sourceUrl?: string }>,
): Promise<any | null> {
  const urls = Array.from(
    new Set(
      obs
        .flatMap((observation) => {
          const values =
            observation.field === 'websiteUrl' || observation.field === 'sourceUrls'
              ? stringValues(observation.value)
              : [];
          if (observation.sourceUrl) values.push(observation.sourceUrl);
          return values;
        })
        .map(normalizeOfficialYaleLabUrl)
        .filter((value): value is string => !!value),
    ),
  );
  if (urls.length === 0) return null;

  const candidates = await Model.find({
    archived: { $ne: true },
    $or: [{ websiteUrl: { $in: urls } }, { sourceUrls: { $in: urls } }],
  })
    .limit(2)
    .lean();
  return candidates.length === 1 ? candidates[0] : null;
}

export async function resolveArchivedEntityDocToCanonical(
  entityDoc: any | null,
  Model: Pick<mongoose.Model<any>, 'findById'>,
): Promise<any | null> {
  if (!entityDoc?.archived || !entityDoc?.canonicalGroupId) return entityDoc;
  const canonical = await Model.findById(entityDoc.canonicalGroupId).lean();
  return canonical || entityDoc;
}

function normalizeResearchEntityName(value: unknown): string {
  return firstStringValue(value).toLowerCase().replace(/\s+/g, ' ').trim();
}

function normalizeLabLikeResearchEntityBaseName(value: unknown): string {
  return normalizeResearchEntityName(value)
    .replace(/\s+(lab|laboratory|research)$/i, '')
    .trim();
}

function hasLabLikeResearchEntitySuffix(value: unknown): boolean {
  return /\s+(lab|laboratory|research)$/i.test(normalizeResearchEntityName(value));
}

function samePiCompatibleResearchEntityName(
  observedName: unknown,
  candidateName: unknown,
): boolean {
  const observed = normalizeResearchEntityName(observedName);
  const candidate = normalizeResearchEntityName(candidateName);
  if (!observed || !candidate) return false;
  if (observed === candidate) return true;
  if (!hasLabLikeResearchEntitySuffix(observed) || !hasLabLikeResearchEntitySuffix(candidate)) {
    return false;
  }
  return (
    normalizeLabLikeResearchEntityBaseName(observed) ===
    normalizeLabLikeResearchEntityBaseName(candidate)
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function compactPersonName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function personNameFromFacultyResearchArea(value: unknown): string {
  const text = firstStringValue(value)
    .replace(/^faculty-research-area-/i, '')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.replace(/\s+research$/i, '').trim();
}

function isFacultyResearchAreaKey(value: unknown): boolean {
  return firstStringValue(value).toLowerCase().startsWith('faculty-research-area-');
}

function shouldPreserveCanonicalResearchEntityFromGeneratedFacultyArea(
  entityType: ObservedEntityType,
  identifier: { entityKey?: string },
  entityDoc: any | null,
): boolean {
  if (!isResearchEntityObservationType(entityType)) return false;
  if (!entityDoc?._id || !isFacultyResearchAreaKey(identifier.entityKey)) return false;
  return firstStringValue(entityDoc.slug) !== firstStringValue(identifier.entityKey);
}

function piCompatibleResearchEntityNames(firstName: string, lastName: string): Set<string> {
  const first = firstName.trim();
  const last = lastName.trim();
  return new Set(
    [
      `${first} ${last} Lab`,
      `${first} ${last} Laboratory`,
      `${last} Lab`,
      `${last} Laboratory`,
    ].map((value) => normalizeResearchEntityName(value)),
  );
}

async function findUniqueUserIdByPersonName(personName: string): Promise<string | null> {
  const user = await findUniqueUserByPersonName(personName);
  return user?._id ? String(user._id) : null;
}

async function findUniqueUserByPersonName(personName: string): Promise<any | null> {
  const parts = personName.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return null;
  const first = parts.slice(0, -1).join(' ');
  const last = parts[parts.length - 1];
  const users = await User.find({
    lname: { $regex: new RegExp(`^\\s*${escapeRegExp(last)}\\s*$`, 'i') },
  })
    .select('_id fname lname')
    .limit(10)
    .lean();
  const expectedFullName = compactPersonName(`${first} ${last}`);
  const matches = users.filter((user: any) => {
    const candidateFullName = compactPersonName(
      `${firstStringValue(user.fname)} ${firstStringValue(user.lname)}`,
    );
    return candidateFullName === expectedFullName;
  });
  return matches.length === 1 && matches[0]?._id ? matches[0] : null;
}

export async function findExistingResearchEntityByFacultyResearchAreaIdentity(
  Model: mongoose.Model<any>,
  identity: { entityKey?: string; name?: unknown; entityType?: unknown },
): Promise<any | null> {
  const observedEntityType = firstStringValue(identity.entityType);
  const observedKey = firstStringValue(identity.entityKey);
  const isFacultyResearchArea =
    observedEntityType === 'FACULTY_RESEARCH_AREA' || isFacultyResearchAreaKey(observedKey);
  if (!isFacultyResearchArea) return null;

  const personName =
    personNameFromFacultyResearchArea(identity.name) ||
    personNameFromFacultyResearchArea(observedKey);
  if (!personName) return null;

  const userId = await findUniqueUserIdByPersonName(personName);
  if (!userId || !mongoose.Types.ObjectId.isValid(userId)) return null;

  const memberships = await ResearchGroupMember.find({
    userId: new mongoose.Types.ObjectId(userId),
    role: 'pi',
    isCurrentMember: { $ne: false },
    researchEntityId: { $exists: true, $ne: null },
  })
    .select('researchEntityId')
    .lean();
  const candidateIds = Array.from(
    new Set(memberships.map((member: any) => String(member.researchEntityId)).filter(Boolean)),
  );
  if (candidateIds.length === 0) return null;

  const parts = personName.split(/\s+/).filter(Boolean);
  const compatibleNames = piCompatibleResearchEntityNames(
    parts.slice(0, -1).join(' '),
    parts[parts.length - 1],
  );
  const candidates = await Model.find({
    _id: { $in: candidateIds },
    archived: { $ne: true },
  })
    .select('_id name slug')
    .lean();
  const nonGeneratedCandidates = candidates.filter(
    (candidate: any) => !firstStringValue(candidate.slug).startsWith('faculty-research-area-'),
  );
  const compatibleCandidates = nonGeneratedCandidates.filter((candidate: any) =>
    compatibleNames.has(normalizeResearchEntityName(candidate.name)),
  );
  const resolvedCandidates =
    compatibleCandidates.length > 0 ? compatibleCandidates : nonGeneratedCandidates;
  if (resolvedCandidates.length !== 1) return null;

  return Model.findById(resolvedCandidates[0]._id).lean();
}

export async function syncProfileBackedFacultyResearchAreaMemberFromIdentity(
  researchEntityId: string,
  identity: {
    entityKey?: string;
    name?: unknown;
    entityType?: unknown;
    userId?: string;
    sourceUrl?: string;
    confidence?: number;
  },
  deps: ProfileBackedFacultyResearchAreaMemberDeps = {},
): Promise<{
  synced: boolean;
  created: boolean;
  researchEntityId?: string;
  userId?: string;
  skipped?: 'not-faculty-research-area' | 'user-not-resolved';
}> {
  const observedEntityType = firstStringValue(identity.entityType);
  const observedKey = firstStringValue(identity.entityKey);
  const isFacultyResearchArea =
    observedEntityType === 'FACULTY_RESEARCH_AREA' || isFacultyResearchAreaKey(observedKey);
  if (!isFacultyResearchArea) {
    return { synced: false, created: false, skipped: 'not-faculty-research-area' };
  }

  const userModel = deps.userModel || User;
  const personName =
    personNameFromFacultyResearchArea(identity.name) ||
    personNameFromFacultyResearchArea(observedKey);
  let user =
    identity.userId && mongoose.Types.ObjectId.isValid(identity.userId)
      ? await userModel.findById(identity.userId).select('_id fname lname').lean()
      : null;
  if (!user) {
    user = personName ? await findUniqueUserByPersonName(personName) : null;
  }
  if (!user?._id) return { synced: false, created: false, skipped: 'user-not-resolved' };

  const memberModel = deps.researchGroupMemberModel || ResearchGroupMember;
  const userId = String(user._id);
  const memberLookup = { researchEntityId, userId, role: 'pi' };
  const existing =
    (await memberModel
      .findOne({
        ...memberLookup,
        isCurrentMember: { $ne: false },
      })
      .lean()) || (await memberModel.findOne(memberLookup).lean());
  const set = {
    researchEntityId,
    userId,
    name: `${firstStringValue(user.fname)} ${firstStringValue(user.lname)}`.trim() || personName,
    role: 'pi',
    isCurrentMember: true,
    sourceUrl: firstStringValue(identity.sourceUrl),
    confidence: Number(identity.confidence) || 0.8,
    lastObservedAt: new Date(),
  };

  if (!existing) {
    await memberModel.create(set);
    return { synced: true, created: true, researchEntityId, userId };
  }

  await memberModel.updateOne({ _id: existing._id }, { $set: set });
  return { synced: true, created: false, researchEntityId, userId };
}

export async function findExistingResearchEntityByPiAndName(
  Model: mongoose.Model<any>,
  observations: Array<{
    field?: string;
    value?: unknown;
    confidence?: number;
    observedAt?: Date;
    sourceUrl?: string;
  }>,
): Promise<any | null> {
  const observedNameValue = bestObservationForField(observations, 'name')?.value;
  const observedName = normalizeResearchEntityName(observedNameValue);
  if (!observedName) return null;

  const userId = await resolveInferredPiUserId(observations, {
    userModel: User,
    observationModel: Observation,
    researchGroupMemberModel: ResearchGroupMember,
  });
  if (!userId || !mongoose.Types.ObjectId.isValid(userId)) return null;

  const memberships = await ResearchGroupMember.find({
    userId: new mongoose.Types.ObjectId(userId),
    role: 'pi',
    isCurrentMember: { $ne: false },
    researchEntityId: { $exists: true, $ne: null },
  })
    .select('researchEntityId')
    .lean();
  const candidateIds = Array.from(
    new Set(memberships.map((member: any) => String(member.researchEntityId)).filter(Boolean)),
  );
  if (candidateIds.length === 0) return null;

  const candidates = await Model.find({
    _id: { $in: candidateIds },
    archived: { $ne: true },
  })
    .select('_id name slug')
    .lean();
  const sameName = candidates.filter(
    (candidate: any) => normalizeResearchEntityName(candidate.name) === observedName,
  );
  if (sameName.length === 1) return Model.findById(sameName[0]._id).lean();

  const compatibleName = candidates.filter((candidate: any) =>
    samePiCompatibleResearchEntityName(observedNameValue, candidate.name),
  );
  if (compatibleName.length !== 1) return null;

  return Model.findById(compatibleName[0]._id).lean();
}

export async function findExistingResearchEntityBySingleKnownPiAndName(
  Model: mongoose.Model<any>,
  observations: Array<{
    field?: string;
    value?: unknown;
    confidence?: number;
    observedAt?: Date;
    sourceUrl?: string;
  }>,
): Promise<any | null> {
  const observedNameValue = firstStringValue(bestObservationForField(observations, 'name')?.value);
  const observedName = normalizeResearchEntityName(observedNameValue);
  if (!observedName) return null;

  const candidates = await Model.find({
    name: { $regex: new RegExp(`^\\s*${escapeRegExp(observedNameValue)}\\s*$`, 'i') },
    archived: { $ne: true },
  })
    .select('_id name')
    .limit(10)
    .lean();
  const sameName = candidates.filter(
    (candidate: any) => normalizeResearchEntityName(candidate.name) === observedName,
  );
  if (sameName.length === 0) return null;

  const candidateIds = sameName
    .map((candidate: any) => candidate._id)
    .filter((id: unknown) => id !== undefined && id !== null);
  const memberships = await ResearchGroupMember.find({
    researchEntityId: { $in: candidateIds },
    role: 'pi',
    isCurrentMember: { $ne: false },
    userId: { $exists: true, $ne: null },
  })
    .select('researchEntityId userId')
    .lean();
  const piUserIds = Array.from(
    new Set(memberships.map((member: any) => String(member.userId)).filter(Boolean)),
  );
  if (piUserIds.length !== 1) return null;

  const memberEntityIds = new Set(
    memberships.map((member: any) => String(member.researchEntityId)).filter(Boolean),
  );
  const preferred =
    sameName.find((candidate: any) => memberEntityIds.has(String(candidate._id))) || sameName[0];

  return Model.findById(preferred._id).lean();
}

type UserIdentityObservation = {
  _id?: unknown;
  entityId?: unknown;
  entityKey?: string | null;
  field?: string;
  value?: unknown;
  sourceName?: string;
  sourceUrl?: string | null;
  confidence?: number;
  observedAt?: Date;
};

interface InferredPiProfileContext {
  inferredOwnerObservation?: {
    field?: string;
    value?: unknown;
    sourceName?: string;
    confidence?: number;
    observedAt?: Date;
    sourceUrl?: string;
  };
  inferredPiUserId?: string;
  inferredPiUserKey?: string;
  userId?: string | null;
  userObservations: UserIdentityObservation[];
  userDoc?: Record<string, unknown> | null;
}

const OFFICIAL_PROFILE_FALLBACK_BLOCKED_OWNER_SOURCES = new Set([
  'nih-reporter',
  'nsf-award-search',
  'orcid',
  'openalex',
  'crossref',
  'europe-pmc',
  'pubmed',
  'arxiv',
]);

function firstProfileUrlValue(value: unknown): { key: string; url: string } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  for (const [key, rawUrl] of Object.entries(value as Record<string, unknown>)) {
    const url = firstStringValue(rawUrl);
    if (url) return { key, url };
  }
  return null;
}

function normalizedNameTokens(value: unknown): string[] {
  return firstStringValue(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function profileUrlPathTokens(value: unknown): string[] {
  const url = firstStringValue(value);
  if (!looksLikeOfficialYaleUrl(url)) return [];
  try {
    const parsed = new URL(url);
    return parsed.pathname
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean);
  } catch {
    return [];
  }
}

function profileUrlClearlyNamesDifferentUser(
  profileUrl: unknown,
  user: { fname?: unknown; lname?: unknown; netid?: unknown },
): boolean {
  const urlTokens = new Set(profileUrlPathTokens(profileUrl));
  if (urlTokens.size === 0) return false;

  const netid = firstStringValue(user.netid).toLowerCase();
  if (netid && urlTokens.has(netid)) return false;

  const firstTokens = normalizedNameTokens(user.fname);
  const lastTokens = normalizedNameTokens(user.lname);
  if (firstTokens.length === 0 || lastTokens.length === 0) return false;

  const firstInitial = firstTokens[0]?.[0] || '';
  const compactFirst = firstTokens.join('');
  const compactLast = lastTokens.join('');
  const urlTokenList = [...urlTokens];
  const hasAnyFirst =
    firstTokens.some((token) => urlTokens.has(token)) ||
    Boolean(compactFirst && urlTokens.has(compactFirst)) ||
    Boolean(
      compactFirst.length > 1 &&
      urlTokenList.some((token) => token.includes(compactFirst) || compactFirst.includes(token)),
    ) ||
    Boolean(firstInitial && urlTokens.has(firstInitial)) ||
    Boolean(
      firstTokens[0]?.length === 1 &&
      firstInitial &&
      urlTokenList.some((token) => token.startsWith(firstInitial)),
    );
  const hasAnyLast =
    lastTokens.some((token) => urlTokens.has(token)) ||
    Boolean(compactLast && urlTokens.has(compactLast)) ||
    Boolean(
      compactLast.length > 1 &&
      urlTokenList.some((token) => token.includes(compactLast) || compactLast.includes(token)),
    );
  const hasAnyNameToken = [...firstTokens, ...lastTokens].some((token) => urlTokens.has(token));

  if (!hasAnyNameToken) return true;
  return !hasAnyFirst || !hasAnyLast;
}

const PROFILE_DERIVED_USER_FIELDS = new Set([
  'profileUrls',
  'orcid',
  'bio',
  'imageUrl',
  'researchInterests',
  'topics',
  'title',
]);

export function filterUserObservationsWithMismatchedProfileUrl(
  observations: UserIdentityObservation[],
  userDoc?: Record<string, unknown> | null,
): UserIdentityObservation[] {
  const fname =
    firstStringValue(bestObservationForField(observations, 'fname')?.value) ||
    firstStringValue(userDoc?.fname);
  const lname =
    firstStringValue(bestObservationForField(observations, 'lname')?.value) ||
    firstStringValue(userDoc?.lname);
  const netid =
    firstStringValue(bestObservationForField(observations, 'netid')?.value) ||
    firstStringValue(userDoc?.netid);
  if (!fname || !lname) return observations;

  const mismatchedProfileUrls = new Set<string>();
  for (const observation of observations) {
    if (observation.field !== 'profileUrls') continue;
    if (
      !observation.value ||
      typeof observation.value !== 'object' ||
      Array.isArray(observation.value)
    ) {
      continue;
    }
    for (const rawUrl of Object.values(observation.value as Record<string, unknown>)) {
      const url = firstStringValue(rawUrl);
      if (profileUrlClearlyNamesDifferentUser(url, { fname, lname, netid })) {
        mismatchedProfileUrls.add(url);
      }
    }
  }
  if (mismatchedProfileUrls.size === 0) return observations;

  return observations.filter((observation) => {
    if (!PROFILE_DERIVED_USER_FIELDS.has(observation.field || '')) return true;
    const profileUrl =
      firstProfileUrlValue(observation.value)?.url || firstStringValue(observation.sourceUrl);
    return !mismatchedProfileUrls.has(profileUrl);
  });
}

async function findUserIdFromIdentityObservations(
  observations: UserIdentityObservation[],
  deps: Required<InferredPiMembershipDeps>,
): Promise<string | null> {
  const { userModel } = deps;

  const netid = firstStringValue(bestObservationForField(observations, 'netid')?.value);
  if (netid) {
    const user = await userModel.findOne({ netid }, { _id: 1 }).lean();
    if (user?._id) return String(user._id);
  }

  const email = firstStringValue(bestObservationForField(observations, 'email')?.value);
  if (email) {
    const user = await userModel.findOne({ email }, { _id: 1 }).lean();
    if (user?._id) return String(user._id);
  }

  const orcid = firstStringValue(bestObservationForField(observations, 'orcid')?.value);
  if (orcid) {
    const user = await userModel.findOne({ orcid }, { _id: 1 }).lean();
    if (user?._id) return String(user._id);
  }

  const profileUrl = firstProfileUrlValue(
    bestObservationForField(observations, 'profileUrls')?.value,
  );
  if (profileUrl) {
    const user = await userModel
      .findOne({ [`profileUrls.${profileUrl.key}`]: profileUrl.url }, { _id: 1 })
      .lean();
    if (user?._id) return String(user._id);
  }

  const website = firstStringValue(bestObservationForField(observations, 'website')?.value);
  if (website) {
    const user = await userModel.findOne({ website }, { _id: 1 }).lean();
    if (user?._id) return String(user._id);
  }

  const first = firstStringValue(bestObservationForField(observations, 'fname')?.value);
  const last = firstStringValue(bestObservationForField(observations, 'lname')?.value);
  if (first && last) {
    const matches = await userModel
      .find(
        {
          fname: { $regex: new RegExp(`^\\s*${escapeRegExp(first)}\\s*$`, 'i') },
          lname: { $regex: new RegExp(`^\\s*${escapeRegExp(last)}\\s*$`, 'i') },
          userType: { $in: ['professor', 'faculty', 'admin'] },
        },
        { _id: 1 },
      )
      .limit(2)
      .lean();
    if (matches.length === 1 && matches[0]?._id) return String(matches[0]._id);

    const observedFullName = compactPersonName(`${first} ${last}`);
    const candidates = await userModel
      .find(
        {
          lname: { $regex: new RegExp(escapeRegExp(last), 'i') },
          userType: { $in: ['professor', 'faculty', 'admin'] },
        },
        { _id: 1, fname: 1, lname: 1 },
      )
      .limit(10)
      .lean();
    const sameFullName = candidates.filter((candidate: any) => {
      const candidateName = compactPersonName(
        `${firstStringValue(candidate.fname)} ${firstStringValue(candidate.lname)}`,
      );
      return candidateName === observedFullName;
    });
    if (sameFullName.length === 1 && sameFullName[0]?._id) {
      return String(sameFullName[0]._id);
    }
  }

  return null;
}

async function resolveInferredPiUserId(
  observations: Array<{
    entityType?: ObservedEntityType;
    field?: string;
    value?: unknown;
    confidence?: number;
    observedAt?: Date;
    sourceUrl?: string;
  }>,
  deps: Required<InferredPiMembershipDeps>,
): Promise<string | null> {
  const directUserId = firstStringValue(
    bestObservationForField(observations, 'inferredPiUserId')?.value,
  );
  if (directUserId && mongoose.Types.ObjectId.isValid(directUserId)) {
    const user = await deps.userModel.findById(directUserId, { _id: 1 }).lean();
    if (user?._id) return String(user._id);
  }

  const ownerKey = firstStringValue(
    bestObservationForField(observations, 'inferredPiUserKey')?.value,
  );
  if (!ownerKey) return null;

  if (ownerKey.toLowerCase().startsWith('netid:')) {
    const netid = ownerKey.slice('netid:'.length).trim();
    if (netid) {
      const user = await deps.userModel.findOne({ netid }, { _id: 1 }).lean();
      if (user?._id) return String(user._id);
    }
  }

  const userObservations = await deps.observationModel
    .find(
      {
        entityType: 'user',
        entityKey: ownerKey,
        superseded: false,
      },
      {
        field: 1,
        value: 1,
        sourceUrl: 1,
      },
    )
    .lean();

  if (!userObservations.length) return null;
  return findUserIdFromIdentityObservations(userObservations, deps);
}

async function inferredPiDisplayNameFromObservations(
  observations: Array<{
    field?: string;
    value?: unknown;
  }>,
  deps: Required<InferredPiMembershipDeps>,
): Promise<string> {
  const ownerKey = firstStringValue(
    bestObservationForField(observations, 'inferredPiUserKey')?.value,
  );
  if (!ownerKey) return '';

  const userObservations = (await deps.observationModel
    .find(
      {
        entityType: 'user',
        entityKey: ownerKey,
        superseded: false,
      },
      {
        field: 1,
        value: 1,
      },
    )
    .lean()) as UserIdentityObservation[];

  const explicitName = firstStringValue(bestObservationForField(userObservations, 'name')?.value);
  if (explicitName) return explicitName;

  const first = firstStringValue(bestObservationForField(userObservations, 'fname')?.value);
  const last = firstStringValue(bestObservationForField(userObservations, 'lname')?.value);
  return cleanTextValue([first, last].filter(Boolean).join(' '));
}

export async function syncInferredPiMembership(
  researchEntityId: string,
  observations: Array<{
    entityType?: ObservedEntityType;
    field?: string;
    value?: unknown;
    confidence?: number;
    observedAt?: Date;
    sourceUrl?: string;
  }>,
  deps: InferredPiMembershipDeps = {},
): Promise<InferredPiMembershipResult> {
  const inferredOwnerObservations = observations
    .filter(
      (observation) =>
        observation.field === 'inferredPiUserId' || observation.field === 'inferredPiUserKey',
    )
    .sort((a, b) => {
      const byConfidence = (Number(b.confidence) || 0) - (Number(a.confidence) || 0);
      if (byConfidence !== 0) return byConfidence;
      return new Date(b.observedAt || 0).getTime() - new Date(a.observedAt || 0).getTime();
    });
  const dedupedOwnerObservations: typeof inferredOwnerObservations = [];
  const seenOwnerKeys = new Set<string>();
  for (const observation of inferredOwnerObservations) {
    const key = `${observation.field || ''}:${firstStringValue(observation.value)}`;
    if (!firstStringValue(observation.value) || seenOwnerKeys.has(key)) continue;
    seenOwnerKeys.add(key);
    dedupedOwnerObservations.push(observation);
  }

  if (dedupedOwnerObservations.length === 0) {
    return { synced: false, created: false, skipped: 'no-inferred-owner' };
  }

  const resolvedDeps: Required<InferredPiMembershipDeps> = {
    userModel: deps.userModel || User,
    observationModel: deps.observationModel || Observation,
    researchGroupMemberModel: deps.researchGroupMemberModel || ResearchGroupMember,
  };
  const memberModel = resolvedDeps.researchGroupMemberModel;
  let synced = false;
  let created = false;
  let firstUserId: string | undefined;

  for (const inferredOwnerObservation of dedupedOwnerObservations) {
    const ownerOnlyObservations = [inferredOwnerObservation];
    const userId = await resolveInferredPiUserId(ownerOnlyObservations, resolvedDeps);
    const observedAt = inferredOwnerObservation.observedAt || new Date();
    const sourceUrl = firstStringValue(inferredOwnerObservation.sourceUrl);
    const confidence = Number(inferredOwnerObservation.confidence) || 0;

    if (!userId) {
      const name = await inferredPiDisplayNameFromObservations(ownerOnlyObservations, resolvedDeps);
      if (!name) {
        continue;
      }

      const existingNameOnly = await memberModel
        .findOne({ researchEntityId, role: 'pi', name })
        .lean();
      if (!existingNameOnly) {
        await memberModel.create({
          researchEntityId,
          name,
          role: 'pi',
          isCurrentMember: true,
          startedAt: observedAt,
          lastObservedAt: observedAt,
          sourceUrl,
          confidence,
        });
        synced = true;
        created = true;
        continue;
      }

      await memberModel.updateOne(
        { _id: existingNameOnly._id },
        {
          $set: {
            researchEntityId,
            name,
            role: existingNameOnly.role || 'pi',
            isCurrentMember: existingNameOnly.isCurrentMember ?? true,
            lastObservedAt: observedAt,
            sourceUrl: sourceUrl || existingNameOnly.sourceUrl || '',
            confidence: Math.max(Number(existingNameOnly.confidence) || 0, confidence),
          },
        },
      );
      synced = true;
      continue;
    }

    if (!firstUserId) firstUserId = userId;

    const existing = await memberModel.findOne({ researchEntityId, userId }).lean();

    if (!existing) {
      await memberModel.create({
        researchEntityId,
        userId,
        role: 'pi',
        isCurrentMember: true,
        startedAt: observedAt,
        lastObservedAt: observedAt,
        sourceUrl,
        confidence,
      });
      synced = true;
      created = true;
      continue;
    }

    const manuallyLockedFields = Array.isArray(existing.manuallyLockedFields)
      ? existing.manuallyLockedFields
      : [];
    const set: Record<string, unknown> = {
      researchEntityId,
      userId,
      isCurrentMember: existing.isCurrentMember ?? true,
      lastObservedAt: observedAt,
      sourceUrl: sourceUrl || existing.sourceUrl || '',
      confidence: Math.max(Number(existing.confidence) || 0, confidence),
    };
    if ((!existing.role || existing.role !== 'pi') && !manuallyLockedFields.includes('role')) {
      set.role = 'pi';
    }
    if (!existing.startedAt) {
      set.startedAt = observedAt;
    }

    await memberModel.updateOne({ _id: existing._id }, { $set: set });
    synced = true;
  }

  if (!synced) {
    return { synced: false, created: false, skipped: 'user-not-resolved' };
  }

  return { synced: true, created, userId: firstUserId };
}

export async function syncResolvedMemberFromObservationFields(
  observations: Array<{
    field?: string;
    value?: unknown;
    confidence?: number;
    observedAt?: Date;
    sourceUrl?: string;
  }>,
  deps: ResolvedMemberMaterializationDeps = {},
): Promise<ResolvedMemberMaterializationResult> {
  const researchEntityKey = firstStringValue(
    bestObservationForField(observations, 'researchEntityKey')?.value,
  );
  const userEntityKeyObservation = bestObservationForField(observations, 'userEntityKey');
  const userEntityKey = firstStringValue(userEntityKeyObservation?.value);
  const directUserId = firstStringValue(bestObservationForField(observations, 'userId')?.value);
  if (!researchEntityKey || (!userEntityKey && !directUserId)) {
    return { synced: false, created: false, skipped: 'missing-keys' };
  }

  const resolvedDeps: Required<ResolvedMemberMaterializationDeps> = {
    researchEntityModel: deps.researchEntityModel || ResearchEntity,
    userModel: deps.userModel || User,
    researchGroupMemberModel: deps.researchGroupMemberModel || ResearchGroupMember,
  };
  const researchEntity = (await resolvedDeps.researchEntityModel
    .findOne({ slug: researchEntityKey }, { _id: 1, archived: 1, canonicalGroupId: 1 })
    .lean()) as { _id?: unknown; archived?: boolean; canonicalGroupId?: unknown } | null;
  if (!researchEntity?._id) {
    return { synced: false, created: false, skipped: 'entity-not-resolved' };
  }
  if (researchEntity.archived && !researchEntity.canonicalGroupId) {
    return {
      synced: false,
      created: false,
      skipped: 'archived-entity-without-canonical',
    };
  }

  const email = firstStringValue(
    bestObservationForField(observations, 'email')?.value,
  ).toLowerCase();
  let user: { _id?: unknown } | null = null;
  if (directUserId && mongoose.Types.ObjectId.isValid(directUserId)) {
    user = (await resolvedDeps.userModel.findOne({ _id: directUserId }, { _id: 1 }).lean()) as {
      _id?: unknown;
    } | null;
  }
  if (!user?._id && userEntityKey.toLowerCase().startsWith('netid:')) {
    const netid = userEntityKey.slice('netid:'.length).trim();
    if (netid) {
      user = (await resolvedDeps.userModel.findOne({ netid }, { _id: 1 }).lean()) as {
        _id?: unknown;
      } | null;
    }
  }
  if (!user?._id && email) {
    user = (await resolvedDeps.userModel.findOne({ email }, { _id: 1 }).lean()) as {
      _id?: unknown;
    } | null;
  }
  if (!user?._id) {
    return { synced: false, created: false, skipped: 'user-not-resolved' };
  }

  const researchEntityId = String(
    researchEntity.archived && researchEntity.canonicalGroupId
      ? researchEntity.canonicalGroupId
      : researchEntity._id,
  );
  const userId = String(user._id);
  const memberModel = resolvedDeps.researchGroupMemberModel;
  const existing = await memberModel.findOne({ researchEntityId, userId }).lean();
  const roleObservation = bestObservationForField(observations, 'role');
  const role = firstStringValue(roleObservation?.value);
  const nameObservation = bestObservationForField(observations, 'name');
  const name = firstStringValue(nameObservation?.value);
  const titleObservation = bestObservationForField(observations, 'title');
  const title = firstStringValue(titleObservation?.value);
  const currentObservation = bestObservationForField(observations, 'isCurrentMember');
  const hasCurrentObservation = typeof currentObservation?.value === 'boolean';
  const sourceObservation = bestObservationForField(observations, 'sourceUrl');
  const sourceUrl =
    firstStringValue(sourceObservation?.value) ||
    firstStringValue(bestObservationForField(observations, 'researchEntityKey')?.sourceUrl) ||
    firstStringValue(userEntityKeyObservation?.sourceUrl);
  const confidence = Math.max(
    0,
    ...observations.map((observation) => Number(observation.confidence) || 0),
  );
  const observedAt =
    observations
      .map((observation) => observation.observedAt)
      .filter((value): value is Date => value instanceof Date)
      .sort((a, b) => b.getTime() - a.getTime())[0] || new Date();

  const set: Record<string, unknown> = {
    researchEntityId,
    userId,
    lastObservedAt: observedAt,
  };
  if (!existing || roleObservation) set.role = role || 'affiliate';
  if (!existing || hasCurrentObservation) {
    set.isCurrentMember = hasCurrentObservation ? currentObservation.value : true;
  }
  if (nameObservation && name) set.name = name;
  if (email) set.email = email;
  if (titleObservation && title) set.title = title;
  if (sourceUrl) set.sourceUrl = sourceUrl;
  if (confidence > 0) set.confidence = confidence;

  if (!existing) {
    await memberModel.create(set);
    return { synced: true, created: true, researchEntityId, userId };
  }

  const manuallyLockedFields = Array.isArray(existing.manuallyLockedFields)
    ? existing.manuallyLockedFields
    : [];
  for (const field of manuallyLockedFields) {
    delete set[field];
  }
  set.researchEntityId = researchEntityId;
  set.userId = userId;

  const updateFilter = existing._id ? { _id: existing._id } : { researchEntityId, userId };
  await memberModel.updateOne(updateFilter, { $set: set });
  return { synced: true, created: false, researchEntityId, userId };
}

export async function syncResolvedRelationshipFromObservationFields(
  observations: Array<{
    field?: string;
    value?: unknown;
    confidence?: number;
    observedAt?: Date;
    sourceUrl?: string;
  }>,
  deps: ResolvedRelationshipMaterializationDeps = {},
): Promise<ResolvedRelationshipMaterializationResult> {
  const sourceEntityKey = firstStringValue(
    bestObservationForField(observations, 'sourceEntityKey')?.value,
  );
  const targetEntityKey = firstStringValue(
    bestObservationForField(observations, 'targetEntityKey')?.value,
  );
  const relationshipType = firstStringValue(
    bestObservationForField(observations, 'relationshipType')?.value,
  );
  if (!sourceEntityKey || !targetEntityKey || !relationshipType) {
    return { synced: false, created: false, skipped: 'missing-keys' };
  }

  const resolvedDeps: Required<ResolvedRelationshipMaterializationDeps> = {
    researchEntityModel: deps.researchEntityModel || ResearchEntity,
    relationshipModel: deps.relationshipModel || ResearchEntityRelationship,
    researchGroupMemberModel: deps.researchGroupMemberModel || ResearchGroupMember,
  };
  const source = (await resolvedDeps.researchEntityModel
    .findOne({ slug: sourceEntityKey, archived: { $ne: true } }, { _id: 1 })
    .lean()) as { _id?: unknown } | null;
  if (!source?._id) {
    return { synced: false, created: false, skipped: 'source-not-resolved' };
  }

  const canonicalFacultyResearchAreaTarget =
    (await findExistingResearchEntityByFacultyResearchAreaIdentity(
      resolvedDeps.researchEntityModel as any,
      { entityKey: targetEntityKey, entityType: 'FACULTY_RESEARCH_AREA' },
    )) as { _id?: unknown } | null;
  const target = (await resolvedDeps.researchEntityModel
    .findOne({ slug: targetEntityKey, archived: { $ne: true } }, { _id: 1, name: 1, slug: 1 })
    .lean()) as { _id?: unknown; name?: unknown; slug?: string } | null;
  const resolvedTarget = canonicalFacultyResearchAreaTarget || target;
  if (!resolvedTarget?._id) {
    return { synced: false, created: false, skipped: 'target-not-resolved' };
  }

  if (!canonicalFacultyResearchAreaTarget && target?._id) {
    await syncProfileBackedFacultyResearchAreaMemberFromIdentity(
      String(target._id),
      {
        entityKey: targetEntityKey,
        name: target.name,
        entityType: 'FACULTY_RESEARCH_AREA',
        sourceUrl: firstStringValue(bestObservationForField(observations, 'sourceUrl')?.value),
        confidence: Math.max(
          0,
          ...observations.map((observation) => Number(observation.confidence) || 0),
        ),
      },
      {
        researchGroupMemberModel: resolvedDeps.researchGroupMemberModel,
      },
    );
  }

  const sourceResearchEntityId = String(source._id);
  const targetResearchEntityId = String(resolvedTarget._id);
  const evidenceStrength =
    firstStringValue(bestObservationForField(observations, 'evidenceStrength')?.value) ||
    'MODERATE';
  const evidenceQuote = firstStringValue(
    bestObservationForField(observations, 'evidenceQuote')?.value,
  );
  const sourceUrl =
    firstStringValue(bestObservationForField(observations, 'sourceUrl')?.value) ||
    firstStringValue(bestObservationForField(observations, 'sourceEntityKey')?.sourceUrl);
  const confidence = Math.max(
    0,
    ...observations.map((observation) => Number(observation.confidence) || 0),
  );
  const observedAt = latestObservationDate(observations);

  const update: Record<string, unknown> = {
    sourceResearchEntityId,
    targetResearchEntityId,
    relationshipType,
    evidenceStrength,
    sourceUrl,
    confidence: confidence || 0.7,
    archived: false,
    lastObservedAt: observedAt,
  };
  if (evidenceQuote) update.evidenceQuote = evidenceQuote;

  const result: any = await resolvedDeps.relationshipModel.updateOne(
    { sourceResearchEntityId, targetResearchEntityId, relationshipType },
    { $set: update },
    { upsert: true },
  );

  return {
    synced: true,
    created: Boolean(result?.upsertedCount),
    sourceResearchEntityId,
    targetResearchEntityId,
  };
}

function cleanTextValue(value: unknown): string {
  return firstStringValue(value).replace(/\s+/g, ' ').trim();
}

function uniqueCleanStrings(values: unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values.flatMap((item) => (Array.isArray(item) ? item : [item]))) {
    const cleaned = cleanTextValue(value);
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
  }
  return out;
}

function looksLikeOfficialYaleUrl(value: string): boolean {
  const url = cleanTextValue(value);
  if (!url) return false;
  return httpUrlHasHostSuffix(url, 'yale.edu');
}

function observationIdsFromUserObservations(observations: UserIdentityObservation[]): string[] {
  return observations
    .map((observation) =>
      observation._id === undefined || observation._id === null ? '' : String(observation._id),
    )
    .filter(Boolean);
}

function maxObservationConfidence(observations: Array<{ confidence?: number }>): number {
  return observations.reduce(
    (max, observation) => Math.max(max, Number(observation.confidence) || 0),
    0,
  );
}

function latestObservationDate(observations: Array<{ observedAt?: Date }>): Date {
  const timestamps = observations
    .map((observation) => new Date(observation.observedAt || 0).getTime())
    .filter((time) => Number.isFinite(time));
  if (timestamps.length === 0) return new Date();
  return new Date(Math.max(...timestamps));
}

function userDocValue(context: InferredPiProfileContext, field: string): unknown {
  return context.userDoc && field in context.userDoc ? context.userDoc[field] : undefined;
}

function bestContextString(context: InferredPiProfileContext, field: string): string {
  const observed = cleanTextValue(bestObservationForField(context.userObservations, field)?.value);
  if (observed) return observed;
  return cleanTextValue(userDocValue(context, field));
}

function bestContextStringArray(context: InferredPiProfileContext, field: string): string[] {
  const observedValue = bestObservationForField(context.userObservations, field)?.value;
  if (Array.isArray(observedValue)) {
    const values = uniqueCleanStrings(observedValue);
    if (values.length > 0) return values;
  }
  const docValue = userDocValue(context, field);
  if (Array.isArray(docValue)) return uniqueCleanStrings(docValue);
  return [];
}

function bestOfficialProfileUrl(context: InferredPiProfileContext): string {
  const profileObservation = bestObservationForField(context.userObservations, 'profileUrls');
  const observedProfileUrl = firstProfileUrlValue(profileObservation?.value)?.url || '';
  if (looksLikeOfficialYaleUrl(observedProfileUrl)) return observedProfileUrl;

  const profileUrls = userDocValue(context, 'profileUrls');
  const docProfileUrl = firstProfileUrlValue(profileUrls)?.url || '';
  if (looksLikeOfficialYaleUrl(docProfileUrl)) return docProfileUrl;

  return '';
}

function departmentsFromProfileContext(context: InferredPiProfileContext): string[] {
  return uniqueCleanStrings([
    bestContextString(context, 'primaryDepartment'),
    ...bestContextStringArray(context, 'departments'),
    ...bestContextStringArray(context, 'secondaryDepartments'),
  ]);
}

function displayNameFromProfileContext(context: InferredPiProfileContext): string {
  const first = bestContextString(context, 'fname');
  const last = bestContextString(context, 'lname');
  const full = cleanTextValue([first, last].filter(Boolean).join(' '));
  if (full) return full;
  return '';
}

function hasMeaningfulObservation(
  observations: Array<{ field?: string; value?: unknown }>,
  field: string,
): boolean {
  return observations.some((observation) => {
    if (observation.field !== field) return false;
    if (typeof observation.value === 'string') return observation.value.trim().length > 0;
    if (Array.isArray(observation.value)) return observation.value.length > 0;
    return observation.value !== undefined && observation.value !== null;
  });
}

export async function loadPiProfileContextFromCurrentMembership(
  researchEntityId: string | undefined,
  deps: Required<InferredPiMembershipDeps>,
): Promise<InferredPiProfileContext> {
  if (!researchEntityId || !mongoose.Types.ObjectId.isValid(researchEntityId)) {
    return { userObservations: [] };
  }

  const member = (await deps.researchGroupMemberModel
    .findOne({
      researchEntityId: new mongoose.Types.ObjectId(researchEntityId),
      role: 'pi',
      isCurrentMember: { $ne: false },
      userId: { $exists: true, $ne: null },
    })
    .lean()) as { userId?: unknown } | null;
  const userId = member?.userId ? String(member.userId) : '';
  if (!userId || !mongoose.Types.ObjectId.isValid(userId)) return { userObservations: [] };

  const userDoc = (await deps.userModel
    .findById(userId, {
      _id: 1,
      fname: 1,
      lname: 1,
      title: 1,
      bio: 1,
      primaryDepartment: 1,
      secondaryDepartments: 1,
      departments: 1,
      researchInterests: 1,
      topics: 1,
      profileUrls: 1,
      website: 1,
    })
    .lean()) as Record<string, unknown> | null;

  if (!userDoc?._id) return { userObservations: [] };

  const userObservations = (await deps.observationModel
    .find(
      {
        entityType: 'user',
        entityId: new mongoose.Types.ObjectId(userId),
        superseded: false,
      },
      {
        _id: 1,
        entityId: 1,
        entityKey: 1,
        field: 1,
        value: 1,
        sourceName: 1,
        sourceUrl: 1,
        confidence: 1,
        observedAt: 1,
      },
    )
    .lean()) as UserIdentityObservation[];

  return {
    inferredPiUserId: userId,
    userId,
    userObservations,
    userDoc,
  };
}

async function loadInferredPiProfileContext(
  observations: Array<{
    entityType?: ObservedEntityType;
    field?: string;
    value?: unknown;
    confidence?: number;
    observedAt?: Date;
    sourceUrl?: string;
  }>,
  deps: Required<InferredPiMembershipDeps>,
  researchEntityId?: string,
): Promise<InferredPiProfileContext> {
  const directUserObservation = bestObservationForField(observations, 'inferredPiUserId');
  const ownerKeyObservation = bestObservationForField(observations, 'inferredPiUserKey');
  const inferredOwnerObservation = directUserObservation || ownerKeyObservation;
  const inferredPiUserId = cleanTextValue(directUserObservation?.value);
  const inferredPiUserKey = cleanTextValue(ownerKeyObservation?.value);

  if (!inferredOwnerObservation) {
    return loadPiProfileContextFromCurrentMembership(researchEntityId, deps);
  }

  let userId: string | null = null;
  let userDoc: Record<string, unknown> | null = null;
  if (inferredPiUserId && mongoose.Types.ObjectId.isValid(inferredPiUserId)) {
    const user = await deps.userModel
      .findById(inferredPiUserId, {
        _id: 1,
        fname: 1,
        lname: 1,
        title: 1,
        bio: 1,
        primaryDepartment: 1,
        secondaryDepartments: 1,
        departments: 1,
        researchInterests: 1,
        topics: 1,
        profileUrls: 1,
        website: 1,
      })
      .lean();
    if (user?._id) {
      userId = String(user._id);
      userDoc = user as Record<string, unknown>;
    }
  }

  const orClauses: Record<string, unknown>[] = [];
  if (inferredPiUserKey) {
    orClauses.push({
      entityType: 'user',
      entityKey: inferredPiUserKey,
      superseded: false,
    });
  }
  if (userId && mongoose.Types.ObjectId.isValid(userId)) {
    orClauses.push({
      entityType: 'user',
      entityId: new mongoose.Types.ObjectId(userId),
      superseded: false,
    });
  }

  const userObservations = orClauses.length
    ? ((await deps.observationModel
        .find(
          { $or: orClauses },
          {
            _id: 1,
            entityId: 1,
            entityKey: 1,
            field: 1,
            value: 1,
            sourceName: 1,
            sourceUrl: 1,
            confidence: 1,
            observedAt: 1,
          },
        )
        .lean()) as UserIdentityObservation[])
    : [];

  if (!userId) {
    if (inferredPiUserKey?.toLowerCase().startsWith('netid:')) {
      const netid = inferredPiUserKey.slice('netid:'.length).trim();
      if (netid) {
        const user = await deps.userModel.findOne({ netid }, { _id: 1 }).lean();
        if (user?._id) userId = String(user._id);
      }
    }
    if (!userId && userObservations.length > 0) {
      userId = await findUserIdFromIdentityObservations(userObservations, deps);
    }
  }

  if (!userDoc && userId) {
    userDoc = (await deps.userModel
      .findById(userId, {
        _id: 1,
        fname: 1,
        lname: 1,
        title: 1,
        bio: 1,
        primaryDepartment: 1,
        secondaryDepartments: 1,
        departments: 1,
        researchInterests: 1,
        topics: 1,
        profileUrls: 1,
        website: 1,
      })
      .lean()) as Record<string, unknown> | null;
  }

  return {
    inferredOwnerObservation,
    inferredPiUserId,
    inferredPiUserKey,
    userId,
    userObservations,
    userDoc,
  };
}

export function buildResearchEntityProfileSupplementObservations(
  entityObservations: Array<{ field?: string; value?: unknown }>,
  context: InferredPiProfileContext,
): ResolverObservation[] {
  if (context.userObservations.length === 0 && !context.userDoc) return [];

  const departments = departmentsFromProfileContext(context);
  const departmentObservation =
    bestObservationForField(context.userObservations, 'departments') ||
    bestObservationForField(context.userObservations, 'primaryDepartment') ||
    bestObservationForField(context.userObservations, 'secondaryDepartments');
  const defaultObservedAt = latestObservationDate(context.userObservations);
  const makeObservation = (
    field: string,
    value: unknown,
    observation?: UserIdentityObservation,
  ): ResolverObservation => ({
    field,
    value,
    sourceName: observation?.sourceName || 'dept-faculty-roster',
    confidence: Math.max(0.55, Number(observation?.confidence) || 0.55),
    observedAt: observation?.observedAt || defaultObservedAt,
  });

  const out: ResolverObservation[] = [];
  if (!hasMeaningfulObservation(entityObservations, 'departments') && departments.length > 0) {
    out.push(makeObservation('departments', departments, departmentObservation));
  }

  return out;
}

export function buildOfficialProfileCoverageInputs(
  researchEntityId: string,
  researchEntityName: string,
  researchEntityWebsiteUrl: string | undefined,
  context: InferredPiProfileContext,
): {
  pathway?: UpsertEntryPathwayInput;
  route?: UpsertContactRouteInput;
  signal?: UpsertAccessSignalInput;
} {
  if (context.userObservations.length === 0) return {};
  const ownerSourceName = firstStringValue(context.inferredOwnerObservation?.sourceName);
  if (OFFICIAL_PROFILE_FALLBACK_BLOCKED_OWNER_SOURCES.has(ownerSourceName)) return {};

  const profileUrl = bestOfficialProfileUrl(context);
  if (!profileUrl) return {};
  if (!isPubliclyExposableSourceUrl(profileUrl)) return {};

  const evidenceObservations = context.userObservations.filter((observation) => {
    if (observation.field === 'profileUrls') {
      return firstProfileUrlValue(observation.value)?.url === profileUrl;
    }
    return ['bio', 'researchInterests', 'topics', 'title', 'fname', 'lname'].includes(
      observation.field || '',
    );
  });
  const sourceEvidenceIds = observationIdsFromUserObservations(evidenceObservations);
  const sourceName =
    bestObservationForField(evidenceObservations, 'profileUrls')?.sourceName ||
    'dept-faculty-roster';
  const observedAt = latestObservationDate(evidenceObservations);
  const confidence = Math.max(0.55, maxObservationConfidence(evidenceObservations) || 0.55);
  const identifier = (
    context.userId ||
    context.inferredPiUserKey ||
    researchEntityName
  ).toLowerCase();
  const displayName =
    displayNameFromProfileContext(context) || researchEntityName.replace(/\s+Lab$/i, '');
  const title = bestContextString(context, 'title') || 'Faculty PI';
  const sourceUrls = uniqueCleanStrings([profileUrl, researchEntityWebsiteUrl]);

  return {
    pathway: {
      researchEntityId,
      pathwayType: 'EXPLORATORY_CONTACT',
      status: 'PLAUSIBLE',
      evidenceStrength: confidence >= 0.7 ? 'MODERATE' : 'WEAK',
      studentFacingLabel: 'Explore the PI profile',
      explanation:
        'An official Yale faculty profile is available even though no structured join page or posted opening was found.',
      bestNextStep:
        'Review the PI profile and lab site first, then decide whether targeted exploratory outreach is appropriate.',
      compensation: 'UNKNOWN',
      sourceEvidenceIds,
      sourceUrls,
      confidence,
      lastObservedAt: observedAt,
      lastMaterializedAt: new Date(),
      derivationKey: `pathway:EXPLORATORY_CONTACT:OFFICIAL_PROFILE:${identifier}`,
    },
    route: {
      researchEntityId,
      routeType: 'FACULTY_PI',
      priority: 60,
      visibility: 'PUBLIC',
      contactPolicy: 'OFFICIAL_ROUTE_PREFERRED',
      name: displayName,
      role: title,
      url: profileUrl,
      rationale: 'Official Yale faculty profile for the PI; review it before outreach.',
      sourceEvidenceIds,
      sourceEvidenceId: sourceEvidenceIds[0],
      observedAt,
      sourceName,
      sourceUrl: profileUrl,
      derivationKey: `route:FACULTY_PI:OFFICIAL_PROFILE:${identifier}`,
    },
    signal: {
      researchEntityId,
      signalType: 'REACH_OUT_PLAUSIBLE',
      confidence: confidence >= 0.75 ? 'HIGH' : confidence >= 0.55 ? 'MEDIUM' : 'LOW',
      confidenceScore: confidence,
      sourceEvidenceId: sourceEvidenceIds[0],
      observedAt,
      excerpt: `Official Yale PI profile available for ${displayName}.`,
      sourceName,
      sourceUrl: profileUrl,
      derivationKey: `signal:REACH_OUT_PLAUSIBLE:OFFICIAL_PROFILE:${identifier}`,
    },
  };
}

async function materializeOfficialProfileCoverage(
  researchEntityId: string,
  researchEntityName: string,
  researchEntityWebsiteUrl: string | undefined,
  context: InferredPiProfileContext,
  deps: OfficialProfileCoverageDeps = {},
): Promise<OfficialProfileCoverageResult> {
  const inputs = buildOfficialProfileCoverageInputs(
    researchEntityId,
    researchEntityName,
    researchEntityWebsiteUrl,
    context,
  );
  if (!inputs.pathway || !inputs.route || !inputs.signal) {
    return { entryPathways: 0, accessSignals: 0, contactRoutes: 0 };
  }

  const accessSignalModel = deps.accessSignalModel || AccessSignal;
  const contactRouteModel = deps.contactRouteModel || ContactRoute;
  const entryPathwayModel = deps.entryPathwayModel || EntryPathway;
  const accessSignalService = deps.accessSignalService || upsertAccessSignal;
  const contactRouteService = deps.contactRouteService || upsertContactRoute;
  const entryPathwayService = deps.entryPathwayService || upsertEntryPathway;

  const [negativeSignal, existingPublicRoute, existingPathway] = await Promise.all([
    accessSignalModel
      .findOne({
        researchEntityId,
        archived: { $ne: true },
        signalType: 'NOT_CURRENTLY_AVAILABLE',
      })
      .lean(),
    contactRouteModel
      .findOne({
        researchEntityId,
        archived: { $ne: true },
        visibility: 'PUBLIC',
      })
      .lean(),
    entryPathwayModel
      .findOne({
        researchEntityId,
        archived: { $ne: true },
      })
      .lean(),
  ]);

  if (negativeSignal) {
    return { entryPathways: 0, accessSignals: 0, contactRoutes: 0 };
  }

  let entryPathways = 0;
  let accessSignals = 0;
  let contactRoutes = 0;
  let pathwayId: string | undefined;

  if (!existingPathway) {
    const pathwayResult = await entryPathwayService(inputs.pathway);
    pathwayId = pathwayResult.pathwayId;
    entryPathways += pathwayId ? 1 : 0;
    if (pathwayId) {
      await accessSignalService({
        ...inputs.signal,
        entryPathwayId: pathwayId,
      });
      accessSignals += 1;
    }
  }

  if (!existingPublicRoute) {
    await contactRouteService({
      ...inputs.route,
      entryPathwayId: pathwayId,
    });
    contactRoutes += 1;
  }

  return { entryPathways, accessSignals, contactRoutes };
}

function materializationPriority(entityType: ObservedEntityType): number {
  switch (entityType) {
    case 'user':
      return 0;
    case 'researchEntity':
    case 'researchGroup':
      return 1;
    case 'researchGroupMember':
      return 2;
    case 'researchEntityRelationship':
      return 3;
    case 'listing':
      return 4;
    case 'fellowship':
      return 5;
    default:
      return 5;
  }
}

function paperIdentityBuckets(groups: Map<string, PaperMaterializationObservation[]>): {
  openAlexKeys: string[];
  arxivKeys: string[];
  doiKeys: string[];
  doiValues: string[];
} {
  const keys = Array.from(groups.keys());
  const arxivKeys = keys.filter((key) => isArxivPaperKey(key));
  const doiKeys = keys.filter((key) => isDoiPaperKey(key));
  const openAlexKeys = keys.filter((key) => !isArxivPaperKey(key) && !isDoiPaperKey(key));
  const doiValues = Array.from(
    new Set(
      Array.from(groups.entries()).flatMap(([entityKey, obs]) => [
        ...observedDoiValues(obs),
        ...(isDoiPaperKey(entityKey)
          ? [normalizeDoiForMaterialization(entityKey.replace(/^doi:/i, ''))].filter(
              (value): value is string => !!value,
            )
          : []),
      ]),
    ),
  );
  return { openAlexKeys, arxivKeys, doiKeys, doiValues };
}

function mapExistingPapers(existingPapers: any[]): {
  byOpenAlexId: Map<string, any>;
  byArxivId: Map<string, any>;
  byDoi: Map<string, any[]>;
} {
  const byOpenAlexId = new Map<string, any>();
  const byArxivId = new Map<string, any>();
  const byDoi = new Map<string, any[]>();
  for (const paper of existingPapers) {
    if (paper.openAlexId) byOpenAlexId.set(String(paper.openAlexId), paper);
    if (paper.arxivId) byArxivId.set(String(paper.arxivId), paper);
    if (paper.doi) {
      const doi = String(paper.doi);
      const list = byDoi.get(doi) || [];
      list.push(paper);
      byDoi.set(doi, list);
    }
  }
  return { byOpenAlexId, byArxivId, byDoi };
}

function findPaperForObservationGroup(
  entityKey: string,
  obs: PaperMaterializationObservation[],
  maps: {
    byOpenAlexId: Map<string, any>;
    byArxivId: Map<string, any>;
    byDoi: Map<string, any[]>;
  },
): any | null {
  const keyValue = uniqueKeyValueForIdentifier('paper', entityKey, obs);
  const doiCandidates = observedDoiValues(obs);
  if (isDoiPaperKey(entityKey) && keyValue) doiCandidates.unshift(keyValue);
  return (
    maps.byOpenAlexId.get(entityKey) ||
    maps.byArxivId.get(entityKey) ||
    (keyValue ? maps.byDoi.get(keyValue)?.[0] : undefined) ||
    doiCandidates
      .map((doi) => maps.byDoi.get(doi))
      .find((papers): papers is any[] => Array.isArray(papers) && papers.length === 1)?.[0] ||
    null
  );
}

const PAPER_SET_FIELDS = new Set([
  'authors',
  'facultyMemberIds',
  'researchEntityIds',
  'fieldsOfStudy',
  'publicationTypes',
  'sources',
]);

const PAPER_DERIVED_AUTHOR_FIELDS = new Set(['yaleAuthorIds', 'yaleAuthorNetIds']);
const PAPER_MATERIALIZATION_ONLY_FIELDS = new Set([PAPER_AUTHORSHIP_EVIDENCE_FIELD]);

export function mergeUniqueArrayValues(existing: unknown, next: unknown): unknown[] {
  const values = [
    ...(Array.isArray(existing)
      ? existing
      : existing === undefined || existing === null
        ? []
        : [existing]),
    ...(Array.isArray(next) ? next : next === undefined || next === null ? [] : [next]),
  ];
  const seen = new Set<string>();
  const merged: unknown[] = [];
  for (const value of values) {
    const key = String(value);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(value);
  }
  return merged;
}

function valuesFromPaperObservations(
  observations: PaperMaterializationObservation[],
  field: string,
): unknown[] {
  const values = observations
    .filter((obs) => obs.field === field)
    .flatMap((obs) => (Array.isArray(obs.value) ? obs.value : [obs.value]))
    .filter((value) => value !== undefined && value !== null && value !== '');
  return mergeUniqueArrayValues(undefined, values);
}

function addUniqueValuesToSet(
  addToSet: Record<string, { $each: unknown[] }>,
  field: string,
  values: unknown[],
): void {
  if (values.length === 0) return;
  const existing = addToSet[field]?.$each || [];
  const merged = mergeUniqueArrayValues(existing, values);
  if (merged.length > 0) addToSet[field] = { $each: merged };
}

function authorshipEvidenceFromPaperObservations(
  observations: PaperMaterializationObservation[],
): PaperAuthorshipEvidence[] {
  return observations
    .filter((obs) => obs.field === PAPER_AUTHORSHIP_EVIDENCE_FIELD)
    .map((obs) =>
      normalizePaperAuthorshipEvidence(obs.value, {
        sourceName: obs.sourceName,
        confidence: obs.confidence,
        sourceUrl: obs.sourceUrl,
        observedAt: obs.observedAt,
      }),
    )
    .filter((evidence): evidence is PaperAuthorshipEvidence => !!evidence);
}

function materializedPaperFieldValue(field: string, value: unknown): unknown {
  if (field === 'doi') return normalizeDoiForMaterialization(value) || undefined;
  return materializedFieldValue('paper', field, value);
}

async function materializePaperAuthorEvidenceFromGroups(
  groups: Map<string, PaperMaterializationObservation[]>,
): Promise<number> {
  void groups;
  return 0;
}

export function buildPaperUpdateFromObservations(
  entityKey: string,
  observations: PaperMaterializationObservation[],
  existingDoc: { manuallyLockedFields?: string[] } | null = null,
): PaperMaterializationPatch {
  const manuallyLockedFields = existingDoc?.manuallyLockedFields || [];
  const resolverObs: ResolverObservation[] = observations.map((obs) => ({
    field: obs.field,
    value: obs.value,
    sourceName: obs.sourceName,
    sourceUrl: obs.sourceUrl,
    confidence: obs.confidence,
    observedAt: obs.observedAt,
  }));
  const resolved = resolveAllFields(resolverObs, { manuallyLockedFields });
  const keyField = uniqueKeyFieldForIdentifier('paper', entityKey) || 'openAlexId';
  const keyValue = uniqueKeyValueForIdentifier('paper', entityKey, observations) || entityKey;
  const set: Record<string, unknown> = {
    [keyField]: keyValue,
    lastObservedAt: new Date(),
  };
  const addToSet: Record<string, { $each: unknown[] }> = {};
  let fieldsWritten = 0;
  let conflicts = 0;

  for (const [field, r] of Object.entries(resolved)) {
    if (manuallyLockedFields.includes(field)) continue;
    if (PAPER_MATERIALIZATION_ONLY_FIELDS.has(field)) continue;
    if (PAPER_DERIVED_AUTHOR_FIELDS.has(field)) continue;

    if (PAPER_SET_FIELDS.has(field)) {
      const values = valuesFromPaperObservations(observations, field);
      addUniqueValuesToSet(addToSet, field, values);
    } else {
      const value = materializedPaperFieldValue(field, r.value);
      if (value !== undefined && value !== null && value !== '') {
        set[field] = value;
      }
    }

    set[`confidenceByField.${field}`] = r.confidence;
    if (r.hasConflict) conflicts++;
    fieldsWritten++;
  }

  const authorshipEvidence = authorshipEvidenceFromPaperObservations(observations);
  if (!manuallyLockedFields.includes('yaleAuthorIds')) {
    addUniqueValuesToSet(
      addToSet,
      'yaleAuthorIds',
      authorshipEvidence.map((evidence) => evidence.userId).filter(Boolean),
    );
  }
  if (!manuallyLockedFields.includes('yaleAuthorNetIds')) {
    addUniqueValuesToSet(
      addToSet,
      'yaleAuthorNetIds',
      authorshipEvidence.map((evidence) => evidence.netid).filter(Boolean),
    );
  }

  if (!existingDoc && !set.title) {
    return {
      update: { $set: set },
      fieldsWritten: 0,
      conflicts: 0,
      skipped: 'missing-required-fields',
    };
  }

  const update: PaperMaterializationPatch['update'] = { $set: set };
  if (Object.keys(addToSet).length > 0) update.$addToSet = addToSet;
  return { update, fieldsWritten, conflicts };
}

function escapeRegexLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function buildFellowshipLookupClauses(
  entityKey: string,
  observations: Array<{ field?: string; value?: unknown; sourceUrl?: string }>,
): Record<string, unknown>[] {
  const clauses: Record<string, unknown>[] = [];
  if (entityKey) clauses.push({ sourceKey: entityKey });

  const sourceUrl = firstStringValue(bestObservationForField(observations, 'sourceUrl')?.value);
  if (sourceUrl) clauses.push({ sourceUrl });

  const applicationLink = firstStringValue(
    bestObservationForField(observations, 'applicationLink')?.value,
  );
  if (applicationLink) {
    clauses.push({ applicationLink });
    clauses.push({ 'links.url': applicationLink });
  }

  const title = firstStringValue(bestObservationForField(observations, 'title')?.value);
  if (title) clauses.push({ title: new RegExp(`^${escapeRegexLiteral(title)}$`, 'i') });

  return clauses;
}

const FELLOWSHIP_MATERIALIZED_FIELDS = new Set([
  'title',
  'competitionType',
  'summary',
  'description',
  'applicationInformation',
  'eligibility',
  'restrictionsToUseOfAward',
  'additionalInformation',
  'links',
  'applicationLink',
  'awardAmount',
  'isAcceptingApplications',
  'applicationOpenDate',
  'deadline',
  'contactName',
  'contactEmail',
  'contactPhone',
  'contactOffice',
  'yearOfStudy',
  'termOfAward',
  'purpose',
  'globalRegions',
  'citizenshipStatus',
  'sourceName',
  'sourceUrl',
  'sourceKey',
  'sourceFingerprint',
]);

export function buildFellowshipUpdateFromObservations(
  entityKey: string,
  observations: FellowshipMaterializationObservation[],
  existingDoc: {
    manuallyLockedFields?: string[];
    title?: string;
    sourceFingerprint?: string;
    sourceLastChangedAt?: Date;
  } | null = null,
  now: Date = new Date(),
): FellowshipMaterializationPatch {
  const manuallyLockedFields = existingDoc?.manuallyLockedFields || [];
  const resolverObs: ResolverObservation[] = observations.map((obs) => ({
    field: obs.field,
    value: obs.value,
    sourceName: obs.sourceName,
    sourceUrl: obs.sourceUrl,
    confidence: obs.confidence,
    observedAt: obs.observedAt,
  }));
  const resolved = resolveAllFields(resolverObs, { manuallyLockedFields });
  const set: Record<string, unknown> = {
    sourceKey: entityKey,
    sourceLastVerifiedAt: now,
  };
  let fieldsWritten = 0;
  let conflicts = 0;

  for (const [field, r] of Object.entries(resolved)) {
    if (manuallyLockedFields.includes(field)) continue;
    if (!FELLOWSHIP_MATERIALIZED_FIELDS.has(field)) continue;
    const value = r.value;
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value) && value.length === 0) continue;
    set[field] = value;
    if (r.hasConflict) conflicts++;
    fieldsWritten++;
  }

  const observedSourceUrl =
    firstStringValue(bestObservationForField(observations, 'sourceUrl')?.value) ||
    firstStringValue(observations.find((obs) => obs.sourceUrl)?.sourceUrl);
  if (observedSourceUrl && !set.sourceUrl) set.sourceUrl = observedSourceUrl;

  const sourceName =
    firstStringValue(bestObservationForField(observations, 'sourceName')?.value) ||
    observations.find((obs) => firstStringValue(obs.sourceName))?.sourceName;
  if (sourceName && !set.sourceName) set.sourceName = sourceName;

  const sourceFingerprint = firstStringValue(set.sourceFingerprint);
  const unchanged =
    !!existingDoc?.sourceFingerprint &&
    !!sourceFingerprint &&
    existingDoc.sourceFingerprint === sourceFingerprint;
  set.sourceLastChangedAt =
    unchanged && existingDoc?.sourceLastChangedAt ? existingDoc.sourceLastChangedAt : now;

  if (!existingDoc?.title && !set.title) {
    return {
      update: { $set: set },
      fieldsWritten: 0,
      conflicts: 0,
      unchanged,
      skipped: 'missing-required-fields',
    };
  }

  return {
    update: { $set: set },
    fieldsWritten,
    conflicts,
    unchanged,
  };
}

/**
 * Some entity schemas have required fields the scraper observation set may not
 * carry — User in particular requires email/fname/lname. Skip create when
 * those aren't present rather than throwing a Mongoose ValidationError that
 * would abort the whole materialization run.
 */
function hasRequiredFieldsForCreate(
  entityType: ObservedEntityType,
  insert: Record<string, unknown>,
): boolean {
  if (entityType === 'user') {
    return !!(insert.email && insert.fname && insert.lname);
  }
  if (entityType === 'paper') {
    return !!insert.title;
  }
  if (isResearchEntityObservationType(entityType)) {
    return !!insert.name;
  }
  return true;
}

export async function materializeEntity(
  entityType: ObservedEntityType,
  identifier: { entityId?: string; entityKey?: string },
  options: MaterializeOptions = {},
): Promise<MaterializeResult> {
  const filter: any = { entityType, superseded: false };
  if (identifier.entityId && identifier.entityKey) {
    filter.$or = [{ entityId: identifier.entityId }, { entityKey: identifier.entityKey }];
  } else if (identifier.entityId) {
    filter.entityId = identifier.entityId;
  } else if (identifier.entityKey) {
    filter.entityKey = identifier.entityKey;
  } else throw new Error('materializeEntity requires entityId or entityKey');

  const obs = await Observation.find(filter).lean();
  if (obs.length === 0) {
    return {
      entityType,
      ...identifier,
      fieldsWritten: 0,
      conflicts: 0,
      created: false,
      resolved: {},
    };
  }

  if (entityType === 'researchGroupMember') {
    if (options.dryRun) {
      return {
        entityType,
        ...identifier,
        fieldsWritten: 0,
        conflicts: 0,
        created: false,
        resolved: {},
      };
    }

    const memberResult = await syncResolvedMemberFromObservationFields(obs as any[]);
    return {
      entityType,
      entityId: memberResult.researchEntityId,
      entityKey: identifier.entityKey,
      fieldsWritten: memberResult.synced ? obs.length : 0,
      conflicts: 0,
      created: memberResult.created,
      resolved: {},
      skipped: memberResult.skipped,
    };
  }

  if (entityType === 'researchEntityRelationship') {
    if (options.dryRun) {
      return {
        entityType,
        ...identifier,
        fieldsWritten: 0,
        conflicts: 0,
        created: false,
        resolved: {},
      };
    }

    const relationshipResult = await syncResolvedRelationshipFromObservationFields(obs as any[]);
    return {
      entityType,
      entityId: relationshipResult.sourceResearchEntityId,
      entityKey: identifier.entityKey,
      fieldsWritten: relationshipResult.synced ? obs.length : 0,
      conflicts: 0,
      created: relationshipResult.created,
      resolved: {},
      skipped: relationshipResult.skipped,
    };
  }

  const Model = entityModelFor(entityType);
  if (!Model) {
    return {
      entityType,
      ...identifier,
      fieldsWritten: 0,
      conflicts: 0,
      created: false,
      resolved: {},
      skipped: 'no-materializer-registered',
    };
  }

  let entityDoc: any = null;
  let entityIdString: string | undefined = identifier.entityId;
  entityDoc = await findEntityDocByIdentifier(Model, entityType, identifier, obs);
  if (isResearchEntityObservationType(entityType)) {
    entityDoc = await resolveArchivedEntityDocToCanonical(entityDoc, Model);
    if (entityDoc?.archived) {
      return {
        entityType,
        entityId: String(entityDoc._id),
        entityKey: identifier.entityKey,
        fieldsWritten: 0,
        conflicts: 0,
        created: false,
        resolved: {},
        skipped: 'archived-entity-without-canonical',
      };
    }
  }
  if (entityDoc) entityIdString = String(entityDoc._id);
  if (
    shouldPreserveCanonicalResearchEntityFromGeneratedFacultyArea(entityType, identifier, entityDoc)
  ) {
    return {
      entityType,
      entityId: entityIdString,
      entityKey: identifier.entityKey,
      fieldsWritten: 0,
      conflicts: 0,
      created: false,
      resolved: {},
      skipped: 'canonical-research-entity-preserved',
    };
  }

  const manuallyLockedFields: string[] = (entityDoc && entityDoc.manuallyLockedFields) || [];
  const manualValues: Record<string, unknown> = {};
  for (const f of manuallyLockedFields) {
    if (entityDoc && entityDoc[f] !== undefined) manualValues[f] = entityDoc[f];
  }

  const materializationObs = obs.filter(
    (o: any) => !shouldIgnoreObservationForEntityMaterialization(entityType, o),
  );
  const userNameCheckedMaterializationObs =
    entityType === 'user'
      ? filterUserObservationsWithMismatchedProfileUrl(
          materializationObs as UserIdentityObservation[],
          entityDoc,
        )
      : materializationObs;
  const resolverMaterializationObs =
    entityType === 'user'
      ? userNameCheckedMaterializationObs.filter(
          (o: any) => o.field !== 'bio' || isMaterializableUserBioCandidate(o.value),
        )
      : userNameCheckedMaterializationObs;
  const inferredPiProfileContext = isResearchEntityObservationType(entityType)
    ? await loadInferredPiProfileContext(
        userNameCheckedMaterializationObs as any[],
        {
          userModel: User,
          observationModel: Observation,
          researchGroupMemberModel: ResearchGroupMember,
        },
        entityIdString,
      )
    : null;
  const supplementalResolverObs =
    isResearchEntityObservationType(entityType) && inferredPiProfileContext
      ? buildResearchEntityProfileSupplementObservations(
          userNameCheckedMaterializationObs as Array<{ field?: string; value?: unknown }>,
          inferredPiProfileContext,
        )
      : [];

  const resolverObs: ResolverObservation[] = [
    ...resolverMaterializationObs.map((o: any) => ({
      field: o.field,
      value: o.value,
      sourceName: o.sourceName,
      sourceUrl: o.sourceUrl,
      confidence: o.confidence,
      observedAt: o.observedAt,
    })),
    ...supplementalResolverObs,
  ];

  const resolved = resolveAllFields(resolverObs, {
    manuallyLockedFields,
    manualValues,
    ...(entityType === 'user' ? { observationScore: buildUserBioObservationScore } : {}),
  });
  const userProfileDepartmentFields = ['primaryDepartment', 'secondaryDepartments', 'departments'];
  const shouldCanonicalizeUserProfileDepartments =
    entityType === 'user' &&
    userProfileDepartmentFields.some((field) => resolved[field] && !manuallyLockedFields.includes(field));
  const canonicalUserProfileDepartments = shouldCanonicalizeUserProfileDepartments
    ? await canonicalizeProfileDepartments({
        primaryDepartment: resolved.primaryDepartment?.value ?? entityDoc?.primaryDepartment,
        secondaryDepartments: resolved.secondaryDepartments?.value ?? entityDoc?.secondaryDepartments,
        departments: resolved.departments?.value ?? entityDoc?.departments,
      })
    : null;
  const userProfileDepartmentConfidence = Math.max(
    ...userProfileDepartmentFields.map((field) => resolved[field]?.confidence || 0),
  );

  const set: Record<string, unknown> = {};
  const unset: Record<string, ''> = {};
  const confidenceByField: Record<string, number> = {
    ...(entityDoc?.confidenceByField || {}),
  };
  const clearIgnoredAccessClaim = shouldClearIgnoredAccessClaimForEntity(
    entityType,
    obs,
    manuallyLockedFields,
  );
  let conflicts = 0;
  let fieldsWritten = 0;
  for (const [field, r] of Object.entries(resolved)) {
    if (manuallyLockedFields.includes(field)) continue;
    if (
      entityType === 'paper' &&
      (PAPER_DERIVED_AUTHOR_FIELDS.has(field) || PAPER_MATERIALIZATION_ONLY_FIELDS.has(field))
    ) {
      continue;
    }
    if (entityType === 'user' && entityDoc && field === 'netid') continue;
    if (
      isResearchEntityObservationType(entityType) &&
      entityDoc &&
      field === 'slug' &&
      firstStringValue(entityDoc.slug) &&
      firstStringValue(entityDoc.slug) !== firstStringValue(r.value)
    ) {
      continue;
    }
    if (entityType === 'user' && userProfileDepartmentFields.includes(field)) {
      continue;
    }
    let nextValue =
      entityType === 'paper' && PAPER_SET_FIELDS.has(field)
        ? mergeUniqueArrayValues(entityDoc?.[field], r.value)
        : r.value;
    if (isResearchEntityObservationType(entityType) && field === 'departments') {
      const canonical = await canonicalizeDepartmentList(nextValue);
      nextValue = canonical.departments;
    }
    set[field] = materializedFieldValue(entityType, field, nextValue);
    confidenceByField[field] = r.confidence;
    if (r.hasConflict) conflicts++;
    fieldsWritten++;
  }
  if (canonicalUserProfileDepartments) {
    const profileDepartmentValues: Record<string, unknown> = {
      primaryDepartment: canonicalUserProfileDepartments.primaryDepartment,
      secondaryDepartments: canonicalUserProfileDepartments.secondaryDepartments,
      departments: canonicalUserProfileDepartments.departments,
    };
    for (const [field, value] of Object.entries(profileDepartmentValues)) {
      if (manuallyLockedFields.includes(field)) continue;
      set[field] = materializedFieldValue(entityType, field, value);
      confidenceByField[field] = userProfileDepartmentConfidence;
      fieldsWritten++;
    }
  }
  if (entityType === 'paper') {
    const paperObs = materializationObs.map((o: any) => ({
      field: o.field,
      value: o.value,
      sourceName: o.sourceName,
      confidence: o.confidence,
      observedAt: o.observedAt,
      sourceUrl: o.sourceUrl,
    })) as PaperMaterializationObservation[];
    const evidence = authorshipEvidenceFromPaperObservations(paperObs);
    if (!manuallyLockedFields.includes('yaleAuthorIds') && evidence.length > 0) {
      set.yaleAuthorIds = mergeUniqueArrayValues(
        entityDoc?.yaleAuthorIds,
        evidence.map((item) => item.userId),
      );
    }
    if (!manuallyLockedFields.includes('yaleAuthorNetIds') && evidence.length > 0) {
      set.yaleAuthorNetIds = mergeUniqueArrayValues(
        entityDoc?.yaleAuthorNetIds,
        evidence.map((item) => item.netid).filter(Boolean),
      );
    }
  }
  if (clearIgnoredAccessClaim) {
    delete set.acceptingUndergrads;
    delete confidenceByField.acceptingUndergrads;
    unset.acceptingUndergrads = '';
  }
  set.confidenceByField = confidenceByField;
  // For ResearchGroup, mirror the per-field acceptance confidence to a
  // top-level scalar so Meilisearch can filter on it. Meili can't index
  // nested mixed objects (see researchGroupFilters.ts). Prefer the freshly
  // resolved confidence (which includes the 1.0 boost for manually-locked
  // fields) over whatever was already on the doc.
  if (isResearchEntityObservationType(entityType)) {
    const resolvedScore = resolved['acceptingUndergrads']?.confidence;
    const fallbackScore = confidenceByField['acceptingUndergrads'];
    const score = typeof resolvedScore === 'number' ? resolvedScore : fallbackScore;
    set.acceptanceConfidence = typeof score === 'number' ? score : 0;
  }
  set.lastObservedAt = new Date();

  if (options.dryRun) {
    return {
      entityType,
      entityId: entityIdString,
      entityKey: identifier.entityKey,
      fieldsWritten,
      conflicts,
      created: !entityDoc,
      resolved,
    };
  }

  let created = false;
  if (entityDoc) {
    const update: Record<string, unknown> = { $set: set };
    if (Object.keys(unset).length > 0) update.$unset = unset;
    await Model.updateOne({ _id: entityDoc._id }, update);
  } else {
    const keyField = uniqueKeyFieldForIdentifier(entityType, identifier.entityKey);
    if (!keyField || !identifier.entityKey) {
      throw new Error(`Cannot create new ${entityType}: missing entityKey or no keyField defined`);
    }
    const keyValue = uniqueKeyValueForIdentifier(entityType, identifier.entityKey, obs);
    if (!keyValue) {
      throw new Error(`Cannot create new ${entityType}: missing normalized unique key value`);
    }
    const insert: Record<string, unknown> = { ...set, [keyField]: keyValue };
    if (!hasRequiredFieldsForCreate(entityType, insert)) {
      return {
        entityType,
        entityId: undefined,
        entityKey: identifier.entityKey,
        fieldsWritten: 0,
        conflicts: 0,
        created: false,
        resolved,
        skipped: 'missing-required-fields',
      };
    }
    const created_ = await Model.create(insert);
    entityIdString = String(created_._id);
    created = true;
  }

  if (isResearchEntityObservationType(entityType) && entityIdString && !options.dryRun) {
    await syncInferredPiMembership(entityIdString, obs as any[]);
  }

  const syncEntityType = entityType === 'researchGroup' ? 'researchEntity' : entityType;
  if (options.syncMeilisearch !== false && isSyncableEntityType(syncEntityType) && entityIdString) {
    const fresh = await Model.findById(entityIdString).lean();
    if (fresh) await syncEntity(syncEntityType, fresh);
  }

  let postMaterializationMetrics: Required<ReportPostMaterializationMetrics> | undefined;
  if (
    isResearchEntityObservationType(entityType) &&
    entityIdString &&
    !options.skipAccessMaterialization
  ) {
    const accessResult = await materializeAccessForResearchGroup({
      researchEntityId: entityIdString,
      entityKey: identifier.entityKey,
    });
    postMaterializationMetrics = {
      entryPathways: accessResult.entryPathways,
      accessSignals: accessResult.accessSignals,
      contactRoutes: accessResult.contactRoutes,
      postedOpportunities: 0,
      guardedContactRoutes: accessResult.guardedContactRoutes,
      staleEvidenceSkipped: accessResult.staleEvidenceSkipped,
      conflicts: 0,
      errors: accessResult.errors,
    };

    const freshEntity = (await Model.findById(entityIdString)
      .select('name websiteUrl')
      .lean()) as any;
    if (freshEntity && inferredPiProfileContext) {
      addPostMaterializationMetrics(
        postMaterializationMetrics,
        await materializeOfficialProfileCoverage(
          entityIdString,
          firstStringValue(freshEntity.name) || firstStringValue(identifier.entityKey),
          firstStringValue(freshEntity.websiteUrl),
          inferredPiProfileContext,
        ),
      );
    }
  }

  return {
    entityType,
    entityId: entityIdString,
    entityKey: identifier.entityKey,
    fieldsWritten,
    conflicts,
    created,
    resolved,
    postMaterializationMetrics,
  };
}

/**
 * Materialize all entities that have observations from a given ScrapeRun.
 */
async function materializePaperObservationsFromRun(
  scrapeRunId: string,
  options: MaterializeOptions = {},
): Promise<{
  materialized: number;
  created: number;
  updated: number;
  conflicts: number;
  skipped: number;
  errors: number;
}> {
  void scrapeRunId;
  void options;
  return { materialized: 0, created: 0, updated: 0, conflicts: 0, skipped: 0, errors: 0 };
}

async function materializeScholarlyLinkObservationsFromRun(
  scrapeRunId: string,
  options: MaterializeOptions = {},
): Promise<{
  materialized: number;
  created: number;
  updated: number;
  conflicts: number;
  skipped: number;
  errors: number;
}> {
  const observations = await Observation.find({
    scrapeRunId: new mongoose.Types.ObjectId(scrapeRunId),
    entityType: 'scholarlyLink',
    superseded: false,
  })
    .select('entityId entityKey field value sourceName confidence observedAt sourceUrl')
    .lean();

  const groups = new Map<string, any[]>();
  for (const obs of observations as any[]) {
    if (!obs.entityKey && !obs.entityId) continue;
    const groupKey = `${String(obs.entityId || '')}:${String(obs.entityKey || '')}`;
    const list = groups.get(groupKey) || [];
    list.push(obs);
    groups.set(groupKey, list);
  }

  if (groups.size === 0) {
    return { materialized: 0, created: 0, updated: 0, conflicts: 0, skipped: 0, errors: 0 };
  }

  let materialized = 0;
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let errors = 0;
  const ops: any[] = [];
  const attributionOps: any[] = [];

  for (const obs of groups.values()) {
    const getValue = (field: string) =>
      obs
        .filter((item) => item.field === field)
        .sort(
          (a, b) => new Date(b.observedAt || 0).getTime() - new Date(a.observedAt || 0).getTime(),
        )[0]?.value;
    const title = String(getValue('title') || '').trim();
    const url = String(getValue('url') || '').trim();
    const destinationKind = String(getValue('destinationKind') || '').trim();
    const displaySource = String(getValue('displaySource') || '').trim();
    const discoveredVia = String(getValue('discoveredVia') || '').trim();
    if (!title || !url || !destinationKind || !displaySource || !discoveredVia) {
      skipped++;
      continue;
    }

    const userId = getValue('userId');
    const researchEntityId = getValue('researchEntityId');
    const lookupClauses = buildScholarlyLinkLookupClauses(obs[0]?.entityId, obs);
    const existing =
      lookupClauses.length > 0
        ? await ResearchScholarlyLink.findOne({
            archived: { $ne: true },
            $or: lookupClauses,
          })
            .select('_id')
            .lean()
        : null;
    const scholarlyLinkId = existing?._id || new mongoose.Types.ObjectId();

    materialized++;
    if (existing) updated++;
    else created++;
    if (options.dryRun) continue;

    const confidence = Number(getValue('confidence'));
    const set: Record<string, unknown> = {
      title,
      url,
      destinationKind,
      displaySource,
      freeFullTextUrl: String(getValue('freeFullTextUrl') || '').trim(),
      freeFullTextLabel: String(getValue('freeFullTextLabel') || '').trim(),
      discoveredVia,
      venue: String(getValue('venue') || '').trim(),
      externalIds: getValue('externalIds') || {},
      confidence: Number.isFinite(confidence) ? confidence : 0.7,
      observedAt: getValue('observedAt') || new Date(),
      sourceUrl: String(obs[0]?.sourceUrl || '').trim(),
      archived: false,
    };
    const crossrefHydratedAt = getValue('crossrefHydratedAt');
    if (crossrefHydratedAt) set.crossrefHydratedAt = crossrefHydratedAt;
    const year = Number(getValue('year'));
    if (Number.isFinite(year) && year > 0) set.year = year;
    if (userId) set.userId = userId;
    if (researchEntityId) set.researchEntityId = researchEntityId;
    const sourceConfidence = Number(obs[0]?.confidence);
    attributionOps.push(
      ...buildScholarlyAttributionWriteModels({
        scholarlyLinkId,
        userId,
        researchEntityId,
        sourceName: String(obs[0]?.sourceName || '').trim(),
        sourceUrl: String(obs[0]?.sourceUrl || '').trim(),
        confidence: Number.isFinite(sourceConfidence) ? sourceConfidence : undefined,
        observedAt: obs[0]?.observedAt,
      }),
    );

    ops.push({
      updateOne: {
        filter: existing
          ? { _id: existing._id }
          : {
              url,
              ...(researchEntityId ? { researchEntityId } : userId ? { userId } : {}),
            },
        update: { $set: set, $setOnInsert: { _id: scholarlyLinkId } },
        upsert: !existing,
      },
    });
  }

  if (!options.dryRun && ops.length > 0) {
    try {
      await ResearchScholarlyLink.bulkWrite(ops, { ordered: false });
    } catch (err) {
      errors += ops.length;
      console.error(
        'materializeScholarlyLinkObservationsFromRun failed:',
        (err as Error)?.message || err,
      );
    }
  }
  if (!options.dryRun && attributionOps.length > 0) {
    try {
      await ResearchScholarlyAttribution.bulkWrite(attributionOps, { ordered: false });
    } catch (err) {
      errors += attributionOps.length;
      console.error(
        'materializeScholarlyLinkObservationsFromRun attribution sync failed:',
        (err as Error)?.message || err,
      );
    }
  }

  return { materialized, created, updated, conflicts: 0, skipped, errors };
}

async function materializeFellowshipObservationsFromRun(
  scrapeRunId: string,
  options: MaterializeOptions = {},
): Promise<{
  materialized: number;
  created: number;
  updated: number;
  unchanged: number;
  conflicts: number;
  skipped: number;
  errors: number;
  missingPreviouslySeen: number;
  metrics: FellowshipCatalogMetrics;
}> {
  const runObjectId = new mongoose.Types.ObjectId(scrapeRunId);
  const observations = (await Observation.find({
    scrapeRunId: runObjectId,
    entityType: 'fellowship',
    superseded: false,
  })
    .select('entityKey field value sourceName confidence observedAt sourceUrl')
    .lean()) as Array<
    FellowshipMaterializationObservation & {
      entityKey?: string;
    }
  >;

  const groups = new Map<string, FellowshipMaterializationObservation[]>();
  for (const obs of observations) {
    if (!obs.entityKey) continue;
    const list = groups.get(obs.entityKey) || [];
    list.push({
      field: obs.field,
      value: obs.value,
      sourceName: obs.sourceName,
      confidence: obs.confidence,
      observedAt: obs.observedAt,
      sourceUrl: obs.sourceUrl,
    });
    groups.set(obs.entityKey, list);
  }

  if (groups.size === 0) {
    return {
      materialized: 0,
      created: 0,
      updated: 0,
      unchanged: 0,
      conflicts: 0,
      skipped: 0,
      errors: 0,
      missingPreviouslySeen: 0,
      metrics: {
        discovered: 0,
        emitted: 0,
        created: 0,
        updated: 0,
        unchanged: 0,
        reviewRequired: 0,
        missingPreviouslySeen: 0,
        deadlineParsed: 0,
        deadlineMissing: 0,
      },
    };
  }

  const seenKeys = Array.from(groups.keys());
  const previouslySeenKeys = await Fellowship.distinct('sourceKey', {
    sourceName: 'yale-college-fellowships-office',
    sourceKey: { $type: 'string' },
    archived: { $ne: true },
  });
  const seenSet = new Set(seenKeys);
  const missingPreviouslySeen = previouslySeenKeys.filter(
    (key) => !seenSet.has(String(key)),
  ).length;

  let materialized = 0;
  let created = 0;
  let updated = 0;
  let unchanged = 0;
  let conflicts = 0;
  let skipped = 0;
  let errors = 0;

  for (const [entityKey, obs] of groups.entries()) {
    const clauses = buildFellowshipLookupClauses(entityKey, obs);
    let existing: any = null;
    if (clauses.length > 0) {
      const matches = await Fellowship.find({ $or: clauses })
        .select('_id title sourceKey sourceFingerprint sourceLastChangedAt manuallyLockedFields')
        .limit(2)
        .lean();
      existing =
        matches.find((match: any) => match.sourceKey && String(match.sourceKey) === entityKey) ||
        (matches.length === 1 ? matches[0] : null);
      if (!existing && matches.length > 1) {
        skipped++;
        continue;
      }
    }

    const patch = buildFellowshipUpdateFromObservations(entityKey, obs, existing);
    if (patch.skipped) {
      skipped++;
      continue;
    }

    materialized++;
    conflicts += patch.conflicts;
    if (existing) {
      if (patch.unchanged) unchanged++;
      else updated++;
    } else {
      created++;
    }

    if (options.dryRun) continue;

    try {
      if (existing) {
        await Fellowship.updateOne({ _id: existing._id }, patch.update);
      } else {
        await Fellowship.create(patch.update.$set);
      }
    } catch (err) {
      errors++;
      console.error(
        `materializeFellowshipObservationsFromRun: ${entityKey} failed:`,
        (err as Error)?.message || err,
      );
    }
  }

  const deadlineParsed = Array.from(groups.values()).filter((obs) =>
    obs.some((item) => item.field === 'deadline' && item.value),
  ).length;
  const reviewRequired = Array.from(groups.values()).filter((obs) =>
    obs.some((item) => item.field === 'reviewRequired' && item.value === true),
  ).length;

  return {
    materialized,
    created,
    updated,
    unchanged,
    conflicts,
    skipped,
    errors,
    missingPreviouslySeen,
    metrics: {
      discovered: groups.size,
      emitted: groups.size,
      created,
      updated,
      unchanged,
      reviewRequired,
      missingPreviouslySeen,
      deadlineParsed,
      deadlineMissing: Math.max(0, groups.size - deadlineParsed),
    },
  };
}

export async function materializeFromRun(
  scrapeRunId: string,
  options: MaterializeOptions = {},
): Promise<{
  materialized: number;
  created: number;
  updated: number;
  conflicts: number;
  skipped: number;
  errors: number;
  postMaterializationMetrics: Required<ReportPostMaterializationMetrics>;
  postMaterializationIntegrity?: PostMaterializationIntegritySummary;
}> {
  const scholarlyLinkResult = await materializeScholarlyLinkObservationsFromRun(
    scrapeRunId,
    options,
  );
  const paperResult = await materializePaperObservationsFromRun(scrapeRunId, options);
  const fellowshipResult = await materializeFellowshipObservationsFromRun(scrapeRunId, options);
  const distinct = await Observation.aggregate([
    {
      $match: {
        scrapeRunId: new mongoose.Types.ObjectId(scrapeRunId),
        entityType: { $nin: ['scholarlyLink', 'paper', 'fellowship'] },
      },
    },
    {
      $group: {
        _id: { entityType: '$entityType', entityId: '$entityId', entityKey: '$entityKey' },
        sourceNames: { $addToSet: '$sourceName' },
        fields: { $addToSet: '$field' },
      },
    },
  ]);

  let materialized = scholarlyLinkResult.materialized + paperResult.materialized;
  let created = scholarlyLinkResult.created + paperResult.created;
  let updated = scholarlyLinkResult.updated + paperResult.updated;
  let conflicts = scholarlyLinkResult.conflicts + paperResult.conflicts;
  let skipped = scholarlyLinkResult.skipped + paperResult.skipped;
  let errors = scholarlyLinkResult.errors + paperResult.errors;
  materialized += fellowshipResult.materialized;
  created += fellowshipResult.created;
  updated += fellowshipResult.updated;
  conflicts += fellowshipResult.conflicts;
  skipped += fellowshipResult.skipped;
  errors += fellowshipResult.errors;
  const postMaterializationMetrics = emptyPostMaterializationMetrics();
  distinct.sort((a, b) => {
    const priorityDiff =
      materializationPriority(a._id.entityType) - materializationPriority(b._id.entityType);
    if (priorityDiff !== 0) return priorityDiff;
    return String(a._id.entityKey || a._id.entityId || '').localeCompare(
      String(b._id.entityKey || b._id.entityId || ''),
    );
  });
  for (const row of distinct) {
    const { entityType, entityId, entityKey } = row._id;
    let res: MaterializeResult;
    try {
      res = await materializeEntity(
        entityType,
        {
          entityId: entityId ? String(entityId) : undefined,
          entityKey: entityKey || undefined,
        },
        {
          ...options,
          skipAccessMaterialization:
            options.skipAccessMaterialization ??
            !shouldMaterializeAccessForRunObservations({
              entityType,
              sourceNames: row.sourceNames || [],
              fields: row.fields || [],
            }),
        },
      );
    } catch (err: any) {
      errors++;
      console.error(
        `materializeFromRun: ${entityType} ${entityKey || entityId} failed:`,
        err?.message || err,
      );
      continue;
    }
    materialized++;
    if (res.created) created++;
    else if (!res.skipped) updated++;
    if (res.skipped) skipped++;
    conflicts += res.conflicts;
    addPostMaterializationMetrics(postMaterializationMetrics, res.postMaterializationMetrics);
  }
  postMaterializationMetrics.postedOpportunities +=
    await countListingBackedPostedOpportunitiesForRun(scrapeRunId);
  const postMaterializationIntegrity = !options.dryRun
    ? await runPostMaterializationIntegrityGate({
        includeSamples: true,
        sourceRunId: scrapeRunId,
      })
    : undefined;
  if (!options.dryRun) {
    const scrapeRunSet: Record<string, unknown> = {
      entitiesCreated: created,
      entitiesUpdated: updated,
      materializationSkipped: skipped,
      materializationConflicts: conflicts,
      materializationErrors: errors,
      postMaterializationMetrics,
      postMaterializationIntegrity,
    };
    if (fellowshipResult.metrics.discovered > 0) {
      scrapeRunSet['metrics.fellowshipCatalog'] = fellowshipResult.metrics;
    }
    await ScrapeRun.updateOne(
      { _id: scrapeRunId },
      {
        $set: scrapeRunSet,
      },
    );
  }
  return {
    materialized,
    created,
    updated,
    conflicts,
    skipped,
    errors,
    postMaterializationMetrics,
    postMaterializationIntegrity,
  };
}

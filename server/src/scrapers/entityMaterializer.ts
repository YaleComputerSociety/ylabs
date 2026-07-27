/**
 * Reads pending Observations for a given entity, resolves field values via the
 * ConfidenceResolver, and writes the resolved values back to the entity collection.
 *
 * For Paper and User entities, also handles upsert when no entityId is yet known
 * (lookup by entityKey, e.g. DOI for Paper or netid for User).
 */
import mongoose from 'mongoose';
import { Observation, ObservedEntityType } from '../models/observation';
import { Paper } from '../models/paper';
import { PaperAuthor } from '../models/paperAuthor';
import { User, normalizeUserType } from '../models/user';
import { ResearchEntity } from '../models/researchEntity';
import { ResearchGroupMember } from '../models/researchGroupMember';
import { ResearchEntityRelationship } from '../models/researchEntityRelationship';
import { ScrapeRun } from '../models/scrapeRun';
import { PostedOpportunity } from '../models/postedOpportunity';
import { ResearchScholarlyLink } from '../models/researchScholarlyLink';
import { deriveShortDescriptionFromFullDescription } from '../utils/researchEntityDescriptionQuality';
import { resolveAllFields, ResolverObservation, ResolvedField } from './confidenceResolver';
import { syncEntity, isSyncableEntityType } from '../services/meiliSyncService';
import { recomputeBrowseRankForEntities } from '../services/researchEntityBrowseRankService';
import { materializeAccessForResearchGroup } from './accessMaterializer';
import type { ReportPostMaterializationMetrics } from './runReport';
import { redactDirectContactInfo } from '../utils/contactRedaction';
import {
  PAPER_AUTHORSHIP_EVIDENCE_FIELD,
  PaperAuthorshipEvidence,
  normalizePaperAuthorshipEvidence,
} from './paperAuthorshipPolicy';
import { cleanPublicProfileBio } from '../services/profileService';
import { serializedDocumentId } from '../utils/idSerialization';
import { sanitizeLogValue } from '../utils/logSanitizer';

interface MaterializeOptions {
  dryRun?: boolean;
  syncMeilisearch?: boolean;
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

const DISCOVERY_ONLY_ACCESS_FIELD_SOURCES = new Set(['ysm-atoz-index', 'yse-centers-index']);
const OFFICIAL_PROFILE_PI_BACKFILL_SOURCE = 'official-profile-pi-backfill';
const OFFICIAL_PROFILE_PUBLICATIONS_FIELD = 'officialProfilePublications';
const PUBLIC_QUOTE_FIELDS = new Set([
  'undergradEvidenceQuote',
  'undergradRoleEvidenceQuote',
  'contactInstructionsQuote',
  'undergradConstraintQuote',
]);
const MATERIALIZER_MANAGED_FIELDS = new Set(['lastObservedAt']);
const MATERIALIZER_OBJECT_ID_RE = /^[a-f0-9]{24}$/i;

export function normalizeMaterializerObjectId(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return MATERIALIZER_OBJECT_ID_RE.test(trimmed) ? trimmed : undefined;
  }
  if (value instanceof mongoose.Types.ObjectId) return value.toHexString();
  return undefined;
}

const materializerDocumentId = (value: unknown): string => serializedDocumentId(value) || '';

function toMaterializerObjectId(value: unknown): mongoose.Types.ObjectId | undefined {
  const id = normalizeMaterializerObjectId(value);
  return id ? new mongoose.Types.ObjectId(id) : undefined;
}

export type MaterializerObservationLike = {
  _id?: unknown;
  field?: string;
  value?: unknown;
  sourceName?: string;
  sourceUrl?: string | null;
  observedAt?: Date;
  confidence?: number;
};

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

type InferredPiObservation = {
  value?: unknown;
  sourceName?: string;
  sourceUrl?: string | null;
  observedAt?: Date;
  confidence?: number;
};

type ResearchGroupMemberMaterializationPatch = {
  filter: Record<string, unknown>;
  update: { $set: Record<string, unknown>; $setOnInsert: Record<string, unknown> };
  fieldsWritten: number;
  conflicts: number;
  resolved: Record<string, ResolvedField>;
  skipped?: string;
};

type ProvenanceResolvedField = ResolvedField & {
  sourceName?: string;
  sourceUrl?: string | null;
  observedAt?: Date;
};

function isOfficialProfileBioChromeObservation(observation: MaterializerObservationLike): boolean {
  if (
    observation.sourceName !== OFFICIAL_PROFILE_PI_BACKFILL_SOURCE ||
    observation.field !== 'bio' ||
    typeof observation.value !== 'string'
  ) {
    return false;
  }

  const value = observation.value.replace(/\s+/g, ' ').trim();
  if (!value) return true;
  if (!cleanPublicProfileBio({ bio: value })) return true;
  if (/@yale\.edu\b/i.test(value)) return true;
  if (
    /\b(?:po box|new haven,?\s*ct|united states|mailing address|contact info|prospect street|west campus drive|kline tower)\b/i.test(
      value,
    )
  ) {
    return true;
  }
  if (
    /^(?:see my webpage|this professor is accepting)\b/i.test(value) ||
    /^medical research interests(?:\b|(?=[A-Z]))/i.test(value)
  ) {
    return true;
  }
  if (
    /\b(?:google scholar|pubmed)\s+profile\b/i.test(value) ||
    /\b(?:for\s+(?:a\s+)?(?:full\s+list|more)|refer\s+to|visit)\b.{0,140}\b(?:google scholar|pubmed|external link)\b/i.test(
      value,
    )
  ) {
    return true;
  }
  if (/^department of\b/i.test(value)) return true;
  if (
    value.length < 120 &&
    /\b(?:selected publications?|wins?|elected|awards?|faculty research awards?)\b/i.test(value) &&
    !/\b(?:studies|research(?:es)?|investigates|develops|focuses on|works on)\b/i.test(value)
  ) {
    return true;
  }
  return /^copy link$/i.test(value);
}

function isResearchEntityObservationType(entityType: ObservedEntityType): boolean {
  return entityType === 'researchEntity' || entityType === 'researchGroup';
}

export function shouldIgnoreObservationForEntityMaterialization(
  entityType: ObservedEntityType,
  observation: MaterializerObservationLike,
): boolean {
  if (observation.field && MATERIALIZER_MANAGED_FIELDS.has(observation.field)) {
    return true;
  }
  if (entityType === 'user' && observation.field === OFFICIAL_PROFILE_PUBLICATIONS_FIELD) {
    return true;
  }
  if (entityType === 'user' && isOfficialProfileBioChromeObservation(observation)) {
    return true;
  }
  return (
    isResearchEntityObservationType(entityType) &&
    observation.field === 'acceptingUndergrads' &&
    !!observation.sourceName &&
    DISCOVERY_ONLY_ACCESS_FIELD_SOURCES.has(observation.sourceName)
  );
}

type OfficialProfilePublicationValue = {
  title?: unknown;
  year?: unknown;
  venue?: unknown;
  url?: unknown;
  sourceUrl?: unknown;
};

const MIN_SCHOLARLY_LINK_YEAR = 1800;
const MAX_SCHOLARLY_LINK_FUTURE_YEARS = 1;

function cleanScholarlyText(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim();
}

function cleanScholarlyHttpUrl(value: unknown): string {
  const text = cleanScholarlyText(value);
  if (!text) return '';
  try {
    const parsed = new URL(text);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? text : '';
  } catch {
    return '';
  }
}

function isPlausibleScholarlyLinkYear(year: number): boolean {
  return (
    Number.isInteger(year) &&
    year >= MIN_SCHOLARLY_LINK_YEAR &&
    year <= new Date().getUTCFullYear() + MAX_SCHOLARLY_LINK_FUTURE_YEARS
  );
}

function normalizeOfficialProfilePublication(
  value: OfficialProfilePublicationValue,
  fallbackSourceUrl: string,
  fallbackObservedAt: Date,
): {
  title: string;
  year?: number;
  venue?: string;
  url: string;
  sourceUrl: string;
  observedAt: Date;
} | null {
  const title = cleanScholarlyText(value.title);
  if (!title) return null;
  const sourceUrl =
    cleanScholarlyHttpUrl(value.sourceUrl) || cleanScholarlyHttpUrl(fallbackSourceUrl);
  if (!sourceUrl) return null;
  const url = cleanScholarlyHttpUrl(value.url);
  if (!url) return null;

  const trimmedYear = typeof value.year === 'string' ? value.year.trim() : '';
  const yearNumber =
    typeof value.year === 'number'
      ? value.year
      : trimmedYear && /^\d+$/.test(trimmedYear)
        ? Number(trimmedYear)
        : undefined;
  const year =
    typeof yearNumber === 'number' && isPlausibleScholarlyLinkYear(yearNumber)
      ? yearNumber
      : undefined;

  return {
    title,
    year,
    venue: cleanScholarlyText(value.venue) || undefined,
    url,
    sourceUrl,
    observedAt: fallbackObservedAt,
  };
}

function officialProfilePublicationUrl(publication: {
  title: string;
  url?: string;
  sourceUrl: string;
}): string {
  if (publication.url) return publication.url;
  return '';
}

export function buildOfficialProfileScholarlyLinkUpserts(
  userId: string,
  observations: MaterializerObservationLike[],
): any[] {
  const userObjectId = toMaterializerObjectId(userId);
  if (!userObjectId) return [];
  const ops: any[] = [];
  const seen = new Set<string>();

  for (const observation of observations) {
    if (observation.field !== OFFICIAL_PROFILE_PUBLICATIONS_FIELD) continue;
    const values = Array.isArray(observation.value) ? observation.value : [observation.value];
    const observedAt = observation.observedAt || new Date();
    const fallbackSourceUrl = observation.sourceUrl || '';
    const confidence = typeof observation.confidence === 'number' ? observation.confidence : 0.9;

    for (const value of values) {
      if (!value || typeof value !== 'object') continue;
      const publication = normalizeOfficialProfilePublication(
        value as OfficialProfilePublicationValue,
        fallbackSourceUrl,
        observedAt,
      );
      if (!publication) continue;
      const key = publication.url.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      ops.push({
        updateOne: {
          filter: {
            userId: userObjectId,
            url: publication.url,
          },
          update: {
            $set: {
              userId: userObjectId,
              title: publication.title,
              url: officialProfilePublicationUrl(publication),
              destinationKind: 'OTHER',
              displaySource: 'Official Yale profile',
              freeFullTextUrl: '',
              freeFullTextLabel: '',
              discoveredVia: 'OFFICIAL_PROFILE',
              ...(publication.year ? { year: publication.year } : {}),
              ...(publication.venue ? { venue: publication.venue } : {}),
              confidence,
              observedAt: publication.observedAt,
              sourceUrl: publication.sourceUrl,
              externalIds: {
                officialProfileSourceUrl: publication.sourceUrl,
              },
              archived: false,
            },
          },
          upsert: true,
        },
      });
    }
  }

  return ops;
}

async function materializeOfficialProfileScholarlyLinks(
  userId: string,
  observations: MaterializerObservationLike[],
): Promise<number> {
  const ops = buildOfficialProfileScholarlyLinkUpserts(userId, observations);
  if (ops.length === 0) return 0;
  const result = await ResearchScholarlyLink.bulkWrite(ops, { ordered: false });
  return result.upsertedCount + result.modifiedCount;
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

function materializedFieldValue(
  entityType: ObservedEntityType,
  field: string,
  value: unknown,
  existingValue?: unknown,
): unknown {
  if (isResearchEntityObservationType(entityType) && field === 'sourceUrls') {
    return sanitizeResearchEntitySourceUrlsForMaterialization(value);
  }
  if (
    isResearchEntityObservationType(entityType) &&
    PUBLIC_QUOTE_FIELDS.has(field) &&
    typeof value === 'string'
  ) {
    return redactDirectContactInfo(value);
  }
  if (entityType === 'user' && field === 'userType') {
    return normalizeUserType(value);
  }
  if (isResearchEntityObservationType(entityType) && field === 'rosterEnrichment') {
    return rosterEnrichmentWithRetainedSuccessfulSnapshot(value, existingValue);
  }
  return value;
}

const successfulRosterSnapshot = (value: unknown): Record<string, unknown> | undefined => {
  const enrichment = objectRecord(value);
  if (!['current', 'partial'].includes(textValue(enrichment.state))) return undefined;
  const memberKeys = Array.isArray(enrichment.memberKeys)
    ? Array.from(new Set(enrichment.memberKeys.map(textValue).filter(Boolean))).slice(0, 40)
    : [];
  const sourceUrl = textValue(enrichment.sourceUrl);
  const observedAt = enrichment.observedAt;
  const freshnessExpiresAt = enrichment.freshnessExpiresAt;
  if (memberKeys.length === 0 || !sourceUrl || !observedAt || !freshnessExpiresAt) return undefined;
  return {
    state: enrichment.state,
    memberKeys,
    sourceUrl,
    ...(enrichment.sourcePublishedAt ? { sourcePublishedAt: enrichment.sourcePublishedAt } : {}),
    observedAt,
    freshnessExpiresAt,
  };
};

export function rosterEnrichmentWithRetainedSuccessfulSnapshot(
  value: unknown,
  existingValue?: unknown,
): unknown {
  const enrichment = objectRecord(value);
  const currentSnapshot = successfulRosterSnapshot(enrichment);
  if (currentSnapshot) return { ...enrichment, lastSuccessfulSnapshot: currentSnapshot };
  if (textValue(enrichment.state) !== 'failed') return enrichment;

  const existing = objectRecord(existingValue);
  const retained =
    successfulRosterSnapshot(existing) ||
    successfulRosterSnapshot(objectRecord(existing.lastSuccessfulSnapshot));
  return retained ? { ...enrichment, lastSuccessfulSnapshot: retained } : enrichment;
}

const RESEARCH_ENTITY_CONTENT_PAGE_SOURCE_PATH_RE =
  /(^|[-/])(blog|blogs|news|events|calendar|newsletter|article|stories|press|podcast|video|webinar)([-/]|$)/i;

export function isResearchEntityContentPageSourceUrl(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const raw = value.trim();
  if (!raw) return false;
  try {
    return RESEARCH_ENTITY_CONTENT_PAGE_SOURCE_PATH_RE.test(new URL(raw).pathname);
  } catch {
    return RESEARCH_ENTITY_CONTENT_PAGE_SOURCE_PATH_RE.test(raw);
  }
}

export function sanitizeResearchEntitySourceUrlsForMaterialization(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return value.filter((url) => !isResearchEntityContentPageSourceUrl(url));
}

function isInitialOnlyNameValue(value: unknown): boolean {
  const raw = textValue(value);
  if (/^[A-Z]{2,}$/.test(raw)) return false;
  const tokens = identityTokens(value);
  return tokens.length === 1 && (tokens[0].length === 1 || raw.includes('.'));
}

export function shouldPreserveExistingUserIdentityField(
  field: string,
  nextValue: unknown,
  existingDoc: Record<string, unknown> | null,
): boolean {
  if (!existingDoc || (field !== 'fname' && field !== 'firstName')) return false;
  const existingValue = existingDoc[field] || existingDoc.fname || existingDoc.firstName;
  if (!textValue(existingValue)) return false;
  return isInitialOnlyNameValue(nextValue) && !isInitialOnlyNameValue(existingValue);
}

function comparableObservationValue(value: unknown): string {
  if (typeof value === 'string') return value.trim().toLowerCase();
  return JSON.stringify(value);
}

function fieldProvenanceForResolvedObservation(
  field: string,
  resolved: ResolvedField,
  observations: MaterializerObservationLike[],
): Record<string, unknown> | null {
  const resolvedValue = comparableObservationValue(resolved.value);
  const contributingSources = new Set(resolved.contributingSources);
  const match = observations
    .filter(
      (obs) => obs.field === field && obs.sourceName && contributingSources.has(obs.sourceName),
    )
    .find((obs) => comparableObservationValue(obs.value) === resolvedValue);
  if (!match) return null;

  return {
    ...(match._id ? { sourceId: match._id } : {}),
    sourceName: match.sourceName,
    sourceUrl: match.sourceUrl || '',
    observedAt: match.observedAt || new Date(),
    confidence: match.confidence ?? resolved.confidence,
  };
}

export function buildInferredPiMemberUpsert(
  researchEntityId: string,
  observation: InferredPiObservation,
): {
  filter: Record<string, unknown>;
  update: { $set: Record<string, unknown>; $setOnInsert: Record<string, unknown> };
} | null {
  const userId = String(observation.value || '').trim();
  const safeResearchEntityId = normalizeMaterializerObjectId(researchEntityId);
  const safeUserId = normalizeMaterializerObjectId(userId);
  if (!safeResearchEntityId || !safeUserId) {
    return null;
  }
  const observedAt = observation.observedAt || new Date();
  const confidence = typeof observation.confidence === 'number' ? observation.confidence : 0.5;
  const sourceUrl = observation.sourceUrl || '';
  const sourceName = observation.sourceName || '';

  return {
    filter: {
      researchEntityId: safeResearchEntityId,
      userId: safeUserId,
      role: 'pi',
      isCurrentMember: true,
    },
    update: {
      $set: {
        researchEntityId: safeResearchEntityId,
        researchGroupId: safeResearchEntityId,
        userId: safeUserId,
        role: 'pi',
        isCurrentMember: true,
        sourceUrl,
        confidence,
        lastObservedAt: observedAt,
        'confidenceByField.role': confidence,
        'fieldProvenance.role': {
          sourceName,
          sourceUrl,
          observedAt,
          confidence,
        },
      },
      $setOnInsert: {
        startedAt: observedAt,
      },
    },
  };
}

const MEMBER_ROLES = new Set([
  'pi',
  'co-pi',
  'director',
  'co-director',
  'core-faculty',
  'affiliated',
  'alumni',
  'postdoc',
  'grad-student',
  'undergrad',
  'staff',
  'affiliate',
]);

/** Roles the public "Principal Investigator" panel renders as the entity lead. */
const LEAD_MEMBER_ROLES = new Set(['pi', 'co-pi', 'director', 'co-director']);
/** Non-lead roster roles a promoted director supersedes within an entity. */
const SUPERSEDED_BY_DIRECTOR_ROLES = ['core-faculty', 'affiliated', 'affiliate'];

const objectRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

function memberNameFromInferredUserName(value: unknown): string {
  const record = objectRecord(value);
  const first = textValue(record.fname || record.first || record.firstName);
  const last = textValue(record.lname || record.last || record.lastName);
  return [first, last].filter(Boolean).join(' ').trim();
}

function normalizeMemberRole(value: unknown): string {
  const role = textValue(value).toLowerCase();
  return MEMBER_ROLES.has(role) ? role : '';
}

async function findUniqueUserForResearchGroupMember(
  resolved: Record<string, ResolvedField>,
): Promise<any | null> {
  const profileUrl = textValue(resolved.profileUrl?.value);
  if (!profileUrl) return null;
  const users = await User.find({
    $or: [
      { 'profileUrls.official': profileUrl },
      { 'profileUrls.medicine': profileUrl },
      { 'profileUrls.yale': profileUrl },
      { 'profileUrls.department': profileUrl },
      { 'profileUrls.directory': profileUrl },
      { scholarCandidateProfileUrls: profileUrl },
      { website: profileUrl },
    ],
  })
    .select('_id facultyMemberId')
    .limit(2)
    .lean();
  return users.length === 1 ? users[0] : null;
}

export function buildResearchGroupMemberUpsert(
  researchEntityId: string,
  resolved: Record<string, ProvenanceResolvedField>,
  user: Record<string, unknown> | null = null,
): ResearchGroupMemberMaterializationPatch | null {
  if (!normalizeMaterializerObjectId(researchEntityId)) return null;
  const role = normalizeMemberRole(resolved.role?.value);
  if (!role) return null;
  if (
    textValue(resolved.currentStatus?.value) &&
    textValue(resolved.currentStatus?.value) !== 'current'
  ) {
    return null;
  }
  if (
    textValue(resolved.evidenceStatus?.value) &&
    textValue(resolved.evidenceStatus?.value) !== 'verified'
  ) {
    return null;
  }
  if (
    resolved.name?.hasConflict ||
    resolved.profileUrl?.hasConflict ||
    resolved.identityKey?.hasConflict ||
    resolved.membershipKey?.hasConflict ||
    resolved.role?.hasConflict
  ) {
    return null;
  }
  const name =
    textValue(resolved.name?.value) ||
    memberNameFromInferredUserName(resolved.inferredUserName?.value);
  const userId = idValue(user?._id);
  const facultyMemberId = idValue(user?.facultyMemberId);
  const profileUrl = textValue(resolved.profileUrl?.value);
  const identityKey =
    textValue(resolved.identityKey?.value) ||
    (profileUrl ? `official-profile:${profileUrl.toLowerCase()}` : '');
  const membershipKey =
    textValue(resolved.membershipKey?.value) || (identityKey ? `${identityKey}|${role}` : '');
  if ((!name && !userId && !facultyMemberId) || (!userId && !facultyMemberId && !identityKey)) {
    return null;
  }

  const roleSource = resolved.role;
  const observedAt = roleSource?.observedAt || new Date();
  const confidence = typeof roleSource?.confidence === 'number' ? roleSource.confidence : 0.5;
  const sourceUrl = textValue(roleSource?.sourceUrl);
  const sourceName = textValue(roleSource?.sourceName);
  const title = textValue(resolved.title?.value);

  const identityFilter: Record<string, unknown> = userId
    ? { userId }
    : facultyMemberId
      ? { facultyMemberId }
      : { membershipKey };
  const filter = {
    researchEntityId,
    role,
    isCurrentMember: true,
    ...identityFilter,
  };
  const set: Record<string, unknown> = {
    researchEntityId,
    researchGroupId: researchEntityId,
    role,
    isCurrentMember: true,
    sourceUrl,
    sourceName,
    confidence,
    lastObservedAt: observedAt,
    'confidenceByField.role': confidence,
    'fieldProvenance.role': {
      sourceName,
      sourceUrl,
      observedAt,
      confidence,
    },
  };
  if (name) set.name = name;
  if (userId) set.userId = userId;
  if (facultyMemberId) set.facultyMemberId = facultyMemberId;
  if (identityKey) set.identityKey = identityKey;
  if (membershipKey) set.membershipKey = membershipKey;
  if (textValue(resolved.evidenceStatus?.value)) {
    set.evidenceStatus = textValue(resolved.evidenceStatus?.value);
  }
  if (textValue(resolved.sectionLabel?.value)) {
    set.sectionLabel = textValue(resolved.sectionLabel?.value);
  }
  if (resolved.sourcePublishedAt?.value) {
    set.sourcePublishedAt = resolved.sourcePublishedAt.value;
  }
  if (resolved.freshnessExpiresAt?.value) {
    set.freshnessExpiresAt = resolved.freshnessExpiresAt.value;
  }
  if (title) {
    set.title = title;
    set['confidenceByField.title'] = resolved.title?.confidence ?? confidence;
  }
  if (profileUrl) {
    set.profileUrl = profileUrl;
    set['fieldProvenance.profileUrl'] = {
      sourceName: textValue(resolved.profileUrl?.sourceName) || sourceName,
      sourceUrl: profileUrl,
      observedAt: resolved.profileUrl?.observedAt || observedAt,
      confidence: resolved.profileUrl?.confidence ?? confidence,
    };
  }

  return {
    filter,
    update: {
      $set: set,
      $setOnInsert: {
        startedAt: observedAt,
      },
    },
    fieldsWritten: Object.keys(resolved).length,
    conflicts: Object.values(resolved).filter((field) => field.hasConflict).length,
    resolved,
  };
}

async function materializeResearchGroupMember(
  identifier: { entityId?: string; entityKey?: string },
  observations: any[],
  options: MaterializeOptions,
): Promise<MaterializeResult> {
  const resolverObs: ResolverObservation[] = observations.map((o: any) => ({
    field: o.field,
    value: o.value,
    sourceName: o.sourceName,
    confidence: o.confidence,
    observedAt: o.observedAt,
  }));
  const resolved = withResolvedFieldProvenance(resolveAllFields(resolverObs), observations);
  const researchGroupKey = textValue(resolved.researchGroupKey?.value);
  if (!researchGroupKey) {
    return {
      entityType: 'researchGroupMember',
      ...identifier,
      fieldsWritten: 0,
      conflicts: 0,
      created: false,
      resolved,
      skipped: 'missing-research-group-key',
    };
  }

  const entity: any = await ResearchEntity.findOne({
    slug: researchGroupKey,
    archived: { $ne: true },
  })
    .select('_id')
    .lean();
  if (!entity?._id) {
    return {
      entityType: 'researchGroupMember',
      ...identifier,
      fieldsWritten: 0,
      conflicts: 0,
      created: false,
      resolved,
      skipped: 'missing-research-entity',
    };
  }

  const researchEntityId = normalizeMaterializerObjectId(entity._id) || '';
  const user = await findUniqueUserForResearchGroupMember(resolved);
  const patch = buildResearchGroupMemberUpsert(researchEntityId, resolved, user);
  if (!patch) {
    return {
      entityType: 'researchGroupMember',
      entityId: materializerDocumentId(entity._id),
      entityKey: identifier.entityKey,
      fieldsWritten: 0,
      conflicts: 0,
      created: false,
      resolved,
      skipped: 'missing-required-fields',
    };
  }

  if (options.dryRun) {
    return {
      entityType: 'researchGroupMember',
      entityId: materializerDocumentId(entity._id),
      entityKey: identifier.entityKey,
      fieldsWritten: patch.fieldsWritten,
      conflicts: patch.conflicts,
      created: false,
      resolved,
    };
  }

  // Don't add a non-lead roster row for someone who is already a lead (PI /
  // director / co-director) of this entity. The director extractor promotes a
  // roster member to `director` and removes the stale roster row; without this
  // guard the next roster materialization would re-create the duplicate
  // (the detail-page dedup keys on user+role, so the person would render twice).
  const resolvedRole = String(patch.filter.role || '');
  if (!LEAD_MEMBER_ROLES.has(resolvedRole)) {
    const identity = patch.filter.userId
      ? { userId: patch.filter.userId }
      : patch.filter.facultyMemberId
        ? { facultyMemberId: patch.filter.facultyMemberId }
        : patch.filter.name
          ? { name: patch.filter.name }
          : null;
    if (identity) {
      const existingLead = await ResearchGroupMember.findOne({
        researchEntityId: patch.filter.researchEntityId,
        role: { $in: Array.from(LEAD_MEMBER_ROLES) },
        isCurrentMember: { $ne: false },
        ...identity,
      })
        .select('_id')
        .lean();
      if (existingLead) {
        return {
          entityType: 'researchGroupMember',
          entityId: materializerDocumentId(entity._id),
          entityKey: identifier.entityKey,
          fieldsWritten: 0,
          conflicts: 0,
          created: false,
          resolved,
          skipped: 'already-lead-member',
        };
      }
    }
  }

  const existing = await ResearchGroupMember.findOne(patch.filter).select('_id').lean();
  await ResearchGroupMember.updateOne(patch.filter, patch.update, { upsert: true });
  return {
    entityType: 'researchGroupMember',
    entityId: materializerDocumentId(entity._id),
    entityKey: identifier.entityKey,
    fieldsWritten: patch.fieldsWritten,
    conflicts: patch.conflicts,
    created: !existing,
    resolved,
  };
}

function withResolvedFieldProvenance(
  resolved: Record<string, ResolvedField>,
  observations: MaterializerObservationLike[],
): Record<string, ProvenanceResolvedField> {
  const output: Record<string, ProvenanceResolvedField> = {};
  for (const [field, value] of Object.entries(resolved)) {
    const source =
      observations.find(
        (observation) => observation.field === field && observation.value === value.value,
      ) || observations.find((observation) => observation.field === field);
    output[field] = {
      ...value,
      ...(source?.sourceName ? { sourceName: source.sourceName } : {}),
      ...(source?.sourceUrl ? { sourceUrl: source.sourceUrl } : {}),
      ...(source?.observedAt ? { observedAt: source.observedAt } : {}),
    };
  }
  return output;
}

async function materializeInferredPiMembership(
  researchEntityId: string,
  observations: MaterializerObservationLike[],
): Promise<void> {
  const piObservations = observations.filter((obs) => obs.field === 'inferredPiUserId');
  for (const observation of piObservations) {
    const patch = buildInferredPiMemberUpsert(researchEntityId, observation);
    if (!patch) continue;
    await ResearchGroupMember.updateOne(patch.filter, patch.update, { upsert: true });
  }

  const piKeyObservations = observations.filter((obs) => obs.field === 'inferredPiUserKey');
  const inferredPiDepartments = departmentValuesForInferredPiLookup(observations);
  for (const observation of piKeyObservations) {
    const filters = userLookupFiltersForInferredPiUserKey(observation.value, inferredPiDepartments);
    if (filters.length === 0) continue;
    const users = await User.find(filters.length === 1 ? filters[0] : { $or: filters })
      .select('_id')
      .limit(2)
      .lean();
    if (users.length !== 1) continue;
    const user = users[0];
    if (!user?._id) continue;
    const patch = buildInferredPiMemberUpsert(researchEntityId, {
      ...observation,
      value: materializerDocumentId(user._id),
    });
    if (!patch) continue;
    await ResearchGroupMember.updateOne(patch.filter, patch.update, { upsert: true });
  }
}

export interface InferredDirectorMaterializationResult {
  written: boolean;
  promoted: boolean;
  removedDuplicates: number;
  userId?: string;
  role?: string;
  skipped?: 'no-observation' | 'unresolved-user';
}

/**
 * Promote a center's named director to a `director` member.
 *
 * Reads the entity-level `inferredDirector*` observations emitted by
 * `center-director-llm`, resolves the name (+ profile URL) to a UNIQUE Yale
 * User, and upserts a lead member row. Resolution is required: an unresolved or
 * ambiguous name is skipped, never written, so a hallucinated leadership name
 * cannot mint a lead. Any pre-existing non-lead roster row for the same person
 * in this entity is removed so they surface once as the lead (the detail-page
 * dedup keys on user+role). Idempotent: re-running converges on a single
 * `director` row.
 */
export async function materializeInferredDirectorMembership(
  researchEntityId: string,
  observations: MaterializerObservationLike[],
): Promise<InferredDirectorMaterializationResult> {
  const empty: InferredDirectorMaterializationResult = {
    written: false,
    promoted: false,
    removedDuplicates: 0,
  };
  if (!normalizeMaterializerObjectId(researchEntityId)) return empty;

  const fieldObs = (field: string) => observations.find((obs) => obs.field === field);
  const nameObs = fieldObs('inferredDirectorUserName');
  if (!nameObs || !nameObs.value) return { ...empty, skipped: 'no-observation' };

  const profileUrl = textValue(fieldObs('inferredDirectorProfileUrl')?.value);
  const title = textValue(fieldObs('inferredDirectorTitle')?.value);
  const roleRaw = textValue(fieldObs('inferredDirectorRole')?.value).toLowerCase();
  const role = roleRaw === 'co-director' ? 'co-director' : 'director';
  const name =
    textValue(fieldObs('inferredDirectorName')?.value) ||
    memberNameFromInferredUserName(nameObs.value);

  const lookupFields: Record<string, ResolvedField> = {
    inferredUserName: {
      value: nameObs.value,
      confidence: 1,
      contributingSources: [],
      hasConflict: false,
    },
  };
  if (profileUrl) {
    lookupFields.profileUrl = {
      value: profileUrl,
      confidence: 1,
      contributingSources: [],
      hasConflict: false,
    };
  }
  const user = await findUniqueUserForResearchGroupMember(lookupFields);
  if (!user?._id) return { ...empty, skipped: 'unresolved-user' };

  const userId = idValue(user._id);
  const facultyMemberId = idValue(user.facultyMemberId);
  const roleSource = fieldObs('inferredDirectorRole') || nameObs;
  const observedAt = roleSource.observedAt || new Date();
  const confidence = typeof roleSource.confidence === 'number' ? roleSource.confidence : 0.85;
  const sourceUrl = textValue(roleSource.sourceUrl);
  const sourceName = textValue(roleSource.sourceName);

  const set: Record<string, unknown> = {
    researchEntityId,
    researchGroupId: researchEntityId,
    userId,
    role,
    isCurrentMember: true,
    sourceUrl: profileUrl || sourceUrl,
    confidence,
    lastObservedAt: observedAt,
    'confidenceByField.role': confidence,
    'fieldProvenance.role': { sourceName, sourceUrl, observedAt, confidence },
  };
  if (name) set.name = name;
  if (facultyMemberId) set.facultyMemberId = facultyMemberId;
  if (title) {
    set.title = title;
    set['confidenceByField.title'] = confidence;
  }

  const existing = await ResearchGroupMember.findOne({
    researchEntityId,
    userId,
    role,
    isCurrentMember: true,
  })
    .select('_id')
    .lean();
  await ResearchGroupMember.updateOne(
    { researchEntityId, userId, role, isCurrentMember: true },
    { $set: set, $setOnInsert: { startedAt: observedAt } },
    { upsert: true },
  );

  const removal = await ResearchGroupMember.deleteMany({
    researchEntityId,
    userId,
    role: { $in: SUPERSEDED_BY_DIRECTOR_ROLES },
  });

  return {
    written: true,
    promoted: Boolean(existing) || (removal.deletedCount || 0) > 0,
    removedDuplicates: removal.deletedCount || 0,
    userId,
    role,
  };
}

export function userLookupValueForInferredPiUserKey(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return '';
  return uniqueKeyValueForIdentifier('user', raw, []) || '';
}

function isLikelyYaleEmailLocalPart(value: string): boolean {
  return value.includes('.') && /^[a-z0-9._-]+$/i.test(value);
}

const textValue = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

const idValue = (value: unknown): string => {
  return serializedDocumentId(value) || '';
};

// ---------------------------------------------------------------------------
// ResearchEntity relationship materialization (umbrella center → faculty).
//
// Restored from the new-foundation producer (commit 8e5cc0a) that was dropped
// during the hallmark merge. The centers/institutes scraper emits
// `researchEntityRelationship` observations (sourceEntityKey/targetEntityKey/
// relationshipType). This resolves the `faculty-research-area-*` target key to
// an existing PI-led ResearchEntity (or mints a profile-backed faculty-research-
// area member); otherwise the relationship is skipped. It never fabricates a
// standalone lab shell or an undergraduate-access claim.
// ---------------------------------------------------------------------------

interface ResolvedRelationshipMaterializationDeps {
  researchEntityModel?: Pick<typeof ResearchEntity, 'findOne' | 'find' | 'findById'>;
  relationshipModel?: Pick<typeof ResearchEntityRelationship, 'updateOne' | 'updateMany'>;
  researchGroupMemberModel?: Pick<typeof ResearchGroupMember, 'findOne' | 'create' | 'updateOne'>;
}

interface ProfileBackedFacultyResearchAreaMemberDeps {
  userModel?: Pick<typeof User, 'findById'>;
  researchGroupMemberModel?: Pick<typeof ResearchGroupMember, 'findOne' | 'create' | 'updateOne'>;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function compactPersonName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function normalizeResearchEntityName(value: unknown): string {
  return textValue(value).toLowerCase().replace(/\s+/g, ' ').trim();
}

function personNameFromFacultyResearchArea(value: unknown): string {
  const text = textValue(value)
    .replace(/^faculty-research-area-/i, '')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.replace(/\s+research$/i, '').trim();
}

function isFacultyResearchAreaKey(value: unknown): boolean {
  return textValue(value).toLowerCase().startsWith('faculty-research-area-');
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
      `${textValue(user.fname)} ${textValue(user.lname)}`,
    );
    return candidateFullName === expectedFullName;
  });
  return matches.length === 1 && matches[0]?._id ? matches[0] : null;
}

async function findUniqueUserIdByPersonName(personName: string): Promise<string | null> {
  const user = await findUniqueUserByPersonName(personName);
  return user?._id ? materializerDocumentId(user._id) || null : null;
}

export async function findExistingResearchEntityByFacultyResearchAreaIdentity(
  Model: mongoose.Model<any>,
  identity: { entityKey?: string; name?: unknown; entityType?: unknown },
): Promise<any | null> {
  const observedEntityType = textValue(identity.entityType);
  const observedKey = textValue(identity.entityKey);
  const isFacultyResearchArea =
    observedEntityType === 'FACULTY_RESEARCH_AREA' || isFacultyResearchAreaKey(observedKey);
  if (!isFacultyResearchArea) return null;

  const personName =
    personNameFromFacultyResearchArea(identity.name) ||
    personNameFromFacultyResearchArea(observedKey);
  if (!personName) return null;

  const userId = await findUniqueUserIdByPersonName(personName);
  const userObjectId = toMaterializerObjectId(userId);
  if (!userObjectId) return null;

  const memberships = await ResearchGroupMember.find({
    userId: userObjectId,
    role: 'pi',
    isCurrentMember: { $ne: false },
    researchEntityId: { $exists: true, $ne: null },
  })
    .select('researchEntityId')
    .lean();
  const candidateIds = Array.from(
    new Set(
      memberships
        .map((member: any) => normalizeMaterializerObjectId(member.researchEntityId))
        .filter(Boolean),
    ),
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
    (candidate: any) => !textValue(candidate.slug).startsWith('faculty-research-area-'),
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
  const observedEntityType = textValue(identity.entityType);
  const observedKey = textValue(identity.entityKey);
  const isFacultyResearchArea =
    observedEntityType === 'FACULTY_RESEARCH_AREA' || isFacultyResearchAreaKey(observedKey);
  if (!isFacultyResearchArea) {
    return { synced: false, created: false, skipped: 'not-faculty-research-area' };
  }

  const userModel = deps.userModel || User;
  const personName =
    personNameFromFacultyResearchArea(identity.name) ||
    personNameFromFacultyResearchArea(observedKey);
  const identityUserId = normalizeMaterializerObjectId(identity.userId);
  let user = identityUserId
    ? await userModel.findById(identityUserId).select('_id fname lname').lean()
    : null;
  if (!user) {
    user = personName ? await findUniqueUserByPersonName(personName) : null;
  }
  if (!user?._id) return { synced: false, created: false, skipped: 'user-not-resolved' };

  const memberModel = deps.researchGroupMemberModel || ResearchGroupMember;
  const userId = normalizeMaterializerObjectId(user._id) || '';
  if (!userId) return { synced: false, created: false, skipped: 'user-not-resolved' };
  const memberLookup = { researchEntityId, userId, role: 'pi' };
  const existing =
    (await memberModel.findOne({ ...memberLookup, isCurrentMember: { $ne: false } }).lean()) ||
    (await memberModel.findOne(memberLookup).lean());
  const set = {
    researchEntityId,
    userId,
    name: `${textValue(user.fname)} ${textValue(user.lname)}`.trim() || personName,
    role: 'pi',
    isCurrentMember: true,
    sourceUrl: textValue(identity.sourceUrl),
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

function latestObservationDate(observations: Array<{ observedAt?: Date }>): Date {
  const timestamps = observations
    .map((observation) => new Date(observation.observedAt || 0).getTime())
    .filter((time) => Number.isFinite(time));
  if (timestamps.length === 0) return new Date();
  return new Date(Math.max(...timestamps));
}

async function materializeResearchEntityRelationship(
  identifier: { entityId?: string; entityKey?: string },
  observations: any[],
  options: MaterializeOptions,
  deps: ResolvedRelationshipMaterializationDeps = {},
): Promise<MaterializeResult> {
  const resolverObs: ResolverObservation[] = observations.map((o: any) => ({
    field: o.field,
    value: o.value,
    sourceName: o.sourceName,
    confidence: o.confidence,
    observedAt: o.observedAt,
  }));
  const resolved = withResolvedFieldProvenance(resolveAllFields(resolverObs), observations);

  const skip = (skipped: string): MaterializeResult => ({
    entityType: 'researchEntityRelationship',
    ...identifier,
    fieldsWritten: 0,
    conflicts: 0,
    created: false,
    resolved,
    skipped,
  });

  const sourceEntityKey = textValue(resolved.sourceEntityKey?.value);
  const targetEntityKey = textValue(resolved.targetEntityKey?.value);
  const relationshipType = textValue(resolved.relationshipType?.value);
  if (!sourceEntityKey || !targetEntityKey || !relationshipType) {
    return skip('missing-keys');
  }

  const researchEntityModel = deps.researchEntityModel || ResearchEntity;
  const relationshipModel = deps.relationshipModel || ResearchEntityRelationship;

  const source = (await researchEntityModel
    .findOne({ slug: sourceEntityKey, archived: { $ne: true } }, { _id: 1 })
    .lean()) as { _id?: unknown } | null;
  if (!source?._id) return skip('source-not-resolved');

  const canonicalFacultyResearchAreaTarget =
    (await findExistingResearchEntityByFacultyResearchAreaIdentity(researchEntityModel as any, {
      entityKey: targetEntityKey,
      entityType: 'FACULTY_RESEARCH_AREA',
    })) as { _id?: unknown } | null;
  const target = (await researchEntityModel
    .findOne({ slug: targetEntityKey, archived: { $ne: true } }, { _id: 1, name: 1, slug: 1 })
    .lean()) as { _id?: unknown; name?: unknown; slug?: string } | null;
  const resolvedTarget = canonicalFacultyResearchAreaTarget || target;
  if (!resolvedTarget?._id) return skip('target-not-resolved');

  if (options.dryRun) {
    return {
      entityType: 'researchEntityRelationship',
      entityId: materializerDocumentId(source._id),
      entityKey: identifier.entityKey,
      fieldsWritten: 0,
      conflicts: 0,
      created: false,
      resolved,
    };
  }

  if (!canonicalFacultyResearchAreaTarget && target?._id) {
    await syncProfileBackedFacultyResearchAreaMemberFromIdentity(
      normalizeMaterializerObjectId(target._id) || '',
      {
        entityKey: targetEntityKey,
        name: target.name,
        entityType: 'FACULTY_RESEARCH_AREA',
        sourceUrl: textValue(resolved.sourceUrl?.value),
        confidence: Math.max(0, ...observations.map((o) => Number(o.confidence) || 0)),
      },
    );
  }

  const sourceResearchEntityId = normalizeMaterializerObjectId(source._id) || '';
  const targetResearchEntityId = normalizeMaterializerObjectId(resolvedTarget._id) || '';
  if (!sourceResearchEntityId || !targetResearchEntityId) return skip('target-not-resolved');
  // Prefer linking the center to the member's existing PI-led lab (a rich page)
  // over a thin faculty-research-area stub: a resolved target whose slug is not a
  // generated `faculty-research-area-*` is a real research home → AFFILIATED_LAB.
  const resolvedRelationshipType = centerRelationshipTypeForResolvedTarget(
    textValue((resolvedTarget as { slug?: unknown }).slug),
    relationshipType,
  );
  const label = relationshipLabelForType(resolvedRelationshipType);
  const evidenceStrength = textValue(resolved.evidenceStrength?.value) || 'MODERATE';
  const evidenceQuote = textValue(resolved.evidenceQuote?.value);
  const sourceUrl = textValue(resolved.sourceUrl?.value);
  const confidence = Math.max(0, ...observations.map((o) => Number(o.confidence) || 0));
  const observedAt = latestObservationDate(observations);

  const update: Record<string, unknown> = {
    sourceResearchEntityId,
    targetResearchEntityId,
    relationshipType: resolvedRelationshipType,
    label,
    evidenceStrength,
    sourceUrl,
    confidence: confidence || 0.7,
    archived: false,
    lastObservedAt: observedAt,
  };
  if (evidenceQuote) update.evidenceQuote = evidenceQuote;

  const result: any = await relationshipModel.updateOne(
    { sourceResearchEntityId, targetResearchEntityId, relationshipType: resolvedRelationshipType },
    { $set: update },
    { upsert: true },
  );

  // The upsert key includes relationshipType, so a center→target edge that was
  // previously a different type (e.g. MEMBER_RESEARCH_AREA before a lab resolved)
  // would survive as a stale duplicate. Archive any sibling with the same
  // (source, target) but a different type so the page shows exactly one edge.
  if (relationshipModel.updateMany) {
    await relationshipModel.updateMany(
      {
        sourceResearchEntityId,
        targetResearchEntityId,
        relationshipType: { $ne: resolvedRelationshipType },
        archived: { $ne: true },
      },
      { $set: { archived: true } },
    );
  }

  return {
    entityType: 'researchEntityRelationship',
    entityId: sourceResearchEntityId,
    entityKey: identifier.entityKey,
    fieldsWritten: observations.length,
    conflicts: 0,
    created: Boolean(result?.upsertedCount),
    resolved,
  };
}

const RESEARCH_ENTITY_RELATIONSHIP_LABELS: Record<string, string> = {
  AFFILIATED_LAB: 'Affiliated lab',
  AFFILIATED_RESEARCH_GROUP: 'Related research group',
  MEMBER_RESEARCH_AREA: 'Member',
  HOSTED_PROGRAM: 'Hosted program',
};

export function relationshipLabelForType(relationshipType: string): string {
  return RESEARCH_ENTITY_RELATIONSHIP_LABELS[relationshipType] || 'Related research home';
}

/**
 * Pick the relationship type for a center→target edge. A resolved target whose
 * slug is a generated `faculty-research-area-*` stub stays MEMBER_RESEARCH_AREA;
 * anything else is a real research home (the member's PI-led lab) → AFFILIATED_LAB.
 */
export function centerRelationshipTypeForResolvedTarget(
  resolvedTargetSlug: string,
  fallbackType: string,
): string {
  const slug = (resolvedTargetSlug || '').trim();
  return slug && !slug.startsWith('faculty-research-area-') ? 'AFFILIATED_LAB' : fallbackType;
}

const uniqueStrings = (values: unknown[]): string[] =>
  Array.from(new Set(values.map(textValue).filter(Boolean)));

const DEPT_USER_KEY_PATTERN = /^dept:[^:]+:(.+)$/i;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function nameRegexFromSlugParts(parts: string[]): RegExp | null {
  const normalized = parts.map((part) => part.trim()).filter(Boolean);
  if (normalized.length === 0) return null;
  return new RegExp(`^${normalized.map(escapeRegex).join('[\\s-]+')}$`, 'i');
}

function deptUserNameFilters(
  value: unknown,
  departments: string[],
): Array<Record<string, unknown>> {
  const raw = typeof value === 'string' ? value.trim() : '';
  const match = raw.match(DEPT_USER_KEY_PATTERN);
  if (!match || departments.length === 0) return [];

  const parts = match[1]
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter(Boolean);
  if (parts.length < 2) return [];

  const firstName = nameRegexFromSlugParts([parts[0]]);
  const lastName = nameRegexFromSlugParts(parts.slice(1));
  if (!firstName || !lastName) return [];

  return departments.flatMap((department) => [
    { fname: firstName, lname: lastName, departments: department },
    { fname: firstName, lname: lastName, primaryDepartment: department },
  ]);
}

function departmentValuesForInferredPiLookup(
  observations: MaterializerObservationLike[],
): string[] {
  return uniqueStrings(
    observations.flatMap((observation) => {
      if (observation.field !== 'departments' && observation.field !== 'primaryDepartment') {
        return [];
      }
      return Array.isArray(observation.value) ? observation.value : [observation.value];
    }),
  );
}

export function userLookupFiltersForInferredPiUserKey(
  value: unknown,
  departments: string[] = [],
): Array<Record<string, unknown>> {
  const lookupValue = userLookupValueForInferredPiUserKey(value);
  if (!lookupValue) return [];

  const filters: Array<Record<string, unknown>> = [{ netid: lookupValue }];
  if (/^[a-z0-9._-]+@yale\.edu$/i.test(lookupValue)) {
    filters.push({ email: lookupValue.toLowerCase() });
  } else if (isLikelyYaleEmailLocalPart(lookupValue)) {
    filters.push({ email: `${lookupValue.toLowerCase()}@yale.edu` });
  }
  return [...filters, ...deptUserNameFilters(value, departments)];
}

function normalizeIdentityText(value: unknown): string {
  return textValue(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function identityTokens(value: unknown): string[] {
  return normalizeIdentityText(value)
    .replace(/&/g, ' and ')
    .split(/[^a-z0-9]+/i)
    .filter(Boolean);
}

function observationValueForField(
  observations: MaterializerObservationLike[],
  field: string,
): unknown {
  return observations.find((obs) => obs.field === field)?.value;
}

function observedUserDepartmentLabels(observations: MaterializerObservationLike[]): string[] {
  return uniqueStrings(
    observations.flatMap((observation) => {
      if (observation.field !== 'departments' && observation.field !== 'primaryDepartment') {
        return [];
      }
      return Array.isArray(observation.value) ? observation.value : [observation.value];
    }),
  );
}

const DEPARTMENT_IDENTITY_STOPWORDS = new Set([
  'and',
  'the',
  'department',
  'departments',
  'program',
  'programs',
  'school',
  'faculty',
  'arts',
  'sciences',
  'science',
  'studies',
  'yale',
]);

function departmentIdentityTokens(labels: string[]): string[] {
  return Array.from(
    new Set(
      labels
        .flatMap(identityTokens)
        .filter((token) => token.length >= 4 && !DEPARTMENT_IDENTITY_STOPWORDS.has(token)),
    ),
  );
}

function officialUserProfileUrlsFromObservations(
  observations: MaterializerObservationLike[],
): string[] {
  return uniqueStrings(
    observations.flatMap((observation) => {
      const urls: unknown[] = [];
      if (observation.field === 'profileUrls') {
        if (typeof observation.value === 'string') urls.push(observation.value);
        else if (observation.value && typeof observation.value === 'object') {
          urls.push(...Object.values(observation.value));
        }
      }
      if (observation.field === 'profileUrl') urls.push(observation.value);
      return urls;
    }),
  ).filter((url) => {
    try {
      const parsed = new URL(url);
      return (
        parsed.hostname.toLowerCase().endsWith('yale.edu') &&
        /\/(?:people|profile)\//i.test(parsed.pathname)
      );
    } catch {
      return false;
    }
  });
}

function observedUserNameParts(observations: MaterializerObservationLike[]): {
  firstInitial: string;
  lastToken: string;
} | null {
  const firstTokens = identityTokens(observationValueForField(observations, 'fname'));
  const lastTokens = identityTokens(observationValueForField(observations, 'lname'));
  const fullNameTokens = identityTokens(
    uniqueStrings([
      observationValueForField(observations, 'displayName'),
      observationValueForField(observations, 'name'),
    ]).join(' '),
  );
  const firstInitial = firstTokens[0]?.charAt(0) || fullNameTokens[0]?.charAt(0) || '';
  const lastToken = lastTokens.at(-1) || fullNameTokens.at(-1) || '';
  if (!firstInitial || lastToken.length < 3) return null;
  return { firstInitial, lastToken };
}

export function userLookupFiltersForOfficialProfileObservations(
  observations: MaterializerObservationLike[],
): Array<Record<string, unknown>> {
  if (officialUserProfileUrlsFromObservations(observations).length === 0) return [];
  const nameParts = observedUserNameParts(observations);
  if (!nameParts) return [];
  const departmentTokens = departmentIdentityTokens(observedUserDepartmentLabels(observations));
  if (departmentTokens.length === 0) return [];

  const lastName = new RegExp(escapeRegex(nameParts.lastToken), 'i');
  const departmentRegexes = departmentTokens.map((token) => new RegExp(escapeRegex(token), 'i'));
  return departmentRegexes.flatMap((department) => [
    { lname: lastName, departments: department },
    { lname: lastName, primaryDepartment: department },
    { name: lastName, departments: department },
    { name: lastName, primaryDepartment: department },
    { displayName: lastName, departments: department },
    { displayName: lastName, primaryDepartment: department },
  ]);
}

export function officialProfileObservationMatchesUser(
  observations: MaterializerObservationLike[],
  user: Record<string, unknown>,
): boolean {
  if (officialUserProfileUrlsFromObservations(observations).length === 0) return false;
  const nameParts = observedUserNameParts(observations);
  if (!nameParts) return false;
  const departmentTokens = departmentIdentityTokens(observedUserDepartmentLabels(observations));
  if (departmentTokens.length === 0) return false;

  const userNameTokens = identityTokens(
    uniqueStrings([
      user.fname,
      user.firstName,
      user.lname,
      user.lastName,
      user.name,
      user.displayName,
    ]).join(' '),
  );
  if (!userNameTokens.includes(nameParts.lastToken)) return false;
  if (!userNameTokens.some((token) => token.charAt(0) === nameParts.firstInitial)) return false;

  const userDepartmentText = normalizeIdentityText(
    uniqueStrings([
      user.primaryDepartment,
      ...(Array.isArray(user.departments) ? user.departments : [user.departments]),
    ]).join(' '),
  );
  return departmentTokens.some((token) => userDepartmentText.includes(token));
}

export function selectOfficialProfileObservationUserMatch(
  observations: MaterializerObservationLike[],
  candidates: Array<Record<string, unknown>>,
  observedKeyValue = '',
): Record<string, unknown> | null {
  const verified = candidates.filter((candidate) =>
    officialProfileObservationMatchesUser(observations, candidate),
  );
  if (verified.length <= 1) return verified[0] || null;

  const observedLocalPart = isLikelyYaleEmailLocalPart(observedKeyValue)
    ? observedKeyValue.toLowerCase()
    : '';
  if (observedLocalPart) {
    const canonicalMatches = verified.filter(
      (candidate) => textValue(candidate.netid).toLowerCase() !== observedLocalPart,
    );
    if (canonicalMatches.length === 1) return canonicalMatches[0];
  }

  return null;
}

async function findUserDocByOfficialProfileObservations(
  Model: mongoose.Model<any>,
  observations: MaterializerObservationLike[],
  observedKeyValue = '',
): Promise<any | null> {
  const profileFallbackFilters = userLookupFiltersForOfficialProfileObservations(observations);
  if (profileFallbackFilters.length === 0) return null;
  const candidates = await Model.find({ $or: profileFallbackFilters }).limit(5).lean();
  return selectOfficialProfileObservationUserMatch(observations, candidates, observedKeyValue);
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
  return toMaterializerObjectId(scrapeRunId) || scrapeRunId;
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
      if (id instanceof mongoose.Types.ObjectId) return true;
      return Boolean(normalizeMaterializerObjectId(id));
    })
    .map((id) => toMaterializerObjectId(id))
    .filter((id): id is mongoose.Types.ObjectId => Boolean(id));

  if (listingIds.length === 0) return 0;

  return postedOpportunityModel.countDocuments({
    listingId: { $in: listingIds },
  });
}

function entityModelFor(entityType: ObservedEntityType): mongoose.Model<any> | null {
  switch (entityType) {
    case 'paper':
      return Paper;
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
    .toLowerCase();
  return normalized || null;
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
  const entityId = normalizeMaterializerObjectId(identifier.entityId);
  if (entityId) {
    return Model.findById(entityId).lean();
  }

  if (!identifier.entityKey) return null;

  const keyField = uniqueKeyFieldForIdentifier(entityType, identifier.entityKey);
  if (!keyField) throw new Error(`No keyField for entityType=${entityType}`);

  const keyValue = uniqueKeyValueForIdentifier(entityType, identifier.entityKey, obs);
  if (!keyValue) return null;

  if (entityType === 'user') {
    const byOfficialProfile = await findUserDocByOfficialProfileObservations(Model, obs, keyValue);
    if (byOfficialProfile) return byOfficialProfile;
  }

  const exact = await Model.findOne({ [keyField]: keyValue }).lean();
  if (exact) return exact;

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
  const evidenceRows = Array.from(groups.entries()).flatMap(([entityKey, obs]) =>
    authorshipEvidenceFromPaperObservations(obs).map((evidence) => ({
      entityKey,
      observations: obs,
      evidence,
    })),
  );
  if (evidenceRows.length === 0) return 0;

  const { openAlexKeys, arxivKeys, doiKeys, doiValues } = paperIdentityBuckets(groups);
  const normalizedDoiKeys = doiKeys
    .map((key) => normalizeDoiForMaterialization(key.replace(/^doi:/i, '')))
    .filter((value): value is string => !!value);
  const existingPapers = await Paper.find({
    $or: [
      ...(openAlexKeys.length > 0 ? [{ openAlexId: { $in: openAlexKeys } }] : []),
      ...(arxivKeys.length > 0 ? [{ arxivId: { $in: arxivKeys } }] : []),
      ...(normalizedDoiKeys.length > 0 ? [{ doi: { $in: normalizedDoiKeys } }] : []),
      ...(doiValues.length > 0 ? [{ doi: { $in: doiValues } }] : []),
    ],
  })
    .select('_id openAlexId arxivId doi')
    .lean();
  const maps = mapExistingPapers(existingPapers as any[]);
  const ops: any[] = [];

  for (const { entityKey, observations, evidence } of evidenceRows) {
    const paper = findPaperForObservationGroup(entityKey, observations, maps);
    if (!paper?._id || !evidence.userId) continue;
    const userObjectId = toMaterializerObjectId(evidence.userId);
    if (!userObjectId) continue;

    const observedAt =
      evidence.observedAt instanceof Date
        ? evidence.observedAt
        : evidence.observedAt
          ? new Date(evidence.observedAt)
          : new Date();
    const provenance = {
      sourceName: evidence.sourceName,
      sourceUrl: evidence.sourceUrl || '',
      observedAt: Number.isNaN(observedAt.getTime()) ? new Date() : observedAt,
      confidence: evidence.confidence,
    };

    ops.push({
      updateOne: {
        filter: {
          paperId: paper._id,
          userId: userObjectId,
        },
        update: {
          $set: {
            paperId: paper._id,
            userId: userObjectId,
            displayName: evidence.displayName,
            externalAuthorIds: {
              ...(evidence.externalAuthorIds || {}),
              authorshipSource: evidence.sourceName,
              authorshipMethod: evidence.method,
            },
            confidence: evidence.confidence ?? 0.9,
            fieldProvenance: {
              authorship: provenance,
            },
            lastObservedAt: provenance.observedAt,
          },
        },
        upsert: true,
      },
    });
  }

  if (ops.length === 0) return 0;
  const result = await PaperAuthor.bulkWrite(ops, { ordered: false });
  return result.upsertedCount + result.modifiedCount;
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
    if (MATERIALIZER_MANAGED_FIELDS.has(field)) continue;
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
  if (identifier.entityId) filter.entityId = identifier.entityId;
  else if (identifier.entityKey) filter.entityKey = identifier.entityKey;
  else throw new Error('materializeEntity requires entityId or entityKey');

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
    return materializeResearchGroupMember(identifier, obs, options);
  }

  if (entityType === 'researchEntityRelationship') {
    return materializeResearchEntityRelationship(identifier, obs, options);
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
  if (entityDoc) entityIdString = String(entityDoc._id);

  const manuallyLockedFields: string[] = (entityDoc && entityDoc.manuallyLockedFields) || [];
  const manualValues: Record<string, unknown> = {};
  for (const f of manuallyLockedFields) {
    if (entityDoc && entityDoc[f] !== undefined) manualValues[f] = entityDoc[f];
  }

  const materializationObs = obs.filter(
    (o: any) => !shouldIgnoreObservationForEntityMaterialization(entityType, o),
  );

  const resolverObs: ResolverObservation[] = materializationObs.map((o: any) => ({
    field: o.field,
    value: o.value,
    sourceName: o.sourceName,
    confidence: o.confidence,
    observedAt: o.observedAt,
  }));

  const resolved = resolveAllFields(resolverObs, {
    manuallyLockedFields,
    manualValues,
  });

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
    const nextValue =
      entityType === 'paper' && PAPER_SET_FIELDS.has(field)
        ? mergeUniqueArrayValues(entityDoc?.[field], r.value)
        : r.value;
    if (
      entityType === 'user' &&
      shouldPreserveExistingUserIdentityField(field, nextValue, entityDoc)
    ) {
      continue;
    }
    set[field] = materializedFieldValue(entityType, field, nextValue, entityDoc?.[field]);
    confidenceByField[field] = r.confidence;
    if (isResearchEntityObservationType(entityType)) {
      const provenance = fieldProvenanceForResolvedObservation(field, r, materializationObs);
      if (provenance) set[`fieldProvenance.${field}`] = provenance;
    }
    if (r.hasConflict) conflicts++;
    fieldsWritten++;
  }
  if (
    isResearchEntityObservationType(entityType) &&
    !manuallyLockedFields.includes('shortDescription') &&
    !set.shortDescription
  ) {
    const fullDescription = set.fullDescription || entityDoc?.fullDescription;
    const derivedShortDescription = deriveShortDescriptionFromFullDescription(fullDescription);
    if (derivedShortDescription) {
      set.shortDescription = derivedShortDescription;
      const fullDescriptionConfidence = resolved.fullDescription?.confidence;
      if (typeof fullDescriptionConfidence === 'number') {
        confidenceByField.shortDescription = fullDescriptionConfidence;
      }
      const provenance = resolved.fullDescription
        ? fieldProvenanceForResolvedObservation(
            'fullDescription',
            resolved.fullDescription,
            materializationObs,
          )
        : undefined;
      if (provenance) set['fieldProvenance.shortDescription'] = provenance;
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
    entityIdString = materializerDocumentId(created_._id);
    created = true;
  }

  if (entityType === 'user' && entityIdString) {
    await materializeOfficialProfileScholarlyLinks(entityIdString, obs);
  }

  const syncEntityType = entityType === 'researchGroup' ? 'researchEntity' : entityType;
  if (isSyncableEntityType(syncEntityType) && entityIdString) {
    const fresh = await Model.findById(entityIdString).lean();
    if (fresh) await syncEntity(syncEntityType, fresh);
  }

  let postMaterializationMetrics: ReportPostMaterializationMetrics | undefined;
  if (isResearchEntityObservationType(entityType) && entityIdString) {
    if (!options.dryRun) {
      await materializeInferredPiMembership(entityIdString, materializationObs);
      await materializeInferredDirectorMembership(entityIdString, materializationObs);
    }
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

    // Recompute the browse-ranking score now that access signals exist, and
    // re-sync the entity so the default /research ordering stays fresh.
    if (!options.dryRun) {
      try {
        await recomputeBrowseRankForEntities([entityIdString]);
      } catch (error) {
        console.error(
          'Failed to recompute browseRankScore:',
          sanitizeLogValue({ entityId: entityIdString, error }),
        );
      }
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
  const runObjectId = toMaterializerObjectId(scrapeRunId);
  if (!runObjectId) {
    return { materialized: 0, created: 0, updated: 0, conflicts: 0, skipped: 0, errors: 0 };
  }
  const observations = (await Observation.find({
    scrapeRunId: runObjectId,
    entityType: 'paper',
    superseded: false,
  })
    .select('entityKey field value sourceName confidence observedAt sourceUrl')
    .lean()) as Array<
    PaperMaterializationObservation & {
      entityKey?: string;
    }
  >;

  const groups = new Map<string, PaperMaterializationObservation[]>();
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
    return { materialized: 0, created: 0, updated: 0, conflicts: 0, skipped: 0, errors: 0 };
  }

  const { openAlexKeys, arxivKeys, doiKeys, doiValues } = paperIdentityBuckets(groups);
  const existingPapers = await Paper.find({
    $or: [
      ...(openAlexKeys.length > 0 ? [{ openAlexId: { $in: openAlexKeys } }] : []),
      ...(arxivKeys.length > 0 ? [{ arxivId: { $in: arxivKeys } }] : []),
      ...(doiKeys.length > 0
        ? [
            {
              doi: {
                $in: doiKeys
                  .map((key) => normalizeDoiForMaterialization(key.replace(/^doi:/i, '')))
                  .filter((value): value is string => !!value),
              },
            },
          ]
        : []),
      ...(doiValues.length > 0 ? [{ doi: { $in: doiValues } }] : []),
    ],
  })
    .select('_id openAlexId arxivId doi manuallyLockedFields')
    .lean();
  const existingMaps = mapExistingPapers(existingPapers as any[]);

  let materialized = 0;
  let created = 0;
  let updated = 0;
  let conflicts = 0;
  let skipped = 0;
  let errors = 0;
  const ops: any[] = [];

  for (const [entityKey, obs] of groups.entries()) {
    const existing = findPaperForObservationGroup(entityKey, obs, existingMaps);
    const patch = buildPaperUpdateFromObservations(entityKey, obs, existing);
    if (patch.skipped) {
      skipped++;
      continue;
    }
    materialized++;
    conflicts += patch.conflicts;
    if (existing) updated++;
    else created++;
    if (options.dryRun) continue;

    ops.push({
      updateOne: {
        filter: existing
          ? { _id: existing._id }
          : {
              [uniqueKeyFieldForIdentifier('paper', entityKey) || 'openAlexId']:
                uniqueKeyValueForIdentifier('paper', entityKey, obs) || entityKey,
            },
        update: patch.update,
        upsert: !existing,
      },
    });
  }

  if (!options.dryRun && ops.length > 0) {
    try {
      await Paper.bulkWrite(ops, { ordered: false });
      await materializePaperAuthorEvidenceFromGroups(groups);
    } catch (err) {
      errors += ops.length;
      console.error('materializePaperObservationsFromRun failed:', sanitizeLogValue(err));
    }
  }

  return { materialized, created, updated, conflicts, skipped, errors };
}

const OFFICIAL_ROSTER_SOURCE_NAME = 'official-research-home-roster';

export interface OfficialRosterSnapshotForReconciliation {
  complete?: boolean;
  memberKeys?: unknown;
  observedAt?: unknown;
}

export function buildOfficialRosterArchiveFilter(
  researchEntityId: string,
  snapshot: OfficialRosterSnapshotForReconciliation,
): Record<string, unknown> | null {
  const safeResearchEntityId = normalizeMaterializerObjectId(researchEntityId);
  const memberKeys = Array.isArray(snapshot.memberKeys)
    ? Array.from(
        new Set(
          snapshot.memberKeys
            .map((value) => textValue(value))
            .filter(Boolean)
            .slice(0, 40),
        ),
      )
    : [];
  if (!safeResearchEntityId || snapshot.complete !== true || memberKeys.length === 0) return null;
  return {
    researchEntityId: safeResearchEntityId,
    sourceName: OFFICIAL_ROSTER_SOURCE_NAME,
    archived: { $ne: true },
    isCurrentMember: { $ne: false },
    membershipKey: { $nin: memberKeys },
  };
}

async function reconcileOfficialRosterSnapshotsFromRun(
  scrapeRunId: string,
  options: MaterializeOptions,
): Promise<number> {
  const runObjectId = toMaterializerObjectId(scrapeRunId);
  if (!runObjectId || options.dryRun) return 0;
  const snapshots = await Observation.find({
    scrapeRunId: runObjectId,
    sourceName: OFFICIAL_ROSTER_SOURCE_NAME,
    entityType: 'researchEntity',
    field: 'rosterEnrichment',
  })
    .select('entityKey value observedAt sourceUrl confidence')
    .lean();
  let archived = 0;
  for (const snapshotObservation of snapshots as any[]) {
    const snapshot = objectRecord(
      snapshotObservation.value,
    ) as OfficialRosterSnapshotForReconciliation;
    if (!snapshotObservation.entityKey) continue;
    const entity: any = await ResearchEntity.findOne({
      slug: snapshotObservation.entityKey,
      archived: { $ne: true },
    })
      .select('_id')
      .lean();
    if (!entity?._id) continue;
    const filter = buildOfficialRosterArchiveFilter(materializerDocumentId(entity._id), snapshot);
    if (!filter) continue;
    const endedAt = snapshotObservation.observedAt || new Date();
    const result = await ResearchGroupMember.updateMany(filter, {
      $set: {
        archived: true,
        isCurrentMember: false,
        endedAt,
        evidenceStatus: 'historical',
        'fieldProvenance.currentStatus': {
          sourceName: OFFICIAL_ROSTER_SOURCE_NAME,
          sourceUrl: snapshotObservation.sourceUrl || '',
          observedAt: endedAt,
          confidence: snapshotObservation.confidence ?? 1,
        },
      },
    });
    archived += result.modifiedCount || 0;
  }
  return archived;
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
}> {
  const paperResult = await materializePaperObservationsFromRun(scrapeRunId, options);
  const runObjectId = toMaterializerObjectId(scrapeRunId);
  if (!runObjectId) {
    return {
      ...paperResult,
      postMaterializationMetrics: emptyPostMaterializationMetrics(),
    };
  }
  const distinct = await Observation.aggregate([
    {
      $match: {
        scrapeRunId: runObjectId,
        entityType: { $ne: 'paper' },
      },
    },
    {
      $group: {
        _id: { entityType: '$entityType', entityId: '$entityId', entityKey: '$entityKey' },
      },
    },
  ]);
  const materializationOrder: Record<string, number> = {
    user: 0,
    researchEntity: 1,
    researchGroup: 1,
  };
  distinct.sort((a, b) => {
    const left = materializationOrder[a._id?.entityType] ?? 10;
    const right = materializationOrder[b._id?.entityType] ?? 10;
    if (left !== right) return left - right;
    return String(a._id?.entityKey || a._id?.entityId || '').localeCompare(
      String(b._id?.entityKey || b._id?.entityId || ''),
    );
  });

  let materialized = paperResult.materialized;
  let created = paperResult.created;
  let updated = paperResult.updated;
  let conflicts = paperResult.conflicts;
  let skipped = paperResult.skipped;
  let errors = paperResult.errors;
  const postMaterializationMetrics = emptyPostMaterializationMetrics();
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
        options,
      );
    } catch (err: any) {
      errors++;
      console.error(
        `materializeFromRun: ${entityType} ${entityKey || entityId} failed:`,
        sanitizeLogValue(err),
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
  const rosterMembersArchived = await reconcileOfficialRosterSnapshotsFromRun(scrapeRunId, options);
  if (!options.dryRun) {
    await ScrapeRun.updateOne(
      { _id: scrapeRunId },
      {
        $set: {
          entitiesCreated: created,
          entitiesUpdated: updated,
          materializationSkipped: skipped,
          materializationConflicts: conflicts,
          materializationErrors: errors,
          entitiesArchived: rosterMembersArchived,
          postMaterializationMetrics,
        },
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
  };
}

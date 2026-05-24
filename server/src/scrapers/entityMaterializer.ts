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
import { User } from '../models/user';
import { ResearchEntity } from '../models/researchEntity';
import { ScrapeRun } from '../models/scrapeRun';
import { PostedOpportunity } from '../models/postedOpportunity';
import {
  resolveAllFields,
  ResolverObservation,
  ResolvedField,
} from './confidenceResolver';
import { syncEntity, isSyncableEntityType } from '../services/meiliSyncService';
import { materializeAccessForResearchGroup } from './accessMaterializer';
import type { ReportPostMaterializationMetrics } from './runReport';
import { redactDirectContactInfo } from '../utils/contactRedaction';
import {
  PAPER_AUTHORSHIP_EVIDENCE_FIELD,
  PaperAuthorshipEvidence,
  normalizePaperAuthorshipEvidence,
} from './paperAuthorshipPolicy';

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
const PUBLIC_QUOTE_FIELDS = new Set([
  'undergradEvidenceQuote',
  'undergradRoleEvidenceQuote',
  'contactInstructionsQuote',
  'undergradConstraintQuote',
]);

type MaterializerObservationLike = {
  field?: string;
  sourceName?: string;
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
  skipped?: string;
};

export const FELLOWSHIP_MATERIALIZED_FIELDS = new Set([
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
  'programAccessRole',
  'hostedByResearchEntityName',
  'hostedByResearchEntityUrl',
]);

function isResearchEntityObservationType(entityType: ObservedEntityType): boolean {
  return entityType === 'researchEntity' || entityType === 'researchGroup';
}

export function shouldIgnoreObservationForEntityMaterialization(
  entityType: ObservedEntityType,
  observation: MaterializerObservationLike,
): boolean {
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

function materializedFieldValue(
  entityType: ObservedEntityType,
  field: string,
  value: unknown,
): unknown {
  if (isResearchEntityObservationType(entityType) && PUBLIC_QUOTE_FIELDS.has(field) && typeof value === 'string') {
    return redactDirectContactInfo(value);
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
    const observedNetid = obs
      .find((o) => o.field === 'netid' && typeof o.value === 'string')
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

  if (entityType === 'user') {
    const emailObservation = obs.find(
      (o) => o.field === 'email' && typeof o.value === 'string',
    );
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
      const byDoi = await Model.find({ doi: { $in: doiValues } }).limit(2).lean();
      if (byDoi.length === 1) return byDoi[0];
    }
  }

  return null;
}

function paperIdentityBuckets(
  groups: Map<string, PaperMaterializationObservation[]>,
): {
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
    ...(Array.isArray(existing) ? existing : existing === undefined || existing === null ? [] : [existing]),
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
    if (!mongoose.Types.ObjectId.isValid(evidence.userId)) continue;
    const userObjectId = new mongoose.Types.ObjectId(evidence.userId);

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

export function buildFellowshipUpdateFromObservations(
  _entityKey: string,
  observations: FellowshipMaterializationObservation[],
  existingDoc: { manuallyLockedFields?: string[] } | null = null,
): FellowshipMaterializationPatch {
  const manuallyLockedFields = existingDoc?.manuallyLockedFields || [];
  const resolverObs: ResolverObservation[] = observations
    .filter((obs) => FELLOWSHIP_MATERIALIZED_FIELDS.has(obs.field))
    .map((obs) => ({
      field: obs.field,
      value: obs.value,
      sourceName: obs.sourceName,
      confidence: obs.confidence,
      observedAt: obs.observedAt,
    }));
  const resolved = resolveAllFields(resolverObs, { manuallyLockedFields });
  const set: Record<string, unknown> = {
    lastObservedAt: new Date(),
  };
  let fieldsWritten = 0;
  let conflicts = 0;

  for (const [field, r] of Object.entries(resolved)) {
    if (manuallyLockedFields.includes(field)) continue;
    const value = materializedFieldValue('fellowship', field, r.value);
    if (value !== undefined && value !== null && value !== '') {
      set[field] = value;
    }
    set[`confidenceByField.${field}`] = r.confidence;
    if (r.hasConflict) conflicts++;
    fieldsWritten++;
  }

  if (!existingDoc && !set.title) {
    return {
      update: { $set: set },
      fieldsWritten: 0,
      conflicts: 0,
      skipped: 'missing-required-fields',
    };
  }

  return { update: { $set: set }, fieldsWritten, conflicts };
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
    set[field] = materializedFieldValue(entityType, field, nextValue);
    confidenceByField[field] = r.confidence;
    if (r.hasConflict) conflicts++;
    fieldsWritten++;
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
      throw new Error(
        `Cannot create new ${entityType}: missing entityKey or no keyField defined`,
      );
    }
    const keyValue = uniqueKeyValueForIdentifier(entityType, identifier.entityKey, obs);
    if (!keyValue) {
      throw new Error(
        `Cannot create new ${entityType}: missing normalized unique key value`,
      );
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

  const syncEntityType = entityType === 'researchGroup' ? 'researchEntity' : entityType;
  if (isSyncableEntityType(syncEntityType) && entityIdString) {
    const fresh = await Model.findById(entityIdString).lean();
    if (fresh) await syncEntity(syncEntityType, fresh);
  }

  let postMaterializationMetrics: ReportPostMaterializationMetrics | undefined;
  if (isResearchEntityObservationType(entityType) && entityIdString) {
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
  const runObjectId = new mongoose.Types.ObjectId(scrapeRunId);
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
      console.error('materializePaperObservationsFromRun failed:', (err as Error)?.message || err);
    }
  }

  return { materialized, created, updated, conflicts, skipped, errors };
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
  const distinct = await Observation.aggregate([
    {
      $match: {
        scrapeRunId: new mongoose.Types.ObjectId(scrapeRunId),
        entityType: { $ne: 'paper' },
      },
    },
    {
      $group: {
        _id: { entityType: '$entityType', entityId: '$entityId', entityKey: '$entityKey' },
      },
    },
  ]);

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

import dotenv from 'dotenv';
import fs from 'fs';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeConnections } from '../db/connections';
import { Observation } from '../models/observation';
import { undergraduateLogisticsSignalTypes } from '../models/researchAccessTypes';
import {
  deriveAccessArtifactsForResearchGroup,
  materializeAccessForResearchGroup,
  type DerivedAccessArtifacts,
} from '../scrapers/accessMaterializer';
import {
  OBSERVATION_REFERENCE_SPECS,
  type ObservationReferenceSpec,
} from '../scrapers/observationRetention';
import {
  materializeUndergraduateLogisticsForResearchEntity,
  resolveUndergraduateLogisticsClaims,
} from '../scrapers/undergraduateLogisticsMaterializer';
import { serializedDocumentId } from '../utils/idSerialization';
import { sanitizeLogValue } from '../utils/logSanitizer';
import {
  ARCHIVABLE_REFERENCE_COLLECTIONS,
  buildDirectReferenceAggregationPipeline,
  buildOrphanReferenceArtifact,
  buildOrphanReferenceDecisionTemplate,
  buildOrphanReferenceOwnerFingerprint,
  buildProvenanceReferenceAggregationPipeline,
  classifyOrphanReference,
  normalizeObservationRepairObjectId,
  observationRepairFingerprint,
  validateOrphanReferenceArtifact,
  validateOrphanReferenceDecisions,
  type OrphanReferenceArtifact,
  type OrphanReferenceClassification,
  type OrphanReferenceDecisionEnvelope,
  type OrphanReferenceObservationCandidate,
  type OrphanReferenceOccurrence,
  type ValidatedOrphanReferenceDecision,
} from './orphanedObservationReferenceRepairCore';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';

dotenv.config();

interface CliOptions {
  execute: boolean;
  confirm: boolean;
  limitPerReference: number;
  maxApply: number;
  privateOutput: string;
  decisionTemplateOutput?: string;
  applyFrom?: string;
  decisions?: string;
}

interface AggregatedOrphanRow {
  owner: Record<string, unknown>;
  missingObservationId: unknown;
  arrayIndex?: number;
  referenceKey?: string;
  provenance?: Record<string, unknown>;
}

interface ApplyResult {
  handle: string;
  decision: string;
  status: 'applied' | 'idempotent' | 'blocked';
  reason?: string;
}

interface ApplyContext {
  materializationKeys: Set<string>;
  ownerSnapshots: Map<string, string>;
}

const MAX_PRIVATE_ARTIFACT_BYTES = 20 * 1024 * 1024;

function positiveInteger(value: string, flag: string): number {
  if (!/^[1-9]\d*$/.test(value)) throw new Error(`${flag} must be a positive integer.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${flag} must be a positive integer.`);
  return parsed;
}

function flagValue(argv: string[], index: number, flag: string): { value: string; next: number } {
  const arg = argv[index];
  const inline = arg.startsWith(`${flag}=`) ? arg.slice(flag.length + 1) : undefined;
  const value = inline === undefined ? argv[index + 1] : inline;
  if (!value?.trim() || value.startsWith('--')) throw new Error(`${flag} requires a value.`);
  return { value: value.trim(), next: inline === undefined ? index + 1 : index };
}

export function parseRepairOrphanedObservationReferencesArgs(argv: string[]): CliOptions {
  const options: Partial<CliOptions> = {
    execute: false,
    confirm: false,
    limitPerReference: 100,
    maxApply: 25,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--execute' || arg === '--apply') options.execute = true;
    else if (arg === '--dry-run') options.execute = false;
    else if (arg === '--confirm-development-orphan-reference-repair') options.confirm = true;
    else if (arg.startsWith('--confirm-development-orphan-reference-repair=')) {
      throw new Error('--confirm-development-orphan-reference-repair does not accept a value.');
    } else if (arg === '--limit-per-reference' || arg.startsWith('--limit-per-reference=')) {
      const parsed = flagValue(argv, index, '--limit-per-reference');
      options.limitPerReference = positiveInteger(parsed.value, '--limit-per-reference');
      index = parsed.next;
    } else if (arg === '--max-apply' || arg.startsWith('--max-apply=')) {
      const parsed = flagValue(argv, index, '--max-apply');
      options.maxApply = positiveInteger(parsed.value, '--max-apply');
      index = parsed.next;
    } else if (arg === '--private-output' || arg.startsWith('--private-output=')) {
      const parsed = flagValue(argv, index, '--private-output');
      options.privateOutput = resolveSafeJsonReportOutputPath(parsed.value, '--private-output');
      index = parsed.next;
    } else if (
      arg === '--decision-template-output' ||
      arg.startsWith('--decision-template-output=')
    ) {
      const parsed = flagValue(argv, index, '--decision-template-output');
      options.decisionTemplateOutput = resolveSafeJsonReportOutputPath(
        parsed.value,
        '--decision-template-output',
      );
      index = parsed.next;
    } else if (arg === '--apply-from' || arg.startsWith('--apply-from=')) {
      const parsed = flagValue(argv, index, '--apply-from');
      options.applyFrom = resolveSafeJsonReportOutputPath(parsed.value, '--apply-from');
      index = parsed.next;
    } else if (arg === '--decisions' || arg.startsWith('--decisions=')) {
      const parsed = flagValue(argv, index, '--decisions');
      options.decisions = resolveSafeJsonReportOutputPath(parsed.value, '--decisions');
      index = parsed.next;
    } else {
      throw new Error(`Unknown observations:repair-orphaned-references argument: ${arg}`);
    }
  }
  if (!options.privateOutput) throw new Error('--private-output is required.');
  if (options.execute && (!options.applyFrom || !options.decisions)) {
    throw new Error('--execute requires --apply-from and --decisions.');
  }
  if (options.execute && !options.confirm) {
    throw new Error('--execute requires --confirm-development-orphan-reference-repair.');
  }
  if (options.execute && process.env.ALLOW_NON_PROD_SCRAPER_WRITES !== 'true') {
    throw new Error('--execute requires ALLOW_NON_PROD_SCRAPER_WRITES=true.');
  }
  return options as CliOptions;
}

function readPrivateJson<T>(file: string, flag: string): T {
  const safePath = resolveSafeJsonReportOutputPath(file, flag);
  const stat = fs.statSync(safePath);
  if (!stat.isFile() || stat.size > MAX_PRIVATE_ARTIFACT_BYTES) {
    throw new Error(`${flag} must be a JSON file no larger than 20 MiB.`);
  }
  return JSON.parse(fs.readFileSync(safePath, 'utf8')) as T;
}

export function writePrivateJson(value: unknown, file: string, flag: string): void {
  const safePath = resolveSafeJsonReportOutputPath(file, flag);
  fs.mkdirSync(path.dirname(safePath), { recursive: true });
  fs.writeFileSync(safePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'w' });
  fs.chmodSync(safePath, 0o600);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function nestedValue(owner: Record<string, unknown>, field: string): unknown {
  return field.split('.').reduce<unknown>((current, part) => {
    if (Array.isArray(current)) return current.map((item) => record(item)[part]);
    return record(current)[part];
  }, owner);
}

function isArchivedOwner(collection: string, owner: Record<string, unknown>): boolean {
  if (collection === 'observations') {
    return owner.superseded === true || Boolean(record(owner.rollback).rolledBackAt);
  }
  return (
    owner.archived === true || stringValue(record(owner.review).status) === 'archived_by_review'
  );
}

function ownerResearchEntityId(owner: Record<string, unknown>): string | undefined {
  return normalizeObservationRepairObjectId(owner.researchEntityId);
}

function occurrenceFromRow(
  spec: ObservationReferenceSpec,
  row: AggregatedOrphanRow,
): OrphanReferenceOccurrence | undefined {
  const ownerId = normalizeObservationRepairObjectId(row.owner._id);
  const missingObservationId = normalizeObservationRepairObjectId(row.missingObservationId);
  if (!ownerId || !missingObservationId) return undefined;
  const provenance = record(row.provenance);
  return {
    ownerCollection: spec.collection,
    ownerId,
    field: spec.field,
    ...(row.referenceKey ? { referenceKey: row.referenceKey } : {}),
    ...(Number.isInteger(row.arrayIndex) ? { arrayIndex: row.arrayIndex } : {}),
    missingObservationId,
    activity: isArchivedOwner(spec.collection, row.owner) ? 'archived' : 'active',
    ownerFingerprint: buildOrphanReferenceOwnerFingerprint({
      owner: row.owner,
      field: spec.field,
      referenceKey: row.referenceKey,
    }),
    ...(ownerResearchEntityId(row.owner)
      ? { researchEntityId: ownerResearchEntityId(row.owner) }
      : {}),
    ...(stringValue(row.owner.derivationKey)
      ? { ownerDerivationKey: stringValue(row.owner.derivationKey) }
      : {}),
    ...((undergraduateLogisticsSignalTypes as readonly string[]).includes(
      stringValue(row.owner.type),
    )
      ? { ownerClaimType: stringValue(row.owner.type) }
      : {}),
    ...(row.referenceKey
      ? {
          provenance: {
            sourceName: stringValue(provenance.sourceName),
            sourceUrl: stringValue(provenance.sourceUrl),
            observedAt: provenance.observedAt
              ? new Date(String(provenance.observedAt)).toISOString()
              : undefined,
          },
        }
      : {}),
  };
}

export function candidateSubjectMatch(ownerCollection: string, owner: Record<string, unknown>) {
  if (ownerCollection === 'research_entities') {
    const clauses: Record<string, unknown>[] = [{ entityId: owner._id }];
    if (stringValue(owner.slug)) clauses.push({ entityKey: stringValue(owner.slug) });
    return { entityType: { $in: ['researchEntity', 'researchGroup'] }, $or: clauses };
  }
  if (ownerCollection === 'faculty_members') {
    const clauses: Record<string, unknown>[] = [];
    if (owner.userId) clauses.push({ entityId: owner.userId });
    if (stringValue(owner.netid)) clauses.push({ entityKey: stringValue(owner.netid) });
    if (stringValue(owner.slug)) clauses.push({ entityKey: stringValue(owner.slug) });
    return clauses.length ? { entityType: 'user', $or: clauses } : null;
  }
  if (ownerCollection === 'papers') {
    const clauses: Record<string, unknown>[] = [{ entityId: owner._id }];
    for (const key of [owner.openAlexId, owner.arxivId, owner.doi]) {
      if (stringValue(key)) clauses.push({ entityKey: stringValue(key) });
    }
    return { entityType: 'paper', $or: clauses };
  }
  if (ownerCollection === 'paper_authors') {
    return owner.paperId ? { entityType: 'paper', entityId: owner.paperId } : null;
  }
  if (ownerCollection === 'grants') {
    const entityIds = [
      ...(Array.isArray(owner.researchEntityIds) ? owner.researchEntityIds : []),
      ...(Array.isArray(owner.researchGroupIds) ? owner.researchGroupIds : []),
    ].filter(Boolean);
    const clauses: Record<string, unknown>[] = [];
    if (entityIds.length) clauses.push({ entityId: { $in: entityIds } });
    if (stringValue(owner.externalId)) clauses.push({ entityKey: stringValue(owner.externalId) });
    return clauses.length
      ? { entityType: { $in: ['researchEntity', 'researchGroup'] }, $or: clauses }
      : null;
  }
  if (ownerCollection === 'research_entity_members') {
    const clauses: Record<string, unknown>[] = [{ entityId: owner._id }];
    if (stringValue(owner.membershipKey)) {
      clauses.push({ entityKey: stringValue(owner.membershipKey) });
    }
    return { entityType: 'researchGroupMember', $or: clauses };
  }
  if (ownerCollection === 'observations') {
    const identity = owner.entityId ? { entityId: owner.entityId } : { entityKey: owner.entityKey };
    return { entityType: owner.entityType, ...identity };
  }
  return null;
}

async function loadCandidateObservations(input: {
  spec: ObservationReferenceSpec;
  owner: Record<string, unknown>;
  referenceKey?: string;
}): Promise<{ candidates: OrphanReferenceObservationCandidate[]; exhaustive: boolean }> {
  const subject = candidateSubjectMatch(input.spec.collection, input.owner);
  if (!subject) return { candidates: [], exhaustive: true };
  const field = input.referenceKey || stringValue(input.owner.field);
  if (!field) return { candidates: [], exhaustive: true };
  const query: Record<string, unknown> = { ...subject, field };
  const sourceName = input.referenceKey
    ? stringValue(record(record(input.owner[input.spec.field])[input.referenceKey]).sourceName)
    : stringValue(input.owner.sourceName);
  if (sourceName) query.sourceName = sourceName;
  const rows = await Observation.find(query).sort({ observedAt: -1 }).limit(51).lean();
  return {
    exhaustive: rows.length <= 50,
    candidates: rows.slice(0, 50).map((candidate: any) => ({
      id: serializedDocumentId(candidate._id) || '',
      entityType: candidate.entityType,
      entityId: serializedDocumentId(candidate.entityId),
      entityKey: candidate.entityKey,
      field: candidate.field,
      value: candidate.value,
      sourceName: candidate.sourceName,
      sourceUrl: candidate.sourceUrl,
      observedAt: candidate.observedAt?.toISOString?.() || String(candidate.observedAt || ''),
      superseded: candidate.superseded === true,
    })),
  };
}

interface ResearchEntityObservationContext {
  entityKey?: string;
  observations: any[];
  accessArtifacts?: DerivedAccessArtifacts;
}

async function loadResearchEntityObservationContext(
  researchEntityId: string,
): Promise<ResearchEntityObservationContext> {
  const objectId = new mongoose.Types.ObjectId(researchEntityId);
  const entity = await mongoose.connection.db
    ?.collection('research_entities')
    .findOne({ _id: objectId }, { projection: { slug: 1 } });
  const entityKey = stringValue(entity?.slug) || undefined;
  const identifiers: Record<string, unknown>[] = [{ entityId: objectId }];
  if (entityKey) identifiers.push({ entityKey });
  const observations = await Observation.find({
    entityType: { $in: ['researchEntity', 'researchGroup'] },
    $or: identifiers,
    superseded: { $ne: true },
  }).lean();
  return { entityKey, observations };
}

async function currentMaterializationEvidenceIds(input: {
  spec: ObservationReferenceSpec;
  owner: Record<string, unknown>;
  occurrence: OrphanReferenceOccurrence;
  observationCache: Map<string, ResearchEntityObservationContext>;
}): Promise<{ evidenceIds: string[]; replacesOwner: boolean }> {
  const researchEntityId = input.occurrence.researchEntityId;
  if (!researchEntityId) return { evidenceIds: [], replacesOwner: false };
  let context = input.observationCache.get(researchEntityId);
  if (!context) {
    context = await loadResearchEntityObservationContext(researchEntityId);
    input.observationCache.set(researchEntityId, context);
  }
  const { observations } = context;

  if (input.spec.collection === 'signals' && input.occurrence.ownerClaimType) {
    const claimType = input.occurrence.ownerClaimType;
    const resolution = resolveUndergraduateLogisticsClaims(observations as any[]);
    return {
      evidenceIds:
        resolution.patches.find((patch) => patch.claimType === claimType)?.sourceEvidenceIds || [],
      replacesOwner: false,
    };
  }

  if (['entry_pathways', 'signals', 'contact_routes'].includes(input.spec.collection)) {
    const key = input.occurrence.ownerDerivationKey;
    if (!key) return { evidenceIds: [], replacesOwner: false };
    if (!context.accessArtifacts) {
      context.accessArtifacts = (
        await deriveAccessArtifactsForResearchGroup(
          { researchEntityId, entityKey: context.entityKey },
          observations as any[],
        )
      ).artifacts;
    }
    const derived = context.accessArtifacts;
    if (input.spec.collection === 'entry_pathways') {
      const exact = derived.entryPathways.find((item) => item.derivationKey === key);
      const legacyReplacement =
        key === 'pathway:EXPLORATORY_CONTACT' ||
        key.startsWith('pathway:EXPLORATORY_CONTACT:OFFICIAL_PROFILE:') ||
        key.startsWith('visibility-repair:official-profile-outreach:')
          ? derived.entryPathways.find(
              (item) =>
                item.pathwayType === 'EXPLORATORY_CONTACT' &&
                /:(IDENTIFIED_FACULTY_LEAD|ORGANIZATIONAL_HOME)$/.test(item.derivationKey),
            )
          : undefined;
      return {
        evidenceIds: exact?.sourceEvidenceIds || legacyReplacement?.sourceEvidenceIds || [],
        replacesOwner: !exact && Boolean(legacyReplacement),
      };
    }
    if (input.spec.collection === 'signals') {
      const exact = derived.accessSignals.find((item) => item.derivationKey === key);
      const legacyReplacement =
        key.startsWith('signal:REACH_OUT_PLAUSIBLE:OFFICIAL_PROFILE:') ||
        key.startsWith('visibility-repair:official-profile-outreach:')
          ? derived.accessSignals.find(
              (item) =>
                item.type === 'REACH_OUT_PLAUSIBLE' &&
                /:(IDENTIFIED_FACULTY_LEAD|ORGANIZATIONAL_HOME)$/.test(item.derivationKey),
            )
          : undefined;
      const id = exact?.sourceEvidenceId || legacyReplacement?.sourceEvidenceId;
      return { evidenceIds: id ? [id] : [], replacesOwner: !exact && Boolean(legacyReplacement) };
    }
    const exact = derived.contactRoutes.find((item) => item.derivationKey === key);
    const legacyReplacement =
      key.startsWith('route:FACULTY_PI:OFFICIAL_PROFILE:') ||
      key.startsWith('visibility-repair:official-profile-contact:')
        ? derived.contactRoutes.find(
            (item) =>
              item.routeType === 'FACULTY_PI' &&
              item.derivationKey.startsWith('route:faculty_pi:identified:'),
          )
        : undefined;
    const route = exact || legacyReplacement;
    return {
      evidenceIds: Array.from(
        new Set([...(route?.sourceEvidenceIds || []), route?.sourceEvidenceId].filter(Boolean)),
      ) as string[],
      replacesOwner: !exact && Boolean(legacyReplacement),
    };
  }

  return { evidenceIds: [], replacesOwner: false };
}

async function classifyCurrentTarget(
  dbFingerprint: string,
  limitPerReference: number,
): Promise<OrphanReferenceClassification[]> {
  const db = mongoose.connection.db;
  if (!db) throw new Error('MongoDB connection is unavailable.');
  const rows: OrphanReferenceClassification[] = [];
  const observationCache = new Map<string, ResearchEntityObservationContext>();

  for (const spec of OBSERVATION_REFERENCE_SPECS) {
    const pipeline =
      spec.kind === 'provenance-map'
        ? buildProvenanceReferenceAggregationPipeline(spec, limitPerReference)
        : buildDirectReferenceAggregationPipeline(spec, limitPerReference);
    const orphanRows = (await db
      .collection(spec.collection)
      .aggregate(pipeline)
      .toArray()) as AggregatedOrphanRow[];
    for (const row of orphanRows) {
      const occurrence = occurrenceFromRow(spec, row);
      if (!occurrence) continue;
      const candidateResult = await loadCandidateObservations({
        spec,
        owner: row.owner,
        referenceKey: row.referenceKey,
      });
      const materialization = await currentMaterializationEvidenceIds({
        spec,
        owner: row.owner,
        occurrence,
        observationCache,
      });
      rows.push(
        classifyOrphanReference({
          occurrence,
          owner: row.owner,
          ownerFieldValue: row.referenceKey ? row.owner[row.referenceKey] : undefined,
          candidates: candidateResult.candidates,
          candidatesExhaustive: candidateResult.exhaustive,
          currentMaterializationEvidenceIds: materialization.evidenceIds,
          materializationReplacesOwner: materialization.replacesOwner,
          dbFingerprint,
        }),
      );
    }
  }
  return rows;
}

export function updatePathFor(classification: OrphanReferenceClassification): string {
  if (classification.referenceKey) {
    return `${classification.field}.${classification.referenceKey}.observationId`;
  }
  if (classification.arrayIndex === undefined) return classification.field;
  const parts = classification.field.split('.');
  if (parts.length === 1) return `${classification.field}.${classification.arrayIndex}`;
  const leaf = parts.pop();
  return `${parts.join('.')}.${classification.arrayIndex}.${leaf}`;
}

export function currentReferenceValue(
  owner: Record<string, unknown>,
  classification: OrphanReferenceClassification,
): string | undefined {
  if (classification.referenceKey) {
    return normalizeObservationRepairObjectId(
      record(record(owner[classification.field])[classification.referenceKey]).observationId,
    );
  }
  const value = nestedValue(owner, classification.field);
  if (classification.arrayIndex !== undefined && Array.isArray(value)) {
    return value
      .map(normalizeObservationRepairObjectId)
      .find((id) => id === classification.missingObservationId);
  }
  return normalizeObservationRepairObjectId(value);
}

export function referenceMatchPath(classification: OrphanReferenceClassification): string {
  if (classification.arrayIndex !== undefined && !classification.field.includes('.')) {
    return classification.field;
  }
  return updatePathFor(classification);
}

function ownerSnapshotKey(classification: OrphanReferenceClassification): string {
  return `${classification.ownerCollection}:${classification.ownerId}`;
}

function ownerSnapshot(owner: Record<string, unknown>): string {
  return observationRepairFingerprint({ owner });
}

async function rememberOwnerSnapshot(
  classification: OrphanReferenceClassification,
  context: ApplyContext,
): Promise<void> {
  const owner = (await mongoose.connection.db!.collection(classification.ownerCollection).findOne({
    _id: new mongoose.Types.ObjectId(classification.ownerId),
  })) as Record<string, unknown> | null;
  if (owner) context.ownerSnapshots.set(ownerSnapshotKey(classification), ownerSnapshot(owner));
}

async function preflightOwner(
  classification: OrphanReferenceClassification,
  context?: ApplyContext,
): Promise<Record<string, unknown>> {
  const db = mongoose.connection.db;
  if (!db) throw new Error('MongoDB connection is unavailable.');
  const owner = (await db
    .collection(classification.ownerCollection)
    .findOne({ _id: new mongoose.Types.ObjectId(classification.ownerId) })) as Record<
    string,
    unknown
  > | null;
  if (!owner) throw new Error('owner_missing');
  const remembered = context?.ownerSnapshots.get(ownerSnapshotKey(classification));
  const fingerprint = remembered
    ? ownerSnapshot(owner)
    : buildOrphanReferenceOwnerFingerprint({
        owner,
        field: classification.field,
        referenceKey: classification.referenceKey,
      });
  if (fingerprint !== (remembered || classification.ownerFingerprint))
    throw new Error('owner_changed_since_review');
  if (currentReferenceValue(owner, classification) !== classification.missingObservationId) {
    throw new Error('orphan_reference_changed_since_review');
  }
  const stillMissing = await Observation.countDocuments({
    _id: new mongoose.Types.ObjectId(classification.missingObservationId),
  });
  if (stillMissing !== 0) throw new Error('referenced_observation_now_exists');
  return owner;
}

async function preflightOwnerForReviewedLoss(
  classification: OrphanReferenceClassification,
  artifactHash: string,
  options: { requireArchived?: boolean } = { requireArchived: true },
): Promise<Record<string, unknown>> {
  try {
    return await preflightOwner(classification);
  } catch (error) {
    if (!(error instanceof Error) || error.message !== 'owner_changed_since_review') throw error;
  }
  const db = mongoose.connection.db!;
  const owner = (await db.collection(classification.ownerCollection).findOne({
    _id: new mongoose.Types.ObjectId(classification.ownerId),
  })) as Record<string, unknown> | null;
  if (!owner || (options.requireArchived !== false && owner.archived !== true)) {
    throw new Error('owner_changed_since_review');
  }
  if (currentReferenceValue(owner, classification) !== classification.missingObservationId) {
    throw new Error('orphan_reference_changed_since_review');
  }
  const reviewedRepairOwnerClauses: Record<string, unknown>[] = [
    { ownerId: new mongoose.Types.ObjectId(classification.ownerId) },
  ];
  if (options.requireArchived === false && classification.researchEntityId) {
    reviewedRepairOwnerClauses.push({
      researchEntityId: new mongoose.Types.ObjectId(classification.researchEntityId),
    });
  }
  const priorReviewedRepair = await db.collection('observation_reference_repair_audits').findOne(
    {
      artifactHash,
      $or: reviewedRepairOwnerClauses,
    },
    { projection: { _id: 1 } },
  );
  if (!priorReviewedRepair) throw new Error('owner_changed_since_review');
  const stillMissing = await Observation.countDocuments({
    _id: new mongoose.Types.ObjectId(classification.missingObservationId),
  });
  if (stillMissing !== 0) throw new Error('referenced_observation_now_exists');
  return owner;
}

async function writeAudit(
  decision: ValidatedOrphanReferenceDecision,
  artifactHash: string,
  result: string,
): Promise<boolean> {
  const db = mongoose.connection.db;
  if (!db) throw new Error('MongoDB connection is unavailable.');
  const repairKey = repairAuditKey(decision, artifactHash);
  const write = await db.collection('observation_reference_repair_audits').updateOne(
    { repairKey },
    {
      $setOnInsert: {
        repairKey,
        artifactHash,
        handle: decision.handle,
        ownerCollection: decision.classification.ownerCollection,
        ownerId: new mongoose.Types.ObjectId(decision.classification.ownerId),
        ...(decision.classification.researchEntityId
          ? {
              researchEntityId: new mongoose.Types.ObjectId(
                decision.classification.researchEntityId,
              ),
            }
          : {}),
        field: decision.classification.field,
        referenceKey: decision.classification.referenceKey,
        missingObservationId: new mongoose.Types.ObjectId(
          decision.classification.missingObservationId,
        ),
        ...(decision.classification.replacementObservationId
          ? {
              replacementObservationId: new mongoose.Types.ObjectId(
                decision.classification.replacementObservationId,
              ),
            }
          : {}),
        activity: decision.classification.activity,
        recovery: decision.classification.recovery,
        decision: decision.decision,
        reviewedBy: decision.reviewedBy,
        reviewNote: decision.reviewNote || '',
        result,
        createdAt: new Date(),
      },
    },
    { upsert: true },
  );
  return write.upsertedCount === 0;
}

function repairAuditKey(decision: ValidatedOrphanReferenceDecision, artifactHash: string): string {
  return observationRepairFingerprint({
    artifactHash,
    handle: decision.handle,
    decision: decision.decision,
  });
}

async function repairAuditExists(
  decision: ValidatedOrphanReferenceDecision,
  artifactHash: string,
): Promise<boolean> {
  const db = mongoose.connection.db;
  if (!db) throw new Error('MongoDB connection is unavailable.');
  return Boolean(
    await db
      .collection('observation_reference_repair_audits')
      .findOne({ repairKey: repairAuditKey(decision, artifactHash) }, { projection: { _id: 1 } }),
  );
}

async function applyRelink(
  decision: ValidatedOrphanReferenceDecision,
  artifactHash: string,
  context: ApplyContext,
): Promise<ApplyResult> {
  const classification = decision.classification;
  const owner = await preflightOwner(classification, context);
  const replacementId = classification.replacementObservationId;
  if (!replacementId) throw new Error('replacement_observation_missing');
  const candidateResult = await loadCandidateObservations({
    spec: {
      collection: classification.ownerCollection,
      field: classification.field,
      kind: classification.referenceKey ? 'provenance-map' : undefined,
    },
    owner,
    referenceKey: classification.referenceKey,
  });
  const current = classifyOrphanReference({
    occurrence: classification,
    owner,
    ownerFieldValue: classification.referenceKey ? owner[classification.referenceKey] : undefined,
    candidates: candidateResult.candidates,
    candidatesExhaustive: candidateResult.exhaustive,
    dbFingerprint: '',
  });
  if (
    current.recovery !== 'deterministic_relink' ||
    current.replacementObservationId !== replacementId
  ) {
    throw new Error('replacement_no_longer_deterministic');
  }
  const db = mongoose.connection.db!;
  const result = await db.collection(classification.ownerCollection).updateOne(
    {
      _id: new mongoose.Types.ObjectId(classification.ownerId),
      [referenceMatchPath(classification)]: new mongoose.Types.ObjectId(
        classification.missingObservationId,
      ),
    },
    {
      $set: {
        [updatePathFor(classification)]: new mongoose.Types.ObjectId(replacementId),
      },
    },
  );
  if (result.modifiedCount !== 1) throw new Error('relink_preflight_filter_mismatch');
  await rememberOwnerSnapshot(classification, context);
  const idempotent = await writeAudit(decision, artifactHash, 'relinked');
  return {
    handle: decision.handle,
    decision: decision.decision,
    status: idempotent ? 'idempotent' : 'applied',
  };
}

async function applyRematerialization(
  decision: ValidatedOrphanReferenceDecision,
  artifactHash: string,
  applyContext: ApplyContext,
): Promise<ApplyResult> {
  const classification = decision.classification;
  await preflightOwnerForReviewedLoss(classification, artifactHash, {
    requireArchived: classification.rematerializationMode === 'replace_legacy_owner',
  });
  const researchEntityId = classification.researchEntityId;
  if (!researchEntityId) throw new Error('research_entity_missing');
  const context = await loadResearchEntityObservationContext(researchEntityId);

  const materializationKey = `${classification.recovery}:${researchEntityId}`;
  if (!applyContext.materializationKeys.has(materializationKey)) {
    if (classification.recovery === 'rematerialize_access') {
      await materializeAccessForResearchGroup({
        researchEntityId,
        entityKey: context.entityKey,
      });
    } else if (classification.recovery === 'rematerialize_logistics') {
      await materializeUndergraduateLogisticsForResearchEntity({
        researchEntityId,
        entityKey: context.entityKey,
      });
    } else {
      throw new Error('unsupported_rematerialization');
    }
    applyContext.materializationKeys.add(materializationKey);
  }

  const db = mongoose.connection.db!;
  if (classification.rematerializationMode === 'replace_legacy_owner') {
    const result = await db.collection(classification.ownerCollection).updateOne(
      {
        _id: new mongoose.Types.ObjectId(classification.ownerId),
        [referenceMatchPath(classification)]: new mongoose.Types.ObjectId(
          classification.missingObservationId,
        ),
      },
      {
        $set: {
          archived: true,
          'review.status': 'archived_by_review',
          'review.reviewedAt': new Date(),
          'review.note':
            decision.reviewNote ||
            'Archived after canonical access artifacts were rematerialized from surviving evidence.',
        },
        ...orphanReferenceRemovalUpdate(classification),
      },
    );
    if (result.modifiedCount !== 1) {
      throw new Error('legacy_replacement_preflight_filter_mismatch');
    }
    const idempotent = await writeAudit(
      decision,
      artifactHash,
      'canonical_replacement_materialized_and_legacy_owner_archived',
    );
    return {
      handle: decision.handle,
      decision: decision.decision,
      status: idempotent ? 'idempotent' : 'applied',
    };
  }

  if (
    classification.arrayIndex !== undefined &&
    !classification.field.includes('.') &&
    ['sourceEvidenceIds'].includes(classification.field)
  ) {
    const owner = await db
      .collection(classification.ownerCollection)
      .findOne({ _id: new mongoose.Types.ObjectId(classification.ownerId) });
    const references = Array.isArray(owner?.[classification.field])
      ? (owner?.[classification.field] as unknown[])
      : [];
    const surviving = references
      .map(normalizeObservationRepairObjectId)
      .filter((id): id is string => Boolean(id) && id !== classification.missingObservationId);
    if (surviving.length === 0) throw new Error('rematerialization_left_no_surviving_evidence');
    await db.collection(classification.ownerCollection).updateOne(
      { _id: new mongoose.Types.ObjectId(classification.ownerId) },
      {
        $pull: {
          [classification.field]: new mongoose.Types.ObjectId(classification.missingObservationId),
        } as any,
      },
    );
  }

  const repaired = await db
    .collection(classification.ownerCollection)
    .findOne({ _id: new mongoose.Types.ObjectId(classification.ownerId) });
  if (
    repaired &&
    currentReferenceValue(repaired, classification) === classification.missingObservationId
  ) {
    throw new Error('rematerialization_did_not_replace_orphan');
  }
  const idempotent = await writeAudit(decision, artifactHash, 'rematerialized');
  return {
    handle: decision.handle,
    decision: decision.decision,
    status: idempotent ? 'idempotent' : 'applied',
  };
}

async function applyArchiveOwner(
  decision: ValidatedOrphanReferenceDecision,
  artifactHash: string,
): Promise<ApplyResult> {
  const classification = decision.classification;
  if (!ARCHIVABLE_REFERENCE_COLLECTIONS.has(classification.ownerCollection)) {
    throw new Error('owner_collection_cannot_be_archived');
  }
  const owner = await preflightOwnerForReviewedLoss(classification, artifactHash);
  const db = mongoose.connection.db!;
  const removal = orphanReferenceRemovalUpdate(classification);
  const result = await db.collection(classification.ownerCollection).updateOne(
    {
      _id: new mongoose.Types.ObjectId(classification.ownerId),
      ...(owner.archived === true ? {} : { archived: { $ne: true } }),
      [referenceMatchPath(classification)]: new mongoose.Types.ObjectId(
        classification.missingObservationId,
      ),
    },
    {
      $set: {
        archived: true,
        'review.status': 'archived_by_review',
        'review.reviewedAt': new Date(),
        'review.note':
          decision.reviewNote || 'Archived after reviewed unrecoverable evidence loss.',
      },
      ...removal,
    },
  );
  if (result.modifiedCount !== 1) throw new Error('archive_preflight_filter_mismatch');
  const idempotent = await writeAudit(decision, artifactHash, 'archived_fail_closed');
  return {
    handle: decision.handle,
    decision: decision.decision,
    status: idempotent ? 'idempotent' : 'applied',
  };
}

export function orphanReferenceRemovalUpdate(
  classification: OrphanReferenceClassification,
): Record<string, unknown> {
  if (classification.arrayIndex !== undefined && !classification.field.includes('.')) {
    return {
      $pull: {
        [classification.field]: new mongoose.Types.ObjectId(classification.missingObservationId),
      },
    };
  }
  return { $unset: { [updatePathFor(classification)]: '' } };
}

async function applyArchivedLoss(
  decision: ValidatedOrphanReferenceDecision,
  artifactHash: string,
): Promise<ApplyResult> {
  const classification = decision.classification;
  await preflightOwnerForReviewedLoss(classification, artifactHash);
  const db = mongoose.connection.db!;
  const result = await db.collection(classification.ownerCollection).updateOne(
    {
      _id: new mongoose.Types.ObjectId(classification.ownerId),
      [referenceMatchPath(classification)]: new mongoose.Types.ObjectId(
        classification.missingObservationId,
      ),
    },
    orphanReferenceRemovalUpdate(classification),
  );
  if (result.modifiedCount !== 1) throw new Error('archived_loss_preflight_filter_mismatch');
  const idempotent = await writeAudit(decision, artifactHash, 'archived_loss_recorded');
  return {
    handle: decision.handle,
    decision: decision.decision,
    status: idempotent ? 'idempotent' : 'applied',
  };
}

async function applyDecision(
  decision: ValidatedOrphanReferenceDecision,
  artifactHash: string,
  context: ApplyContext,
): Promise<ApplyResult> {
  try {
    const db = mongoose.connection.db!;
    const currentOwner = (await db.collection(decision.classification.ownerCollection).findOne({
      _id: new mongoose.Types.ObjectId(decision.classification.ownerId),
    })) as Record<string, unknown> | null;
    const currentReference = currentOwner
      ? currentReferenceValue(currentOwner, decision.classification)
      : undefined;
    if (
      currentOwner &&
      currentReference !== decision.classification.missingObservationId &&
      (await alreadySatisfiesDecision(currentOwner, currentReference, decision))
    ) {
      await writeAudit(decision, artifactHash, 'already_repaired_before_replay');
      return { handle: decision.handle, decision: decision.decision, status: 'idempotent' };
    }
    if (await repairAuditExists(decision, artifactHash)) {
      const owner = (await db.collection(decision.classification.ownerCollection).findOne({
        _id: new mongoose.Types.ObjectId(decision.classification.ownerId),
      })) as Record<string, unknown> | null;
      if (
        !owner ||
        currentReferenceValue(owner, decision.classification) !==
          decision.classification.missingObservationId
      ) {
        return { handle: decision.handle, decision: decision.decision, status: 'idempotent' };
      }
    }
    if (decision.decision === 'relink') return await applyRelink(decision, artifactHash, context);
    if (decision.decision === 'rematerialize') {
      return await applyRematerialization(decision, artifactHash, context);
    }
    if (decision.decision === 'archive_owner') {
      return await applyArchiveOwner(decision, artifactHash);
    }
    if (decision.decision === 'record_loss') {
      return await applyArchivedLoss(decision, artifactHash);
    }
    throw new Error('unsupported_decision');
  } catch (error) {
    return {
      handle: decision.handle,
      decision: decision.decision,
      status: 'blocked',
      reason: error instanceof Error ? error.message : 'unknown_error',
    };
  }
}

async function alreadySatisfiesDecision(
  owner: Record<string, unknown>,
  currentReference: string | undefined,
  decision: ValidatedOrphanReferenceDecision,
): Promise<boolean> {
  if (decision.decision === 'relink') {
    return currentReference === decision.classification.replacementObservationId;
  }
  if (decision.decision === 'archive_owner') {
    return owner.archived === true && !currentReference;
  }
  if (decision.decision === 'record_loss') return !currentReference;
  if (decision.decision === 'rematerialize') {
    if (decision.classification.rematerializationMode === 'replace_legacy_owner') {
      return owner.archived === true && !currentReference;
    }
    if (!currentReference) return true;
    const currentId = normalizeObservationRepairObjectId(currentReference);
    if (!currentId) return false;
    return (
      (await Observation.countDocuments({ _id: new mongoose.Types.ObjectId(currentId) })) === 1
    );
  }
  return false;
}

async function main(): Promise<void> {
  const options = parseRepairOrphanedObservationReferencesArgs(process.argv.slice(2));
  const guard = assertScriptApplyAllowed({
    apply: options.execute,
    scriptName: 'observations:repair-orphaned-references',
    mongoUrl: process.env.MONGODBURL,
  });
  if (guard.environment !== 'development') {
    throw new Error('Orphaned Observation reference repair is limited to Development.');
  }
  await initializeConnections();

  if (!options.execute) {
    const rows = await classifyCurrentTarget(guard.dbFingerprint, options.limitPerReference);
    const artifact = buildOrphanReferenceArtifact({
      generatedAt: new Date(),
      dbFingerprint: guard.dbFingerprint,
      limitPerReference: options.limitPerReference,
      rows,
    });
    writePrivateJson(artifact, options.privateOutput, '--private-output');
    if (options.decisionTemplateOutput) {
      writePrivateJson(
        buildOrphanReferenceDecisionTemplate(artifact),
        options.decisionTemplateOutput,
        '--decision-template-output',
      );
    }
    console.log(
      JSON.stringify({
        mode: 'dry-run',
        environment: guard.environment,
        classified: rows.length,
        recoverable: rows.filter((row) => row.recovery !== 'review_required').length,
        reviewRequired: rows.filter((row) => row.recovery === 'review_required').length,
        possiblyTruncatedScopes: artifact.referenceScopes.filter((scope) => scope.possiblyTruncated)
          .length,
        privateArtifactWritten: true,
        decisionTemplateWritten: Boolean(options.decisionTemplateOutput),
      }),
    );
    return;
  }

  const artifact = readPrivateJson<OrphanReferenceArtifact>(options.applyFrom!, '--apply-from');
  validateOrphanReferenceArtifact(artifact, guard.dbFingerprint);
  const envelope = readPrivateJson<OrphanReferenceDecisionEnvelope>(
    options.decisions!,
    '--decisions',
  );
  const decisions = validateOrphanReferenceDecisions({
    artifact,
    envelope,
    maxApply: options.maxApply,
  });
  const results: ApplyResult[] = [];
  const context: ApplyContext = { materializationKeys: new Set(), ownerSnapshots: new Map() };
  for (const decision of decisions) {
    results.push(await applyDecision(decision, artifact.artifactHash, context));
  }
  const report = {
    artifactType: 'orphaned-observation-reference-repair-apply',
    classification: 'PRIVATE',
    generatedAt: new Date().toISOString(),
    environment: guard.environment,
    dbFingerprint: guard.dbFingerprint,
    sourceArtifactHash: artifact.artifactHash,
    results,
  };
  writePrivateJson(report, options.privateOutput, '--private-output');
  console.log(
    JSON.stringify({
      mode: 'execute',
      environment: guard.environment,
      reviewedDecisions: decisions.length,
      applied: results.filter((result) => result.status === 'applied').length,
      idempotent: results.filter((result) => result.status === 'idempotent').length,
      blocked: results.filter((result) => result.status === 'blocked').length,
      privateArtifactWritten: true,
    }),
  );
  if (results.some((result) => result.status === 'blocked')) process.exitCode = 2;
}

const filename = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === filename) {
  main()
    .catch((error) => {
      console.error('Orphaned Observation reference repair failed:', sanitizeLogValue(error));
      process.exitCode = 1;
    })
    .finally(() => mongoose.disconnect());
}

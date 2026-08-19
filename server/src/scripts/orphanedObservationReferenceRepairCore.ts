import { createHash } from 'crypto';
import mongoose from 'mongoose';
import type { ObservationReferenceSpec } from '../scrapers/observationRetention';

export type OrphanReferenceActivity = 'active' | 'archived';

export type OrphanReferenceRecovery =
  | 'deterministic_relink'
  | 'rematerialize_access'
  | 'rematerialize_logistics'
  | 'review_required'
  | 'record_archived_loss';

export type OrphanReferenceDecision =
  | 'relink'
  | 'rematerialize'
  | 'archive_owner'
  | 'record_loss'
  | 'defer_review';

export interface OrphanReferenceOccurrence {
  ownerCollection: string;
  ownerId: string;
  field: string;
  referenceKey?: string;
  arrayIndex?: number;
  missingObservationId: string;
  activity: OrphanReferenceActivity;
  ownerFingerprint: string;
  researchEntityId?: string;
  ownerDerivationKey?: string;
  ownerClaimType?: string;
  provenance?: {
    sourceName?: string;
    sourceUrl?: string;
    observedAt?: string;
  };
}

export interface OrphanReferenceObservationCandidate {
  id: string;
  entityType: string;
  entityId?: string;
  entityKey?: string;
  field: string;
  value: unknown;
  sourceName: string;
  sourceUrl?: string;
  observedAt?: string;
  superseded?: boolean;
}

export interface OrphanReferenceClassification extends OrphanReferenceOccurrence {
  handle: string;
  recovery: OrphanReferenceRecovery;
  reason: string;
  replacementObservationId?: string;
  rematerializationMode?: 'refresh_owner' | 'replace_legacy_owner';
  candidateCount: number;
  recommendedDecision: OrphanReferenceDecision;
}

export interface OrphanReferenceReviewDecision {
  handle: string;
  decision: OrphanReferenceDecision;
  reviewedBy: string;
  reviewNote?: string;
}

export interface OrphanReferenceDecisionEnvelope {
  artifactHash: string;
  decisions: OrphanReferenceReviewDecision[];
}

export interface OrphanReferenceArtifact {
  artifactType: 'orphaned-observation-reference-repair';
  artifactVersion: 1;
  classification: 'PRIVATE';
  generatedAt: string;
  environment: 'development';
  dbFingerprint: string;
  limitPerReference: number;
  referenceScopes: Array<{
    ownerCollection: string;
    field: string;
    classified: number;
    possiblyTruncated: boolean;
  }>;
  artifactHash: string;
  rows: OrphanReferenceClassification[];
}

export interface ValidatedOrphanReferenceDecision extends OrphanReferenceReviewDecision {
  classification: OrphanReferenceClassification;
}

export const ACCESS_REFERENCE_COLLECTIONS = new Set(['signals']);

export const ARCHIVABLE_REFERENCE_COLLECTIONS = new Set(['signals']);

const OBJECT_ID_RE = /^[a-f\d]{24}$/i;
const MAX_ARTIFACT_AGE_MS = 48 * 60 * 60 * 1000;

export function normalizeObservationRepairObjectId(value: unknown): string | undefined {
  if (value instanceof mongoose.Types.ObjectId) return value.toHexString();
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return OBJECT_ID_RE.test(trimmed) ? trimmed.toLowerCase() : undefined;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeUrl(value: unknown): string {
  const raw = stringValue(value);
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    parsed.hash = '';
    if (parsed.pathname !== '/') parsed.pathname = parsed.pathname.replace(/\/+$/, '');
    return parsed.toString().toLowerCase();
  } catch {
    return raw.replace(/\/+$/, '').toLowerCase();
  }
}

function canonicalValue(value: unknown): unknown {
  if (value === undefined) return null;
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return value.trim();
  if (value instanceof Date) return value.toISOString();
  const objectId = normalizeObservationRepairObjectId(value);
  if (objectId) return objectId;
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value instanceof Map) {
    return canonicalValue(Object.fromEntries(value.entries()));
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, canonicalValue(record[key])]),
    );
  }
  return String(value);
}

export function observationRepairFingerprint(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalValue(value)))
    .digest('hex');
}

export function buildOrphanReferenceHandle(
  occurrence: OrphanReferenceOccurrence,
  dbFingerprint: string,
): string {
  return observationRepairFingerprint({
    dbFingerprint,
    ownerCollection: occurrence.ownerCollection,
    ownerId: occurrence.ownerId,
    field: occurrence.field,
    referenceKey: occurrence.referenceKey,
    arrayIndex: occurrence.arrayIndex,
    missingObservationId: occurrence.missingObservationId,
  });
}

export function buildOrphanReferenceOwnerFingerprint(input: {
  owner: Record<string, unknown>;
  field: string;
  referenceKey?: string;
}): string {
  return observationRepairFingerprint({
    owner: input.owner,
    field: input.field,
    referenceKey: input.referenceKey,
  });
}

function valuesMatch(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonicalValue(left)) === JSON.stringify(canonicalValue(right));
}

function subjectsMatch(input: {
  ownerCollection: string;
  ownerId: string;
  owner: Record<string, unknown>;
  candidate: OrphanReferenceObservationCandidate;
}): boolean {
  const candidateId = normalizeObservationRepairObjectId(input.candidate.entityId);
  const candidateKey = stringValue(input.candidate.entityKey).toLowerCase();
  const ownerId = normalizeObservationRepairObjectId(input.ownerId);

  if (input.ownerCollection === 'research_entities') {
    return (
      ['researchEntity', 'researchGroup'].includes(input.candidate.entityType) &&
      ((Boolean(ownerId) && candidateId === ownerId) ||
        (Boolean(candidateKey) && candidateKey === stringValue(input.owner.slug).toLowerCase()))
    );
  }
  if (input.ownerCollection === 'faculty_members') {
    const userId = normalizeObservationRepairObjectId(input.owner.userId);
    const keys = [input.owner.netid, input.owner.slug]
      .map((value) => stringValue(value).toLowerCase())
      .filter(Boolean);
    return (
      input.candidate.entityType === 'user' &&
      ((Boolean(userId) && candidateId === userId) ||
        (Boolean(candidateKey) && keys.includes(candidateKey)))
    );
  }
  if (input.ownerCollection === 'papers') {
    const keys = [input.owner.openAlexId, input.owner.arxivId, input.owner.doi]
      .map((value) => stringValue(value).toLowerCase())
      .filter(Boolean);
    return (
      input.candidate.entityType === 'paper' &&
      ((Boolean(ownerId) && candidateId === ownerId) ||
        (Boolean(candidateKey) && keys.includes(candidateKey)))
    );
  }
  if (input.ownerCollection === 'paper_authors') {
    const paperId = normalizeObservationRepairObjectId(input.owner.paperId);
    return input.candidate.entityType === 'paper' && Boolean(paperId) && candidateId === paperId;
  }
  if (input.ownerCollection === 'grants') {
    const entityIds = [
      ...(Array.isArray(input.owner.researchEntityIds) ? input.owner.researchEntityIds : []),
      ...(Array.isArray(input.owner.researchGroupIds) ? input.owner.researchGroupIds : []),
    ]
      .map(normalizeObservationRepairObjectId)
      .filter(Boolean);
    const externalId = stringValue(input.owner.externalId).toLowerCase();
    return (
      ['researchEntity', 'researchGroup'].includes(input.candidate.entityType) &&
      ((Boolean(candidateId) && entityIds.includes(candidateId)) ||
        (Boolean(candidateKey) && Boolean(externalId) && candidateKey === externalId))
    );
  }
  if (input.ownerCollection === 'research_entity_members') {
    const keys = [input.owner.membershipKey]
      .map((value) => stringValue(value).toLowerCase())
      .filter(Boolean);
    return (
      input.candidate.entityType === 'researchGroupMember' &&
      ((Boolean(ownerId) && candidateId === ownerId) ||
        (Boolean(candidateKey) && keys.includes(candidateKey)))
    );
  }
  if (input.ownerCollection === 'observations') {
    const ownerEntityId = normalizeObservationRepairObjectId(input.owner.entityId);
    const ownerEntityKey = stringValue(input.owner.entityKey).toLowerCase();
    return (
      input.candidate.entityType === stringValue(input.owner.entityType) &&
      ((Boolean(ownerEntityId) && candidateId === ownerEntityId) ||
        (Boolean(ownerEntityKey) && candidateKey === ownerEntityKey))
    );
  }
  return false;
}

function exactProvenanceCandidates(input: {
  occurrence: OrphanReferenceOccurrence;
  owner: Record<string, unknown>;
  ownerFieldValue?: unknown;
  candidates: OrphanReferenceObservationCandidate[];
}): OrphanReferenceObservationCandidate[] {
  const provenance = input.occurrence.provenance;
  if (!input.occurrence.referenceKey || !provenance?.sourceName) return [];
  const sourceName = provenance.sourceName.trim().toLowerCase();
  const sourceUrl = normalizeUrl(provenance.sourceUrl);

  return input.candidates.filter((candidate) => {
    if (candidate.field !== input.occurrence.referenceKey) return false;
    if (candidate.sourceName.trim().toLowerCase() !== sourceName) return false;
    if (sourceUrl && normalizeUrl(candidate.sourceUrl) !== sourceUrl) return false;
    if (
      !subjectsMatch({
        ownerCollection: input.occurrence.ownerCollection,
        ownerId: input.occurrence.ownerId,
        owner: input.owner,
        candidate,
      })
    ) {
      return false;
    }
    return valuesMatch(input.ownerFieldValue, candidate.value);
  });
}

function exactSupersessionCandidates(input: {
  occurrence: OrphanReferenceOccurrence;
  owner: Record<string, unknown>;
  candidates: OrphanReferenceObservationCandidate[];
}): OrphanReferenceObservationCandidate[] {
  const ownerSourceName = stringValue(input.owner.sourceName).toLowerCase();
  const ownerSourceUrl = normalizeUrl(input.owner.sourceUrl);
  const ownerObservedAt = new Date(String(input.owner.observedAt || 0)).getTime();
  return input.candidates.filter((candidate) => {
    if (candidate.id === input.occurrence.ownerId) return false;
    if (candidate.field !== stringValue(input.owner.field)) return false;
    if (candidate.sourceName.trim().toLowerCase() !== ownerSourceName) return false;
    if (ownerSourceUrl && normalizeUrl(candidate.sourceUrl) !== ownerSourceUrl) return false;
    if (!valuesMatch(input.owner.value, candidate.value)) return false;
    if (
      !subjectsMatch({
        ownerCollection: 'observations',
        ownerId: input.occurrence.ownerId,
        owner: input.owner,
        candidate,
      })
    ) {
      return false;
    }
    const candidateObservedAt = new Date(String(candidate.observedAt || 0)).getTime();
    return Number.isFinite(candidateObservedAt) && candidateObservedAt >= ownerObservedAt;
  });
}

export function classifyOrphanReference(input: {
  occurrence: OrphanReferenceOccurrence;
  owner: Record<string, unknown>;
  ownerFieldValue?: unknown;
  candidates: OrphanReferenceObservationCandidate[];
  candidatesExhaustive?: boolean;
  currentMaterializationEvidenceIds?: string[];
  materializationReplacesOwner?: boolean;
  dbFingerprint: string;
}): OrphanReferenceClassification {
  const { occurrence } = input;
  const handle = buildOrphanReferenceHandle(occurrence, input.dbFingerprint);

  if (occurrence.ownerCollection === 'observations' && occurrence.field === 'supersededBy') {
    const exact = exactSupersessionCandidates(input);
    if (input.candidatesExhaustive === false) {
      return {
        ...occurrence,
        handle,
        recovery: 'review_required',
        reason: 'The bounded candidate query cannot prove the supersession candidate is unique.',
        candidateCount: exact.length,
        recommendedDecision: 'defer_review',
      };
    }
    if (exact.length === 1) {
      return {
        ...occurrence,
        handle,
        recovery: 'deterministic_relink',
        reason:
          'One surviving Observation matches subject, field, source, value, and supersession time.',
        replacementObservationId: exact[0].id,
        candidateCount: 1,
        recommendedDecision: 'relink',
      };
    }
    if (occurrence.activity === 'archived') {
      return {
        ...occurrence,
        handle,
        recovery: 'record_archived_loss',
        reason:
          'No exact successor remains; preserve the historical Observation, remove only the dangling pointer, and record the loss.',
        candidateCount: exact.length,
        recommendedDecision: 'record_loss',
      };
    }
    return {
      ...occurrence,
      handle,
      recovery: 'review_required',
      reason:
        exact.length > 1
          ? 'Multiple exact supersession candidates remain.'
          : 'No exact supersession candidate remains.',
      candidateCount: exact.length,
      recommendedDecision: 'defer_review',
    };
  }

  if (occurrence.referenceKey) {
    const exact = exactProvenanceCandidates(input);
    if (input.candidatesExhaustive === false) {
      return {
        ...occurrence,
        handle,
        recovery: 'review_required',
        reason: 'The bounded candidate query cannot prove the provenance candidate is unique.',
        candidateCount: exact.length,
        recommendedDecision: 'defer_review',
      };
    }
    if (exact.length === 1) {
      return {
        ...occurrence,
        handle,
        recovery: 'deterministic_relink',
        reason:
          'One surviving Observation matches the owner subject, provenance field, source, and exact value.',
        replacementObservationId: exact[0].id,
        candidateCount: 1,
        recommendedDecision: 'relink',
      };
    }
    if (occurrence.activity === 'archived') {
      return {
        ...occurrence,
        handle,
        recovery: 'record_archived_loss',
        reason:
          'No unique source-equivalent Observation remains; preserve the archived owner, remove only the dangling pointer, and record the loss.',
        candidateCount: exact.length,
        recommendedDecision: 'record_loss',
      };
    }
    return {
      ...occurrence,
      handle,
      recovery: 'review_required',
      reason:
        exact.length > 1
          ? 'Multiple source-equivalent provenance candidates remain.'
          : 'No source-equivalent provenance candidate remains.',
      candidateCount: exact.length,
      recommendedDecision: ARCHIVABLE_REFERENCE_COLLECTIONS.has(occurrence.ownerCollection)
        ? 'archive_owner'
        : 'defer_review',
    };
  }

  if (occurrence.activity === 'archived') {
    return {
      ...occurrence,
      handle,
      recovery: 'record_archived_loss',
      reason:
        'Preserve the archived owner, remove only the dangling pointer, and record the unrecoverable evidence loss.',
      candidateCount: 0,
      recommendedDecision: 'record_loss',
    };
  }

  const materializedEvidenceIds = (input.currentMaterializationEvidenceIds || [])
    .map(normalizeObservationRepairObjectId)
    .filter((id): id is string => Boolean(id));
  if (occurrence.ownerClaimType && materializedEvidenceIds.length > 0) {
    return {
      ...occurrence,
      handle,
      recovery: 'rematerialize_logistics',
      reason:
        'The current logistics materializer derives the same claim from surviving source evidence.',
      candidateCount: materializedEvidenceIds.length,
      recommendedDecision: 'rematerialize',
    };
  }
  if (
    ACCESS_REFERENCE_COLLECTIONS.has(occurrence.ownerCollection) &&
    materializedEvidenceIds.length > 0
  ) {
    return {
      ...occurrence,
      handle,
      recovery: 'rematerialize_access',
      reason: input.materializationReplacesOwner
        ? 'The current access materializer derives a canonical semantic replacement from surviving source evidence.'
        : 'The current access materializer derives the same owner from surviving source evidence.',
      rematerializationMode: input.materializationReplacesOwner
        ? 'replace_legacy_owner'
        : 'refresh_owner',
      candidateCount: materializedEvidenceIds.length,
      recommendedDecision: 'rematerialize',
    };
  }

  return {
    ...occurrence,
    handle,
    recovery: 'review_required',
    reason:
      'No deterministic source-equivalent relink or current materialization result is available.',
    candidateCount: 0,
    recommendedDecision: ARCHIVABLE_REFERENCE_COLLECTIONS.has(occurrence.ownerCollection)
      ? 'archive_owner'
      : 'defer_review',
  };
}

export function buildOrphanReferenceArtifact(input: {
  generatedAt: Date;
  dbFingerprint: string;
  limitPerReference: number;
  rows: OrphanReferenceClassification[];
}): OrphanReferenceArtifact {
  const scopeCounts = new Map<string, number>();
  for (const row of input.rows) {
    const key = `${row.ownerCollection}\u0000${row.field}`;
    scopeCounts.set(key, (scopeCounts.get(key) || 0) + 1);
  }
  const referenceScopes = Array.from(scopeCounts.entries())
    .map(([key, classified]) => {
      const [ownerCollection, field] = key.split('\u0000');
      return {
        ownerCollection,
        field,
        classified,
        possiblyTruncated: classified >= input.limitPerReference,
      };
    })
    .sort(
      (left, right) =>
        left.ownerCollection.localeCompare(right.ownerCollection) ||
        left.field.localeCompare(right.field),
    );
  const withoutHash = {
    artifactType: 'orphaned-observation-reference-repair' as const,
    artifactVersion: 1 as const,
    classification: 'PRIVATE' as const,
    generatedAt: input.generatedAt.toISOString(),
    environment: 'development' as const,
    dbFingerprint: input.dbFingerprint,
    limitPerReference: input.limitPerReference,
    referenceScopes,
    rows: input.rows,
  };
  return {
    ...withoutHash,
    artifactHash: observationRepairFingerprint(withoutHash),
  };
}

export function validateOrphanReferenceArtifact(
  artifact: OrphanReferenceArtifact,
  expectedDbFingerprint: string,
  now = new Date(),
): void {
  if (!artifact || typeof artifact !== 'object' || !Array.isArray(artifact.rows)) {
    throw new Error('Apply artifact must contain a rows array.');
  }
  if (
    artifact.artifactType !== 'orphaned-observation-reference-repair' ||
    artifact.artifactVersion !== 1
  ) {
    throw new Error('Apply artifact has an unsupported type or version.');
  }
  if (artifact.classification !== 'PRIVATE' || artifact.environment !== 'development') {
    throw new Error('Apply artifact must be a private Development classifier artifact.');
  }
  if (!expectedDbFingerprint || artifact.dbFingerprint !== expectedDbFingerprint) {
    throw new Error(
      'Apply artifact database target does not match the guarded Development target.',
    );
  }
  const generatedAt = new Date(artifact.generatedAt).getTime();
  if (
    !Number.isFinite(generatedAt) ||
    generatedAt > now.getTime() ||
    now.getTime() - generatedAt > MAX_ARTIFACT_AGE_MS
  ) {
    throw new Error('Apply artifact is stale; regenerate and review the classifier.');
  }
  const { artifactHash: _artifactHash, ...withoutHash } = artifact;
  if (artifact.artifactHash !== observationRepairFingerprint(withoutHash)) {
    throw new Error('Apply artifact hash does not match its contents.');
  }
  const handles = artifact.rows.map((row) => row.handle);
  if (new Set(handles).size !== handles.length) {
    throw new Error('Apply artifact contains duplicate repair handles.');
  }
}

export function validateOrphanReferenceDecisions(input: {
  artifact: OrphanReferenceArtifact;
  envelope: OrphanReferenceDecisionEnvelope;
  maxApply: number;
}): ValidatedOrphanReferenceDecision[] {
  if (!input.envelope || !Array.isArray(input.envelope.decisions)) {
    throw new Error('Decision artifact must contain a decisions array.');
  }
  if (input.envelope.artifactHash !== input.artifact.artifactHash) {
    throw new Error('Decision artifact hash does not match the reviewed classifier artifact.');
  }
  const rowByHandle = new Map(input.artifact.rows.map((row) => [row.handle, row]));
  const seen = new Set<string>();
  const accepted: ValidatedOrphanReferenceDecision[] = [];

  for (const decision of input.envelope.decisions) {
    if (!decision.handle || seen.has(decision.handle)) {
      throw new Error('Decision artifact contains a missing or duplicate repair handle.');
    }
    seen.add(decision.handle);
    const classification = rowByHandle.get(decision.handle);
    if (!classification) throw new Error('Decision artifact references an unknown repair handle.');
    if (typeof decision.reviewedBy !== 'string' || !decision.reviewedBy.trim()) {
      throw new Error('Every repair decision requires reviewedBy.');
    }

    const allowed = allowedDecisionsForClassification(classification);
    if (!allowed.has(decision.decision)) {
      throw new Error(
        `Decision ${decision.decision} is not allowed for ${classification.recovery}.`,
      );
    }
    if (decision.decision !== 'defer_review') {
      accepted.push({ ...decision, reviewedBy: decision.reviewedBy.trim(), classification });
    }
  }

  if (accepted.length > input.maxApply) {
    throw new Error(
      `Reviewed artifact would apply ${accepted.length} decisions, above --max-apply.`,
    );
  }
  return accepted;
}

function allowedDecisionsForClassification(
  classification: OrphanReferenceClassification,
): Set<OrphanReferenceDecision> {
  const common = new Set<OrphanReferenceDecision>(['defer_review']);
  if (classification.recovery === 'deterministic_relink') common.add('relink');
  if (
    classification.recovery === 'rematerialize_access' ||
    classification.recovery === 'rematerialize_logistics'
  ) {
    common.add('rematerialize');
  }
  if (classification.recovery === 'record_archived_loss') common.add('record_loss');
  if (
    classification.recovery === 'review_required' &&
    ARCHIVABLE_REFERENCE_COLLECTIONS.has(classification.ownerCollection)
  ) {
    common.add('archive_owner');
  }
  return common;
}

export function buildOrphanReferenceDecisionTemplate(
  artifact: OrphanReferenceArtifact,
): OrphanReferenceDecisionEnvelope {
  return {
    artifactHash: artifact.artifactHash,
    decisions: artifact.rows.map((row) => ({
      handle: row.handle,
      decision: row.recommendedDecision,
      reviewedBy: '',
      reviewNote: '',
    })),
  };
}

export function buildDirectReferenceAggregationPipeline(
  spec: ObservationReferenceSpec,
  limit: number,
): Record<string, unknown>[] {
  return [
    { $match: { [spec.field]: { $exists: true, $ne: null } } },
    { $set: { __owner: '$$ROOT' } },
    {
      $project: {
        __owner: 1,
        __wasArray: { $isArray: `$${spec.field}` },
        __refs: {
          $cond: [{ $isArray: `$${spec.field}` }, `$${spec.field}`, [`$${spec.field}`]],
        },
      },
    },
    { $unwind: { path: '$__refs', includeArrayIndex: '__arrayIndex' } },
    { $match: { __refs: { $type: 'objectId' } } },
    {
      $lookup: {
        from: 'observations',
        localField: '__refs',
        foreignField: '_id',
        as: '__observation',
      },
    },
    { $match: { '__observation.0': { $exists: false } } },
    { $limit: limit },
    {
      $project: {
        _id: 0,
        owner: '$__owner',
        missingObservationId: '$__refs',
        arrayIndex: { $cond: ['$__wasArray', '$__arrayIndex', '$$REMOVE'] },
      },
    },
  ];
}

export function buildProvenanceReferenceAggregationPipeline(
  spec: ObservationReferenceSpec,
  limit: number,
): Record<string, unknown>[] {
  return [
    { $match: { [spec.field]: { $type: 'object' } } },
    { $set: { __owner: '$$ROOT', __provenance: { $objectToArray: `$${spec.field}` } } },
    { $unwind: '$__provenance' },
    { $match: { '__provenance.v.observationId': { $type: 'objectId' } } },
    {
      $lookup: {
        from: 'observations',
        localField: '__provenance.v.observationId',
        foreignField: '_id',
        as: '__observation',
      },
    },
    { $match: { '__observation.0': { $exists: false } } },
    { $limit: limit },
    {
      $project: {
        _id: 0,
        owner: '$__owner',
        missingObservationId: '$__provenance.v.observationId',
        referenceKey: '$__provenance.k',
        provenance: '$__provenance.v',
      },
    },
  ];
}

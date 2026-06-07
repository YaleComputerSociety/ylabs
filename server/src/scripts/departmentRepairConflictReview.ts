import dotenv from 'dotenv';
import { writeFile } from 'node:fs/promises';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { Observation } from '../models/observation';
import { ResearchEntity } from '../models/researchEntity';
import { ScrapeRun } from '../models/scrapeRun';
import {
  resolveAllFields,
  type ResolverObservation,
  type ResolvedField,
} from '../scrapers/confidenceResolver';
import { shouldUnionMaterializedField } from '../scrapers/entityMaterializer';
import {
  planStudentVisibilityGate,
  type StudentVisibilityGatePlan,
} from '../services/studentVisibilityGateService';

dotenv.config();

export type DepartmentRepairConflictReviewBucket =
  | 'parser_bug'
  | 'lead_repair'
  | 'program_contact_lead_repair'
  | 'safe_existing_value'
  | 'timestamp_noise'
  | 'needs_operator_review';

export interface DepartmentRepairReviewObservation {
  entityType?: string;
  entityId?: string;
  entityKey?: string;
  field: string;
  value: unknown;
  sourceName: string;
  confidence: number;
  sourceUrl?: string;
  observedAt: Date | string;
}

export interface DepartmentRepairReviewEntity {
  recordId: string;
  slug?: string;
  label: string;
  entityType?: string;
  kind?: string;
  currentTier?: string;
  manuallyLockedFields?: string[];
  confidenceByField?: Record<string, number>;
  currentValues?: Record<string, unknown>;
}

export interface DepartmentRepairConflictReviewRow {
  bucket: DepartmentRepairConflictReviewBucket;
  entityKey: string;
  recordId?: string;
  label?: string;
  entityType?: string;
  kind?: string;
  currentTier?: string;
  field: string;
  winningValue?: unknown;
  conflictingValues: unknown[];
  contributingSources: string[];
  sourceUrls: string[];
  reasons: string[];
  recommendedAction: string;
}

export interface DepartmentRepairConflictReviewReport {
  generatedAt: string;
  run: {
    id: string;
    sourceName?: string;
    observationCount?: number;
    materializationConflicts?: number;
    materializationErrors?: number;
  };
  totals: {
    observations: number;
    entities: number;
    conflictingFields: number;
    affectedEntities: number;
    parserBugRows: number;
    leadRepairRows: number;
    programContactLeadRepairRows: number;
    safeExistingValueRows: number;
    timestampNoiseRows: number;
    needsOperatorReviewRows: number;
  };
  buckets: Record<DepartmentRepairConflictReviewBucket, DepartmentRepairConflictReviewRow[]>;
  rows: DepartmentRepairConflictReviewRow[];
}

const RESEARCH_ENTITY_TYPES = new Set(['researchEntity', 'researchGroup']);
const MANUAL_SOURCE_NAMES = new Set(['manual', 'manual-admin-edit', 'manual-pi-edit']);
const LEAD_REPAIR_REASONS = new Set(['missing_lab_lead', 'missing_lead']);
const PROGRAM_CONTACT_LEAD_REPAIR_REASONS = new Set([
  'missing_program_action_route',
  'missing_program_contact',
  'missing_center_contact_route',
  'missing_contact_route',
  'missing_lead',
]);
const TIMESTAMP_NOISE_FIELDS = new Set([
  'createdat',
  'updatedat',
  'observedat',
  'lastobservedat',
  'lastscrapedat',
  'scrapedat',
]);

const uniqueStrings = (values: unknown[]): string[] =>
  Array.from(
    new Set(
      values
        .filter((value): value is string => typeof value === 'string')
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );

const normalizeKey = (value: unknown): string =>
  typeof value === 'string' ? value.trim().toLowerCase() : '';

const valueKey = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim().toLowerCase();
  return JSON.stringify(value);
};

const entityObservationKey = (observation: DepartmentRepairReviewObservation): string =>
  normalizeKey(observation.entityId) || normalizeKey(observation.entityKey);

const displayEntityKey = (
  observation: DepartmentRepairReviewObservation,
  entity?: DepartmentRepairReviewEntity,
): string => entity?.slug || observation.entityKey || observation.entityId || 'unknown-entity';

const entityTypeKey = (entity?: DepartmentRepairReviewEntity): string =>
  normalizeKey(entity?.entityType || entity?.kind);

function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((item) => collectStrings(item, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((item) => collectStrings(item, out));
  return out;
}

function isUrlishField(field: string): boolean {
  const normalized = normalizeKey(field);
  return normalized.includes('url') || normalized.includes('website') || normalized === 'sourceurls';
}

function isTimestampNoiseField(field: string): boolean {
  const normalized = normalizeKey(field).replace(/[_\-\s]/g, '');
  return TIMESTAMP_NOISE_FIELDS.has(normalized) || normalized.endsWith('timestamp');
}

function hasMalformedUrlLikeValue(value: unknown): boolean {
  return collectStrings(value).some((raw) => {
    const value = raw.trim();
    if (!value) return false;
    if (/%3c\s*a\b|%3ca%20href|<\s*a\b|<\/a>|href=/i.test(value)) return true;
    if (!/^https?:\/\//i.test(value)) return false;
    try {
      const url = new URL(value);
      return /%3c|%3e|<|>|\s/i.test(url.href);
    } catch {
      return true;
    }
  });
}

function sourceUrlsForField(
  observations: DepartmentRepairReviewObservation[],
  field: string,
): string[] {
  return uniqueStrings(
    observations
      .filter((observation) => observation.field === field)
      .flatMap((observation) => [observation.sourceUrl, ...(isUrlishField(field) ? collectStrings(observation.value) : [])]),
  );
}

function currentValueForField(entity: DepartmentRepairReviewEntity | undefined, field: string): unknown {
  return entity?.currentValues?.[field];
}

function classifyConflict(
  entity: DepartmentRepairReviewEntity | undefined,
  field: string,
  resolved: ResolvedField,
): DepartmentRepairConflictReviewBucket {
  if (isTimestampNoiseField(field)) {
    return 'timestamp_noise';
  }
  if (resolved.contributingSources.some((sourceName) => MANUAL_SOURCE_NAMES.has(sourceName))) {
    return 'safe_existing_value';
  }
  const fieldConfidence = entity?.confidenceByField?.[field];
  if (typeof fieldConfidence === 'number' && fieldConfidence > resolved.confidence) {
    return 'safe_existing_value';
  }
  const currentValue = currentValueForField(entity, field);
  if (
    currentValue !== undefined &&
    valueKey(currentValue) === valueKey(resolved.value) &&
    (fieldConfidence ?? 0) >= resolved.confidence
  ) {
    return 'safe_existing_value';
  }
  return 'needs_operator_review';
}

function actionForBucket(bucket: DepartmentRepairConflictReviewBucket): string {
  if (bucket === 'parser_bug') return 'Fix department link extraction and rerun before applying broader batches.';
  if (bucket === 'lead_repair') return 'Repair PI/lead evidence before promotion; do not weaken the lab gate.';
  if (bucket === 'program_contact_lead_repair') {
    return 'Repair the program contact, lead, or action route before promotion.';
  }
  if (bucket === 'safe_existing_value') return 'Keep the existing stronger value; document the lower-trust conflict if it repeats.';
  if (bucket === 'timestamp_noise') return 'Treat as scrape timestamp noise; do not route to operator review.';
  return 'Review the source-backed field conflict before applying more department repair writes.';
}

function makeBaseRow(input: {
  bucket: DepartmentRepairConflictReviewBucket;
  observation: DepartmentRepairReviewObservation;
  entity?: DepartmentRepairReviewEntity;
  field: string;
  winningValue?: unknown;
  conflictingValues?: unknown[];
  contributingSources?: string[];
  sourceUrls?: string[];
  reasons: string[];
}): DepartmentRepairConflictReviewRow {
  return {
    bucket: input.bucket,
    entityKey: displayEntityKey(input.observation, input.entity),
    recordId: input.entity?.recordId || input.observation.entityId,
    label: input.entity?.label,
    entityType: input.entity?.entityType,
    kind: input.entity?.kind,
    currentTier: input.entity?.currentTier,
    field: input.field,
    winningValue: input.winningValue,
    conflictingValues: input.conflictingValues || [],
    contributingSources: uniqueStrings(input.contributingSources || []),
    sourceUrls: uniqueStrings(input.sourceUrls || []),
    reasons: input.reasons,
    recommendedAction: actionForBucket(input.bucket),
  };
}

function rowKey(row: DepartmentRepairConflictReviewRow): string {
  return [
    row.bucket,
    row.recordId || row.entityKey,
    row.field,
    row.reasons.join(','),
    valueKey(row.winningValue),
  ].join('|');
}

function compareRows(
  a: DepartmentRepairConflictReviewRow,
  b: DepartmentRepairConflictReviewRow,
): number {
  const bucketOrder: Record<DepartmentRepairConflictReviewBucket, number> = {
    parser_bug: 0,
    lead_repair: 1,
    program_contact_lead_repair: 2,
    safe_existing_value: 3,
    timestamp_noise: 4,
    needs_operator_review: 5,
  };
  if (bucketOrder[a.bucket] !== bucketOrder[b.bucket]) return bucketOrder[a.bucket] - bucketOrder[b.bucket];
  const labelCompare = (a.label || a.entityKey).localeCompare(b.label || b.entityKey);
  if (labelCompare !== 0) return labelCompare;
  return a.field.localeCompare(b.field);
}

function isLabLeadRepairCandidate(entity: DepartmentRepairReviewEntity | undefined): boolean {
  const type = entityTypeKey(entity);
  return type === 'lab';
}

function isProgramContactLeadRepairCandidate(entity: DepartmentRepairReviewEntity | undefined): boolean {
  const type = entityTypeKey(entity);
  return type === 'program';
}

function matchingRepairReasons(plan: StudentVisibilityGatePlan, allowedReasons: Set<string>): string[] {
  return plan.reasons.filter((reason) => allowedReasons.has(reason));
}

export function buildDepartmentRepairConflictReviewReport(input: {
  run: DepartmentRepairConflictReviewReport['run'];
  observations: DepartmentRepairReviewObservation[];
  resolverObservations?: DepartmentRepairReviewObservation[];
  entities: DepartmentRepairReviewEntity[];
  visibilityPlans?: StudentVisibilityGatePlan[];
  generatedAt?: string;
}): DepartmentRepairConflictReviewReport {
  const researchObservations = input.observations.filter((observation) =>
    RESEARCH_ENTITY_TYPES.has(observation.entityType || 'researchEntity'),
  );
  const conflictObservations = (input.resolverObservations || input.observations).filter((observation) =>
    RESEARCH_ENTITY_TYPES.has(observation.entityType || 'researchEntity'),
  );
  const entitiesById = new Map(input.entities.map((entity) => [normalizeKey(entity.recordId), entity]));
  const entitiesBySlug = new Map(
    input.entities
      .filter((entity) => entity.slug)
      .map((entity) => [normalizeKey(entity.slug), entity]),
  );
  const groupKeyForObservation = (observation: DepartmentRepairReviewObservation): string => {
    const entity =
      entitiesById.get(normalizeKey(observation.entityId)) ||
      entitiesBySlug.get(normalizeKey(observation.entityKey));
    return normalizeKey(entity?.recordId) || entityObservationKey(observation);
  };
  const rowsByKey = new Map<string, DepartmentRepairConflictReviewRow>();
  const runObservationsByEntity = new Map<string, DepartmentRepairReviewObservation[]>();
  const conflictObservationsByEntity = new Map<string, DepartmentRepairReviewObservation[]>();

  for (const observation of researchObservations) {
    const key = groupKeyForObservation(observation);
    if (!key) continue;
    runObservationsByEntity.set(key, [...(runObservationsByEntity.get(key) || []), observation]);
  }
  for (const observation of conflictObservations) {
    const key = groupKeyForObservation(observation);
    if (!key) continue;
    conflictObservationsByEntity.set(key, [...(conflictObservationsByEntity.get(key) || []), observation]);
  }

  const addRow = (row: DepartmentRepairConflictReviewRow) => {
    rowsByKey.set(rowKey(row), row);
  };

  for (const observations of conflictObservationsByEntity.values()) {
    const first = runObservationsByEntity.get(groupKeyForObservation(observations[0]))?.[0] || observations[0];
    const entity =
      entitiesById.get(normalizeKey(first.entityId)) ||
      entitiesBySlug.get(normalizeKey(first.entityKey));
    const resolverObservations: ResolverObservation[] = observations.map((observation) => ({
      field: observation.field,
      value: observation.value,
      sourceName: observation.sourceName,
      confidence: observation.confidence,
      observedAt:
        observation.observedAt instanceof Date ? observation.observedAt : new Date(observation.observedAt),
    }));
    const resolved = resolveAllFields(resolverObservations, {
      manuallyLockedFields: entity?.manuallyLockedFields,
      manualValues: entity?.currentValues,
    });

    for (const observation of runObservationsByEntity.get(groupKeyForObservation(first)) || []) {
      if (!isUrlishField(observation.field)) continue;
      if (!hasMalformedUrlLikeValue(observation.value) && !hasMalformedUrlLikeValue(observation.sourceUrl)) continue;
      addRow(
        makeBaseRow({
          bucket: 'parser_bug',
          observation,
          entity,
          field: observation.field,
          winningValue: observation.value,
          conflictingValues: [],
          contributingSources: [observation.sourceName],
          sourceUrls: uniqueStrings([observation.sourceUrl, ...collectStrings(observation.value)]),
          reasons: ['malformed_url_or_embedded_html'],
        }),
      );
    }

    for (const [field, resolvedField] of Object.entries(resolved)) {
      if (!resolvedField.hasConflict) continue;
      if (shouldUnionMaterializedField('researchEntity', field)) continue;
      const bucket = classifyConflict(entity, field, resolvedField);
      addRow(
        makeBaseRow({
          bucket,
          observation: first,
          entity,
          field,
          winningValue: resolvedField.value,
          conflictingValues: resolvedField.conflictingValues || [],
          contributingSources: resolvedField.contributingSources,
          sourceUrls: sourceUrlsForField(observations, field),
          reasons: bucket === 'timestamp_noise' ? ['timestamp_or_noise_conflict'] : ['materialization_field_conflict'],
        }),
      );
    }
  }

  const touchedRecordIds = new Set(input.entities.map((entity) => entity.recordId));
  const firstObservationByRecordId = new Map<string, DepartmentRepairReviewObservation>();
  for (const observations of runObservationsByEntity.values()) {
    const first = observations[0];
    const entity =
      entitiesById.get(normalizeKey(first.entityId)) ||
      entitiesBySlug.get(normalizeKey(first.entityKey));
    if (entity?.recordId && !firstObservationByRecordId.has(entity.recordId)) {
      firstObservationByRecordId.set(entity.recordId, first);
    }
  }

  for (const plan of input.visibilityPlans || []) {
    if (!touchedRecordIds.has(plan.recordId)) continue;
    const entity = entitiesById.get(normalizeKey(plan.recordId));
    const labLeadRepairReasons = matchingRepairReasons(plan, LEAD_REPAIR_REASONS);
    const programContactLeadRepairReasons = matchingRepairReasons(plan, PROGRAM_CONTACT_LEAD_REPAIR_REASONS);
    const isLabLeadRepair = isLabLeadRepairCandidate(entity) && labLeadRepairReasons.length > 0;
    const isProgramContactLeadRepair =
      isProgramContactLeadRepairCandidate(entity) && programContactLeadRepairReasons.length > 0;
    if (!isLabLeadRepair && !isProgramContactLeadRepair) continue;
    const observation =
      firstObservationByRecordId.get(plan.recordId) ||
      ({
        entityType: 'researchEntity',
        entityId: plan.recordId,
        entityKey: plan.slug,
        field: isProgramContactLeadRepair ? 'contactRoute' : 'lead',
        value: undefined,
        sourceName: 'student-visibility-gate',
        confidence: 1,
        observedAt: new Date(),
      } satisfies DepartmentRepairReviewObservation);
    addRow(
      makeBaseRow({
        bucket: isProgramContactLeadRepair ? 'program_contact_lead_repair' : 'lead_repair',
        observation,
        entity,
        field: isProgramContactLeadRepair ? 'contactRoute' : 'lead',
        conflictingValues: [],
        contributingSources: plan.sourceNames,
        sourceUrls: sourceUrlsForField(runObservationsByEntity.get(groupKeyForObservation(observation)) || [], 'sourceUrls'),
        reasons: isProgramContactLeadRepair ? programContactLeadRepairReasons : labLeadRepairReasons,
      }),
    );
  }

  const rows = Array.from(rowsByKey.values()).sort(compareRows);
  const affectedEntities = new Set(rows.map((row) => row.recordId || row.entityKey));
  const buckets: Record<DepartmentRepairConflictReviewBucket, DepartmentRepairConflictReviewRow[]> = {
    parser_bug: rows.filter((row) => row.bucket === 'parser_bug'),
    lead_repair: rows.filter((row) => row.bucket === 'lead_repair'),
    program_contact_lead_repair: rows.filter((row) => row.bucket === 'program_contact_lead_repair'),
    safe_existing_value: rows.filter((row) => row.bucket === 'safe_existing_value'),
    timestamp_noise: rows.filter((row) => row.bucket === 'timestamp_noise'),
    needs_operator_review: rows.filter((row) => row.bucket === 'needs_operator_review'),
  };

  return {
    generatedAt: input.generatedAt || new Date().toISOString(),
    run: input.run,
    totals: {
      observations: researchObservations.length,
      entities: runObservationsByEntity.size,
      conflictingFields: rows.filter((row) => row.reasons.includes('materialization_field_conflict')).length,
      affectedEntities: affectedEntities.size,
      parserBugRows: buckets.parser_bug.length,
      leadRepairRows: buckets.lead_repair.length,
      programContactLeadRepairRows: buckets.program_contact_lead_repair.length,
      safeExistingValueRows: buckets.safe_existing_value.length,
      timestampNoiseRows: buckets.timestamp_noise.length,
      needsOperatorReviewRows: buckets.needs_operator_review.length,
    },
    buckets,
    rows,
  };
}

async function loadEntitiesForObservations(
  observations: DepartmentRepairReviewObservation[],
): Promise<DepartmentRepairReviewEntity[]> {
  const ids = uniqueStrings(observations.map((observation) => observation.entityId)).filter((id) =>
    mongoose.Types.ObjectId.isValid(id),
  );
  const slugs = uniqueStrings(observations.map((observation) => observation.entityKey));
  const fields = uniqueStrings(observations.map((observation) => observation.field));
  const selectFields = uniqueStrings([
    'slug',
    'name',
    'displayName',
    'entityType',
    'kind',
    'studentVisibilityTier',
    'manuallyLockedFields',
    'confidenceByField',
    'sourceUrls',
    'websiteUrl',
    'website',
    ...fields,
  ]).join(' ');
  const or: Record<string, unknown>[] = [];
  if (ids.length > 0) or.push({ _id: { $in: ids } });
  if (slugs.length > 0) or.push({ slug: { $in: slugs } });
  if (or.length === 0) return [];

  const docs = await ResearchEntity.find({ $or: or }).select(selectFields).lean();
  return (docs as any[]).map((doc) => {
    const currentValues: Record<string, unknown> = {};
    for (const field of fields) currentValues[field] = doc[field];
    return {
      recordId: String(doc._id),
      slug: doc.slug,
      label: doc.displayName || doc.name || doc.slug || String(doc._id),
      entityType: doc.entityType,
      kind: doc.kind,
      currentTier: doc.studentVisibilityTier,
      manuallyLockedFields: Array.isArray(doc.manuallyLockedFields) ? doc.manuallyLockedFields : [],
      confidenceByField: doc.confidenceByField || {},
      currentValues,
    };
  });
}

async function loadResolverObservationsForTouchedEntities(
  observations: DepartmentRepairReviewObservation[],
): Promise<DepartmentRepairReviewObservation[]> {
  const ids = uniqueStrings(observations.map((observation) => observation.entityId)).filter((id) =>
    mongoose.Types.ObjectId.isValid(id),
  );
  const slugs = uniqueStrings(observations.map((observation) => observation.entityKey));
  const or: Record<string, unknown>[] = [];
  if (ids.length > 0) or.push({ entityId: { $in: ids } });
  if (slugs.length > 0) or.push({ entityKey: { $in: slugs } });
  if (or.length === 0) return observations;

  const docs = await Observation.find({
    entityType: { $in: ['researchEntity', 'researchGroup'] },
    superseded: false,
    $or: or,
  })
    .select('entityType entityId entityKey field value sourceName confidence sourceUrl observedAt')
    .lean();

  return (docs as any[]).map((observation) => ({
    entityType: observation.entityType,
    entityId: observation.entityId ? String(observation.entityId) : undefined,
    entityKey: observation.entityKey,
    field: observation.field,
    value: observation.value,
    sourceName: observation.sourceName,
    confidence: observation.confidence,
    sourceUrl: observation.sourceUrl,
    observedAt: observation.observedAt,
  }));
}

export async function generateDepartmentRepairConflictReviewReport(
  runId: string,
): Promise<DepartmentRepairConflictReviewReport> {
  if (!mongoose.Types.ObjectId.isValid(runId)) {
    throw new Error('--run must be a valid ScrapeRun id');
  }
  const run = await ScrapeRun.findById(runId)
    .select('sourceName observationCount materializationConflicts materializationErrors')
    .lean();
  if (!run) throw new Error(`ScrapeRun not found: ${runId}`);

  const observations = await Observation.find({
    scrapeRunId: new mongoose.Types.ObjectId(runId),
    superseded: { $ne: true },
  })
    .select('entityType entityId entityKey field value sourceName confidence sourceUrl observedAt')
    .lean();
  const reviewObservations: DepartmentRepairReviewObservation[] = (observations as any[]).map((observation) => ({
    entityType: observation.entityType,
    entityId: observation.entityId ? String(observation.entityId) : undefined,
    entityKey: observation.entityKey,
    field: observation.field,
    value: observation.value,
    sourceName: observation.sourceName,
    confidence: observation.confidence,
    sourceUrl: observation.sourceUrl,
    observedAt: observation.observedAt,
  }));
  const entities = await loadEntitiesForObservations(reviewObservations);
  const resolverObservations = await loadResolverObservationsForTouchedEntities(reviewObservations);
  const recordIds = uniqueStrings(entities.map((entity) => entity.recordId));
  const visibilityPlans =
    recordIds.length > 0
      ? await planStudentVisibilityGate({ collection: 'research', mode: 'dry-run', recordIds } as any)
      : [];

  return buildDepartmentRepairConflictReviewReport({
    run: {
      id: String((run as any)._id),
      sourceName: (run as any).sourceName,
      observationCount: (run as any).observationCount,
      materializationConflicts: (run as any).materializationConflicts,
      materializationErrors: (run as any).materializationErrors,
    },
    observations: reviewObservations,
    resolverObservations,
    entities,
    visibilityPlans,
  });
}

function parseArgs(argv: string[]): { runId: string; output?: string } {
  const options: { runId?: string; output?: string } = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg.startsWith('--run=')) {
      options.runId = arg.slice('--run='.length).trim();
    } else if (arg === '--run') {
      index += 1;
      options.runId = argv[index]?.trim();
      if (!options.runId || options.runId.startsWith('--')) throw new Error('--run requires a scrape run id');
    } else if (arg.startsWith('--output=')) {
      options.output = arg.slice('--output='.length).trim();
    } else if (arg === '--output') {
      index += 1;
      options.output = argv[index]?.trim();
      if (!options.output || options.output.startsWith('--')) throw new Error('--output requires a file path');
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!options.runId) throw new Error('--run is required');
  if (options.output === '') delete options.output;
  return { runId: options.runId, output: options.output };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  await initializeConnections();
  const report = await generateDepartmentRepairConflictReviewReport(options.runId);
  const json = JSON.stringify(report, null, 2);
  if (options.output) await writeFile(options.output, `${json}\n`, 'utf8');
  console.log(json);
}

if (process.argv[1] && pathMatchesScript(process.argv[1], 'departmentRepairConflictReview.ts')) {
  main()
    .catch((error) => {
      console.error('Failed to generate department repair conflict review:', error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}

function pathMatchesScript(value: string, scriptName: string): boolean {
  return value.replace(/\\/g, '/').endsWith(`/scripts/${scriptName}`);
}

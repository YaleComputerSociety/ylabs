import dotenv from 'dotenv';
import fs from 'fs';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeConnections } from '../db/connections';
import {
  resolveField,
  type ResolverObservation,
} from '../scrapers/confidenceResolver';
import { redactDirectContactInfo } from '../utils/contactRedaction';
import { serializedDocumentId } from '../utils/idSerialization';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import { sanitizeLogValue } from '../utils/logSanitizer';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const DEFAULT_LIMIT = 500;
const DEFAULT_SAMPLE_SIZE = 20;
const DEFAULT_PLAN_LIMIT = 100;
const MAX_VALUE_PREVIEW_LENGTH = 240;
const APPLY_BLOCKED_REASON =
  'Apply mode is intentionally unavailable until cross-source conflict plans are reviewed and a guarded source-precedence or field-policy path is implemented.';

export type CrossSourceObservationReviewQueue =
  | 'priority_review'
  | 'context_review'
  | 'metadata_review';

export type CrossSourceObservationReviewCategory =
  | 'identity_or_routing'
  | 'access_evidence'
  | 'content'
  | 'funding_context'
  | 'additive_metadata'
  | 'other';

export type CrossSourceObservationPolicyBucket =
  | 'description_policy_review'
  | 'name_precedence_review'
  | 'routing_or_entity_type_review'
  | 'access_evidence_policy_review'
  | 'metadata_merge_policy_review'
  | 'funding_context_policy_review'
  | 'manual_source_precedence_review';

export interface CrossSourceObservationConflictReviewArgs {
  sourceName?: string;
  reviewQueue?: CrossSourceObservationReviewQueue;
  reviewCategory?: CrossSourceObservationReviewCategory;
  field?: string;
  limit: number;
  sampleSize: number;
  planLimit: number;
  acceptedDecisions?: string;
  allowEmptyDecisions?: boolean;
  decisionTemplateOutput?: string;
  output?: string;
}

export interface CrossSourceObservationConflictObservation {
  id: string;
  sourceName: string;
  value: unknown;
  observedAt?: Date | string;
  sourceUrl?: string;
  confidence?: number;
}

export interface CrossSourceObservationConflictGroup {
  entityType: string;
  entityId?: string;
  entityKey?: string;
  field: string;
  observations: CrossSourceObservationConflictObservation[];
}

export interface CrossSourceObservationValuePreview {
  sourceName: string;
  observationIds: string[];
  valuePreviews: string[];
}

export interface CrossSourceObservationConflictSample {
  entityType: string;
  entityId?: string;
  entityKey?: string;
  field: string;
  reviewCategory: CrossSourceObservationReviewCategory;
  reviewQueue: CrossSourceObservationReviewQueue;
  policyBucket: CrossSourceObservationPolicyBucket;
  sourceConflictScope: 'cross_source';
  activeObservationCount: number;
  distinctValueCount: number;
  sourceNames: string[];
  resolvedConfidence: number;
  contributingSources: string[];
  conflictingValuePreviews: string[];
  valuePreviewsBySource: CrossSourceObservationValuePreview[];
}

export interface CrossSourceObservationConflictPlan {
  planId: string;
  entityType: string;
  entityId?: string;
  entityKey?: string;
  field: string;
  reviewCategory: CrossSourceObservationReviewCategory;
  reviewQueue: CrossSourceObservationReviewQueue;
  policyBucket: CrossSourceObservationPolicyBucket;
  sourceNames: string[];
  contributingSources: string[];
  observationIdsBySource: Array<{
    sourceName: string;
    observationIds: string[];
  }>;
  proposedAction: 'review_source_precedence_or_field_policy';
  applyBlocked: true;
  applyBlockedReason: string;
}

export interface CrossSourceObservationReviewDecision {
  planId: string;
  decision: string;
  preferredSourceName?: string;
  sourceNames?: string[];
  observationIdsBySource?: Array<{
    sourceName: string;
    observationIds: string[];
  }>;
  reviewedBy?: string;
  reviewNote?: string;
}

export interface CrossSourceObservationReviewDecisionValidationRow {
  planId: string;
  decision: string;
  preferredSourceName?: string;
  sourceNames?: string[];
  observationIdsBySource?: Array<{
    sourceName: string;
    observationIds: string[];
  }>;
  reviewedBy?: string;
  status: 'valid' | 'invalid';
  errors: string[];
}

export interface CrossSourceObservationReviewDecisionValidationSummary {
  artifactPath?: string;
  applyBlocked: true;
  applyBlockedReason: string;
  totalDecisions: number;
  validDecisionCount: number;
  invalidDecisionCount: number;
  unmatchedPlanDecisionCount: number;
  duplicatePlanDecisionCount: number;
  unreviewedPlanCount: number;
  decisionsByType: Array<{ decision: string; count: number }>;
  decisions: CrossSourceObservationReviewDecisionValidationRow[];
}

export interface CrossSourceObservationDecisionTemplate {
  generatedAt: string;
  applyBlocked: true;
  applyBlockedReason: string;
  acceptedDecisionValues: ['prefer_source', 'accept_current_resolver', 'defer_review'];
  decisions: Array<{
    planId: string;
    entityType: string;
    entityId?: string;
    entityKey?: string;
    field: string;
    reviewCategory: CrossSourceObservationReviewCategory;
    reviewQueue: CrossSourceObservationReviewQueue;
    policyBucket: CrossSourceObservationPolicyBucket;
    sourceNames: string[];
    contributingSources: string[];
    observationIdsBySource: Array<{
      sourceName: string;
      observationIds: string[];
    }>;
    proposedAction: 'review_source_precedence_or_field_policy';
    decision: '';
    preferredSourceName: '';
    reviewedBy: '';
    reviewNote: '';
  }>;
}

export interface CrossSourceObservationConflictSummary {
  generatedAt: string;
  mode: 'dry-run';
  applyBlocked: true;
  sourceName?: string;
  reviewQueue?: CrossSourceObservationReviewQueue;
  reviewCategory?: CrossSourceObservationReviewCategory;
  field?: string;
  limit: number;
  sampleSize: number;
  planLimit: number;
  groupsScanned: number;
  candidateGroups: number;
  plannedGroups: number;
  planTruncated: boolean;
  priorityReviewCandidateGroups: number;
  contextReviewCandidateGroups: number;
  metadataReviewCandidateGroups: number;
  categoryCounts: Array<{ category: CrossSourceObservationReviewCategory; count: number }>;
  fieldCounts: Array<{ field: string; count: number }>;
  sourcePairCounts: Array<{ sourcePair: string[]; count: number }>;
  policyBucketCounts: Array<{ policyBucket: CrossSourceObservationPolicyBucket; count: number }>;
  reviewQueues: Array<{
    queue: CrossSourceObservationReviewQueue;
    label: string;
    count: number;
    categories: Array<{ category: CrossSourceObservationReviewCategory; count: number }>;
  }>;
  sampledGroups: number;
  samples: CrossSourceObservationConflictSample[];
  plans: CrossSourceObservationConflictPlan[];
  reviewDecisionValidation?: CrossSourceObservationReviewDecisionValidationSummary;
  nextAction: string;
}

interface AggregatedCrossSourceObservationConflictGroup {
  _id: {
    entityType?: string;
    entityId?: unknown;
    entityKey?: string;
    field?: string;
  };
  observations?: Array<{
    id?: unknown;
    sourceName?: string;
    value?: unknown;
    observedAt?: Date | string;
    sourceUrl?: string;
    confidence?: number;
  }>;
}

const ADDITIVE_METADATA_CONFLICT_FIELDS = new Set([
  'sourceUrls',
  'profileUrls',
  'dataSources',
  'departments',
  'researchAreas',
  'fundingAgencies',
]);
const IDENTITY_OR_ROUTING_CONFLICT_FIELDS = new Set([
  'inferredPiUserId',
  'inferredPiUserKey',
  'websiteUrl',
  'profileUrl',
  'slug',
  'name',
  'kind',
  'entityType',
  'netid',
  'email',
  'fname',
  'lname',
  'title',
  'userType',
]);
const CONTENT_CONFLICT_FIELDS = new Set([
  'description',
  'fullDescription',
  'shortDescription',
]);
const ACCESS_EVIDENCE_CONFLICT_FIELDS = new Set([
  'undergradAccessEvidence',
  'undergradEvidenceQuote',
  'undergradRoleEvidenceQuote',
  'contactInstructionsQuote',
  'undergradConstraintQuote',
  'acceptingUndergrads',
  'contactEmail',
  'contactName',
  'contactRole',
  'joinPageUrl',
  'applicationUrl',
]);
const FUNDING_CONTEXT_CONFLICT_FIELDS = new Set([
  'recentGrants',
  'recentGrantCount',
]);

const PRIORITY_REVIEW_CATEGORIES = new Set<CrossSourceObservationReviewCategory>([
  'identity_or_routing',
  'access_evidence',
  'content',
]);
const METADATA_REVIEW_CATEGORIES = new Set<CrossSourceObservationReviewCategory>([
  'additive_metadata',
]);

const REVIEW_QUEUE_DEFINITIONS: Array<{
  queue: CrossSourceObservationReviewQueue;
  label: string;
}> = [
  {
    queue: 'priority_review',
    label: 'Identity, access, or student-facing content',
  },
  {
    queue: 'context_review',
    label: 'Funding or uncategorized context',
  },
  {
    queue: 'metadata_review',
    label: 'Additive metadata merge review',
  },
];

export function parseCrossSourceObservationConflictReviewArgs(
  argv: string[],
): CrossSourceObservationConflictReviewArgs {
  const args: CrossSourceObservationConflictReviewArgs = {
    limit: DEFAULT_LIMIT,
    sampleSize: DEFAULT_SAMPLE_SIZE,
    planLimit: DEFAULT_PLAN_LIMIT,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--apply') {
      throw new Error(
        'observations:cross-source-conflict-review apply mode is blocked; this command is read-only.',
      );
    }
    if (arg.startsWith('--source=')) {
      args.sourceName = parseRequiredString(arg.slice('--source='.length), '--source');
      continue;
    }
    if (arg === '--source') {
      const next = consumeValue(argv, index, '--source', 'a value');
      args.sourceName = parseRequiredString(next, '--source');
      index += 1;
      continue;
    }
    if (arg.startsWith('--queue=')) {
      args.reviewQueue = parseReviewQueue(arg.slice('--queue='.length));
      continue;
    }
    if (arg === '--queue') {
      const next = consumeValue(argv, index, '--queue', 'a value');
      args.reviewQueue = parseReviewQueue(next);
      index += 1;
      continue;
    }
    if (arg.startsWith('--category=')) {
      args.reviewCategory = parseReviewCategory(arg.slice('--category='.length));
      continue;
    }
    if (arg === '--category') {
      const next = consumeValue(argv, index, '--category', 'a value');
      args.reviewCategory = parseReviewCategory(next);
      index += 1;
      continue;
    }
    if (arg.startsWith('--field=')) {
      args.field = parseRequiredString(arg.slice('--field='.length), '--field');
      continue;
    }
    if (arg === '--field') {
      const next = consumeValue(argv, index, '--field', 'a value');
      args.field = parseRequiredString(next, '--field');
      index += 1;
      continue;
    }
    if (arg.startsWith('--limit=')) {
      args.limit = parsePositiveIntegerValue(arg.slice('--limit='.length), '--limit');
      continue;
    }
    if (arg === '--limit') {
      const next = consumeValue(argv, index, '--limit', 'a number');
      args.limit = parsePositiveIntegerValue(next, '--limit');
      index += 1;
      continue;
    }
    if (arg.startsWith('--sample-size=')) {
      args.sampleSize = parsePositiveIntegerValue(
        arg.slice('--sample-size='.length),
        '--sample-size',
      );
      continue;
    }
    if (arg === '--sample-size') {
      const next = consumeValue(argv, index, '--sample-size', 'a number');
      args.sampleSize = parsePositiveIntegerValue(next, '--sample-size');
      index += 1;
      continue;
    }
    if (arg.startsWith('--plan-limit=')) {
      args.planLimit = parsePositiveIntegerValue(
        arg.slice('--plan-limit='.length),
        '--plan-limit',
      );
      continue;
    }
    if (arg === '--plan-limit') {
      const next = consumeValue(argv, index, '--plan-limit', 'a number');
      args.planLimit = parsePositiveIntegerValue(next, '--plan-limit');
      index += 1;
      continue;
    }
    if (arg.startsWith('--accepted-decisions=')) {
      args.acceptedDecisions = resolveSafeJsonReportOutputPath(
        arg.slice('--accepted-decisions='.length),
        '--accepted-decisions',
      );
      continue;
    }
    if (arg === '--accepted-decisions') {
      const next = consumeValue(argv, index, '--accepted-decisions', 'a path');
      args.acceptedDecisions = resolveSafeJsonReportOutputPath(next, '--accepted-decisions');
      index += 1;
      continue;
    }
    if (arg === '--allow-empty-decisions') {
      args.allowEmptyDecisions = true;
      continue;
    }
    if (arg.startsWith('--decision-template-output=')) {
      args.decisionTemplateOutput = resolveSafeJsonReportOutputPath(
        arg.slice('--decision-template-output='.length),
        '--decision-template-output',
      );
      continue;
    }
    if (arg === '--decision-template-output') {
      const next = consumeValue(argv, index, '--decision-template-output', 'a path');
      args.decisionTemplateOutput = resolveSafeJsonReportOutputPath(
        next,
        '--decision-template-output',
      );
      index += 1;
      continue;
    }
    if (arg.startsWith('--output=')) {
      args.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
      continue;
    }
    if (arg === '--output') {
      const next = consumeValue(argv, index, '--output', 'a path');
      args.output = resolveSafeJsonReportOutputPath(next);
      index += 1;
      continue;
    }

    throw new Error(`Unknown cross-source observation conflict review option: ${arg}`);
  }

  return args;
}

export function buildCrossSourceObservationConflictSummary(input: {
  sourceName?: string;
  reviewQueue?: CrossSourceObservationReviewQueue;
  reviewCategory?: CrossSourceObservationReviewCategory;
  field?: string;
  limit: number;
  sampleSize: number;
  planLimit?: number;
  groups: CrossSourceObservationConflictGroup[];
}): CrossSourceObservationConflictSummary {
  const candidates = input.groups
    .map((group) => buildCandidateSample(group))
    .filter((sample): sample is CrossSourceObservationConflictSample => Boolean(sample))
    .filter((sample) => matchesReviewFilters(sample, input))
    .sort(compareSamplesForReview);

  const samples = candidates.slice(0, input.sampleSize);
  const planLimit = input.planLimit || DEFAULT_PLAN_LIMIT;
  const plans = candidates.slice(0, planLimit).map(buildConflictPlan);
  const categoryCounts = buildCategoryCounts(candidates);
  const fieldCounts = buildFieldCounts(candidates);
  const sourcePairCounts = buildSourcePairCounts(candidates);
  const policyBucketCounts = buildPolicyBucketCounts(candidates);
  const reviewQueues = buildReviewQueues(categoryCounts);
  const countForQueue = (queue: CrossSourceObservationReviewQueue): number =>
    reviewQueues.find((item) => item.queue === queue)?.count || 0;

  return {
    generatedAt: new Date().toISOString(),
    mode: 'dry-run',
    applyBlocked: true,
    sourceName: input.sourceName,
    reviewQueue: input.reviewQueue,
    reviewCategory: input.reviewCategory,
    field: input.field,
    limit: input.limit,
    sampleSize: input.sampleSize,
    planLimit,
    groupsScanned: input.groups.length,
    candidateGroups: candidates.length,
    plannedGroups: plans.length,
    planTruncated: candidates.length > plans.length,
    priorityReviewCandidateGroups: countForQueue('priority_review'),
    contextReviewCandidateGroups: countForQueue('context_review'),
    metadataReviewCandidateGroups: countForQueue('metadata_review'),
    categoryCounts,
    fieldCounts,
    sourcePairCounts,
    policyBucketCounts,
    reviewQueues,
    sampledGroups: samples.length,
    samples,
    plans,
    nextAction:
      'Review cross-source conflicts by source and field before designing source-precedence, field-lock, or guarded supersession behavior.',
  };
}

export function writeCrossSourceObservationConflictReviewOutput(
  summary: object,
  output?: string,
): void {
  if (!output) return;
  const safeOutput = resolveSafeJsonReportOutputPath(output);
  fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
  fs.writeFileSync(safeOutput, `${JSON.stringify(summary, null, 2)}\n`);
}

export function buildCrossSourceObservationConflictReviewOutput<T extends object>(
  summary: T,
  metadata: {
    environment?: string;
    db?: string;
    options: CrossSourceObservationConflictReviewArgs;
  },
): T & {
  environment?: string;
  db?: string;
  options: CrossSourceObservationConflictReviewArgs;
} {
  return {
    ...summary,
    ...(metadata.environment ? { environment: metadata.environment } : {}),
    ...(metadata.db ? { db: metadata.db } : {}),
    options: metadata.options,
  };
}

export function buildCrossSourceObservationDecisionTemplate(
  plans: CrossSourceObservationConflictPlan[],
  generatedAt = new Date().toISOString(),
): CrossSourceObservationDecisionTemplate {
  return {
    generatedAt,
    applyBlocked: true,
    applyBlockedReason: APPLY_BLOCKED_REASON,
    acceptedDecisionValues: ['prefer_source', 'accept_current_resolver', 'defer_review'],
    decisions: plans.map((plan) => ({
      planId: plan.planId,
      entityType: plan.entityType,
      entityId: plan.entityId,
      entityKey: plan.entityKey,
      field: plan.field,
      reviewCategory: plan.reviewCategory,
      reviewQueue: plan.reviewQueue,
      policyBucket: plan.policyBucket,
      sourceNames: plan.sourceNames,
      contributingSources: plan.contributingSources,
      observationIdsBySource: plan.observationIdsBySource,
      proposedAction: plan.proposedAction,
      decision: '',
      preferredSourceName: '',
      reviewedBy: '',
      reviewNote: '',
    })),
  };
}

export function writeCrossSourceObservationDecisionTemplate(
  template: CrossSourceObservationDecisionTemplate,
  output?: string,
): void {
  if (!output) return;
  const safeOutput = resolveSafeJsonReportOutputPath(output, '--decision-template-output');
  fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
  fs.writeFileSync(safeOutput, `${JSON.stringify(template, null, 2)}\n`);
}

export function readCrossSourceObservationReviewDecisions(
  inputPath: string,
  options: { allowEmpty?: boolean } = {},
): CrossSourceObservationReviewDecision[] {
  const safeInputPath = resolveSafeJsonReportOutputPath(inputPath, '--accepted-decisions');
  if (options.allowEmpty && !fs.existsSync(safeInputPath)) {
    return [];
  }
  const parsed = JSON.parse(fs.readFileSync(safeInputPath, 'utf8')) as unknown;
  const decisions = Array.isArray(parsed)
    ? parsed
    : parsed &&
        typeof parsed === 'object' &&
        'decisions' in parsed &&
        Array.isArray((parsed as { decisions?: unknown }).decisions)
      ? (parsed as { decisions: unknown[] }).decisions
      : undefined;

  if (!decisions) {
    throw new Error(
      'Accepted cross-source decisions artifact must be a JSON array or an object with a decisions array.',
    );
  }

  return decisions.map((raw, index) => normalizeCrossSourceReviewDecision(raw, index));
}

export function validateCrossSourceObservationReviewDecisions(
  plans: CrossSourceObservationConflictPlan[],
  decisions: CrossSourceObservationReviewDecision[],
  artifactPath?: string,
): CrossSourceObservationReviewDecisionValidationSummary {
  const planById = new Map(plans.map((plan) => [plan.planId, plan]));
  const planIdCounts = new Map<string, number>();
  const decisionsByType = new Map<string, number>();
  for (const decision of decisions) {
    if (decision.planId) {
      planIdCounts.set(decision.planId, (planIdCounts.get(decision.planId) || 0) + 1);
    }
    if (decision.decision) {
      decisionsByType.set(decision.decision, (decisionsByType.get(decision.decision) || 0) + 1);
    }
  }

  const rows = decisions.map((decision) =>
    validateCrossSourceObservationReviewDecision(decision, planById, planIdCounts),
  );
  const validPlanIds = new Set(
    rows
      .filter((row) => row.status === 'valid')
      .map((row) => row.planId)
      .filter(Boolean),
  );

  return {
    artifactPath,
    applyBlocked: true,
    applyBlockedReason: APPLY_BLOCKED_REASON,
    totalDecisions: decisions.length,
    validDecisionCount: rows.filter((row) => row.status === 'valid').length,
    invalidDecisionCount: rows.filter((row) => row.status === 'invalid').length,
    unmatchedPlanDecisionCount: rows.filter((row) =>
      row.errors.includes('planId is not present in generated plans'),
    ).length,
    duplicatePlanDecisionCount: Array.from(planIdCounts.values()).reduce(
      (sum, count) => sum + Math.max(0, count - 1),
      0,
    ),
    unreviewedPlanCount: plans.filter((plan) => !validPlanIds.has(plan.planId)).length,
    decisionsByType: Array.from(decisionsByType.entries()).map(([decision, count]) => ({
      decision,
      count,
    })),
    decisions: rows,
  };
}

export async function runCrossSourceObservationConflictReview(
  args: CrossSourceObservationConflictReviewArgs,
): Promise<CrossSourceObservationConflictSummary> {
  if (!args.sourceName) {
    throw new Error(
      '--source is required for live cross-source observation conflict review to keep the read-only query bounded; use source:health row commands.',
    );
  }
  const groups = await loadCrossSourceConflictGroups(args);
  const summary = buildCrossSourceObservationConflictSummary({
    sourceName: args.sourceName,
    reviewQueue: args.reviewQueue,
    reviewCategory: args.reviewCategory,
    field: args.field,
    limit: args.limit,
    sampleSize: args.sampleSize,
    planLimit: args.planLimit,
    groups,
  });
  if (!args.acceptedDecisions) return summary;
  return {
    ...summary,
    reviewDecisionValidation: validateCrossSourceObservationReviewDecisions(
      summary.plans,
      readCrossSourceObservationReviewDecisions(args.acceptedDecisions, {
        allowEmpty: Boolean(args.allowEmptyDecisions),
      }),
      args.acceptedDecisions,
    ),
  };
}

function normalizeCrossSourceReviewDecision(
  raw: unknown,
  index: number,
): CrossSourceObservationReviewDecision {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`Decision row ${index + 1} must be an object.`);
  }
  const row = raw as Record<string, unknown>;
  return {
    planId: asString(row.planId).trim(),
    decision: asString(row.decision).trim(),
    preferredSourceName: optionalString(row.preferredSourceName),
    sourceNames: asStringArray(row.sourceNames),
    observationIdsBySource: normalizeObservationIdsBySource(row.observationIdsBySource),
    reviewedBy: optionalString(row.reviewedBy),
    reviewNote: optionalString(row.reviewNote),
  };
}

function validateCrossSourceObservationReviewDecision(
  decision: CrossSourceObservationReviewDecision,
  planById: Map<string, CrossSourceObservationConflictPlan>,
  planIdCounts: Map<string, number>,
): CrossSourceObservationReviewDecisionValidationRow {
  const errors: string[] = [];
  const plan = planById.get(decision.planId);

  if (!decision.planId) {
    errors.push('Decision row is missing planId.');
  } else {
    if (!plan) {
      errors.push('planId is not present in generated plans');
    }
    if ((planIdCounts.get(decision.planId) || 0) > 1) {
      errors.push('Only one decision per planId is allowed.');
    }
  }

  if (
    decision.decision !== 'prefer_source' &&
    decision.decision !== 'accept_current_resolver' &&
    decision.decision !== 'defer_review'
  ) {
    errors.push('Decision must be prefer_source, accept_current_resolver, or defer_review.');
  }

  if (decision.decision === 'prefer_source') {
    if (!decision.preferredSourceName) {
      errors.push('prefer_source requires preferredSourceName.');
    } else if (plan && !plan.sourceNames.includes(decision.preferredSourceName)) {
      errors.push('preferredSourceName must be one of the generated plan sourceNames');
    }
  } else if (decision.preferredSourceName) {
    errors.push(`${decision.decision} decisions must not include preferredSourceName.`);
  }

  if (plan && decision.sourceNames && !sameStringSet(decision.sourceNames, plan.sourceNames)) {
    errors.push('sourceNames must match the generated plan when provided');
  }
  if (
    plan &&
    decision.observationIdsBySource &&
    !sameObservationIdsBySource(decision.observationIdsBySource, plan.observationIdsBySource)
  ) {
    errors.push('observationIdsBySource must match the generated plan when provided');
  }

  return {
    planId: decision.planId,
    decision: decision.decision,
    preferredSourceName: decision.preferredSourceName,
    sourceNames: decision.sourceNames,
    observationIdsBySource: decision.observationIdsBySource,
    reviewedBy: decision.reviewedBy,
    status: errors.length > 0 ? 'invalid' : 'valid',
    errors,
  };
}

async function loadCrossSourceConflictGroups(
  args: CrossSourceObservationConflictReviewArgs,
): Promise<CrossSourceObservationConflictGroup[]> {
  const sourceMatch: Record<string, unknown> = {
    superseded: { $ne: true },
    sourceName: args.sourceName,
    field: { $exists: true, $ne: '' },
  };
  if (args.field) {
    sourceMatch.field = args.field;
  }

  const keyLimit = Math.max(args.limit, Math.min(args.limit * 10, 10000));
  const keys = await observationCollection()
    .aggregate(
      [
        { $match: sourceMatch },
        {
          $group: {
            _id: {
              entityType: '$entityType',
              entityId: '$entityId',
              entityKey: '$entityKey',
              field: '$field',
            },
          },
        },
        { $sort: { '_id.entityType': 1, '_id.field': 1, '_id.entityKey': 1 } },
        { $limit: keyLimit },
      ],
      { allowDiskUse: true },
    )
    .toArray();

  const groups: CrossSourceObservationConflictGroup[] = [];
  for (const key of keys) {
    const groupKey = key._id as AggregatedCrossSourceObservationConflictGroup['_id'];
    const observations = await loadObservationsForGroupKey(groupKey);
    const sourceNames = new Set(observations.map((observation) => observation.sourceName));
    const distinctValues = new Set(observations.map((observation) => serializeValue(observation.value)));
    if (sourceNames.size < 2 || distinctValues.size < 2) {
      continue;
    }
    groups.push({
      entityType: groupKey.entityType || 'unknown',
      entityId: stringifyId(groupKey.entityId) || undefined,
      entityKey: groupKey.entityKey || undefined,
      field: groupKey.field || 'unknown',
      observations,
    });
    if (groups.length >= args.limit) {
      break;
    }
  }

  return groups;
}

function observationCollection() {
  const db = mongoose.connection.db;
  if (!db) {
    throw new Error('MongoDB connection is not initialized');
  }
  return db.collection('observations');
}

async function loadObservationsForGroupKey(
  key: AggregatedCrossSourceObservationConflictGroup['_id'],
): Promise<CrossSourceObservationConflictObservation[]> {
  const match: Record<string, unknown> = {
    superseded: { $ne: true },
    sourceName: { $exists: true, $ne: '' },
    entityType: key.entityType,
    field: key.field,
  };
  if (key.entityId) {
    match.entityId = key.entityId;
  } else if (key.entityKey) {
    match.entityKey = key.entityKey;
  } else {
    return [];
  }

  const rows = await observationCollection()
    .find(match)
    .project({
      sourceName: 1,
      value: 1,
      observedAt: 1,
      sourceUrl: 1,
      confidence: 1,
    })
    .toArray();

  return rows.map((row) => ({
    id: stringifyId(row._id),
    sourceName: typeof row.sourceName === 'string' ? row.sourceName : 'unknown',
    value: row.value,
    observedAt: row.observedAt,
    sourceUrl: typeof row.sourceUrl === 'string' ? row.sourceUrl : undefined,
    confidence: typeof row.confidence === 'number' ? row.confidence : undefined,
  }));
}

function buildCandidateSample(
  group: CrossSourceObservationConflictGroup,
): CrossSourceObservationConflictSample | null {
  const sourceNames = Array.from(
    new Set(group.observations.map((observation) => observation.sourceName).filter(Boolean)),
  ).sort();
  if (sourceNames.length < 2) {
    return null;
  }

  const distinctValueCount = new Set(
    group.observations.map((observation) => serializeValue(observation.value)),
  ).size;
  if (distinctValueCount < 2) {
    return null;
  }

  const resolved = resolveField(
    group.field,
    group.observations.map((observation) => toResolverObservation(observation, group.field)),
  );
  if (!resolved?.hasConflict) {
    return null;
  }

  const reviewCategory = reviewCategoryForField(group.field);
  const reviewQueue = reviewQueueForCategory(reviewCategory);
  const policyBucket = policyBucketForConflict(group.field, reviewCategory);
  return {
    entityType: group.entityType,
    entityId: group.entityId,
    entityKey: group.entityKey,
    field: group.field,
    reviewCategory,
    reviewQueue,
    policyBucket,
    sourceConflictScope: 'cross_source',
    activeObservationCount: group.observations.length,
    distinctValueCount,
    sourceNames,
    resolvedConfidence: resolved.confidence,
    contributingSources: resolved.contributingSources.slice().sort(),
    conflictingValuePreviews: (resolved.conflictingValues || []).slice(0, 3).map(previewValue),
    valuePreviewsBySource: buildValuePreviewsBySource(group.observations),
  };
}

function toResolverObservation(
  observation: CrossSourceObservationConflictObservation,
  field: string,
): ResolverObservation {
  return {
    field,
    value: observation.value,
    sourceName: observation.sourceName,
    confidence: typeof observation.confidence === 'number' ? observation.confidence : 0.5,
    observedAt: observedAtForResolver(observation.observedAt),
  };
}

function buildValuePreviewsBySource(
  observations: CrossSourceObservationConflictObservation[],
): CrossSourceObservationValuePreview[] {
  const bySource = new Map<string, CrossSourceObservationConflictObservation[]>();
  for (const observation of observations) {
    bySource.set(observation.sourceName, [
      ...(bySource.get(observation.sourceName) || []),
      observation,
    ]);
  }
  return Array.from(bySource.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([sourceName, sourceObservations]) => ({
      sourceName,
      observationIds: sourceObservations.map((observation) => observation.id),
      valuePreviews: Array.from(
        new Set(sourceObservations.map((observation) => previewValue(observation.value))),
      ),
    }));
}

function matchesReviewFilters(
  sample: CrossSourceObservationConflictSample,
  filters: {
    sourceName?: string;
    reviewQueue?: CrossSourceObservationReviewQueue;
    reviewCategory?: CrossSourceObservationReviewCategory;
    field?: string;
  },
): boolean {
  if (filters.sourceName && !sample.sourceNames.includes(filters.sourceName)) return false;
  if (filters.field && sample.field !== filters.field) return false;
  if (filters.reviewCategory && sample.reviewCategory !== filters.reviewCategory) return false;
  if (filters.reviewQueue && sample.reviewQueue !== filters.reviewQueue) return false;
  return true;
}

function buildConflictPlan(
  sample: CrossSourceObservationConflictSample,
): CrossSourceObservationConflictPlan {
  return {
    planId: [
      sample.entityType,
      sample.entityKey || sample.entityId || 'unknown-entity',
      sample.field,
    ].join(':'),
    entityType: sample.entityType,
    entityId: sample.entityId,
    entityKey: sample.entityKey,
    field: sample.field,
    reviewCategory: sample.reviewCategory,
    reviewQueue: sample.reviewQueue,
    policyBucket: sample.policyBucket,
    sourceNames: sample.sourceNames,
    contributingSources: sample.contributingSources,
    observationIdsBySource: sample.valuePreviewsBySource.map((item) => ({
      sourceName: item.sourceName,
      observationIds: item.observationIds,
    })),
    proposedAction: 'review_source_precedence_or_field_policy',
    applyBlocked: true,
    applyBlockedReason: APPLY_BLOCKED_REASON,
  };
}

function compareSamplesForReview(
  left: CrossSourceObservationConflictSample,
  right: CrossSourceObservationConflictSample,
): number {
  return (
    reviewQueueRank(left.reviewQueue) - reviewQueueRank(right.reviewQueue) ||
    right.distinctValueCount - left.distinctValueCount ||
    right.activeObservationCount - left.activeObservationCount ||
    left.entityType.localeCompare(right.entityType) ||
    (left.entityKey || left.entityId || '').localeCompare(right.entityKey || right.entityId || '') ||
    left.field.localeCompare(right.field)
  );
}

function buildCategoryCounts(
  samples: CrossSourceObservationConflictSample[],
): Array<{ category: CrossSourceObservationReviewCategory; count: number }> {
  const counts = new Map<CrossSourceObservationReviewCategory, number>();
  for (const sample of samples) {
    counts.set(sample.reviewCategory, (counts.get(sample.reviewCategory) || 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([category, count]) => ({ category, count }))
    .sort((left, right) => right.count - left.count || left.category.localeCompare(right.category));
}

function buildFieldCounts(
  samples: CrossSourceObservationConflictSample[],
): Array<{ field: string; count: number }> {
  const counts = new Map<string, number>();
  for (const sample of samples) {
    counts.set(sample.field, (counts.get(sample.field) || 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([field, count]) => ({ field, count }))
    .sort((left, right) => right.count - left.count || left.field.localeCompare(right.field));
}

function buildSourcePairCounts(
  samples: CrossSourceObservationConflictSample[],
): Array<{ sourcePair: string[]; count: number }> {
  const sourcePairByKey = new Map<string, { sourcePair: string[]; count: number }>();
  for (const sample of samples) {
    const sourcePair = sample.sourceNames.slice().sort();
    const key = sourcePair.join('||');
    const existing = sourcePairByKey.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      sourcePairByKey.set(key, { sourcePair, count: 1 });
    }
  }
  return Array.from(sourcePairByKey.values()).sort(
    (left, right) =>
      right.count - left.count ||
      left.sourcePair.join(' ').localeCompare(right.sourcePair.join(' ')),
  );
}

function buildPolicyBucketCounts(
  samples: CrossSourceObservationConflictSample[],
): Array<{ policyBucket: CrossSourceObservationPolicyBucket; count: number }> {
  const counts = new Map<CrossSourceObservationPolicyBucket, number>();
  for (const sample of samples) {
    counts.set(sample.policyBucket, (counts.get(sample.policyBucket) || 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([policyBucket, count]) => ({ policyBucket, count }))
    .sort((left, right) => right.count - left.count || left.policyBucket.localeCompare(right.policyBucket));
}

function buildReviewQueues(
  categoryCounts: Array<{ category: CrossSourceObservationReviewCategory; count: number }>,
): CrossSourceObservationConflictSummary['reviewQueues'] {
  const categoriesByQueue = new Map<
    CrossSourceObservationReviewQueue,
    Array<{ category: CrossSourceObservationReviewCategory; count: number }>
  >();
  for (const item of categoryCounts) {
    const queue = reviewQueueForCategory(item.category);
    const categories = categoriesByQueue.get(queue) || [];
    categories.push(item);
    categoriesByQueue.set(queue, categories);
  }

  return REVIEW_QUEUE_DEFINITIONS.map((definition) => {
    const categories = (categoriesByQueue.get(definition.queue) || []).sort(
      (left, right) => right.count - left.count || left.category.localeCompare(right.category),
    );
    return {
      queue: definition.queue,
      label: definition.label,
      count: categories.reduce((sum, item) => sum + item.count, 0),
      categories,
    };
  });
}

function reviewCategoryForField(field: string): CrossSourceObservationReviewCategory {
  if (IDENTITY_OR_ROUTING_CONFLICT_FIELDS.has(field)) return 'identity_or_routing';
  if (ACCESS_EVIDENCE_CONFLICT_FIELDS.has(field)) return 'access_evidence';
  if (CONTENT_CONFLICT_FIELDS.has(field)) return 'content';
  if (FUNDING_CONTEXT_CONFLICT_FIELDS.has(field)) return 'funding_context';
  if (ADDITIVE_METADATA_CONFLICT_FIELDS.has(field)) return 'additive_metadata';
  return 'other';
}

function reviewQueueForCategory(
  category: CrossSourceObservationReviewCategory,
): CrossSourceObservationReviewQueue {
  if (PRIORITY_REVIEW_CATEGORIES.has(category)) return 'priority_review';
  if (METADATA_REVIEW_CATEGORIES.has(category)) return 'metadata_review';
  return 'context_review';
}

function policyBucketForConflict(
  field: string,
  category: CrossSourceObservationReviewCategory,
): CrossSourceObservationPolicyBucket {
  if (category === 'content') return 'description_policy_review';
  if (field === 'name') return 'name_precedence_review';
  if (
    category === 'identity_or_routing' &&
    ['websiteUrl', 'profileUrl', 'slug', 'kind', 'entityType'].includes(field)
  ) {
    return 'routing_or_entity_type_review';
  }
  if (category === 'access_evidence') return 'access_evidence_policy_review';
  if (category === 'additive_metadata') return 'metadata_merge_policy_review';
  if (category === 'funding_context') return 'funding_context_policy_review';
  return 'manual_source_precedence_review';
}

function reviewQueueRank(queue: CrossSourceObservationReviewQueue): number {
  if (queue === 'priority_review') return 0;
  if (queue === 'context_review') return 1;
  return 2;
}

function parseReviewQueue(raw: string): CrossSourceObservationReviewQueue {
  const value = raw.trim();
  if (value === 'priority_review' || value === 'context_review' || value === 'metadata_review') {
    return value;
  }
  throw new Error('--queue must be priority_review, context_review, or metadata_review');
}

function parseReviewCategory(raw: string): CrossSourceObservationReviewCategory {
  const value = raw.trim();
  if (
    value === 'identity_or_routing' ||
    value === 'access_evidence' ||
    value === 'content' ||
    value === 'funding_context' ||
    value === 'additive_metadata' ||
    value === 'other'
  ) {
    return value;
  }
  throw new Error(
    '--category must be identity_or_routing, access_evidence, content, funding_context, additive_metadata, or other',
  );
}

function consumeValue(
  argv: string[],
  index: number,
  flagName: string,
  requirement: string,
): string {
  const value = argv[index + 1];
  if (!value || !value.trim() || value.startsWith('--')) {
    throw new Error(`${flagName} requires ${requirement}`);
  }
  return value;
}

function parseRequiredString(
  value: string,
  flagName: string,
  requirement = 'a value',
): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith('--')) {
    throw new Error(`${flagName} requires ${requirement}`);
  }
  return trimmed;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function optionalString(value: unknown): string | undefined {
  const text = asString(value).trim();
  return text ? text : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const strings = value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim());
  return strings.length > 0 ? strings : undefined;
}

function normalizeObservationIdsBySource(
  value: unknown,
): Array<{ sourceName: string; observationIds: string[] }> | undefined {
  if (!Array.isArray(value)) return undefined;
  const rows = value
    .map((item) => {
      if (!item || typeof item !== 'object') return undefined;
      const record = item as Record<string, unknown>;
      const sourceName = asString(record.sourceName).trim();
      const observationIds = asStringArray(record.observationIds) || [];
      if (!sourceName || observationIds.length === 0) return undefined;
      return {
        sourceName,
        observationIds,
      };
    })
    .filter((item): item is { sourceName: string; observationIds: string[] } =>
      Boolean(item),
    );
  return rows.length > 0 ? rows : undefined;
}

function sameStringSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const leftSet = new Set(left);
  if (leftSet.size !== right.length) return false;
  return right.every((value) => leftSet.has(value));
}

function sameObservationIdsBySource(
  left: Array<{ sourceName: string; observationIds: string[] }>,
  right: Array<{ sourceName: string; observationIds: string[] }>,
): boolean {
  return (
    JSON.stringify(normalizedObservationIdRows(left)) ===
    JSON.stringify(normalizedObservationIdRows(right))
  );
}

function normalizedObservationIdRows(
  rows: Array<{ sourceName: string; observationIds: string[] }>,
): Array<{ sourceName: string; observationIds: string[] }> {
  return rows
    .map((row) => ({
      sourceName: row.sourceName,
      observationIds: Array.from(new Set(row.observationIds)).sort(),
    }))
    .sort((left, right) => left.sourceName.localeCompare(right.sourceName));
}

function parsePositiveIntegerValue(value: string, flagName: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed.toString() !== value) {
    throw new Error(`${flagName} must be a positive integer`);
  }
  return parsed;
}

function observedAtForResolver(value: Date | string | undefined): Date {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date(0);
}

function stringifyId(value: unknown): string {
  return serializedDocumentId(value) || '';
}

function serializeValue(value: unknown): string {
  if (value === null || value === undefined) return '__null__';
  if (typeof value === 'string') return `s:${value.trim().toLowerCase()}`;
  if (typeof value === 'number' || typeof value === 'boolean') return `p:${String(value)}`;
  if (Array.isArray(value)) {
    return `a:[${value.map((item) => serializeValue(item)).sort().join(',')}]`;
  }
  if (typeof value === 'object') {
    return `o:${JSON.stringify(value, Object.keys(value as object).sort())}`;
  }
  return `x:${String(value)}`;
}

function previewValue(value: unknown): string {
  const raw = typeof value === 'string' ? value : JSON.stringify(value);
  return redactDirectContactInfo(String(raw ?? '')).slice(0, MAX_VALUE_PREVIEW_LENGTH);
}

async function main(): Promise<void> {
  const args = parseCrossSourceObservationConflictReviewArgs(process.argv.slice(2));
  const guard = assertScriptApplyAllowed({
    apply: false,
    scriptName: 'observations:cross-source-conflict-review',
    mongoUrl: process.env.MONGODBURL,
  });
  await initializeConnections();
  const summary = await runCrossSourceObservationConflictReview(args);
  const output = buildCrossSourceObservationConflictReviewOutput(summary, {
    environment: guard.environment,
    db: mongoose.connection.db?.databaseName || mongoose.connection.name || guard.dbLabel,
    options: args,
  });
  console.log(JSON.stringify(output, null, 2));
  writeCrossSourceObservationConflictReviewOutput(output, args.output);
  writeCrossSourceObservationDecisionTemplate(
    buildCrossSourceObservationDecisionTemplate(summary.plans, summary.generatedAt),
    args.decisionTemplateOutput,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main()
    .catch((error) => {
      console.error(sanitizeLogValue(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}

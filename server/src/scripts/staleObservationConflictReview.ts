import dotenv from 'dotenv';
import fs from 'fs';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeConnections } from '../db/connections';
import { Observation } from '../models/observation';
import { redactDirectContactInfo } from '../utils/contactRedaction';
import { serializedDocumentId } from '../utils/idSerialization';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import { sanitizeLogValue } from '../utils/logSanitizer';

dotenv.config();

const DEFAULT_LIMIT = 500;
const DEFAULT_SAMPLE_SIZE = 20;
const DEFAULT_PLAN_LIMIT = 100;
const MAX_VALUE_PREVIEW_LENGTH = 240;
const APPLY_BLOCKED_REASON =
  'Apply mode is intentionally unavailable until this dry-run plan is reviewed and a guarded supersession path is implemented.';
const STALE_OBSERVATION_OBJECT_ID_RE = /^[a-f0-9]{24}$/i;

export type StaleObservationReviewQueue =
  | 'priority_review'
  | 'context_review'
  | 'metadata_review';

export type StaleObservationReviewCategory =
  | 'identity_or_routing'
  | 'access_evidence'
  | 'content'
  | 'funding_context'
  | 'additive_metadata'
  | 'other';

export type StaleObservationReviewPolicyBucket =
  | 'stale_identity_or_routing_review'
  | 'stale_description_review'
  | 'stale_access_evidence_review'
  | 'stale_metadata_merge_review'
  | 'stale_funding_context_review'
  | 'stale_manual_review';

export interface StaleObservationConflictReviewArgs {
  apply: boolean;
  sourceName?: string;
  reviewQueue?: StaleObservationReviewQueue;
  reviewCategory?: StaleObservationReviewCategory;
  field?: string;
  limit: number;
  sampleSize: number;
  planLimit: number;
  maxApply?: number;
  confirmStaleObservationSupersession?: boolean;
  acceptedDecisions?: string;
  allowEmptyDecisions?: boolean;
  decisionTemplateOutput?: string;
  output?: string;
}

export interface StaleObservationConflictObservation {
  id: string;
  value: unknown;
  observedAt?: Date | string;
  sourceUrl?: string;
  confidence?: number;
}

export interface StaleObservationConflictGroup {
  sourceName: string;
  entityType: string;
  entityId?: string;
  entityKey?: string;
  field: string;
  observations: StaleObservationConflictObservation[];
}

export interface StaleObservationConflictSample {
  sourceName: string;
  entityType: string;
  entityId?: string;
  entityKey?: string;
  field: string;
  reviewCategory: StaleObservationReviewCategory;
  reviewQueue: StaleObservationReviewQueue;
  activeObservationCount: number;
  distinctValueCount: number;
  keepObservationId: string;
  keepObservedAt?: string;
  keepValuePreview: string;
  supersedeObservationIds: string[];
  supersedeValuePreviews: string[];
}

export interface StaleObservationSupersessionPlan {
  planId: string;
  sourceName: string;
  entityType: string;
  entityId?: string;
  entityKey?: string;
  field: string;
  reviewCategory: StaleObservationReviewCategory;
  reviewQueue: StaleObservationReviewQueue;
  keepObservationId: string;
  supersedeObservationIds: string[];
  supersedeCount: number;
  applyBlocked: true;
  applyBlockedReason: string;
}

export interface StaleObservationReviewDecision {
  planId: string;
  decision: string;
  keepObservationId?: string;
  supersedeObservationIds?: string[];
  reviewedBy?: string;
  reviewNote?: string;
}

export interface StaleObservationReviewDecisionValidationRow {
  planId: string;
  decision: string;
  keepObservationId?: string;
  supersedeObservationIds?: string[];
  reviewedBy?: string;
  status: 'valid' | 'invalid';
  errors: string[];
}

export interface StaleObservationReviewDecisionValidationSummary {
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
  decisions: StaleObservationReviewDecisionValidationRow[];
}

export interface StaleObservationApplySummary {
  requestedDecisionCount: number;
  validSupersessionDecisionCount: number;
  maxApply?: number;
  appliedPlanCount: number;
  supersedeObservationCount: number;
  modifiedObservationCount: number;
  skippedPlanCount: number;
  skippedPlans: Array<{
    planId: string;
    reason: string;
  }>;
}

export interface StaleObservationDecisionTemplate {
  generatedAt: string;
  applyBlocked: true;
  applyBlockedReason: string;
  acceptedDecisionValues: ['supersede_stale_observations', 'defer_review'];
  decisions: Array<{
    planId: string;
    sourceName: string;
    entityType: string;
    entityId?: string;
    entityKey?: string;
    field: string;
    reviewCategory: StaleObservationReviewCategory;
    reviewQueue: StaleObservationReviewQueue;
    keepObservationId: string;
    supersedeObservationIds: string[];
    supersedeCount: number;
    decision: '';
    reviewedBy: '';
    reviewNote: '';
  }>;
}

export interface StaleObservationConflictSummary {
  generatedAt: string;
  mode: 'dry-run' | 'apply';
  applyBlocked: boolean;
  sourceName?: string;
  reviewQueue?: StaleObservationReviewQueue;
  reviewCategory?: StaleObservationReviewCategory;
  field?: string;
  limit: number;
  sampleSize: number;
  planLimit: number;
  groupsScanned: number;
  candidateGroups: number;
  candidateSupersedeObservations: number;
  plannedGroups: number;
  plannedSupersedeObservations: number;
  planTruncated: boolean;
  priorityReviewCandidateGroups: number;
  contextReviewCandidateGroups: number;
  metadataReviewCandidateGroups: number;
  categoryCounts: Array<{ category: StaleObservationReviewCategory; count: number }>;
  fieldCounts: Array<{ field: string; count: number }>;
  policyBucketCounts: Array<{
    policyBucket: StaleObservationReviewPolicyBucket;
    count: number;
  }>;
  reviewQueues: Array<{
    queue: StaleObservationReviewQueue;
    label: string;
    count: number;
    categories: Array<{ category: StaleObservationReviewCategory; count: number }>;
  }>;
  sampledGroups: number;
  samples: StaleObservationConflictSample[];
  plans: StaleObservationSupersessionPlan[];
  reviewDecisionValidation?: StaleObservationReviewDecisionValidationSummary;
  applySummary?: StaleObservationApplySummary;
  nextAction: string;
}

export interface StaleObservationApplyDeps {
  countActiveKeepObservations: (keepObservationId: string) => Promise<number>;
  supersedeObservations: (
    supersedeObservationIds: string[],
    keepObservationId: string,
  ) => Promise<{ matchedCount?: number; modifiedCount?: number }>;
}

interface AggregatedObservationConflictGroup {
  _id: {
    sourceName?: string;
    entityType?: string;
    entityId?: unknown;
    entityKey?: string;
    field?: string;
  };
  observations?: Array<{
    id?: unknown;
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

const ALL_KNOWN_CONFLICT_FIELDS = new Set([
  ...ADDITIVE_METADATA_CONFLICT_FIELDS,
  ...IDENTITY_OR_ROUTING_CONFLICT_FIELDS,
  ...CONTENT_CONFLICT_FIELDS,
  ...ACCESS_EVIDENCE_CONFLICT_FIELDS,
  ...FUNDING_CONTEXT_CONFLICT_FIELDS,
]);

const PRIORITY_REVIEW_CATEGORIES = new Set<StaleObservationReviewCategory>([
  'identity_or_routing',
  'access_evidence',
  'content',
]);
const METADATA_REVIEW_CATEGORIES = new Set<StaleObservationReviewCategory>([
  'additive_metadata',
]);

const REVIEW_QUEUE_DEFINITIONS: Array<{
  queue: StaleObservationReviewQueue;
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

export function parseStaleObservationConflictReviewArgs(
  argv: string[],
): StaleObservationConflictReviewArgs {
  const args: StaleObservationConflictReviewArgs = {
    apply: false,
    limit: DEFAULT_LIMIT,
    sampleSize: DEFAULT_SAMPLE_SIZE,
    planLimit: DEFAULT_PLAN_LIMIT,
    confirmStaleObservationSupersession: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--apply') {
      args.apply = true;
      continue;
    }
    if (arg === '--confirm-stale-observation-supersession') {
      args.confirmStaleObservationSupersession = true;
      continue;
    }
    if (arg.startsWith('--confirm-stale-observation-supersession=')) {
      throw new Error('--confirm-stale-observation-supersession does not accept a value');
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
    if (arg.startsWith('--max-apply=')) {
      args.maxApply = parsePositiveIntegerValue(
        arg.slice('--max-apply='.length),
        '--max-apply',
      );
      continue;
    }
    if (arg === '--max-apply') {
      const next = consumeValue(argv, index, '--max-apply', 'a number');
      args.maxApply = parsePositiveIntegerValue(next, '--max-apply');
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

    throw new Error(`Unknown stale observation conflict review option: ${arg}`);
  }

  return args;
}

export function buildStaleObservationConflictSummary(input: {
  sourceName?: string;
  reviewQueue?: StaleObservationReviewQueue;
  reviewCategory?: StaleObservationReviewCategory;
  field?: string;
  limit: number;
  sampleSize: number;
  planLimit?: number;
  groups: StaleObservationConflictGroup[];
}): StaleObservationConflictSummary {
  const candidates = input.groups
    .map((group) => buildCandidateSample(group))
    .filter((sample): sample is StaleObservationConflictSample => Boolean(sample))
    .filter((sample) => matchesReviewFilters(sample, input))
    .sort(compareSamplesForReview);

  const samples = candidates.slice(0, input.sampleSize);
  const planLimit = input.planLimit || DEFAULT_PLAN_LIMIT;
  const plans = candidates.slice(0, planLimit).map(buildSupersessionPlan);
  const categoryCounts = buildCategoryCounts(candidates);
  const fieldCounts = buildFieldCounts(candidates);
  const policyBucketCounts = buildPolicyBucketCounts(candidates);
  const reviewQueues = buildReviewQueues(categoryCounts);
  const countForQueue = (queue: StaleObservationReviewQueue): number =>
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
    candidateSupersedeObservations: candidates.reduce(
      (sum, candidate) => sum + candidate.supersedeObservationIds.length,
      0,
    ),
    plannedGroups: plans.length,
    plannedSupersedeObservations: plans.reduce(
      (sum, plan) => sum + plan.supersedeObservationIds.length,
      0,
    ),
    planTruncated: candidates.length > plans.length,
    priorityReviewCandidateGroups: countForQueue('priority_review'),
    contextReviewCandidateGroups: countForQueue('context_review'),
    metadataReviewCandidateGroups: countForQueue('metadata_review'),
    categoryCounts,
    fieldCounts,
    policyBucketCounts,
    reviewQueues,
    sampledGroups: samples.length,
    samples,
    plans,
    nextAction:
      'Review sampled same-source stale observation candidates before designing any guarded supersession apply path.',
  };
}

export function writeStaleObservationConflictReviewOutput(
  summary: object,
  output?: string,
): void {
  if (!output) return;
  const safeOutput = resolveSafeJsonReportOutputPath(output);
  fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
  fs.writeFileSync(safeOutput, `${JSON.stringify(summary, null, 2)}\n`);
}

export function buildStaleObservationConflictReviewOutput<T extends object>(
  summary: T,
  metadata: {
    environment?: string;
    db?: string;
    options: StaleObservationConflictReviewArgs;
  },
): T & {
  environment?: string;
  db?: string;
  options: StaleObservationConflictReviewArgs;
} {
  return {
    ...summary,
    ...(metadata.environment ? { environment: metadata.environment } : {}),
    ...(metadata.db ? { db: metadata.db } : {}),
    options: metadata.options,
  };
}

export function assertStaleObservationConflictReviewApplyAllowed(
  args: StaleObservationConflictReviewArgs,
  env: NodeJS.ProcessEnv = process.env,
  mongoUrl?: string,
) {
  const guard = assertScriptApplyAllowed({
    apply: args.apply,
    scriptName: 'observations:stale-conflict-review',
    mongoUrl,
    env,
  });

  if (args.apply) {
    if (!args.acceptedDecisions) {
      throw new Error(
        'observations:stale-conflict-review apply mode requires --accepted-decisions.',
      );
    }
    if (!Number.isFinite(args.maxApply)) {
      throw new Error(
        '--max-apply is required when --apply is set for observations:stale-conflict-review.',
      );
    }
    if (!args.confirmStaleObservationSupersession) {
      throw new Error(
        '--confirm-stale-observation-supersession is required when --apply is set for observations:stale-conflict-review.',
      );
    }
  }

  return guard;
}

export function buildStaleObservationDecisionTemplate(
  plans: StaleObservationSupersessionPlan[],
  generatedAt = new Date().toISOString(),
): StaleObservationDecisionTemplate {
  return {
    generatedAt,
    applyBlocked: true,
    applyBlockedReason: APPLY_BLOCKED_REASON,
    acceptedDecisionValues: ['supersede_stale_observations', 'defer_review'],
    decisions: plans.map((plan) => ({
      planId: plan.planId,
      sourceName: plan.sourceName,
      entityType: plan.entityType,
      entityId: plan.entityId,
      entityKey: plan.entityKey,
      field: plan.field,
      reviewCategory: plan.reviewCategory,
      reviewQueue: plan.reviewQueue,
      keepObservationId: plan.keepObservationId,
      supersedeObservationIds: plan.supersedeObservationIds,
      supersedeCount: plan.supersedeCount,
      decision: '',
      reviewedBy: '',
      reviewNote: '',
    })),
  };
}

export function writeStaleObservationDecisionTemplate(
  template: StaleObservationDecisionTemplate,
  output?: string,
): void {
  if (!output) return;
  const safeOutput = resolveSafeJsonReportOutputPath(output, '--decision-template-output');
  fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
  fs.writeFileSync(safeOutput, `${JSON.stringify(template, null, 2)}\n`);
}

export function readStaleObservationReviewDecisions(
  inputPath: string,
  options: { allowEmpty?: boolean } = {},
): StaleObservationReviewDecision[] {
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
      'Accepted stale-observation decisions artifact must be a JSON array or an object with a decisions array.',
    );
  }

  return decisions.map((raw, index) => normalizeStaleObservationReviewDecision(raw, index));
}

export function validateStaleObservationReviewDecisions(
  plans: StaleObservationSupersessionPlan[],
  decisions: StaleObservationReviewDecision[],
  artifactPath?: string,
): StaleObservationReviewDecisionValidationSummary {
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
    validateStaleObservationReviewDecision(decision, planById, planIdCounts),
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
      row.errors.includes('No generated stale-observation plan matches this planId.'),
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

export async function runStaleObservationConflictReview(
  args: StaleObservationConflictReviewArgs,
): Promise<StaleObservationConflictSummary> {
  const groups = await loadSameSourceConflictGroups(args);
  const summary = buildStaleObservationConflictSummary({
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
  const decisions = readStaleObservationReviewDecisions(args.acceptedDecisions, {
    allowEmpty: Boolean(args.allowEmptyDecisions),
  });
  const reviewDecisionValidation = validateStaleObservationReviewDecisions(
    summary.plans,
    decisions,
    args.acceptedDecisions,
  );
  if (!args.apply) {
    return {
      ...summary,
      reviewDecisionValidation,
    };
  }

  const applySummary = await applyStaleObservationSupersessions({
    plans: summary.plans,
    validation: reviewDecisionValidation,
    maxApply: args.maxApply,
  });
  return {
    ...summary,
    mode: 'apply',
    applyBlocked: false,
    reviewDecisionValidation,
    applySummary,
  };
}

export async function applyStaleObservationSupersessions(input: {
  plans: StaleObservationSupersessionPlan[];
  validation: StaleObservationReviewDecisionValidationSummary;
  maxApply?: number;
  deps?: StaleObservationApplyDeps;
}): Promise<StaleObservationApplySummary> {
  const deps = input.deps || defaultStaleObservationApplyDeps();
  const planById = new Map(input.plans.map((plan) => [plan.planId, plan]));
  const validRows = input.validation.decisions.filter(
    (row) => row.status === 'valid' && row.decision === 'supersede_stale_observations',
  );
  const boundedRows = input.maxApply ? validRows.slice(0, input.maxApply) : validRows;
  const skippedPlans: StaleObservationApplySummary['skippedPlans'] = [];
  let appliedPlanCount = 0;
  let supersedeObservationCount = 0;
  let modifiedObservationCount = 0;

  for (const row of boundedRows) {
    const plan = planById.get(row.planId);
    if (!plan) {
      skippedPlans.push({ planId: row.planId, reason: 'plan_not_found' });
      continue;
    }
    if (!row.keepObservationId || !row.supersedeObservationIds?.length) {
      skippedPlans.push({ planId: row.planId, reason: 'missing_supersession_ids' });
      continue;
    }
    const activeKeepCount = await deps.countActiveKeepObservations(row.keepObservationId);
    if (activeKeepCount !== 1) {
      skippedPlans.push({ planId: row.planId, reason: 'keep_observation_not_active' });
      continue;
    }

    const result = await deps.supersedeObservations(
      row.supersedeObservationIds,
      row.keepObservationId,
    );
    appliedPlanCount += 1;
    supersedeObservationCount += row.supersedeObservationIds.length;
    modifiedObservationCount += result.modifiedCount || 0;
  }

  if (input.maxApply && validRows.length > input.maxApply) {
    for (const row of validRows.slice(input.maxApply)) {
      skippedPlans.push({ planId: row.planId, reason: 'max_apply_limit' });
    }
  }

  return {
    requestedDecisionCount: input.validation.totalDecisions,
    validSupersessionDecisionCount: validRows.length,
    ...(input.maxApply ? { maxApply: input.maxApply } : {}),
    appliedPlanCount,
    supersedeObservationCount,
    modifiedObservationCount,
    skippedPlanCount: skippedPlans.length,
    skippedPlans,
  };
}

function defaultStaleObservationApplyDeps(): StaleObservationApplyDeps {
  return {
    async countActiveKeepObservations(keepObservationId) {
      return Observation.countDocuments({
        _id: toObjectId(keepObservationId),
        superseded: { $ne: true },
      }).exec();
    },
    async supersedeObservations(supersedeObservationIds, keepObservationId) {
      return Observation.updateMany(
        {
          _id: { $in: supersedeObservationIds.map(toObjectId) },
          superseded: { $ne: true },
        },
        {
          $set: {
            superseded: true,
            supersededBy: toObjectId(keepObservationId),
          },
        },
      ).exec();
    },
  };
}

export function normalizeStaleObservationObjectId(
  value: unknown,
): mongoose.Types.ObjectId | undefined {
  if (value instanceof mongoose.Types.ObjectId) return value;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!STALE_OBSERVATION_OBJECT_ID_RE.test(trimmed)) return undefined;
  return new mongoose.Types.ObjectId(trimmed);
}

function toObjectId(value: unknown): mongoose.Types.ObjectId {
  const objectId = normalizeStaleObservationObjectId(value);
  if (!objectId) {
    throw new Error(`Invalid Observation id: ${value}`);
  }
  return objectId;
}

function normalizeStaleObservationReviewDecision(
  raw: unknown,
  index: number,
): StaleObservationReviewDecision {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`Decision row ${index + 1} must be an object.`);
  }
  const row = raw as Record<string, unknown>;
  return {
    planId: asString(row.planId).trim(),
    decision: asString(row.decision).trim(),
    keepObservationId: optionalString(row.keepObservationId),
    supersedeObservationIds: asStringArray(row.supersedeObservationIds),
    reviewedBy: optionalString(row.reviewedBy),
    reviewNote: optionalString(row.reviewNote),
  };
}

function validateStaleObservationReviewDecision(
  decision: StaleObservationReviewDecision,
  planById: Map<string, StaleObservationSupersessionPlan>,
  planIdCounts: Map<string, number>,
): StaleObservationReviewDecisionValidationRow {
  const errors: string[] = [];
  const plan = planById.get(decision.planId);

  if (!decision.planId) {
    errors.push('Decision row is missing planId.');
  } else {
    if (!plan) {
      errors.push('No generated stale-observation plan matches this planId.');
    }
    if ((planIdCounts.get(decision.planId) || 0) > 1) {
      errors.push('Only one decision per planId is allowed.');
    }
  }

  if (
    decision.decision !== 'supersede_stale_observations' &&
    decision.decision !== 'defer_review'
  ) {
    errors.push('Decision must be supersede_stale_observations or defer_review.');
  }

  if (decision.decision === 'supersede_stale_observations') {
    if (!decision.keepObservationId) {
      errors.push('supersede_stale_observations requires keepObservationId.');
    }
    if (!decision.supersedeObservationIds?.length) {
      errors.push('supersede_stale_observations requires supersedeObservationIds.');
    }
    if (plan && decision.keepObservationId !== plan.keepObservationId) {
      errors.push('keepObservationId must match the generated plan keepObservationId.');
    }
    if (
      plan &&
      decision.supersedeObservationIds?.length &&
      !sameStringSet(decision.supersedeObservationIds, plan.supersedeObservationIds)
    ) {
      errors.push('supersedeObservationIds must match the generated plan supersedeObservationIds.');
    }
  }

  return {
    planId: decision.planId,
    decision: decision.decision,
    keepObservationId: decision.keepObservationId,
    supersedeObservationIds: decision.supersedeObservationIds,
    reviewedBy: decision.reviewedBy,
    status: errors.length > 0 ? 'invalid' : 'valid',
    errors,
  };
}

async function loadSameSourceConflictGroups(
  args: StaleObservationConflictReviewArgs,
): Promise<StaleObservationConflictGroup[]> {
  const match: Record<string, unknown> = {
    superseded: { $ne: true },
    sourceName: { $exists: true, $ne: '' },
    field: { $exists: true, $ne: '' },
  };

  if (args.sourceName) {
    match.sourceName = args.sourceName;
  }
  const fieldFilter = buildMongoFieldFilter(args);
  if (fieldFilter) {
    match.field = fieldFilter;
  }

  const rows = (await Observation.aggregate([
    { $match: match },
    { $sort: { observedAt: -1, _id: -1 } },
    {
      $group: {
        _id: {
          sourceName: '$sourceName',
          entityType: '$entityType',
          entityId: '$entityId',
          entityKey: '$entityKey',
          field: '$field',
        },
        activeObservationCount: { $sum: 1 },
        distinctValues: { $addToSet: '$value' },
        observations: {
          $push: {
            id: '$_id',
            value: '$value',
            observedAt: '$observedAt',
            sourceUrl: '$sourceUrl',
            confidence: '$confidence',
          },
        },
      },
    },
    {
      $addFields: {
        distinctValueCount: { $size: '$distinctValues' },
      },
    },
    {
      $match: {
        activeObservationCount: { $gt: 1 },
        distinctValueCount: { $gt: 1 },
      },
    },
    { $sort: { activeObservationCount: -1, '_id.sourceName': 1, '_id.field': 1 } },
    { $limit: args.limit },
  ]).exec()) as AggregatedObservationConflictGroup[];

  return rows.map((row) => ({
    sourceName: row._id.sourceName || 'unknown',
    entityType: row._id.entityType || 'unknown',
    entityId: stringifyId(row._id.entityId) || undefined,
    entityKey: row._id.entityKey || undefined,
    field: row._id.field || 'unknown',
    observations: (row.observations || []).map((observation) => ({
      id: stringifyId(observation.id),
      value: observation.value,
      observedAt: observation.observedAt,
      sourceUrl: observation.sourceUrl,
      confidence: observation.confidence,
    })),
  }));
}

function buildCandidateSample(
  group: StaleObservationConflictGroup,
): StaleObservationConflictSample | null {
  const observations = [...group.observations].sort(compareObservationsByNewest);
  const keep = observations[0];
  if (!keep) {
    return null;
  }

  const keepSerializedValue = serializeValue(keep.value);
  const reviewCategory = reviewCategoryForField(group.field);
  const reviewQueue = reviewQueueForCategory(reviewCategory);
  const supersedeCandidates = observations
    .slice(1)
    .filter((observation) => serializeValue(observation.value) !== keepSerializedValue);

  if (supersedeCandidates.length === 0) {
    return null;
  }

  const distinctValueCount = new Set(observations.map((observation) => serializeValue(observation.value)))
    .size;

  return {
    sourceName: group.sourceName,
    entityType: group.entityType,
    entityId: group.entityId,
    entityKey: group.entityKey,
    field: group.field,
    reviewCategory,
    reviewQueue,
    activeObservationCount: observations.length,
    distinctValueCount,
    keepObservationId: keep.id,
    keepObservedAt: formatOptionalDate(keep.observedAt),
    keepValuePreview: previewValue(keep.value),
    supersedeObservationIds: supersedeCandidates.map((observation) => observation.id),
    supersedeValuePreviews: supersedeCandidates.map((observation) => previewValue(observation.value)),
  };
}

function matchesReviewFilters(
  sample: StaleObservationConflictSample,
  filters: {
    reviewQueue?: StaleObservationReviewQueue;
    reviewCategory?: StaleObservationReviewCategory;
    field?: string;
  },
): boolean {
  if (filters.field && sample.field !== filters.field) return false;
  if (filters.reviewCategory && sample.reviewCategory !== filters.reviewCategory) return false;
  if (filters.reviewQueue && sample.reviewQueue !== filters.reviewQueue) return false;
  return true;
}

function buildSupersessionPlan(
  sample: StaleObservationConflictSample,
): StaleObservationSupersessionPlan {
  return {
    planId: [
      sample.sourceName,
      sample.entityType,
      sample.entityKey || sample.entityId || 'unknown-entity',
      sample.field,
    ].join(':'),
    sourceName: sample.sourceName,
    entityType: sample.entityType,
    entityId: sample.entityId,
    entityKey: sample.entityKey,
    field: sample.field,
    reviewCategory: sample.reviewCategory,
    reviewQueue: sample.reviewQueue,
    keepObservationId: sample.keepObservationId,
    supersedeObservationIds: sample.supersedeObservationIds,
    supersedeCount: sample.supersedeObservationIds.length,
    applyBlocked: true,
    applyBlockedReason: APPLY_BLOCKED_REASON,
  };
}

function compareSamplesForReview(
  left: StaleObservationConflictSample,
  right: StaleObservationConflictSample,
): number {
  return (
    reviewQueueRank(left.reviewQueue) - reviewQueueRank(right.reviewQueue) ||
    right.distinctValueCount - left.distinctValueCount ||
    right.activeObservationCount - left.activeObservationCount ||
    left.sourceName.localeCompare(right.sourceName) ||
    left.entityType.localeCompare(right.entityType) ||
    (left.entityKey || left.entityId || '').localeCompare(right.entityKey || right.entityId || '') ||
    left.field.localeCompare(right.field)
  );
}

function buildCategoryCounts(
  samples: StaleObservationConflictSample[],
): Array<{ category: StaleObservationReviewCategory; count: number }> {
  const counts = new Map<StaleObservationReviewCategory, number>();
  for (const sample of samples) {
    counts.set(sample.reviewCategory, (counts.get(sample.reviewCategory) || 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([category, count]) => ({ category, count }))
    .sort((left, right) => right.count - left.count || left.category.localeCompare(right.category));
}

function buildFieldCounts(
  samples: StaleObservationConflictSample[],
): Array<{ field: string; count: number }> {
  const counts = new Map<string, number>();
  for (const sample of samples) {
    counts.set(sample.field, (counts.get(sample.field) || 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([field, count]) => ({ field, count }))
    .sort((left, right) => right.count - left.count || left.field.localeCompare(right.field));
}

function buildPolicyBucketCounts(
  samples: StaleObservationConflictSample[],
): Array<{ policyBucket: StaleObservationReviewPolicyBucket; count: number }> {
  const counts = new Map<StaleObservationReviewPolicyBucket, number>();
  for (const sample of samples) {
    const policyBucket = policyBucketForCategory(sample.reviewCategory);
    counts.set(policyBucket, (counts.get(policyBucket) || 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([policyBucket, count]) => ({ policyBucket, count }))
    .sort((left, right) =>
      right.count - left.count || left.policyBucket.localeCompare(right.policyBucket),
    );
}

function policyBucketForCategory(
  category: StaleObservationReviewCategory,
): StaleObservationReviewPolicyBucket {
  if (category === 'identity_or_routing') return 'stale_identity_or_routing_review';
  if (category === 'content') return 'stale_description_review';
  if (category === 'access_evidence') return 'stale_access_evidence_review';
  if (category === 'additive_metadata') return 'stale_metadata_merge_review';
  if (category === 'funding_context') return 'stale_funding_context_review';
  return 'stale_manual_review';
}

function buildReviewQueues(
  categoryCounts: Array<{ category: StaleObservationReviewCategory; count: number }>,
): StaleObservationConflictSummary['reviewQueues'] {
  return REVIEW_QUEUE_DEFINITIONS.map((definition) => {
    const categories = categoryCounts
      .filter((item) => reviewQueueForCategory(item.category) === definition.queue)
      .sort((left, right) => right.count - left.count || left.category.localeCompare(right.category));
    return {
      queue: definition.queue,
      label: definition.label,
      count: categories.reduce((sum, item) => sum + item.count, 0),
      categories,
    };
  });
}

function reviewCategoryForField(field: string): StaleObservationReviewCategory {
  if (ADDITIVE_METADATA_CONFLICT_FIELDS.has(field)) return 'additive_metadata';
  if (IDENTITY_OR_ROUTING_CONFLICT_FIELDS.has(field)) return 'identity_or_routing';
  if (CONTENT_CONFLICT_FIELDS.has(field)) return 'content';
  if (ACCESS_EVIDENCE_CONFLICT_FIELDS.has(field)) return 'access_evidence';
  if (FUNDING_CONTEXT_CONFLICT_FIELDS.has(field)) return 'funding_context';
  return 'other';
}

function reviewQueueForCategory(
  category: StaleObservationReviewCategory,
): StaleObservationReviewQueue {
  if (PRIORITY_REVIEW_CATEGORIES.has(category)) return 'priority_review';
  if (METADATA_REVIEW_CATEGORIES.has(category)) return 'metadata_review';
  return 'context_review';
}

function reviewQueueRank(queue: StaleObservationReviewQueue): number {
  if (queue === 'priority_review') return 0;
  if (queue === 'context_review') return 1;
  return 2;
}

function buildMongoFieldFilter(
  args: StaleObservationConflictReviewArgs,
): string | { $in?: string[]; $nin?: string[] } | undefined {
  if (args.field) return args.field;
  if (args.reviewCategory) return mongoFieldFilterForCategory(args.reviewCategory);
  if (args.reviewQueue) {
    if (args.reviewQueue === 'priority_review') {
      return {
        $in: [
          ...IDENTITY_OR_ROUTING_CONFLICT_FIELDS,
          ...CONTENT_CONFLICT_FIELDS,
          ...ACCESS_EVIDENCE_CONFLICT_FIELDS,
        ],
      };
    }
    if (args.reviewQueue === 'metadata_review') {
      return { $in: [...ADDITIVE_METADATA_CONFLICT_FIELDS] };
    }
    return {
      $nin: [
        ...IDENTITY_OR_ROUTING_CONFLICT_FIELDS,
        ...CONTENT_CONFLICT_FIELDS,
        ...ACCESS_EVIDENCE_CONFLICT_FIELDS,
        ...ADDITIVE_METADATA_CONFLICT_FIELDS,
      ],
    };
  }
  return undefined;
}

function mongoFieldFilterForCategory(
  category: StaleObservationReviewCategory,
): string | { $in?: string[]; $nin?: string[] } | undefined {
  if (category === 'identity_or_routing') return { $in: [...IDENTITY_OR_ROUTING_CONFLICT_FIELDS] };
  if (category === 'access_evidence') return { $in: [...ACCESS_EVIDENCE_CONFLICT_FIELDS] };
  if (category === 'content') return { $in: [...CONTENT_CONFLICT_FIELDS] };
  if (category === 'funding_context') return { $in: [...FUNDING_CONTEXT_CONFLICT_FIELDS] };
  if (category === 'additive_metadata') return { $in: [...ADDITIVE_METADATA_CONFLICT_FIELDS] };
  return { $nin: [...ALL_KNOWN_CONFLICT_FIELDS] };
}

function compareObservationsByNewest(
  left: StaleObservationConflictObservation,
  right: StaleObservationConflictObservation,
): number {
  const leftTime = observedAtMs(left.observedAt);
  const rightTime = observedAtMs(right.observedAt);
  if (leftTime !== rightTime) {
    return rightTime - leftTime;
  }
  return right.id.localeCompare(left.id);
}

function observedAtMs(value: Date | string | undefined): number {
  if (!value) return 0;
  const date = value instanceof Date ? value : new Date(value);
  const time = date.getTime();
  return Number.isNaN(time) ? 0 : time;
}

function formatOptionalDate(value: Date | string | undefined): string | undefined {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function serializeValue(value: unknown): string {
  if (value === null || value === undefined) return '__null__';
  if (typeof value === 'string') return `s:${value.trim().toLowerCase()}`;
  if (typeof value === 'number' || typeof value === 'boolean') return `p:${String(value)}`;
  if (Array.isArray(value)) return `[${value.map(serializeValue).sort().join(',')}]`;
  if (typeof value === 'object') {
    const objectValue = value as Record<string, unknown>;
    return `{${Object.keys(objectValue)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${serializeValue(objectValue[key])}`)
      .join(',')}}`;
  }
  return `p:${String(value)}`;
}

function previewValue(value: unknown): string {
  let raw: string;
  if (typeof value === 'string') {
    raw = value;
  } else {
    try {
      raw = JSON.stringify(value);
    } catch {
      raw = String(value);
    }
  }

  const redacted = redactDirectContactInfo(raw).replace(/\s+/g, ' ').trim();
  return redacted.length > MAX_VALUE_PREVIEW_LENGTH
    ? `${redacted.slice(0, MAX_VALUE_PREVIEW_LENGTH - 3)}...`
    : redacted;
}

function parsePositiveIntegerValue(raw: string, flagName: string): number {
  if (!/^[1-9]\d*$/.test(raw)) {
    throw new Error(`${flagName} must be a positive integer`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${flagName} must be a positive integer`);
  }
  return value;
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
  raw: string,
  flagName: string,
  requirement = 'a value',
): string {
  const value = raw.trim();
  if (!value || value.startsWith('--')) {
    throw new Error(`${flagName} requires ${requirement}`);
  }
  return value;
}

function parseReviewQueue(raw: string): StaleObservationReviewQueue {
  const value = parseRequiredString(raw, '--queue');
  if (
    value === 'priority_review' ||
    value === 'context_review' ||
    value === 'metadata_review'
  ) {
    return value;
  }
  throw new Error('--queue must be priority_review, context_review, or metadata_review');
}

function parseReviewCategory(raw: string): StaleObservationReviewCategory {
  const value = parseRequiredString(raw, '--category');
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

function stringifyId(value: unknown): string {
  return serializedDocumentId(value) || '';
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function optionalString(value: unknown): string | undefined {
  const stringValue = asString(value).trim();
  return stringValue || undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const strings = value.filter(
    (item): item is string => typeof item === 'string' && item.trim().length > 0,
  );
  return strings.length > 0 ? strings : undefined;
}

function sameStringSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const leftSet = new Set(left);
  if (leftSet.size !== right.length) return false;
  return right.every((value) => leftSet.has(value));
}

async function main(): Promise<void> {
  const args = parseStaleObservationConflictReviewArgs(process.argv.slice(2));
  const guard = assertStaleObservationConflictReviewApplyAllowed(
    args,
    process.env,
    process.env.MONGODBURL,
  );
  await initializeConnections();
  const summary = await runStaleObservationConflictReview(args);
  const output = buildStaleObservationConflictReviewOutput(summary, {
    environment: guard.environment,
    db: mongoose.connection.db?.databaseName || mongoose.connection.name || guard.dbLabel,
    options: args,
  });
  console.log(JSON.stringify(output, null, 2));
  writeStaleObservationConflictReviewOutput(output, args.output);
  writeStaleObservationDecisionTemplate(
    buildStaleObservationDecisionTemplate(summary.plans, summary.generatedAt),
    args.decisionTemplateOutput,
  );
}

const __filename = fileURLToPath(import.meta.url);
const isDirectRun = process.argv[1] ? path.resolve(process.argv[1]) === __filename : false;

if (isDirectRun) {
  main()
    .catch((error) => {
      console.error(sanitizeLogValue(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}

import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import type { Collection, Document } from 'mongodb';
import { initializeConnections } from '../db/connections';
import {
  buildDuplicateEntityReviewSummary,
  classifyDuplicateEntityCluster,
  type DuplicateEntityReviewCategory,
  type DuplicateEntityReviewEntity,
  type DuplicateEntityReviewSummary,
} from './betaDataQualityCore';
import {
  applyResearchEntityDedupeGroupsSequentially,
  applyResearchEntityDedupeMergeGroup,
  type ResearchEntityDedupeMergeGroup,
} from './dedupeResearchEntitiesByPi';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import { serializedDocumentId } from '../utils/idSerialization';
import { sanitizeLogValue } from '../utils/logSanitizer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const ACTIVE_FILTER = { archived: { $ne: true } };
const DEFAULT_LIMIT = 10000;
const DEFAULT_PLAN_LIMIT = 100;
const DEFAULT_MAX_APPLY = 10;
const MAX_ENTITIES_PER_CLUSTER = 10;
const REVIEW_DECISION_APPLY_STATUS =
  'Accepted duplicate-name decisions can drive apply mode for shared-website, zero-reference cross-department, or specific-website cross-department merge_into_canonical plans; ambiguous manual disambiguation decisions remain review-only.';
const DUPLICATE_ENTITY_NAME_REVIEW_OBJECT_ID_RE = /^[a-f0-9]{24}$/i;

const EMPTY_REFERENCE_IMPACT_COUNTS: DuplicateEntityReferenceImpactCounts = {
  entryPathways: 0,
  accessSignals: 0,
  contactRoutes: 0,
  researchEntityMembers: 0,
  researchScholarlyLinks: 0,
  researchScholarlyAttributions: 0,
  postedOpportunities: 0,
  listings: 0,
  observations: 0,
};

export function normalizeDuplicateEntityNameReviewObjectId(
  value: unknown,
): mongoose.Types.ObjectId | undefined {
  if (value instanceof mongoose.Types.ObjectId) return value;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!DUPLICATE_ENTITY_NAME_REVIEW_OBJECT_ID_RE.test(trimmed)) return undefined;
  return new mongoose.Types.ObjectId(trimmed);
}

const REFERENCE_IMPACT_COLLECTIONS: Array<{
  key: keyof DuplicateEntityReferenceImpactCounts;
  collectionName: string;
  field: string;
  array?: boolean;
  match?: Record<string, unknown>;
}> = [
  {
    key: 'entryPathways',
    collectionName: 'entry_pathways',
    field: 'researchEntityId',
    match: ACTIVE_FILTER,
  },
  {
    key: 'accessSignals',
    collectionName: 'access_signals',
    field: 'researchEntityId',
    match: ACTIVE_FILTER,
  },
  {
    key: 'contactRoutes',
    collectionName: 'contact_routes',
    field: 'researchEntityId',
    match: ACTIVE_FILTER,
  },
  {
    key: 'researchEntityMembers',
    collectionName: 'research_entity_members',
    field: 'researchEntityId',
    match: ACTIVE_FILTER,
  },
  {
    key: 'researchScholarlyLinks',
    collectionName: 'research_scholarly_links',
    field: 'researchEntityId',
    match: ACTIVE_FILTER,
  },
  {
    key: 'researchScholarlyAttributions',
    collectionName: 'research_scholarly_attributions',
    field: 'researchEntityId',
    match: ACTIVE_FILTER,
  },
  {
    key: 'postedOpportunities',
    collectionName: 'posted_opportunities',
    field: 'researchEntityId',
    match: ACTIVE_FILTER,
  },
  {
    key: 'listings',
    collectionName: 'listings',
    field: 'researchEntityId',
    match: ACTIVE_FILTER,
  },
  {
    key: 'observations',
    collectionName: 'observations',
    field: 'entityId',
    match: { entityType: 'researchEntity', superseded: { $ne: true } },
  },
];

export interface DuplicateEntityNameReviewArgs {
  apply: boolean;
  confirmDuplicateEntityNameReview: boolean;
  limit: number;
  limitProvided: boolean;
  category?: DuplicateEntityReviewCategory;
  planLimit: number;
  maxApply: number;
  acceptedDecisions?: string;
  allowEmptyDecisions?: boolean;
  decisionTemplateOutput?: string;
  output?: string;
}

interface DuplicateEntityNameReviewEntity extends DuplicateEntityReviewEntity {
  school?: string;
  schools?: string[];
  researchAreas?: string[];
}

export interface DuplicateEntityNameReviewCluster {
  normalizedName: string;
  count: number;
  reviewCategory: DuplicateEntityReviewCategory;
  entities: DuplicateEntityNameReviewEntity[];
}

export interface DuplicateEntityNameReviewPlan {
  planId: string;
  normalizedName: string;
  reviewCategory: DuplicateEntityReviewCategory;
  entityIds: string[];
  entitySlugs: string[];
  sharedWebsiteUrl?: string;
  proposedAction: 'review_for_merge_or_aliasing' | 'manual_disambiguation_review';
  canonicalEntityId?: string;
  referenceImpact?: DuplicateEntityReferenceImpactSummary;
  reviewPreflight: DuplicateEntityNameReviewPreflight;
  applyBlocked: boolean;
  applyStatus: string;
}

export type DuplicateEntityNameReviewPreflightStatus =
  | 'merge_preflight_ready_for_review'
  | 'manual_disambiguation_required';

export interface DuplicateEntityNameReviewPreflight {
  status: DuplicateEntityNameReviewPreflightStatus;
  referenceRewriteRequired: boolean;
  totalReferencesImpacted: number;
  blockers: string[];
  requiredReviewerDecisions: string[];
}

export interface DuplicateEntityReferenceImpactCounts {
  entryPathways: number;
  accessSignals: number;
  contactRoutes: number;
  researchEntityMembers: number;
  researchScholarlyLinks: number;
  researchScholarlyAttributions: number;
  postedOpportunities: number;
  listings: number;
  observations: number;
}

export type DuplicateEntityReferenceImpactByEntityId = Record<
  string,
  DuplicateEntityReferenceImpactCounts
>;

export interface DuplicateEntityReferenceImpactSummary {
  totalReferences: number;
  byEntity: Array<{
    entityId: string;
    totalReferences: number;
    counts: DuplicateEntityReferenceImpactCounts;
  }>;
}

export interface DuplicateEntityNameReviewPlanSummary {
  category?: DuplicateEntityReviewCategory;
  planLimit: number;
  plannedClusterCount: number;
  plannedEntityCount: number;
  planTruncated: boolean;
  preflightSummary: DuplicateEntityNameReviewPreflightSummary;
  plans: DuplicateEntityNameReviewPlan[];
}

export interface DuplicateEntityNameReviewPreflightSummary {
  mergePreflightReadyForReview: number;
  manualDisambiguationRequired: number;
  withReferenceRewrite: number;
  totalReferencesImpacted: number;
  requiredReviewerDecisions: Array<{ decision: string; count: number }>;
}

export interface DuplicateEntityNameReviewDecision {
  planId: string;
  decision: string;
  canonicalEntityId?: string;
  reviewedBy?: string;
  reviewNote?: string;
}

export interface DuplicateEntityNameReviewDecisionValidationRow {
  planId: string;
  decision: string;
  canonicalEntityId?: string;
  reviewedBy?: string;
  status: 'valid' | 'invalid';
  errors: string[];
}

export interface DuplicateEntityNameReviewDecisionValidationSummary {
  artifactPath?: string;
  applyBlocked: boolean;
  applyStatus: string;
  totalDecisions: number;
  validDecisionCount: number;
  invalidDecisionCount: number;
  unmatchedPlanDecisionCount: number;
  duplicatePlanDecisionCount: number;
  unreviewedPlanCount: number;
  decisionsByType: Array<{ decision: string; count: number }>;
  decisions: DuplicateEntityNameReviewDecisionValidationRow[];
}

export interface DuplicateEntityNameReviewDecisionTemplate {
  generatedAt: string;
  applyBlocked: boolean;
  applyStatus: string;
  acceptedDecisionValues: ['merge_into_canonical', 'mark_distinct_homes', 'defer_review'];
  decisions: Array<{
    planId: string;
    normalizedName: string;
    reviewCategory: DuplicateEntityReviewCategory;
    entityIds: string[];
    entitySlugs: string[];
    sharedWebsiteUrl?: string;
    reviewPreflightStatus: DuplicateEntityNameReviewPreflightStatus;
    referenceRewriteRequired: boolean;
    totalReferencesImpacted: number;
    requiredReviewerDecisions: string[];
    decision: '';
    canonicalEntityId: '';
    reviewedBy: '';
    reviewNote: '';
  }>;
}

export interface DuplicateEntityNameReviewReport {
  generatedAt: string;
  mongoTarget?: string;
  mode: 'dry-run' | 'apply';
  applyBlocked: boolean;
  applyStatus: string;
  clusterLimit: number;
  clusterCount: number;
  entityCountInClusters: number;
  reviewSummary: DuplicateEntityReviewSummary;
  planSummary: DuplicateEntityNameReviewPlanSummary;
  reviewDecisionValidation?: DuplicateEntityNameReviewDecisionValidationSummary;
  applied?: Array<Awaited<ReturnType<typeof applyResearchEntityDedupeMergeGroup>>>;
  clusters: DuplicateEntityNameReviewCluster[];
  nextAction: string;
}

function consumeValue(
  argv: string[],
  index: number,
  flag: string,
  noun: 'number' | 'path' | 'value',
): { value: string; nextIndex: number } {
  const value = argv[index + 1];
  if (value === undefined || value.trim() === '' || value.startsWith('--')) {
    throw new Error(`${flag} requires a ${noun}`);
  }
  return { value, nextIndex: index + 1 };
}

function consumeInlineValue(arg: string, flag: string, noun: 'number' | 'path' | 'value'): string {
  const value = arg.slice(`${flag}=`.length);
  if (value.trim() === '' || value.startsWith('--')) {
    throw new Error(`${flag} requires a ${noun}`);
  }
  return value;
}

export function parseDuplicateEntityNameReviewArgs(argv: string[]): DuplicateEntityNameReviewArgs {
  const args: DuplicateEntityNameReviewArgs = {
    apply: false,
    confirmDuplicateEntityNameReview: false,
    limit: DEFAULT_LIMIT,
    limitProvided: false,
    planLimit: DEFAULT_PLAN_LIMIT,
    maxApply: DEFAULT_MAX_APPLY,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply') {
      args.apply = true;
      continue;
    }
    if (arg === '--confirm-duplicate-entity-name-review') {
      args.confirmDuplicateEntityNameReview = true;
      continue;
    }
    if (arg.startsWith('--confirm-duplicate-entity-name-review=')) {
      throw new Error('--confirm-duplicate-entity-name-review does not accept a value');
    }
    if (arg === '--mode=dry-run' || arg === '--dry-run') {
      args.apply = false;
      continue;
    }
    if (arg.startsWith('--limit=')) {
      args.limit = parsePositiveIntegerValue(
        consumeInlineValue(arg, '--limit', 'number'),
        '--limit',
      );
      args.limitProvided = true;
      continue;
    }
    if (arg === '--limit') {
      const { value, nextIndex } = consumeValue(argv, index, '--limit', 'number');
      args.limit = parsePositiveIntegerValue(value, '--limit');
      args.limitProvided = true;
      index = nextIndex;
      continue;
    }
    if (arg.startsWith('--category=')) {
      args.category = parseDuplicateEntityReviewCategory(
        consumeInlineValue(arg, '--category', 'value'),
      );
      continue;
    }
    if (arg === '--category') {
      const { value, nextIndex } = consumeValue(argv, index, '--category', 'value');
      args.category = parseDuplicateEntityReviewCategory(value);
      index = nextIndex;
      continue;
    }
    if (arg.startsWith('--plan-limit=')) {
      args.planLimit = parsePositiveIntegerValue(
        consumeInlineValue(arg, '--plan-limit', 'number'),
        '--plan-limit',
      );
      continue;
    }
    if (arg === '--plan-limit') {
      const { value, nextIndex } = consumeValue(argv, index, '--plan-limit', 'number');
      args.planLimit = parsePositiveIntegerValue(value, '--plan-limit');
      index = nextIndex;
      continue;
    }
    if (arg.startsWith('--max-apply=')) {
      args.maxApply = parsePositiveIntegerValue(
        consumeInlineValue(arg, '--max-apply', 'number'),
        '--max-apply',
      );
      continue;
    }
    if (arg === '--max-apply') {
      const { value, nextIndex } = consumeValue(argv, index, '--max-apply', 'number');
      args.maxApply = parsePositiveIntegerValue(value, '--max-apply');
      index = nextIndex;
      continue;
    }
    if (arg === '--output') {
      const { value, nextIndex } = consumeValue(argv, index, '--output', 'path');
      args.output = resolveSafeJsonReportOutputPath(value);
      index = nextIndex;
      continue;
    }
    if (arg.startsWith('--output=')) {
      args.output = resolveSafeJsonReportOutputPath(consumeInlineValue(arg, '--output', 'path'));
      continue;
    }
    if (arg === '--accepted-decisions') {
      const { value, nextIndex } = consumeValue(argv, index, '--accepted-decisions', 'path');
      args.acceptedDecisions = resolveSafeJsonReportOutputPath(value, '--accepted-decisions');
      index = nextIndex;
      continue;
    }
    if (arg.startsWith('--accepted-decisions=')) {
      args.acceptedDecisions = resolveSafeJsonReportOutputPath(
        consumeInlineValue(arg, '--accepted-decisions', 'path'),
        '--accepted-decisions',
      );
      continue;
    }
    if (arg === '--allow-empty-decisions') {
      args.allowEmptyDecisions = true;
      continue;
    }
    if (arg === '--decision-template-output') {
      const { value, nextIndex } = consumeValue(argv, index, '--decision-template-output', 'path');
      args.decisionTemplateOutput = resolveSafeJsonReportOutputPath(
        value,
        '--decision-template-output',
      );
      index = nextIndex;
      continue;
    }
    if (arg.startsWith('--decision-template-output=')) {
      args.decisionTemplateOutput = resolveSafeJsonReportOutputPath(
        consumeInlineValue(arg, '--decision-template-output', 'path'),
        '--decision-template-output',
      );
      continue;
    }

    throw new Error(`Unknown duplicate-name review option: ${arg}`);
  }

  return args;
}

export function buildDuplicateEntityNameReviewPlans(
  clusters: DuplicateEntityNameReviewCluster[],
  options: {
    category?: DuplicateEntityReviewCategory;
    planLimit?: number;
    referenceImpactByEntityId?: DuplicateEntityReferenceImpactByEntityId;
  } = {},
): DuplicateEntityNameReviewPlanSummary {
  const planLimit = options.planLimit || DEFAULT_PLAN_LIMIT;
  const eligibleClusters = clusters.filter(
    (cluster) => !options.category || cluster.reviewCategory === options.category,
  );
  const plans = eligibleClusters
    .slice(0, planLimit)
    .map((cluster) =>
      buildDuplicateEntityNameReviewPlan(cluster, options.referenceImpactByEntityId),
    );

  return {
    category: options.category,
    planLimit,
    plannedClusterCount: plans.length,
    plannedEntityCount: plans.reduce((sum, plan) => sum + plan.entityIds.length, 0),
    planTruncated: eligibleClusters.length > plans.length,
    preflightSummary: buildDuplicateEntityNameReviewPreflightSummary(plans),
    plans,
  };
}

export function writeDuplicateEntityNameReviewOutput(
  report: DuplicateEntityNameReviewReport,
  output?: string,
): void {
  if (!output) return;
  const safeOutput = resolveSafeJsonReportOutputPath(output);
  fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
  fs.writeFileSync(safeOutput, `${JSON.stringify(report, null, 2)}\n`);
}

export function buildDuplicateEntityNameReviewOutput(
  report: DuplicateEntityNameReviewReport,
  metadata: {
    environment: string;
    db: string;
    options: DuplicateEntityNameReviewArgs;
  },
): DuplicateEntityNameReviewReport & {
  environment: string;
  db: string;
  options: DuplicateEntityNameReviewArgs;
} {
  return {
    environment: metadata.environment,
    db: metadata.db,
    options: metadata.options,
    ...report,
  };
}

export function writeDuplicateEntityNameReviewDecisionTemplate(
  template: DuplicateEntityNameReviewDecisionTemplate,
  output?: string,
): void {
  if (!output) return;
  const safeOutput = resolveSafeJsonReportOutputPath(output, '--decision-template-output');
  fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
  fs.writeFileSync(safeOutput, `${JSON.stringify(template, null, 2)}\n`);
}

export function buildDuplicateEntityNameReviewDecisionTemplate(
  plans: DuplicateEntityNameReviewPlan[],
  generatedAt = new Date().toISOString(),
): DuplicateEntityNameReviewDecisionTemplate {
  return {
    generatedAt,
    applyBlocked: false,
    applyStatus: REVIEW_DECISION_APPLY_STATUS,
    acceptedDecisionValues: ['merge_into_canonical', 'mark_distinct_homes', 'defer_review'],
    decisions: plans.map((plan) => ({
      planId: plan.planId,
      normalizedName: plan.normalizedName,
      reviewCategory: plan.reviewCategory,
      entityIds: plan.entityIds,
      entitySlugs: plan.entitySlugs,
      sharedWebsiteUrl: plan.sharedWebsiteUrl,
      reviewPreflightStatus: plan.reviewPreflight.status,
      referenceRewriteRequired: plan.reviewPreflight.referenceRewriteRequired,
      totalReferencesImpacted: plan.reviewPreflight.totalReferencesImpacted,
      requiredReviewerDecisions: plan.reviewPreflight.requiredReviewerDecisions,
      decision: '',
      canonicalEntityId: '',
      reviewedBy: '',
      reviewNote: '',
    })),
  };
}

export function readDuplicateEntityNameReviewDecisions(
  inputPath: string,
  options: { allowEmpty?: boolean } = {},
): DuplicateEntityNameReviewDecision[] {
  const safeInputPath = resolveSafeJsonReportOutputPath(inputPath, '--accepted-decisions');
  if (!fs.existsSync(safeInputPath) && options.allowEmpty) {
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
      'Accepted decisions artifact must be a JSON array or an object with a decisions array.',
    );
  }

  return decisions.map((raw, index) => normalizeDuplicateEntityNameReviewDecision(raw, index));
}

export function validateDuplicateEntityNameReviewDecisions(
  plans: DuplicateEntityNameReviewPlan[],
  decisions: DuplicateEntityNameReviewDecision[],
  artifactPath?: string,
): DuplicateEntityNameReviewDecisionValidationSummary {
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
    validateDuplicateEntityNameReviewDecision(decision, planById, planIdCounts),
  );
  const validPlanIds = new Set(
    rows
      .filter((row) => row.status === 'valid')
      .map((row) => row.planId)
      .filter(Boolean),
  );

  return {
    artifactPath,
    applyBlocked: false,
    applyStatus: REVIEW_DECISION_APPLY_STATUS,
    totalDecisions: decisions.length,
    validDecisionCount: rows.filter((row) => row.status === 'valid').length,
    invalidDecisionCount: rows.filter((row) => row.status === 'invalid').length,
    unmatchedPlanDecisionCount: rows.filter((row) =>
      row.errors.includes('No generated duplicate-name plan matches this planId.'),
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

export function selectDuplicateEntityNamePlansForAcceptedMergeApply(
  plans: DuplicateEntityNameReviewPlan[],
  validation: DuplicateEntityNameReviewDecisionValidationSummary,
): Array<{ plan: DuplicateEntityNameReviewPlan; canonicalEntityId: string }> {
  if (validation.invalidDecisionCount > 0) {
    throw new Error('Accepted duplicate-name decisions contain invalid rows; refusing apply.');
  }
  const planById = new Map(plans.map((plan) => [plan.planId, plan]));
  return validation.decisions
    .filter(
      (decision) => decision.status === 'valid' && decision.decision === 'merge_into_canonical',
    )
    .map((decision) => {
      const plan = planById.get(decision.planId);
      if (!plan || !decision.canonicalEntityId) return undefined;
      return { plan, canonicalEntityId: decision.canonicalEntityId };
    })
    .filter(
      (
        selection,
      ): selection is { plan: DuplicateEntityNameReviewPlan; canonicalEntityId: string } =>
        Boolean(selection),
    );
}

export function buildDuplicateEntityNameMergeGroups(
  selections: Array<{ plan: DuplicateEntityNameReviewPlan; canonicalEntityId: string }>,
  clusters: DuplicateEntityNameReviewCluster[],
): ResearchEntityDedupeMergeGroup[] {
  const entityById = new Map(
    clusters.flatMap((cluster) => cluster.entities.map((entity) => [entity.id, entity] as const)),
  );
  return selections.map(({ plan, canonicalEntityId }) => {
    const duplicateEntityIds = plan.entityIds.filter((id) => id !== canonicalEntityId);
    const entities = plan.entityIds.map((id) => entityById.get(id)).filter(Boolean);
    return {
      canonicalEntityId,
      duplicateEntityIds,
      mergedDepartments: uniqueStrings(entities.flatMap((entity) => entity?.departments || [])),
      mergedResearchAreas: uniqueStrings(entities.flatMap((entity) => entity?.researchAreas || [])),
      mergedSourceUrls: uniqueStrings(
        entities.flatMap((entity) => [
          ...(entity?.sourceUrls || []),
          entity?.websiteUrl,
          entity?.website,
        ]),
      ),
    };
  });
}

export function assertDuplicateEntityNameReviewApplyAllowed(args: {
  apply: boolean;
  confirmDuplicateEntityNameReview: boolean;
  limitProvided: boolean;
  acceptedDecisions?: string;
  maxApply: number;
  plannedDuplicateEntities: number;
}): void {
  if (!args.apply) return;
  if (!args.limitProvided) {
    throw new Error('--limit is required when --apply is set.');
  }
  if (!args.confirmDuplicateEntityNameReview) {
    throw new Error(
      '--confirm-duplicate-entity-name-review is required when --apply is set for research-entity:duplicate-name-review.',
    );
  }
  if (!args.acceptedDecisions) {
    throw new Error('--accepted-decisions is required when --apply is set.');
  }
  if (args.plannedDuplicateEntities > args.maxApply) {
    throw new Error(`Apply would modify ${args.plannedDuplicateEntities} rows, above --max-apply.`);
  }
}

async function buildDuplicateEntityNameReviewReport(
  args: DuplicateEntityNameReviewArgs,
): Promise<DuplicateEntityNameReviewReport> {
  const rows = (await collection('research_entities')
    .aggregate([
      { $match: { ...ACTIVE_FILTER, name: { $exists: true, $ne: '' } } },
      {
        $project: {
          normalizedName: { $toLower: { $trim: { input: '$name' } } },
          name: 1,
          slug: 1,
          kind: 1,
          entityType: 1,
          school: 1,
          schools: 1,
          departments: 1,
          researchAreas: 1,
          website: 1,
          websiteUrl: 1,
          sourceUrls: 1,
        },
      },
      { $match: { normalizedName: { $ne: '' } } },
      {
        $group: {
          _id: '$normalizedName',
          count: { $sum: 1 },
          entities: { $push: '$$ROOT' },
        },
      },
      { $match: { count: { $gt: 1 } } },
      { $sort: { count: -1, _id: 1 } },
      { $limit: args.limit },
    ])
    .toArray()) as Array<Document & { _id: string; count: number; entities: Document[] }>;

  const clusters = rows.map((row) => {
    const cluster = {
      normalizedName: row._id,
      count: row.count,
      entities: row.entities.slice(0, MAX_ENTITIES_PER_CLUSTER).map((entity) => ({
        id: stringifyId(entity._id),
        name: asString(entity.name),
        slug: optionalString(entity.slug),
        kind: optionalString(entity.kind),
        entityType: optionalString(entity.entityType),
        school: optionalString(entity.school),
        schools: asStringArray(entity.schools),
        departments: asStringArray(entity.departments),
        researchAreas: asStringArray(entity.researchAreas),
        website: optionalString(entity.website),
        websiteUrl: optionalString(entity.websiteUrl),
        sourceUrls: asStringArray(entity.sourceUrls),
      })),
    };
    return {
      ...cluster,
      reviewCategory: classifyDuplicateEntityCluster(cluster),
    } satisfies DuplicateEntityNameReviewCluster;
  });
  const referenceImpactByEntityId = await loadReferenceImpactByEntityId(
    clusters.flatMap((cluster) => cluster.entities.map((entity) => entity.id)),
  );
  const planSummary = buildDuplicateEntityNameReviewPlans(clusters, {
    category: args.category,
    planLimit: args.planLimit,
    referenceImpactByEntityId,
  });
  const reviewDecisionValidation = args.acceptedDecisions
    ? validateDuplicateEntityNameReviewDecisions(
        planSummary.plans,
        readDuplicateEntityNameReviewDecisions(args.acceptedDecisions, {
          allowEmpty: Boolean(args.allowEmptyDecisions),
        }),
        args.acceptedDecisions,
      )
    : undefined;
  const acceptedMergeSelections =
    reviewDecisionValidation && args.apply
      ? selectDuplicateEntityNamePlansForAcceptedMergeApply(
          planSummary.plans,
          reviewDecisionValidation,
        )
      : [];
  const mergeGroups = buildDuplicateEntityNameMergeGroups(acceptedMergeSelections, clusters);
  assertDuplicateEntityNameReviewApplyAllowed({
    apply: args.apply,
    confirmDuplicateEntityNameReview: args.confirmDuplicateEntityNameReview,
    limitProvided: args.limitProvided,
    acceptedDecisions: args.acceptedDecisions,
    maxApply: args.maxApply,
    plannedDuplicateEntities: mergeGroups.reduce(
      (sum, group) => sum + group.duplicateEntityIds.length,
      0,
    ),
  });
  const applied = args.apply
    ? await applyResearchEntityDedupeGroupsSequentially(mergeGroups, (group) =>
        applyResearchEntityDedupeMergeGroup(group, {
          deleteDuplicates: false,
          relinkReferences: true,
        }),
      )
    : [];

  return {
    generatedAt: new Date().toISOString(),
    mongoTarget: describeMongoTarget(process.env.MONGODBURL || ''),
    mode: args.apply ? 'apply' : 'dry-run',
    applyBlocked: false,
    applyStatus: REVIEW_DECISION_APPLY_STATUS,
    clusterLimit: args.limit,
    clusterCount: clusters.length,
    entityCountInClusters: rows.reduce((sum, row) => sum + row.count, 0),
    reviewSummary: buildDuplicateEntityReviewSummary(clusters),
    planSummary,
    reviewDecisionValidation,
    applied,
    clusters,
    nextAction:
      'Apply only reviewed shared-website, zero-reference cross-department, or specific-website cross-department merge decisions; keep same-label and ambiguous cross-department plans in review.',
  };
}

async function main(): Promise<void> {
  const args = parseDuplicateEntityNameReviewArgs(process.argv.slice(2));
  assertDuplicateEntityNameReviewApplyAllowed({
    apply: args.apply,
    confirmDuplicateEntityNameReview: args.confirmDuplicateEntityNameReview,
    limitProvided: args.limitProvided,
    acceptedDecisions: args.acceptedDecisions,
    maxApply: args.maxApply,
    plannedDuplicateEntities: 0,
  });
  const guard = assertScriptApplyAllowed({
    apply: args.apply,
    scriptName: 'research-entity:duplicate-name-review',
    mongoUrl: process.env.MONGODBURL,
  });
  await initializeConnections();
  const report = await buildDuplicateEntityNameReviewReport(args);
  const outputReport = buildDuplicateEntityNameReviewOutput(report, {
    environment: guard.environment,
    db: guard.dbLabel,
    options: args,
  });
  console.log(JSON.stringify(outputReport, null, 2));
  writeDuplicateEntityNameReviewOutput(outputReport, args.output);
  writeDuplicateEntityNameReviewDecisionTemplate(
    buildDuplicateEntityNameReviewDecisionTemplate(report.planSummary.plans, report.generatedAt),
    args.decisionTemplateOutput,
  );
}

function collection(name: string): Collection<Document> {
  const db = mongoose.connection.db;
  if (!db) {
    throw new Error('MongoDB connection is not initialized');
  }
  return db.collection(name);
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

function parseDuplicateEntityReviewCategory(raw: string): DuplicateEntityReviewCategory {
  const value = raw.trim();
  if (
    value === 'shared_website_merge_review' ||
    value === 'cross_department_same_person_review' ||
    value === 'same_label_disambiguation' ||
    value === 'manual_review'
  ) {
    return value;
  }
  throw new Error(
    '--category must be shared_website_merge_review, cross_department_same_person_review, same_label_disambiguation, or manual_review',
  );
}

function buildDuplicateEntityNameReviewPlan(
  cluster: DuplicateEntityNameReviewCluster,
  referenceImpactByEntityId?: DuplicateEntityReferenceImpactByEntityId,
): DuplicateEntityNameReviewPlan {
  const entityIds = cluster.entities.map((entity) => entity.id).filter(Boolean);
  const entitySlugs = cluster.entities
    .map((entity) => entity.slug)
    .filter((slug): slug is string => Boolean(slug));
  const sharedWebsite = sharedWebsiteUrl(cluster.entities);
  const referenceImpact = referenceImpactByEntityId
    ? buildReferenceImpactSummary(entityIds, referenceImpactByEntityId)
    : undefined;
  return {
    planId: `duplicate-name:${cluster.reviewCategory}:${slugForPlan(cluster.normalizedName)}`,
    normalizedName: cluster.normalizedName,
    reviewCategory: cluster.reviewCategory,
    entityIds,
    entitySlugs,
    sharedWebsiteUrl: sharedWebsite,
    proposedAction:
      cluster.reviewCategory === 'shared_website_merge_review'
        ? 'review_for_merge_or_aliasing'
        : 'manual_disambiguation_review',
    canonicalEntityId: undefined,
    referenceImpact,
    reviewPreflight: buildDuplicateEntityNameReviewPreflight(
      cluster,
      sharedWebsite,
      referenceImpact,
    ),
    applyBlocked: false,
    applyStatus: REVIEW_DECISION_APPLY_STATUS,
  };
}

function buildDuplicateEntityNameReviewPreflight(
  cluster: DuplicateEntityNameReviewCluster,
  sharedWebsite: string | undefined,
  referenceImpact?: DuplicateEntityReferenceImpactSummary,
): DuplicateEntityNameReviewPreflight {
  const totalReferencesImpacted = referenceImpact?.totalReferences || 0;
  const referenceRewriteDecision =
    'Confirm guarded reference rewrite and archive behavior for active references.';
  if (cluster.reviewCategory === 'shared_website_merge_review' && sharedWebsite) {
    return {
      status: 'merge_preflight_ready_for_review',
      referenceRewriteRequired: totalReferencesImpacted > 0,
      totalReferencesImpacted,
      blockers: [],
      requiredReviewerDecisions: [
        'Confirm the shared website represents one research home.',
        'Select the canonical ResearchEntity before any apply path.',
        referenceRewriteDecision,
      ],
    };
  }
  if (
    cluster.reviewCategory === 'cross_department_same_person_review' &&
    hasExactlyOneZeroReferenceEntity(cluster, referenceImpact)
  ) {
    return {
      status: 'merge_preflight_ready_for_review',
      referenceRewriteRequired: totalReferencesImpacted > 0,
      totalReferencesImpacted,
      blockers: [],
      requiredReviewerDecisions: [
        'Confirm the cross-department rows represent one person and one research home.',
        'Select the referenced ResearchEntity as canonical before apply.',
        referenceRewriteDecision,
      ],
    };
  }
  if (
    cluster.reviewCategory === 'cross_department_same_person_review' &&
    hasSpecificWebsiteReplacingGenericDirectory(cluster)
  ) {
    return {
      status: 'merge_preflight_ready_for_review',
      referenceRewriteRequired: totalReferencesImpacted > 0,
      totalReferencesImpacted,
      blockers: [],
      requiredReviewerDecisions: [
        'Confirm the cross-department rows represent one person and one research home.',
        'Select the ResearchEntity with the specific lab website as canonical before apply.',
        referenceRewriteDecision,
      ],
    };
  }

  const blockers =
    cluster.reviewCategory === 'shared_website_merge_review'
      ? ['Shared-website category did not include a normalized shared website URL.']
      : [];

  return {
    status: 'manual_disambiguation_required',
    referenceRewriteRequired: totalReferencesImpacted > 0,
    totalReferencesImpacted,
    blockers,
    requiredReviewerDecisions: [
      'Confirm whether duplicate labels represent one research home or distinct homes.',
      'Choose merge/archive, alias, or display-label disambiguation before any apply path.',
      referenceRewriteDecision,
    ],
  };
}

function hasExactlyOneZeroReferenceEntity(
  cluster: DuplicateEntityNameReviewCluster,
  referenceImpact?: DuplicateEntityReferenceImpactSummary,
): boolean {
  if (!referenceImpact || cluster.entities.length !== 2) return false;
  const totals = cluster.entities.map((entity) => {
    const impact = referenceImpact.byEntity.find((row) => row.entityId === entity.id);
    return impact?.totalReferences ?? 0;
  });
  return totals.filter((total) => total === 0).length === 1 && totals.some((total) => total > 0);
}

function hasSpecificWebsiteReplacingGenericDirectory(
  cluster: DuplicateEntityNameReviewCluster,
): boolean {
  if (cluster.entities.length !== 2) return false;
  const classes = cluster.entities.map((entity) => {
    const urls = [entity.websiteUrl, entity.website].filter((url): url is string =>
      Boolean(url && url.trim()),
    );
    return {
      hasSpecificWebsite: urls.some(isSpecificResearchHomeWebsite),
      hasGenericDirectoryWebsite: urls.some(isGenericResearchHomeDirectoryUrl),
    };
  });
  return (
    classes.some((item) => item.hasSpecificWebsite) &&
    classes.some((item) => item.hasGenericDirectoryWebsite && !item.hasSpecificWebsite)
  );
}

function isSpecificResearchHomeWebsite(url: string): boolean {
  return /^https?:\/\//i.test(url) && !isGenericResearchHomeDirectoryUrl(url);
}

function isGenericResearchHomeDirectoryUrl(url: string): boolean {
  const normalized = url.trim().toLowerCase().replace(/\/+$/, '');
  return normalized.includes('/about/a-to-z-index/atoz/lab-websites');
}

function buildDuplicateEntityNameReviewPreflightSummary(
  plans: DuplicateEntityNameReviewPlan[],
): DuplicateEntityNameReviewPreflightSummary {
  const requiredReviewerDecisions = new Map<string, number>();
  for (const plan of plans) {
    for (const decision of plan.reviewPreflight.requiredReviewerDecisions) {
      requiredReviewerDecisions.set(decision, (requiredReviewerDecisions.get(decision) || 0) + 1);
    }
  }

  return {
    mergePreflightReadyForReview: plans.filter(
      (plan) => plan.reviewPreflight.status === 'merge_preflight_ready_for_review',
    ).length,
    manualDisambiguationRequired: plans.filter(
      (plan) => plan.reviewPreflight.status === 'manual_disambiguation_required',
    ).length,
    withReferenceRewrite: plans.filter((plan) => plan.reviewPreflight.referenceRewriteRequired)
      .length,
    totalReferencesImpacted: plans.reduce(
      (sum, plan) => sum + plan.reviewPreflight.totalReferencesImpacted,
      0,
    ),
    requiredReviewerDecisions: Array.from(requiredReviewerDecisions.entries()).map(
      ([decision, count]) => ({ decision, count }),
    ),
  };
}

function normalizeDuplicateEntityNameReviewDecision(
  raw: unknown,
  index: number,
): DuplicateEntityNameReviewDecision {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`Decision row ${index + 1} must be an object.`);
  }
  const row = raw as Record<string, unknown>;
  return {
    planId: asString(row.planId).trim(),
    decision: asString(row.decision).trim(),
    canonicalEntityId: optionalString(row.canonicalEntityId),
    reviewedBy: optionalString(row.reviewedBy),
    reviewNote: optionalString(row.reviewNote),
  };
}

function validateDuplicateEntityNameReviewDecision(
  decision: DuplicateEntityNameReviewDecision,
  planById: Map<string, DuplicateEntityNameReviewPlan>,
  planIdCounts: Map<string, number>,
): DuplicateEntityNameReviewDecisionValidationRow {
  const errors: string[] = [];
  const plan = planById.get(decision.planId);

  if (!decision.planId) {
    errors.push('Decision row is missing planId.');
  } else {
    if (!plan) {
      errors.push('No generated duplicate-name plan matches this planId.');
    }
    if ((planIdCounts.get(decision.planId) || 0) > 1) {
      errors.push('Only one decision per planId is allowed.');
    }
  }

  if (
    decision.decision !== 'merge_into_canonical' &&
    decision.decision !== 'mark_distinct_homes' &&
    decision.decision !== 'defer_review'
  ) {
    errors.push('Decision must be merge_into_canonical, mark_distinct_homes, or defer_review.');
  }

  if (decision.decision === 'merge_into_canonical') {
    if (!decision.canonicalEntityId) {
      errors.push('merge_into_canonical requires canonicalEntityId.');
    }
    if (plan && plan.reviewPreflight.status !== 'merge_preflight_ready_for_review') {
      errors.push('merge_into_canonical requires merge_preflight_ready_for_review status.');
    }
    if (
      plan &&
      decision.canonicalEntityId &&
      !plan.entityIds.includes(decision.canonicalEntityId)
    ) {
      errors.push('canonicalEntityId must be one of the plan entityIds.');
    }
  } else if (decision.canonicalEntityId) {
    errors.push('canonicalEntityId is only valid for merge_into_canonical decisions.');
  }
  if (!decision.reviewedBy) {
    errors.push('reviewedBy is required.');
  }

  return {
    planId: decision.planId,
    decision: decision.decision,
    canonicalEntityId: decision.canonicalEntityId,
    reviewedBy: decision.reviewedBy,
    status: errors.length > 0 ? 'invalid' : 'valid',
    errors,
  };
}

async function loadReferenceImpactByEntityId(
  entityIds: string[],
): Promise<DuplicateEntityReferenceImpactByEntityId> {
  const uniqueEntityIds = Array.from(new Set(entityIds.filter(Boolean)));
  const objectIds = uniqueEntityIds.flatMap((id) => {
    const objectId = normalizeDuplicateEntityNameReviewObjectId(id);
    return objectId ? [objectId] : [];
  });
  const impact = Object.fromEntries(
    uniqueEntityIds.map((id) => [id, { ...EMPTY_REFERENCE_IMPACT_COUNTS }]),
  ) as DuplicateEntityReferenceImpactByEntityId;
  if (objectIds.length === 0) return impact;

  for (const ref of REFERENCE_IMPACT_COLLECTIONS) {
    const rows = (await collection(ref.collectionName)
      .aggregate(buildReferenceImpactPipeline(ref.field, objectIds, ref.match, ref.array))
      .toArray()) as Array<{ _id: unknown; count: number }>;
    for (const row of rows) {
      const id = stringifyId(row._id);
      if (!impact[id]) {
        impact[id] = { ...EMPTY_REFERENCE_IMPACT_COUNTS };
      }
      impact[id][ref.key] = row.count;
    }
  }

  return impact;
}

function buildReferenceImpactPipeline(
  field: string,
  objectIds: mongoose.Types.ObjectId[],
  extraMatch: Record<string, unknown> = {},
  array = false,
): Document[] {
  const match = {
    ...extraMatch,
    [field]: { $in: objectIds },
  };
  if (!array) {
    return [{ $match: match }, { $group: { _id: `$${field}`, count: { $sum: 1 } } }];
  }

  return [
    { $match: match },
    { $unwind: `$${field}` },
    { $match: { [field]: { $in: objectIds } } },
    { $group: { _id: `$${field}`, count: { $sum: 1 } } },
  ];
}

function buildReferenceImpactSummary(
  entityIds: string[],
  referenceImpactByEntityId: DuplicateEntityReferenceImpactByEntityId,
): DuplicateEntityReferenceImpactSummary {
  const byEntity = entityIds.map((entityId) => {
    const counts = referenceImpactByEntityId[entityId] || { ...EMPTY_REFERENCE_IMPACT_COUNTS };
    return {
      entityId,
      counts,
      totalReferences: totalReferenceCount(counts),
    };
  });
  return {
    totalReferences: byEntity.reduce((sum, item) => sum + item.totalReferences, 0),
    byEntity,
  };
}

function totalReferenceCount(counts: DuplicateEntityReferenceImpactCounts): number {
  return Object.values(counts).reduce((sum, value) => sum + value, 0);
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return Array.from(
    new Set(
      values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)),
    ),
  );
}

function sharedWebsiteUrl(entities: DuplicateEntityNameReviewEntity[]): string | undefined {
  const keyedWebsites = entities.flatMap((entity): Array<{ key: string; raw?: string }> => {
    const raw = entity.websiteUrl || entity.website;
    const key = normalizedWebsiteKey(raw);
    return key ? [{ key, raw }] : [];
  });
  if (keyedWebsites.length < 2) return undefined;
  if (new Set(keyedWebsites.map((item) => item.key)).size !== 1) return undefined;
  return keyedWebsites.find((item) => item.raw)?.raw;
}

function normalizedWebsiteKey(value?: string): string {
  if (!value) return '';
  try {
    const parsed = new URL(value.trim());
    const host = parsed.hostname.replace(/^www\./i, '').toLowerCase();
    const urlPath = parsed.pathname.replace(/\/+$/, '').toLowerCase();
    return `${host}${urlPath}`;
  } catch {
    return value
      .trim()
      .replace(/^https?:\/\//i, '')
      .replace(/\/+$/, '')
      .toLowerCase();
  }
}

function slugForPlan(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'cluster';
}

function describeMongoTarget(url: string): string {
  try {
    const parsed = new URL(url);
    const database = parsed.pathname.replace(/^\//, '') || '(default-db)';
    return `${parsed.protocol}//${parsed.hostname}/${database}`;
  } catch {
    return '(unparseable-mongodb-url)';
  }
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
  if (!Array.isArray(value)) {
    return undefined;
  }
  const strings = value.filter(
    (item): item is string => typeof item === 'string' && item.trim().length > 0,
  );
  return strings.length > 0 ? strings : undefined;
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

import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { ResearchEntity } from '../models/researchEntity';
import { ResearchGroupMember } from '../models/researchGroupMember';
import {
  buildFundingResearchEntityDedupePlan,
  buildOfficialLabUrlResearchEntityDedupePlan,
  buildResearchEntityPiDedupePlan,
  type OfficialLabUrlDedupeRow,
  type ResearchEntityPiDedupeRow,
  selectCurrentMemberIdsToRetire,
  shouldRetireDuplicateCurrentMembersForDedupeRun,
} from './researchEntityPiDedupeCore';
import {
  buildArchivedEntityArtifactRepairPlan,
  type ArchivedEntityArtifact,
  type ArchivedEntityArtifactType,
} from './repairArchivedEntityArtifactsCore';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import { runStudentVisibilityGate } from '../services/studentVisibilityGateService';
import { serializedDocumentId } from '../utils/idSerialization';
import { sanitizeLogValue } from '../utils/logSanitizer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const REVIEW_DECISION_APPLY_STATUS =
  'Accepted same-PI dedupe decisions can drive apply mode; only valid merge_into_canonical decisions are applied.';
const BETA_ENV_PREFIX = 'SCRAPER_ENV=beta';
const RESEARCH_ENTITY_PI_DEDUPE_OBJECT_ID_RE = /^[a-f0-9]{24}$/i;

type ResearchEntityPiDedupePlanGroup = ReturnType<typeof buildResearchEntityPiDedupePlan>[number];

export interface ResearchEntityDedupeMergeGroup {
  canonicalEntityId: string;
  duplicateEntityIds: string[];
  mergedDepartments: string[];
  mergedResearchAreas: string[];
  mergedSourceUrls: string[];
}

export type ResearchEntityPiDedupeDecisionValue =
  | 'merge_into_canonical'
  | 'mark_distinct_homes'
  | 'defer_review';

export interface ResearchEntityPiDedupeArgs {
  apply: boolean;
  confirmResearchEntityPiDedupe: boolean;
  deleteDuplicates: boolean;
  fundingOnly: boolean;
  fullPlan: boolean;
  officialLabUrlOnly: boolean;
  reviewedProfileAreaOnly: boolean;
  limit: number;
  limitProvided: boolean;
  maxApply: number;
  slug?: string;
  acceptedDecisions?: string;
  allowEmptyDecisions?: boolean;
  decisionTemplateOutput?: string;
  output?: string;
}

export interface ResearchEntityPiDedupeDecision {
  planId: string;
  decision: string;
  canonicalEntityId?: string;
  reviewedBy?: string;
  reviewNote?: string;
}

export interface ResearchEntityPiDedupeDecisionValidationRow {
  planId: string;
  decision: string;
  canonicalEntityId?: string;
  reviewedBy?: string;
  status: 'valid' | 'invalid';
  errors: string[];
}

export interface ResearchEntityPiDedupeDecisionValidationSummary {
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
  decisions: ResearchEntityPiDedupeDecisionValidationRow[];
}

export interface ResearchEntityPiDedupeDecisionTemplate {
  generatedAt: string;
  applyBlocked: boolean;
  applyStatus: string;
  acceptedDecisionValues: ResearchEntityPiDedupeDecisionValue[];
  decisions: Array<{
    planId: string;
    userId: string;
    normalizedName: string;
    canonicalEntityId: string;
    duplicateEntityIds: string[];
    canonicalSlug?: string;
    duplicateSlugs: string[];
    mergedDepartments: string[];
    mergedResearchAreas: string[];
    dedupeCategory?: string;
    decision: '';
    reviewedBy: '';
    reviewNote: '';
  }>;
}

export function parseResearchEntityPiDedupeArgs(argv: string[]) {
  const args: ResearchEntityPiDedupeArgs = {
    apply: false,
    confirmResearchEntityPiDedupe: false,
    deleteDuplicates: false,
    fundingOnly: false,
    fullPlan: false,
    officialLabUrlOnly: false,
    reviewedProfileAreaOnly: false,
    limit: 10000,
    limitProvided: false,
    maxApply: 10,
    slug: undefined,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') continue;
    if (arg === '--apply') {
      args.apply = true;
      continue;
    }
    if (arg === '--confirm-research-entity-pi-dedupe') {
      args.confirmResearchEntityPiDedupe = true;
      continue;
    }
    if (arg.startsWith('--confirm-research-entity-pi-dedupe=')) {
      throw new Error('--confirm-research-entity-pi-dedupe does not accept a value');
    }
    if (arg === '--mode=dry-run' || arg === '--dry-run') {
      args.apply = false;
      continue;
    }
    if (arg === '--delete-duplicates') {
      args.deleteDuplicates = true;
      continue;
    }
    if (arg === '--funding-only') {
      args.fundingOnly = true;
      continue;
    }
    if (arg === '--full-plan') {
      args.fullPlan = true;
      continue;
    }
    if (arg === '--official-lab-url-only') {
      args.officialLabUrlOnly = true;
      continue;
    }
    if (arg === '--reviewed-profile-area-only') {
      args.reviewedProfileAreaOnly = true;
      continue;
    }
    if (arg === '--allow-empty-decisions') {
      args.allowEmptyDecisions = true;
      continue;
    }
    if (arg.startsWith('--limit=')) {
      args.limit = parsePositiveIntegerOption(arg.slice('--limit='.length).trim(), '--limit', 0);
      args.limitProvided = true;
      continue;
    }
    if (arg === '--limit') {
      const limit = argv[index + 1]?.trim();
      if (!limit) throw new Error('--limit requires a number');
      args.limit = parsePositiveIntegerOption(limit, '--limit', 0);
      args.limitProvided = true;
      index += 1;
      continue;
    }
    if (arg.startsWith('--max-apply=')) {
      args.maxApply = parsePositiveIntegerOption(
        arg.slice('--max-apply='.length).trim(),
        '--max-apply',
        0,
      );
      continue;
    }
    if (arg === '--max-apply') {
      const maxApply = argv[index + 1]?.trim();
      if (!maxApply) throw new Error('--max-apply requires a number');
      args.maxApply = parsePositiveIntegerOption(maxApply, '--max-apply', 0);
      index += 1;
      continue;
    }
    if (arg.startsWith('--slug=')) {
      args.slug = arg.slice('--slug='.length).trim();
      if (!args.slug) throw new Error('--slug requires a value');
      continue;
    }
    if (arg === '--slug') {
      const slug = argv[index + 1]?.trim();
      if (!slug) throw new Error('--slug requires a value');
      args.slug = slug;
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
      args.acceptedDecisions = resolveSafeJsonReportOutputPath(
        argv[index + 1],
        '--accepted-decisions',
      );
      index += 1;
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
      args.decisionTemplateOutput = resolveSafeJsonReportOutputPath(
        argv[index + 1],
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
      args.output = resolveSafeJsonReportOutputPath(argv[index + 1]);
      index += 1;
      continue;
    }
    throw new Error(`Unknown research-entity:dedupe-by-pi argument: ${arg}`);
  }

  return args;
}

function parsePositiveIntegerOption(
  raw: string | undefined,
  flagName: string,
  fallback: number,
): number {
  if (raw === undefined) return fallback;
  if (!/^[1-9]\d*$/.test(raw)) {
    throw new Error(`${flagName} must be a positive integer`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${flagName} must be a positive integer`);
  }
  return value;
}

function betaCommand(command: string): string {
  return command.startsWith(`${BETA_ENV_PREFIX} `) ? command : `${BETA_ENV_PREFIX} ${command}`;
}

export function assertResearchEntityPiDedupeApplyAllowed(args: {
  apply: boolean;
  maxApply: number;
  plannedDuplicateEntities: number;
  plannedDuplicateCurrentMembers: number;
}): void {
  if (!args.apply) return;
  const plannedRepairs =
    Math.max(0, args.plannedDuplicateEntities) +
    Math.max(0, args.plannedDuplicateCurrentMembers);
  if (plannedRepairs > args.maxApply) {
    throw new Error(`Apply would modify ${plannedRepairs} rows, above --max-apply.`);
  }
}

export function assertResearchEntityPiDedupeApplyBounded(args: {
  apply: boolean;
  confirmResearchEntityPiDedupe: boolean;
  limitProvided: boolean;
}): void {
  if (args.apply && !args.confirmResearchEntityPiDedupe) {
    throw new Error(
      '--confirm-research-entity-pi-dedupe is required when --apply is set for research-entity:dedupe-by-pi.',
    );
  }
  if (args.apply && !args.limitProvided) {
    throw new Error('--limit is required when --apply is set.');
  }
}

export function writeResearchEntityPiDedupeOutput(
  report: Record<string, unknown>,
  output?: string,
): void {
  if (!output) return;
  const safeOutput = resolveSafeJsonReportOutputPath(output);
  fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
  fs.writeFileSync(safeOutput, `${JSON.stringify(report, null, 2)}\n`);
}

export function buildResearchEntityPiDedupeOutput<T extends Record<string, unknown>>(
  report: T,
  metadata: {
    environment: string;
    db: string;
    options: ResearchEntityPiDedupeArgs;
  },
): T & {
  generatedAt: string;
  environment: string;
  db: string;
  options: ResearchEntityPiDedupeArgs;
} {
  return {
    generatedAt: new Date().toISOString(),
    environment: metadata.environment,
    db: metadata.db,
    options: metadata.options,
    ...report,
  };
}

export function writeResearchEntityPiDedupeDecisionTemplate(
  template: ResearchEntityPiDedupeDecisionTemplate,
  output?: string,
): void {
  if (!output) return;
  const safeOutput = resolveSafeJsonReportOutputPath(output, '--decision-template-output');
  fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
  fs.writeFileSync(safeOutput, `${JSON.stringify(template, null, 2)}\n`);
}

function researchEntityPiDedupePlanId(group: {
  userId: string;
  normalizedName: string;
  canonicalEntityId: string;
  duplicateEntityIds: string[];
}): string {
  const duplicateIds = [...(group.duplicateEntityIds || [])].sort().join(',');
  return `${group.normalizedName}:${group.canonicalEntityId}:${duplicateIds}`;
}

export function buildResearchEntityPiDedupeDecisionTemplate(
  plans: ResearchEntityPiDedupePlanGroup[],
  generatedAt = new Date().toISOString(),
): ResearchEntityPiDedupeDecisionTemplate {
  return {
    generatedAt,
    applyBlocked: false,
    applyStatus: REVIEW_DECISION_APPLY_STATUS,
    acceptedDecisionValues: ['merge_into_canonical', 'mark_distinct_homes', 'defer_review'],
    decisions: plans.map((plan) => ({
      planId: researchEntityPiDedupePlanId(plan),
      userId: plan.userId,
      normalizedName: plan.normalizedName,
      canonicalEntityId: plan.canonicalEntityId,
      duplicateEntityIds: plan.duplicateEntityIds,
      canonicalSlug: plan.canonicalSlug,
      duplicateSlugs: plan.duplicateSlugs,
      mergedDepartments: plan.mergedDepartments,
      mergedResearchAreas: plan.mergedResearchAreas,
      dedupeCategory: plan.dedupeCategory,
      decision: '',
      reviewedBy: '',
      reviewNote: '',
    })),
  };
}

export function readResearchEntityPiDedupeDecisions(
  inputPath: string,
  options: { allowEmpty?: boolean } = {},
): ResearchEntityPiDedupeDecision[] {
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
  return decisions.map((decision, index) => normalizeResearchEntityPiDedupeDecision(decision, index));
}

function normalizeResearchEntityPiDedupeDecision(
  raw: unknown,
  index: number,
): ResearchEntityPiDedupeDecision {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`Accepted decision at index ${index} must be an object.`);
  }
  const record = raw as Record<string, unknown>;
  return {
    planId: String(record.planId || '').trim(),
    decision: String(record.decision || '').trim(),
    canonicalEntityId:
      typeof record.canonicalEntityId === 'string' && record.canonicalEntityId.trim()
        ? record.canonicalEntityId.trim()
        : undefined,
    reviewedBy:
      typeof record.reviewedBy === 'string' && record.reviewedBy.trim()
        ? record.reviewedBy.trim()
        : undefined,
    reviewNote:
      typeof record.reviewNote === 'string' && record.reviewNote.trim()
        ? record.reviewNote.trim()
        : undefined,
  };
}

export function validateResearchEntityPiDedupeDecisions(
  plans: ResearchEntityPiDedupePlanGroup[],
  decisions: ResearchEntityPiDedupeDecision[],
  artifactPath?: string,
): ResearchEntityPiDedupeDecisionValidationSummary {
  const planById = new Map(plans.map((plan) => [researchEntityPiDedupePlanId(plan), plan]));
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
    validateResearchEntityPiDedupeDecision(decision, planById, planIdCounts),
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
      row.errors.includes('No generated same-PI dedupe plan matches this planId.'),
    ).length,
    duplicatePlanDecisionCount: Array.from(planIdCounts.values()).reduce(
      (sum, count) => sum + Math.max(0, count - 1),
      0,
    ),
    unreviewedPlanCount: plans.filter((plan) => !validPlanIds.has(researchEntityPiDedupePlanId(plan)))
      .length,
    decisionsByType: Array.from(decisionsByType.entries()).map(([decision, count]) => ({
      decision,
      count,
    })),
    decisions: rows,
  };
}

export function selectResearchEntityPiDedupePlansForAcceptedMergeApply(
  plans: ResearchEntityPiDedupePlanGroup[],
  validation: ResearchEntityPiDedupeDecisionValidationSummary,
): ResearchEntityPiDedupePlanGroup[] {
  if (validation.invalidDecisionCount > 0) {
    throw new Error('Accepted same-PI dedupe decisions contain invalid rows; refusing apply.');
  }
  const planById = new Map(plans.map((plan) => [researchEntityPiDedupePlanId(plan), plan]));
  return validation.decisions
    .filter((decision) => decision.status === 'valid' && decision.decision === 'merge_into_canonical')
    .map((decision) => planById.get(decision.planId))
    .filter((plan): plan is ResearchEntityPiDedupePlanGroup => Boolean(plan));
}

function validateResearchEntityPiDedupeDecision(
  decision: ResearchEntityPiDedupeDecision,
  planById: Map<string, ResearchEntityPiDedupePlanGroup>,
  planIdCounts: Map<string, number>,
): ResearchEntityPiDedupeDecisionValidationRow {
  const errors: string[] = [];
  const plan = planById.get(decision.planId);
  if (!decision.planId) {
    errors.push('planId is required.');
  } else if (!plan) {
    errors.push('No generated same-PI dedupe plan matches this planId.');
  }
  if ((planIdCounts.get(decision.planId) || 0) > 1) {
    errors.push('Only one accepted decision is allowed per planId.');
  }
  if (!['merge_into_canonical', 'mark_distinct_homes', 'defer_review'].includes(decision.decision)) {
    errors.push(
      'decision must be one of merge_into_canonical, mark_distinct_homes, or defer_review.',
    );
  }
  if (decision.decision === 'merge_into_canonical') {
    if (!decision.canonicalEntityId) {
      errors.push('A merge decision requires canonicalEntityId.');
    } else if (plan && decision.canonicalEntityId !== plan.canonicalEntityId) {
      errors.push('A merge decision must use the generated canonicalEntityId.');
    }
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

export async function applyResearchEntityPiDedupeGroupsSequentially<TGroup, TResult>(
  groups: TGroup[],
  applyFn: (group: TGroup) => Promise<TResult>,
): Promise<TResult[]> {
  const results: TResult[] = [];
  for (const group of groups) {
    results.push(await applyFn(group));
  }
  return results;
}

export const applyResearchEntityDedupeGroupsSequentially =
  applyResearchEntityPiDedupeGroupsSequentially;

export function shouldRelinkReferencesForResearchEntityPiDedupeRun(options: {
  apply: boolean;
}): boolean {
  return options.apply;
}

export function chooseResearchEntityPiDedupeConflictAction(args: {
  deleteDuplicates: boolean;
  archiveOnConflict?: boolean;
}): 'archive' | 'delete' | 'throw' {
  if (args.archiveOnConflict) return 'archive';
  return args.deleteDuplicates ? 'delete' : 'throw';
}

export function chooseArchivedDocumentConflictOutcome(args: {
  allowDeleteOnConflict: boolean;
}): 'blocked' | 'delete' {
  return args.allowDeleteOnConflict ? 'delete' : 'blocked';
}

export function buildArchivedDocumentArchiveSet(args: {
  now: Date;
  relinkField?: string;
  relinkValue?: unknown;
  includeRelink: boolean;
}): Record<string, unknown> {
  const set: Record<string, unknown> = {
    archived: true,
    lastMaterializedAt: args.now,
  };
  if (
    args.includeRelink &&
    args.relinkField &&
    args.relinkValue !== undefined &&
    args.relinkValue !== null
  ) {
    set[args.relinkField] = args.relinkValue;
  }
  return set;
}

export function buildResearchEntityDedupeReferenceFilter(args: {
  field: string;
  duplicateIds: mongoose.Types.ObjectId[];
  filter?: Record<string, unknown>;
  archiveOnConflict?: boolean;
}): Record<string, unknown> {
  return {
    ...(args.filter || {}),
    ...(args.archiveOnConflict ? { archived: { $ne: true } } : {}),
    [args.field]: { $in: args.duplicateIds },
  };
}

function isReviewedProfileAreaGroup(group: ReturnType<typeof buildResearchEntityPiDedupePlan>[number]) {
  if (group.dedupeCategory === 'profile_area_shell_with_concrete_home') return true;
  const canonicalSlug = String(group.canonicalSlug || '');
  return (
    group.duplicateSlugs.length > 0 &&
    !canonicalSlug.startsWith('faculty-research-area-') &&
    !canonicalSlug.startsWith('nih-pi-') &&
    !canonicalSlug.startsWith('nsf-pi-') &&
    group.duplicateSlugs.every((slug) => String(slug || '').startsWith('faculty-research-area-'))
  );
}

export function buildResearchEntityPiDedupeReviewBreakdown(
  groups: Array<{
    canonicalEntityId: string;
    duplicateEntityIds: string[];
    canonicalSlug?: string;
    duplicateSlugs: string[];
    mergedDepartments?: string[];
    mergedResearchAreas?: string[];
  }>,
) {
  const fundingSlugPattern = /^(nih|nsf)-pi-/;
  const uniqueCount = (values: unknown[] | undefined) =>
    new Set((values || []).map((value) => String(value || '').trim()).filter(Boolean)).size;
  const reviewedProfileAreaGroups = groups.filter((group) =>
    isReviewedProfileAreaGroup(group as ReturnType<typeof buildResearchEntityPiDedupePlan>[number]),
  ).length;
  const fundingSourceGroups = groups.filter((group) =>
    [group.canonicalSlug || '', ...(group.duplicateSlugs || [])].some((slug) =>
      fundingSlugPattern.test(String(slug || '')),
    ),
  ).length;
  const crossDepartmentGroups = groups.filter((group) => uniqueCount(group.mergedDepartments) > 1)
    .length;
  const groupsWithMergedResearchAreas = groups.filter(
    (group) => uniqueCount(group.mergedResearchAreas) > 0,
  ).length;
  const highResearchAreaMergeGroups = groups.filter(
    (group) => uniqueCount(group.mergedResearchAreas) >= 6,
  ).length;

  return {
    totalGroups: groups.length,
    plannedDuplicateEntities: groups.reduce(
      (sum, group) => sum + Math.max(0, group.duplicateEntityIds?.length || 0),
      0,
    ),
    reviewedProfileAreaGroups,
    fundingSourceGroups,
    crossDepartmentGroups,
    groupsWithMergedResearchAreas,
    highResearchAreaMergeGroups,
    recommendedNarrowCommands: [
      betaCommand(
        'yarn --cwd server research-entity:dedupe-by-pi --reviewed-profile-area-only --limit=10000 --output /tmp/ylabs-research-entity-dedupe-reviewed-profile-area.json',
      ),
      betaCommand(
        'yarn --cwd server research-entity:dedupe-by-pi --funding-only --limit=10000 --output /tmp/ylabs-research-entity-dedupe-funding-only.json',
      ),
      betaCommand(
        'yarn --cwd server research-entity:dedupe-by-pi --official-lab-url-only --limit=10000 --output /tmp/ylabs-research-entity-dedupe-official-lab-url.json',
      ),
    ],
  };
}

const ARTIFACT_SPECS: Array<{
  artifactType: ArchivedEntityArtifactType;
  collection: string;
}> = [
  { artifactType: 'EntryPathway', collection: 'entry_pathways' },
  { artifactType: 'AccessSignal', collection: 'access_signals' },
  { artifactType: 'ContactRoute', collection: 'contact_routes' },
  { artifactType: 'PostedOpportunity', collection: 'posted_opportunities' },
];

const SCALAR_REFERENCE_SPECS: Array<{
  collection: string;
  field: string;
  filter?: Record<string, unknown>;
  archiveOnConflict?: boolean;
}> = [
  { collection: 'research_entities', field: 'canonicalGroupId' },
  { collection: 'research_scholarly_links', field: 'researchEntityId', archiveOnConflict: true },
  { collection: 'entry_pathways', field: 'researchEntityId', archiveOnConflict: true },
  { collection: 'access_signals', field: 'researchEntityId', archiveOnConflict: true },
  { collection: 'contact_routes', field: 'researchEntityId', archiveOnConflict: true },
  { collection: 'posted_opportunities', field: 'researchEntityId', archiveOnConflict: true },
  {
    collection: 'research_entity_relationships',
    field: 'sourceResearchEntityId',
    archiveOnConflict: true,
  },
  {
    collection: 'research_entity_relationships',
    field: 'targetResearchEntityId',
    archiveOnConflict: true,
  },
  { collection: 'observations', field: 'entityId', filter: { entityType: 'researchEntity' } },
  { collection: 'observations', field: 'entityId', filter: { entityType: 'researchGroup' } },
];

const ARRAY_REFERENCE_SPECS: Array<{
  collection: string;
  field: string;
}> = [];

export function profileAreaNamesForPi(firstName: string, lastName: string): string[] {
  const first = String(firstName || '').trim();
  const last = String(lastName || '').trim();
  if (!first || !last) return [];
  return [`${first} ${last} Lab`, `${first} ${last} Laboratory`, `${first} ${last} Research`];
}

function dedupePlannedGroups<T extends { canonicalEntityId: string; duplicateEntityIds: string[] }>(
  groups: T[],
): T[] {
  const seen = new Set<string>();
  return groups.filter((group) => {
    const key = [group.canonicalEntityId, ...group.duplicateEntityIds].sort().join(':');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isFullPersonLabName(normalizedName: string): boolean {
  const tokens = normalizedName
    .replace(/\s+lab$/i, '')
    .split(/\s+/)
    .filter(Boolean);
  return /\s+lab$/i.test(normalizedName) && tokens.length >= 2;
}

async function loadSamePiCandidateRows(limit: number, options: { includeRetiredMembers: boolean }) {
  const memberMatch: Record<string, unknown> = {
    role: 'pi',
    researchEntityId: { $exists: true, $ne: null },
    userId: { $exists: true, $ne: null },
  };
  if (!options.includeRetiredMembers) memberMatch.isCurrentMember = { $ne: false };

  const rows = await ResearchGroupMember.aggregate([
    { $match: memberMatch },
    {
      $lookup: {
        from: 'research_entities',
        localField: 'researchEntityId',
        foreignField: '_id',
        as: 'entity',
      },
    },
    { $unwind: '$entity' },
    { $match: { 'entity.archived': { $ne: true } } },
    {
      $lookup: {
        from: 'users',
        localField: 'userId',
        foreignField: '_id',
        as: 'user',
      },
    },
    { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        userId: { $toString: '$userId' },
        piFirstName: '$user.fname',
        piLastName: '$user.lname',
        entity: {
          id: { $toString: '$entity._id' },
          slug: '$entity.slug',
          name: '$entity.name',
          kind: '$entity.kind',
          entityType: '$entity.entityType',
          websiteUrl: '$entity.websiteUrl',
          fullDescription: '$entity.fullDescription',
          shortDescription: '$entity.shortDescription',
          sourceUrls: '$entity.sourceUrls',
          departments: '$entity.departments',
          researchAreas: '$entity.researchAreas',
        },
      },
    },
    {
      $group: {
        _id: { userId: '$userId' },
        piFirstName: { $first: '$piFirstName' },
        piLastName: { $first: '$piLastName' },
        entities: { $addToSet: '$entity' },
      },
    },
    { $limit: limit },
  ]);

  return Promise.all(
    rows.map(async (row: any) => {
      const firstName = String(row.piFirstName || '').trim();
      const lastName = String(row.piLastName || '').trim();
      const entityIds = new Set((row.entities || []).map((entity: { id?: string }) => entity.id));
      const exactPersonNames = profileAreaNamesForPi(firstName, lastName);
      const profileAreaEntities =
        exactPersonNames.length > 0
          ? await ResearchEntity.find({
              archived: { $ne: true },
              name: { $in: exactPersonNames },
            })
              .select(
                '_id slug name kind entityType websiteUrl fullDescription shortDescription sourceUrls departments researchAreas',
              )
              .lean()
          : [];

      return {
        userId: row._id.userId,
        normalizedName: `same-pi:${row._id.userId}`,
        piFirstName: row.piFirstName,
        piLastName: row.piLastName,
        entities: [
          ...(row.entities || []),
          ...profileAreaEntities
            .map((entity: any) => ({
              id: serializedDocumentId(entity._id) || '',
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
            }))
            .filter((entity) => {
              if (entityIds.has(entity.id)) return false;
              entityIds.add(entity.id);
              return true;
            }),
        ],
      };
    }),
  );
}

async function loadSinglePiNameCandidateRows(limit: number) {
  return ResearchEntity.aggregate([
    { $match: { archived: { $ne: true }, name: { $exists: true, $ne: '' } } },
    {
      $project: {
        normalizedName: { $trim: { input: { $toLower: '$name' } } },
        entity: {
          id: { $toString: '$_id' },
          slug: '$slug',
          name: '$name',
          kind: '$kind',
          entityType: '$entityType',
          websiteUrl: '$websiteUrl',
          fullDescription: '$fullDescription',
          shortDescription: '$shortDescription',
          sourceUrls: '$sourceUrls',
          departments: '$departments',
          researchAreas: '$researchAreas',
        },
      },
    },
    {
      $group: {
        _id: '$normalizedName',
        entities: { $addToSet: '$entity' },
        entityIds: { $addToSet: { $toObjectId: '$entity.id' } },
      },
    },
    { $match: { 'entities.1': { $exists: true } } },
    {
      $lookup: {
        from: 'research_entity_members',
        let: { entityIds: '$entityIds' },
        pipeline: [
          {
            $match: {
              $expr: { $in: ['$researchEntityId', '$$entityIds'] },
              role: 'pi',
              isCurrentMember: { $ne: false },
              userId: { $exists: true, $ne: null },
            },
          },
          { $group: { _id: '$userId' } },
        ],
        as: 'piUsers',
      },
    },
    { $limit: limit },
  ]).then((rows) =>
    rows
      .filter((row: any) => {
        const piUserCount = (row.piUsers || []).length;
        if (piUserCount > 1) return false;
        return piUserCount === 1 || isFullPersonLabName(row._id || '');
      })
      .map((row: any) => ({
        userId: row.piUsers?.[0]?._id ? String(row.piUsers[0]._id) : `name:${row._id}`,
        normalizedName: row._id,
        entities: row.entities,
      })),
  );
}

async function loadCandidateRows(
  limit: number,
  options: { includeNameOnly: boolean; includeRetiredPiLinks: boolean },
) {
  const [samePiRows, singlePiNameRows] = await Promise.all([
    loadSamePiCandidateRows(limit, { includeRetiredMembers: options.includeRetiredPiLinks }),
    options.includeNameOnly ? loadSinglePiNameCandidateRows(limit) : Promise.resolve([]),
  ]);
  const seen = new Set<string>();
  return [...samePiRows, ...singlePiNameRows]
    .filter((row) => {
      const entityKey = row.entities
        .map((entity: { id?: string }) => entity.id || '')
        .filter(Boolean)
        .sort()
        .join(',');
      const key = `${row.userId}:${row.normalizedName}:${entityKey}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
}

async function loadOfficialLabUrlCandidateRows(limit: number) {
  return ResearchEntity.aggregate([
    { $match: { archived: { $ne: true } } },
    {
      $project: {
        entity: {
          id: { $toString: '$_id' },
          slug: '$slug',
          name: '$name',
          kind: '$kind',
          entityType: '$entityType',
          websiteUrl: '$websiteUrl',
          fullDescription: '$fullDescription',
          shortDescription: '$shortDescription',
          sourceUrls: '$sourceUrls',
          departments: '$departments',
          researchAreas: '$researchAreas',
        },
        urls: {
          $setUnion: [
            {
              $cond: [
                {
                  $and: [
                    { $ne: ['$websiteUrl', null] },
                    { $ne: [{ $trim: { input: '$websiteUrl' } }, ''] },
                  ],
                },
                ['$websiteUrl'],
                [],
              ],
            },
            { $ifNull: ['$sourceUrls', []] },
          ],
        },
      },
    },
    { $unwind: '$urls' },
    {
      $project: {
        url: { $trim: { input: { $toLower: '$urls' } } },
        entity: 1,
      },
    },
    {
      $match: {
        url: { $regex: '^https://medicine\\.yale\\.edu/lab/[^/]+/?$' },
      },
    },
    {
      $group: {
        _id: '$url',
        entities: { $addToSet: '$entity' },
      },
    },
    { $match: { 'entities.1': { $exists: true } } },
    { $sort: { _id: 1 } },
    { $limit: limit },
  ]).then((rows) =>
    rows.map((row: any) => ({
      url: row._id,
      entities: row.entities || [],
    })),
  );
}

async function loadDuplicateCurrentMemberRows(limit: number) {
  return ResearchGroupMember.aggregate([
    {
      $match: {
        isCurrentMember: { $ne: false },
        researchEntityId: { $exists: true, $ne: null },
        userId: { $exists: true, $ne: null },
      },
    },
    {
      $group: {
        _id: {
          researchEntityId: '$researchEntityId',
          userId: '$userId',
          role: '$role',
        },
        members: {
          $push: {
            id: { $toString: '$_id' },
            confidence: '$confidence',
            lastObservedAt: '$lastObservedAt',
            updatedAt: '$updatedAt',
            sourceUrl: '$sourceUrl',
          },
        },
      },
    },
    { $match: { 'members.1': { $exists: true } } },
    { $limit: limit },
  ]).then((rows) =>
    rows.map((row: any) => ({
      researchEntityId: serializedDocumentId(row._id.researchEntityId) || '',
      userId: serializedDocumentId(row._id.userId) || '',
      role: row._id.role,
      memberIdsToRetire: selectCurrentMemberIdsToRetire(row.members || []),
      memberCount: (row.members || []).length,
    })),
  );
}

export function normalizeResearchEntityPiDedupeObjectId(
  value: unknown,
): mongoose.Types.ObjectId | undefined {
  if (value instanceof mongoose.Types.ObjectId) return value;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!RESEARCH_ENTITY_PI_DEDUPE_OBJECT_ID_RE.test(trimmed)) return undefined;
  return new mongoose.Types.ObjectId(trimmed);
}

function objectId(value: unknown): mongoose.Types.ObjectId | undefined {
  return normalizeResearchEntityPiDedupeObjectId(value);
}

async function collectionExists(name: string): Promise<boolean> {
  const db = mongoose.connection.db;
  if (!db) return false;
  const matches = await db.listCollections({ name }, { nameOnly: true }).toArray();
  return matches.length > 0;
}

function stringId(value: unknown): string {
  return value === undefined || value === null ? '' : String(value);
}

async function loadArtifactsForDeleteMode(args: {
  canonicalId: mongoose.Types.ObjectId;
  duplicateIds: mongoose.Types.ObjectId[];
}): Promise<{
  artifacts: ArchivedEntityArtifact[];
  canonicalArtifacts: ArchivedEntityArtifact[];
}> {
  const artifacts: ArchivedEntityArtifact[] = [];
  const canonicalArtifacts: ArchivedEntityArtifact[] = [];
  const db = mongoose.connection.db;
  if (!db) return { artifacts, canonicalArtifacts };

  for (const spec of ARTIFACT_SPECS) {
    if (!(await collectionExists(spec.collection))) continue;
    const collection = db.collection(spec.collection);
    const [duplicateRows, canonicalRows] = await Promise.all([
      collection
        .find({
          archived: { $ne: true },
          researchEntityId: { $in: args.duplicateIds },
        })
        .project({
          _id: 1,
          researchEntityId: 1,
          derivationKey: 1,
          signalType: 1,
          entryPathwayId: 1,
        })
        .toArray(),
      collection
        .find({
          archived: { $ne: true },
          researchEntityId: args.canonicalId,
        })
        .project({
          _id: 1,
          researchEntityId: 1,
          derivationKey: 1,
          signalType: 1,
          entryPathwayId: 1,
        })
        .toArray(),
    ]);

    for (const row of duplicateRows) {
      artifacts.push({
        artifactType: spec.artifactType,
        id: stringId(row._id),
        researchEntityId: stringId(row.researchEntityId),
        canonicalResearchEntityId: stringId(args.canonicalId),
        derivationKey: stringId(row.derivationKey),
        signalType: stringId(row.signalType),
        entryPathwayId: stringId(row.entryPathwayId),
      });
    }
    for (const row of canonicalRows) {
      canonicalArtifacts.push({
        artifactType: spec.artifactType,
        id: stringId(row._id),
        researchEntityId: stringId(row.researchEntityId),
        canonicalResearchEntityId: stringId(row.researchEntityId),
        derivationKey: stringId(row.derivationKey),
        signalType: stringId(row.signalType),
        entryPathwayId: stringId(row.entryPathwayId),
      });
    }
  }

  return { artifacts, canonicalArtifacts };
}

async function archiveOrDeleteDuplicateDocument(args: {
  collectionName: string;
  id: string;
  now: Date;
  relinkField?: string;
  relinkValue?: mongoose.Types.ObjectId;
  allowDeleteOnConflict?: boolean;
}): Promise<'archived' | 'deleted' | 'skipped'> {
  const db = mongoose.connection.db;
  const id = objectId(args.id);
  if (!db || !id) return 'skipped';
  const collection = db.collection(args.collectionName);
  const existing = await collection.findOne({ _id: id }, { projection: { archived: 1 } });
  if (!existing) return 'skipped';
  if (Object.prototype.hasOwnProperty.call(existing, 'archived')) {
    const set = buildArchivedDocumentArchiveSet({
      now: args.now,
      relinkField: args.relinkField,
      relinkValue: args.relinkValue,
      includeRelink: true,
    });
    try {
      const result = await collection.updateOne({ _id: id }, { $set: set });
      return result.modifiedCount > 0 ? 'archived' : 'skipped';
    } catch (error: any) {
      if (error?.code !== 11000) throw error;
      if (args.relinkField) {
        try {
          const archiveOnly = await collection.updateOne(
            { _id: id },
            {
              $set: buildArchivedDocumentArchiveSet({
                now: args.now,
                relinkField: args.relinkField,
                relinkValue: args.relinkValue,
                includeRelink: false,
              }),
            },
          );
          if (archiveOnly.modifiedCount > 0) return 'archived';
        } catch (retryError: any) {
          if (retryError?.code !== 11000) throw retryError;
        }
      }
      const outcome = chooseArchivedDocumentConflictOutcome({
        allowDeleteOnConflict: args.allowDeleteOnConflict === true,
      });
      if (outcome === 'blocked') {
        throw new Error(
          `Archiving ${args.collectionName} ${args.id} hit a duplicate key; archive-mode dedupe will not delete conflict rows.`,
        );
      }
      const result = await collection.deleteOne({ _id: id });
      return result.deletedCount > 0 ? 'deleted' : 'skipped';
    }
  }
  const result = await collection.deleteOne({ _id: id });
  return result.deletedCount > 0 ? 'deleted' : 'skipped';
}

async function applyDeleteModeArtifactPlan(args: {
  canonicalId: mongoose.Types.ObjectId;
  duplicateIds: mongoose.Types.ObjectId[];
  now: Date;
  allowDeleteOnConflict: boolean;
}): Promise<Record<string, number>> {
  const db = mongoose.connection.db;
  const counts = {
    artifactRelinked: 0,
    artifactConflictsArchived: 0,
    artifactConflictsDeleted: 0,
    artifactMerged: 0,
    artifactMergeArchived: 0,
    artifactMergeDeleted: 0,
    artifactChildrenRelinked: 0,
  };
  if (!db) return counts;

  const { artifacts, canonicalArtifacts } = await loadArtifactsForDeleteMode(args);
  const plan = buildArchivedEntityArtifactRepairPlan({ artifacts, canonicalArtifacts });

  for (const item of plan.relink) {
    const spec = ARTIFACT_SPECS.find((candidate) => candidate.artifactType === item.artifactType);
    const itemId = objectId(item.id);
    if (!spec || !itemId) continue;
    try {
      const result = await db.collection(spec.collection).updateOne(
        { _id: itemId, archived: { $ne: true } },
        {
          $set: {
            researchEntityId: args.canonicalId,
            lastMaterializedAt: args.now,
          },
        },
      );
      counts.artifactRelinked += result.modifiedCount || 0;
    } catch (error: any) {
      if (error?.code !== 11000) throw error;
      const outcome = await archiveOrDeleteDuplicateDocument({
        collectionName: spec.collection,
        id: item.id,
        now: args.now,
        relinkField: 'researchEntityId',
        relinkValue: args.canonicalId,
        allowDeleteOnConflict: args.allowDeleteOnConflict,
      });
      if (outcome === 'archived') counts.artifactConflictsArchived += 1;
      if (outcome === 'deleted') counts.artifactConflictsDeleted += 1;
    }
  }

  for (const item of plan.mergeAndArchive) {
    const spec = ARTIFACT_SPECS.find((candidate) => candidate.artifactType === item.artifactType);
    const duplicateId = objectId(item.duplicateId);
    const canonicalArtifactId = objectId(item.canonicalId);
    if (!spec || !duplicateId || !canonicalArtifactId) continue;
    const collection = db.collection(spec.collection);
    const duplicate = await collection.findOne(
      { _id: duplicateId },
      { projection: { sourceEvidenceIds: 1, sourceUrls: 1 } },
    );
    const addToSet: Record<string, { $each: unknown[] }> = {};
    if (Array.isArray(duplicate?.sourceEvidenceIds) && duplicate.sourceEvidenceIds.length > 0) {
      addToSet.sourceEvidenceIds = { $each: duplicate.sourceEvidenceIds };
    }
    if (Array.isArray(duplicate?.sourceUrls) && duplicate.sourceUrls.length > 0) {
      addToSet.sourceUrls = { $each: duplicate.sourceUrls };
    }
    if (Object.keys(addToSet).length > 0) {
      const result = await collection.updateOne(
        { _id: canonicalArtifactId },
        {
          $addToSet: addToSet,
          $set: { lastMaterializedAt: args.now },
        },
      );
      counts.artifactMerged += result.modifiedCount || 0;
    }

    if (item.artifactType === 'EntryPathway') {
      const [signals, routes, opportunities] = await Promise.all(
        [
          { collection: 'access_signals', field: 'entryPathwayId' },
          { collection: 'contact_routes', field: 'entryPathwayId' },
          { collection: 'posted_opportunities', field: 'entryPathwayId' },
        ].map(async (child) => {
          if (!(await collectionExists(child.collection))) return { modifiedCount: 0 };
          return db.collection(child.collection).updateMany(
            { [child.field]: objectId(item.duplicateId), archived: { $ne: true } },
            { $set: { [child.field]: objectId(item.canonicalId), lastMaterializedAt: args.now } },
          );
        }),
      );
      counts.artifactChildrenRelinked +=
        (signals.modifiedCount || 0) +
        (routes.modifiedCount || 0) +
        (opportunities.modifiedCount || 0);
    }

    const outcome = await archiveOrDeleteDuplicateDocument({
      collectionName: spec.collection,
      id: item.duplicateId,
      now: args.now,
      relinkField: 'researchEntityId',
      relinkValue: args.canonicalId,
      allowDeleteOnConflict: args.allowDeleteOnConflict,
    });
    if (outcome === 'archived') counts.artifactMergeArchived += 1;
    if (outcome === 'deleted') counts.artifactMergeDeleted += 1;
  }

  return counts;
}

async function relinkScalarReferences(args: {
  canonicalId: mongoose.Types.ObjectId;
  duplicateIds: mongoose.Types.ObjectId[];
  now: Date;
  deleteDuplicates: boolean;
}): Promise<Record<string, number>> {
  const db = mongoose.connection.db;
  const counts: Record<string, number> = {};
  if (!db) return counts;

  for (const spec of SCALAR_REFERENCE_SPECS) {
    if (!(await collectionExists(spec.collection))) continue;
    const collection = db.collection(spec.collection);
    const baseFilter = buildResearchEntityDedupeReferenceFilter({
      field: spec.field,
      duplicateIds: args.duplicateIds,
      filter: spec.filter,
      archiveOnConflict: spec.archiveOnConflict,
    });
    const rows = await collection.find(baseFilter).project({ _id: 1 }).toArray();
    for (const row of rows) {
      try {
        const result = await collection.updateOne(
          { _id: row._id },
          { $set: { [spec.field]: args.canonicalId } },
        );
        counts[`${spec.collection}.${spec.field}.relinked`] =
          (counts[`${spec.collection}.${spec.field}.relinked`] || 0) +
          (result.modifiedCount || 0);
      } catch (error: any) {
        if (error?.code !== 11000) throw error;
        const action = chooseResearchEntityPiDedupeConflictAction({
          deleteDuplicates: args.deleteDuplicates,
          archiveOnConflict: spec.archiveOnConflict,
        });
        if (action === 'throw') {
          throw new Error(
            `Relinking ${spec.collection}.${spec.field} hit a duplicate key for ${
              serializedDocumentId(row._id) || ''
            }; archive-mode dedupe will not delete reference rows.`,
          );
        }
        const outcome =
          action === 'archive'
            ? await archiveOrDeleteDuplicateDocument({
                collectionName: spec.collection,
                id: serializedDocumentId(row._id) || '',
                now: args.now,
                relinkField: spec.field,
                relinkValue: args.canonicalId,
                allowDeleteOnConflict: false,
              })
            : await collection.deleteOne({ _id: row._id }).then((result) =>
                result.deletedCount > 0 ? 'deleted' : 'skipped',
              );
        counts[`${spec.collection}.${spec.field}.conflict.${outcome}`] =
          (counts[`${spec.collection}.${spec.field}.conflict.${outcome}`] || 0) + 1;
      }
    }
  }

  return counts;
}

async function relinkArrayReferences(args: {
  canonicalId: mongoose.Types.ObjectId;
  duplicateIds: mongoose.Types.ObjectId[];
}): Promise<Record<string, number>> {
  const db = mongoose.connection.db;
  const counts: Record<string, number> = {};
  if (!db) return counts;

  for (const spec of ARRAY_REFERENCE_SPECS) {
    if (!(await collectionExists(spec.collection))) continue;
    const result = await db.collection(spec.collection).updateMany(
      { [spec.field]: { $in: args.duplicateIds } },
      [
        {
          $set: {
            [spec.field]: {
              $setUnion: [
                {
                  $map: {
                    input: `$${spec.field}`,
                    as: 'id',
                    in: {
                      $cond: [{ $in: ['$$id', args.duplicateIds] }, args.canonicalId, '$$id'],
                    },
                  },
                },
                [],
              ],
            },
          },
        },
      ],
    );
    counts[`${spec.collection}.${spec.field}.relinked`] = result.modifiedCount || 0;
  }

  return counts;
}

async function countRemainingDuplicateReferences(
  duplicateIds: mongoose.Types.ObjectId[],
): Promise<Record<string, number>> {
  const db = mongoose.connection.db;
  const counts: Record<string, number> = {};
  if (!db) return counts;

  const referenceSpecs: Array<{
    collection: string;
    field: string;
    filter?: Record<string, unknown>;
    archiveOnConflict?: boolean;
  }> = [
    ...SCALAR_REFERENCE_SPECS,
    ...ARTIFACT_SPECS.map((item) => ({
      collection: item.collection,
      field: 'researchEntityId',
      archiveOnConflict: true,
    })),
  ];

  for (const spec of referenceSpecs) {
    if (!(await collectionExists(spec.collection))) continue;
    const filter = buildResearchEntityDedupeReferenceFilter({
      field: spec.field,
      duplicateIds,
      filter: spec.filter,
      archiveOnConflict: spec.archiveOnConflict,
    });
    const count = await db.collection(spec.collection).countDocuments(filter);
    if (count > 0) counts[`${spec.collection}.${spec.field}`] = count;
  }

  for (const spec of ARRAY_REFERENCE_SPECS) {
    if (!(await collectionExists(spec.collection))) continue;
    const count = await db.collection(spec.collection).countDocuments({
      [spec.field]: { $in: duplicateIds },
    });
    if (count > 0) counts[`${spec.collection}.${spec.field}`] = count;
  }

  return counts;
}

export async function applyResearchEntityDedupeMergeGroup(
  group: ResearchEntityDedupeMergeGroup,
  options: { deleteDuplicates: boolean; relinkReferences?: boolean },
) {
  const canonicalId = objectId(group.canonicalEntityId);
  const duplicateIds = group.duplicateEntityIds
    .map((id) => objectId(id))
    .filter((id): id is mongoose.Types.ObjectId => Boolean(id));
  if (!canonicalId || duplicateIds.length !== group.duplicateEntityIds.length || duplicateIds.length === 0) {
    return {
      canonicalEntityId: group.canonicalEntityId,
      duplicateEntityIds: group.duplicateEntityIds,
      canonicalUpdated: 0,
      archivedEntities: 0,
      deletedEntities: 0,
      retiredConflictingMembers: 0,
      relinkedMembers: 0,
      artifactRelink: {},
      scalarRelink: {},
      arrayRelink: {},
      remainingReferencesBeforeDelete: {},
    };
  }
  const now = new Date();

  const canonicalUpdate = await ResearchEntity.updateOne(
    { _id: canonicalId, archived: { $ne: true } },
    {
      $addToSet: {
        departments: { $each: group.mergedDepartments },
        researchAreas: { $each: group.mergedResearchAreas },
        sourceUrls: { $each: group.mergedSourceUrls },
      },
      $set: { lastObservedAt: new Date() },
    },
  );

  const archived = options.deleteDuplicates
    ? { modifiedCount: 0 }
    : await ResearchEntity.updateMany(
        { _id: { $in: duplicateIds }, archived: { $ne: true } },
        {
          $set: {
            archived: true,
            canonicalGroupId: canonicalId,
            lastObservedAt: now,
          },
        },
      );

  const duplicateMembers = await ResearchGroupMember.find({
    researchEntityId: { $in: duplicateIds },
  })
    .select('_id userId role')
    .lean();
  const canonicalMemberKeys = new Set(
    (
      await ResearchGroupMember.find({
        researchEntityId: canonicalId,
        userId: { $in: duplicateMembers.map((member) => member.userId).filter(Boolean) },
      })
        .select('userId role')
        .lean()
    ).map((member) => `${String(member.userId)}:${member.role || ''}`),
  );
  const conflictingMemberIds = duplicateMembers
    .filter((member) => canonicalMemberKeys.has(`${String(member.userId)}:${member.role || ''}`))
    .map((member) => member._id);

  const retiredConflictingMembers =
    conflictingMemberIds.length > 0
      ? await ResearchGroupMember.updateMany(
          { _id: { $in: conflictingMemberIds }, isCurrentMember: { $ne: false } },
          {
            $set: {
              isCurrentMember: false,
              leftAt: now,
              endedAt: now,
              lastObservedAt: now,
            },
          },
        )
      : { modifiedCount: 0 };

  const members = await ResearchGroupMember.updateMany(
    { researchEntityId: { $in: duplicateIds }, _id: { $nin: conflictingMemberIds } },
    { $set: { researchEntityId: canonicalId, researchGroupId: canonicalId } },
  );

  const shouldRelinkReferences = options.deleteDuplicates || options.relinkReferences;
  const artifactRelink = shouldRelinkReferences
    ? await applyDeleteModeArtifactPlan({
        canonicalId,
        duplicateIds,
        now,
        allowDeleteOnConflict: options.deleteDuplicates,
      })
    : {};
  const scalarRelink = shouldRelinkReferences
    ? await relinkScalarReferences({
        canonicalId,
        duplicateIds,
        now,
        deleteDuplicates: options.deleteDuplicates,
      })
    : {};
  const arrayRelink = shouldRelinkReferences
    ? await relinkArrayReferences({ canonicalId, duplicateIds })
    : {};
  const remainingReferencesBeforeDelete = options.deleteDuplicates
    ? await countRemainingDuplicateReferences(duplicateIds)
    : {};
  const deleted =
    options.deleteDuplicates && Object.keys(remainingReferencesBeforeDelete).length === 0
      ? await ResearchEntity.deleteMany({ _id: { $in: duplicateIds } })
      : { deletedCount: 0 };

  return {
    canonicalEntityId: group.canonicalEntityId,
    duplicateEntityIds: group.duplicateEntityIds,
    canonicalUpdated: canonicalUpdate.modifiedCount || 0,
    archivedEntities: archived.modifiedCount || 0,
    deletedEntities: deleted.deletedCount || 0,
    retiredConflictingMembers: retiredConflictingMembers.modifiedCount || 0,
    relinkedMembers: members.modifiedCount || 0,
    artifactRelink,
    scalarRelink,
    arrayRelink,
    remainingReferencesBeforeDelete,
  };
}

async function retireDuplicateCurrentMembers(
  groups: Array<{
    researchEntityId: string;
    userId: string;
    role?: string;
    memberIdsToRetire: string[];
    memberCount: number;
  }>,
) {
  const now = new Date();
  const results = await Promise.all(
    groups.map(async (group) => {
      const memberIds = group.memberIdsToRetire
        .map((id) => objectId(id))
        .filter((id): id is mongoose.Types.ObjectId => Boolean(id));
      if (memberIds.length === 0) {
        return {
          researchEntityId: group.researchEntityId,
          userId: group.userId,
          role: group.role,
          memberCount: group.memberCount,
          retiredMembers: 0,
        };
      }

      const retired = await ResearchGroupMember.updateMany(
        { _id: { $in: memberIds }, isCurrentMember: { $ne: false } },
        {
          $set: {
            isCurrentMember: false,
            leftAt: now,
            endedAt: now,
            lastObservedAt: now,
          },
        },
      );

      return {
        researchEntityId: group.researchEntityId,
        userId: group.userId,
        role: group.role,
        memberCount: group.memberCount,
        retiredMembers: retired.modifiedCount || 0,
      };
    }),
  );

  return results;
}

async function main() {
  const args = parseResearchEntityPiDedupeArgs(process.argv.slice(2));
  const {
    apply,
    deleteDuplicates,
    fundingOnly,
    fullPlan,
    officialLabUrlOnly,
    limit,
    maxApply,
    slug,
    reviewedProfileAreaOnly,
    acceptedDecisions,
    allowEmptyDecisions,
    decisionTemplateOutput,
    output,
  } = args;
  assertResearchEntityPiDedupeApplyBounded({
    apply,
    confirmResearchEntityPiDedupe: args.confirmResearchEntityPiDedupe,
    limitProvided: args.limitProvided,
  });
  if (!process.env.MONGODBURL) throw new Error('MONGODBURL is required');
  const guard = assertScriptApplyAllowed({
    apply,
    scriptName: 'research-entity:dedupe-by-pi',
    mongoUrl: process.env.MONGODBURL,
  });
  await mongoose.connect(process.env.MONGODBURL);

  const officialLabUrlRows: OfficialLabUrlDedupeRow[] = officialLabUrlOnly
    ? await loadOfficialLabUrlCandidateRows(limit)
    : [];
  const piRows: ResearchEntityPiDedupeRow[] = officialLabUrlOnly
    ? []
    : await loadCandidateRows(limit, {
        includeNameOnly: !deleteDuplicates,
        includeRetiredPiLinks: deleteDuplicates,
      });
  const rows = officialLabUrlOnly ? officialLabUrlRows : piRows;
  const allPlan = dedupePlannedGroups(
    officialLabUrlOnly
      ? buildOfficialLabUrlResearchEntityDedupePlan(officialLabUrlRows)
      : fundingOnly
        ? buildFundingResearchEntityDedupePlan(piRows)
        : buildResearchEntityPiDedupePlan(piRows),
  );
  const slugFilteredPlan = slug
    ? allPlan.filter((group) => group.canonicalSlug === slug || group.duplicateSlugs.includes(slug))
    : allPlan;
  const candidatePlan = reviewedProfileAreaOnly
    ? slugFilteredPlan.filter(isReviewedProfileAreaGroup)
    : slugFilteredPlan;
  const reviewDecisionValidation = acceptedDecisions
    ? validateResearchEntityPiDedupeDecisions(
        candidatePlan,
        readResearchEntityPiDedupeDecisions(acceptedDecisions, {
          allowEmpty: Boolean(allowEmptyDecisions),
        }),
        acceptedDecisions,
      )
    : undefined;
  const plan =
    apply && reviewDecisionValidation
      ? selectResearchEntityPiDedupePlansForAcceptedMergeApply(candidatePlan, reviewDecisionValidation)
      : candidatePlan;
  const duplicateCurrentMembers =
    acceptedDecisions || !shouldRetireDuplicateCurrentMembersForDedupeRun({ fundingOnly })
      ? []
      : await loadDuplicateCurrentMemberRows(limit);
  const plannedDuplicateEntities = plan.reduce(
    (sum, group) => sum + group.duplicateEntityIds.length,
    0,
  );
  const plannedDuplicateCurrentMembers = duplicateCurrentMembers.reduce(
    (sum, group) => sum + group.memberIdsToRetire.length,
    0,
  );
  assertResearchEntityPiDedupeApplyAllowed({
    apply,
    maxApply,
    plannedDuplicateEntities,
    plannedDuplicateCurrentMembers,
  });
  const applied = apply
    ? await applyResearchEntityPiDedupeGroupsSequentially(plan, (group) =>
        applyResearchEntityDedupeMergeGroup(group, {
          deleteDuplicates,
          relinkReferences: shouldRelinkReferencesForResearchEntityPiDedupeRun({ apply }),
        }),
      )
    : [];
  const retiredDuplicateCurrentMembers = apply
    ? await retireDuplicateCurrentMembers(duplicateCurrentMembers)
    : [];

  // Anti-stale safety net: merging duplicates and retiring members changes the
  // canonical survivor's lead/evidence, which would otherwise leave a stale
  // student-visibility tier until the next full gate run. Recompute the tier for
  // the affected canonical entities immediately so reads never serve a stale
  // tier after a dedupe.
  let visibilityRecomputed = 0;
  if (apply) {
    const canonicalIds = Array.from(
      new Set(
        applied
          .map((result: any) => result?.canonicalEntityId)
          .filter((id: unknown): id is string => typeof id === 'string' && id.length > 0),
      ),
    );
    if (canonicalIds.length > 0) {
      const gateResult = await runStudentVisibilityGate({
        collection: 'research',
        mode: 'apply',
        recordIds: canonicalIds,
      });
      visibilityRecomputed = gateResult.counts.scanned;
    }
  }

  writeResearchEntityPiDedupeDecisionTemplate(
    buildResearchEntityPiDedupeDecisionTemplate(candidatePlan),
    decisionTemplateOutput,
  );

  const report = {
    mode: apply ? 'apply' : 'dry-run',
    duplicateDisposition: deleteDuplicates ? 'delete' : 'archive',
    fundingOnly,
    officialLabUrlOnly,
    candidateGroups: rows.length,
    filteredBySlug: slug || null,
    reviewedProfileAreaOnly,
    maxApply,
    reviewCandidateGroups: candidatePlan.length,
    plannedGroups: plan.length,
    plannedDuplicateEntities,
    duplicateCurrentMemberGroups: duplicateCurrentMembers.length,
    plannedDuplicateCurrentMembers,
    reviewBreakdown: buildResearchEntityPiDedupeReviewBreakdown(plan),
    plan: fullPlan ? plan : plan.slice(0, 25),
    currentMemberPlan: duplicateCurrentMembers.slice(0, 25),
    ...(reviewDecisionValidation ? { reviewDecisionValidation } : {}),
    applied,
    retiredDuplicateCurrentMembers,
    visibilityRecomputed,
  };

  const outputReport = buildResearchEntityPiDedupeOutput(report, {
    environment: guard.environment,
    db: guard.dbLabel,
    options: args,
  });

  console.log(JSON.stringify(outputReport, null, 2));
  writeResearchEntityPiDedupeOutput(outputReport, output);
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

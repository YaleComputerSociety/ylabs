import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { ResearchEntity } from '../models/researchEntity';
import { RoleAssignment } from '../models/roleAssignment';
import {
  buildFundingResearchEntityDedupePlan,
  buildOfficialLabUrlResearchEntityDedupePlan,
  buildMultiPersonEntityQuarantine,
  buildOrgNameResearchEntityDedupePlan,
  buildResearchEntityPiDedupePlan,
  buildSameNameDifferentPersonQuarantine,
  buildSharedPersonIdResearchEntityDedupePlan,
  buildSpecificProfileLabUrlResearchEntityDedupePlan,
  buildWebsiteUrlResearchEntityDedupePlan,
  normalizeWebsiteUrlIdentityKey,
  specificProfileLabUrlIdentityKey,
  ORG_NAME_DEDUPE_ENTITY_TYPES,
  isLowTrustAreaShellSlug,
  type MultiPersonEntityQuarantine,
  type OfficialLabUrlDedupeRow,
  type OrgNameDedupeEntity,
  type ResearchEntityPiDedupeRow,
  type SameNameDifferentPersonQuarantine,
  type WebsiteUrlDedupeRow,
  selectCurrentMemberIdsToRetire,
  shouldRetireDuplicateCurrentMembersForDedupeRun,
} from './researchEntityPiDedupeCore';
import {
  buildArchivedEntityArtifactRepairPlan,
  type ArchivedEntityArtifact,
  type ArchivedEntityArtifactType,
} from './repairArchivedEntityArtifactsCore';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import { isSweepStageOptedIn } from './sweepStageFlags';
import { deleteFromIndex, syncEntities } from '../services/meiliSyncService';
import { recomputeVisibilityAndResyncCanonicals } from '../services/researchEntityEponymousMergeService';
import { recordResearchEntityMergeRedirects } from '../services/researchEntityMergeRedirectService';
import {
  repairMergeSurvivorVisibility,
  type MergeSurvivorVisibilityRepair,
} from '../services/researchEntityMergeSurvivorVisibilityService';
import { computeResearchEntityStudentVisibility } from '../services/studentVisibilityTier';
import {
  getResearchEntityRosterByEntityId,
  type ResearchEntityRosterEntry,
} from '../services/researchEntityMembershipAccessor';
import { buildGateLeadRow } from './retireForeignLeadGraftsCore';
import {
  fullDescriptionQuality,
  shortDescriptionQuality,
} from '../utils/researchEntityDescriptionQuality';
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
  canonicalName?: string;
  canonicalWebsiteUrl?: string;
  canonicalFullDescription?: string;
  canonicalShortDescription?: string;
  mergedRecentGrants?: unknown[];
  mergedRecentGrantCount?: number;
  mergedFundingAgencies?: string[];
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
  profileLabUrlOnly: boolean;
  orgNameOnly: boolean;
  websiteUrlOnly: boolean;
  reviewedProfileAreaOnly: boolean;
  sharedPersonId: boolean;
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
    canonicalName?: string;
    canonicalWebsiteUrl?: string;
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
    profileLabUrlOnly: false,
    orgNameOnly: false,
    websiteUrlOnly: false,
    reviewedProfileAreaOnly: false,
    sharedPersonId: false,
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
    if (arg === '--profile-lab-url-only') {
      args.profileLabUrlOnly = true;
      continue;
    }
    if (arg === '--org-name-only') {
      args.orgNameOnly = true;
      continue;
    }
    if (arg === '--website-url-only') {
      args.websiteUrlOnly = true;
      continue;
    }
    if (arg === '--reviewed-profile-area-only') {
      args.reviewedProfileAreaOnly = true;
      continue;
    }
    if (arg === '--shared-person-id') {
      args.sharedPersonId = true;
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
    Math.max(0, args.plannedDuplicateEntities) + Math.max(0, args.plannedDuplicateCurrentMembers);
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
      canonicalName: plan.canonicalName,
      canonicalWebsiteUrl: plan.canonicalWebsiteUrl,
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
  return decisions.map((decision, index) =>
    normalizeResearchEntityPiDedupeDecision(decision, index),
  );
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
    unreviewedPlanCount: plans.filter(
      (plan) => !validPlanIds.has(researchEntityPiDedupePlanId(plan)),
    ).length,
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
    .filter(
      (decision) => decision.status === 'valid' && decision.decision === 'merge_into_canonical',
    )
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
  if (
    !['merge_into_canonical', 'mark_distinct_homes', 'defer_review'].includes(decision.decision)
  ) {
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

function isReviewedProfileAreaGroup(
  group: ReturnType<typeof buildResearchEntityPiDedupePlan>[number],
) {
  if (group.dedupeCategory === 'profile_area_shell_with_concrete_home') return true;
  const canonicalSlug = String(group.canonicalSlug || '');
  return (
    group.duplicateSlugs.length > 0 &&
    !canonicalSlug.startsWith('faculty-research-area-') &&
    !canonicalSlug.startsWith('nih-pi-') &&
    !canonicalSlug.startsWith('nsf-pi-') &&
    !canonicalSlug.startsWith('federal-pi-') &&
    !canonicalSlug.startsWith('doe-pi-') &&
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
    canonicalName?: string;
    canonicalWebsiteUrl?: string;
  }>,
) {
  const fundingSlugPattern = /^(nih|nsf|federal)-pi-/;
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
  const crossDepartmentGroups = groups.filter(
    (group) => uniqueCount(group.mergedDepartments) > 1,
  ).length;
  const groupsWithMergedResearchAreas = groups.filter(
    (group) => uniqueCount(group.mergedResearchAreas) > 0,
  ).length;
  const highResearchAreaMergeGroups = groups.filter(
    (group) => uniqueCount(group.mergedResearchAreas) >= 6,
  ).length;
  const groupsCarryingCanonicalName = groups.filter((group) =>
    Boolean(String(group.canonicalName || '').trim()),
  ).length;
  const groupsCarryingCanonicalWebsite = groups.filter((group) =>
    Boolean(String(group.canonicalWebsiteUrl || '').trim()),
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
    groupsCarryingCanonicalName,
    groupsCarryingCanonicalWebsite,
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
}> = [{ artifactType: 'AccessSignal', collection: 'signals' }];

const SCALAR_REFERENCE_SPECS: Array<{
  collection: string;
  field: string;
  filter?: Record<string, unknown>;
  archiveOnConflict?: boolean;
}> = [
  { collection: 'research_entities', field: 'canonicalGroupId' },
  { collection: 'research_scholarly_links', field: 'researchEntityId', archiveOnConflict: true },
  { collection: 'signals', field: 'researchEntityId', archiveOnConflict: true },
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
  {
    collection: 'research_plans',
    field: 'target.id',
    filter: { 'target.kind': 'RESEARCH_ENTITY' },
    archiveOnConflict: true,
  },
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

export async function loadSamePiCandidateRows(
  limit: number,
  options: {
    includeRetiredMembers: boolean;
    personIds?: Array<string | mongoose.Types.ObjectId>;
  },
) {
  const assignmentMatch: Record<string, unknown> = {
    'target.kind': 'RESEARCH_ENTITY',
    role: 'PI',
    'target.id': { $exists: true, $ne: null },
    personId: { $exists: true, $ne: null },
    archived: { $ne: true },
  };
  if (!options.includeRetiredMembers) assignmentMatch.state = { $ne: 'HISTORICAL' };
  if (options.personIds) {
    const scopedPersonIds = options.personIds
      .map((personId) => normalizeResearchEntityPiDedupeObjectId(personId))
      .filter((personId): personId is mongoose.Types.ObjectId => Boolean(personId));
    if (scopedPersonIds.length === 0) return [];
    assignmentMatch.personId = { $in: scopedPersonIds };
  }

  const rows = await RoleAssignment.aggregate([
    { $match: assignmentMatch },
    {
      $lookup: {
        from: 'research_entities',
        localField: 'target.id',
        foreignField: '_id',
        as: 'entity',
      },
    },
    { $unwind: '$entity' },
    { $match: { 'entity.archived': { $ne: true } } },
    {
      $lookup: {
        from: 'researchers',
        localField: 'personId',
        foreignField: '_id',
        as: 'person',
      },
    },
    { $unwind: { path: '$person', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        personId: { $toString: '$personId' },
        piDisplayName: '$person.displayName',
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
          recentGrants: '$entity.recentGrants',
          recentGrantCount: '$entity.recentGrantCount',
          fundingAgencies: '$entity.fundingAgencies',
        },
      },
    },
    {
      $group: {
        _id: { userId: '$personId' },
        piDisplayName: { $first: '$piDisplayName' },
        entities: { $addToSet: '$entity' },
      },
    },
    { $limit: limit },
  ]);

  return Promise.all(
    rows.map(async (row: any) => {
      const displayNameParts = String(row.piDisplayName || '')
        .trim()
        .split(/\s+/)
        .filter(Boolean);
      const lastName =
        displayNameParts.length > 0 ? displayNameParts[displayNameParts.length - 1] : '';
      const firstName = displayNameParts.slice(0, -1).join(' ');
      const entityIds = new Set((row.entities || []).map((entity: { id?: string }) => entity.id));
      const exactPersonNames = profileAreaNamesForPi(firstName, lastName);
      const profileAreaEntities =
        exactPersonNames.length > 0
          ? await ResearchEntity.find({
              archived: { $ne: true },
              name: { $in: exactPersonNames },
            })
              .select(
                '_id slug name kind entityType websiteUrl fullDescription shortDescription sourceUrls departments researchAreas recentGrants recentGrantCount fundingAgencies',
              )
              .lean()
          : [];

      return {
        userId: row._id.userId,
        normalizedName: `same-pi:${row._id.userId}`,
        piFirstName: firstName,
        piLastName: lastName,
        entities: [
          ...(row.entities || []).map((entity: { id?: string }) => ({
            ...entity,
            piRoleCorroborated: true,
          })),
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
              recentGrants: entity.recentGrants,
              recentGrantCount: entity.recentGrantCount,
              fundingAgencies: entity.fundingAgencies,
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
          recentGrants: '$recentGrants',
          recentGrantCount: '$recentGrantCount',
          fundingAgencies: '$fundingAgencies',
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
        from: 'role_assignments',
        let: { entityIds: '$entityIds' },
        pipeline: [
          {
            $match: {
              $expr: { $in: ['$target.id', '$$entityIds'] },
              'target.kind': 'RESEARCH_ENTITY',
              role: 'PI',
              state: { $ne: 'HISTORICAL' },
              archived: { $ne: true },
              personId: { $exists: true, $ne: null },
            },
          },
          { $group: { _id: '$personId' } },
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

async function loadSpecificProfileLabUrlCandidateRows(
  limit: number,
): Promise<OfficialLabUrlDedupeRow[]> {
  const rows = await ResearchEntity.aggregate([
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
            { $cond: [{ $ne: [{ $type: '$websiteUrl' }, 'missing'] }, ['$websiteUrl'], []] },
            { $cond: [{ $ne: [{ $type: '$website' }, 'missing'] }, ['$website'], []] },
            { $ifNull: ['$sourceUrls', []] },
          ],
        },
      },
    },
    { $unwind: '$urls' },
    { $project: { url: '$urls', entity: 1 } },
    {
      $match: {
        url: {
          $regex: '^https?://([a-z0-9-]+\\.)*yale\\.edu/(lab|profile)/[^/]+/?$',
          $options: 'i',
        },
      },
    },
    {
      $group: {
        _id: '$url',
        entities: { $addToSet: '$entity' },
      },
    },
  ]).allowDiskUse(true);

  const byKey = new Map<string, OfficialLabUrlDedupeRow>();
  for (const row of rows as Array<{
    _id: string;
    entities: ResearchEntityPiDedupeRow['entities'];
  }>) {
    const key = specificProfileLabUrlIdentityKey(row._id);
    if (!key) continue;
    const existing = byKey.get(key);
    if (existing) {
      const seen = new Set(existing.entities.map((entity) => entity.id));
      for (const entity of row.entities) {
        if (!seen.has(entity.id)) existing.entities.push(entity);
      }
    } else {
      byKey.set(key, { url: row._id, entities: [...row.entities] });
    }
  }

  return Array.from(byKey.values())
    .filter((row) => row.entities.length > 1)
    .sort((a, b) => a.url.localeCompare(b.url))
    .slice(0, limit);
}

async function loadOrgNameCandidateRows(limit: number): Promise<OrgNameDedupeEntity[]> {
  return ResearchEntity.aggregate([
    {
      $match: {
        archived: { $ne: true },
        entityType: { $in: [...ORG_NAME_DEDUPE_ENTITY_TYPES] },
        name: { $exists: true, $ne: '' },
      },
    },
    {
      $lookup: {
        from: 'role_assignments',
        let: { entityId: '$_id' },
        pipeline: [
          {
            $match: {
              $expr: { $eq: ['$target.id', '$$entityId'] },
              'target.kind': 'RESEARCH_ENTITY',
              state: { $ne: 'HISTORICAL' },
              archived: { $ne: true },
              personId: { $exists: true, $ne: null },
            },
          },
          {
            $group: {
              _id: null,
              memberCount: { $sum: 1 },
              piCount: { $sum: { $cond: [{ $eq: ['$role', 'PI'] }, 1, 0] } },
            },
          },
        ],
        as: 'membership',
      },
    },
    {
      $project: {
        id: { $toString: '$_id' },
        slug: '$slug',
        name: '$name',
        displayName: '$displayName',
        entityType: '$entityType',
        websiteUrl: '$websiteUrl',
        fullDescription: '$fullDescription',
        shortDescription: '$shortDescription',
        sourceUrls: '$sourceUrls',
        departments: '$departments',
        researchAreas: '$researchAreas',
        memberCount: { $ifNull: [{ $arrayElemAt: ['$membership.memberCount', 0] }, 0] },
        hasAttachedPi: {
          $gt: [{ $ifNull: [{ $arrayElemAt: ['$membership.piCount', 0] }, 0] }, 0],
        },
      },
    },
    { $sort: { id: 1 } },
    { $limit: limit },
  ]).then((rows) => rows as OrgNameDedupeEntity[]);
}

async function loadWebsiteUrlCandidateRows(limit: number): Promise<WebsiteUrlDedupeRow[]> {
  const entities = await ResearchEntity.aggregate([
    {
      $match: {
        archived: { $ne: true },
        websiteUrl: { $exists: true, $nin: ['', null] },
      },
    },
    {
      $lookup: {
        from: 'role_assignments',
        let: { entityId: '$_id' },
        pipeline: [
          {
            $match: {
              $expr: { $eq: ['$target.id', '$$entityId'] },
              'target.kind': 'RESEARCH_ENTITY',
              role: 'PI',
              state: { $ne: 'HISTORICAL' },
              archived: { $ne: true },
              personId: { $exists: true, $ne: null },
            },
          },
          { $limit: 1 },
        ],
        as: 'piMembership',
      },
    },
    {
      $project: {
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
        recentGrants: '$recentGrants',
        recentGrantCount: '$recentGrantCount',
        fundingAgencies: '$fundingAgencies',
        piRoleCorroborated: { $gt: [{ $size: '$piMembership' }, 0] },
      },
    },
    { $sort: { id: 1 } },
  ]);

  const byKey = new Map<string, WebsiteUrlDedupeRow>();
  for (const entity of entities as ResearchEntityPiDedupeRow['entities']) {
    const key = normalizeWebsiteUrlIdentityKey(entity.websiteUrl);
    if (!key) continue;
    const existing = byKey.get(key);
    if (existing) existing.entities.push(entity);
    else byKey.set(key, { websiteUrl: entity.websiteUrl || '', entities: [entity] });
  }

  return Array.from(byKey.values())
    .filter((row) => row.entities.length > 1)
    .slice(0, limit);
}

async function loadDuplicateCurrentMemberRows(limit: number) {
  return RoleAssignment.aggregate([
    {
      $match: {
        'target.kind': 'RESEARCH_ENTITY',
        state: { $ne: 'HISTORICAL' },
        archived: { $ne: true },
        'target.id': { $exists: true, $ne: null },
        personId: { $exists: true, $ne: null },
      },
    },
    {
      $group: {
        _id: {
          researchEntityId: '$target.id',
          userId: '$personId',
          role: '$role',
        },
        members: {
          $push: {
            id: { $toString: '$_id' },
            confidence: '$confidence',
            lastObservedAt: '$rosterProvenance.observedAt',
            updatedAt: '$updatedAt',
            sourceUrl: '$rosterProvenance.sourceUrl',
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
        signalType: stringId(row.type),
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
        signalType: stringId(row.type),
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
          (counts[`${spec.collection}.${spec.field}.relinked`] || 0) + (result.modifiedCount || 0);
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
            : await collection
                .deleteOne({ _id: row._id })
                .then((result) => (result.deletedCount > 0 ? 'deleted' : 'skipped'));
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
    const result = await db
      .collection(spec.collection)
      .updateMany({ [spec.field]: { $in: args.duplicateIds } }, [
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
      ]);
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

export const SCRAPER_SWEEP_MERGE_URL_IDENTITY_DUPLICATES_ENV =
  'SCRAPER_SWEEP_MERGE_URL_IDENTITY_DUPLICATES';
export const DEFAULT_URL_IDENTITY_MERGE_MAX = 500;

export function isUrlIdentityDedupeStageEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return isSweepStageOptedIn(env[SCRAPER_SWEEP_MERGE_URL_IDENTITY_DUPLICATES_ENV]);
}

const STUDENT_VISIBILITY_TIER_RANK: Record<string, number> = {
  student_ready: 3,
  limited_but_safe: 2,
  operator_review: 1,
  suppressed: 0,
};
const STUDENT_VISIBILITY_RANK_TIER = [
  'suppressed',
  'operator_review',
  'limited_but_safe',
  'student_ready',
];
const mergeTierRank = (tier: unknown): number =>
  STUDENT_VISIBILITY_TIER_RANK[String(tier ?? '')] ?? STUDENT_VISIBILITY_TIER_RANK.operator_review;

const MERGE_LEAD_ROLES = new Set(['pi', 'co-pi', 'director', 'co-director']);

function renderLeadMembersFromRoster(
  entries: ResearchEntityRosterEntry[],
  researchEntityId: mongoose.Types.ObjectId,
): Array<Record<string, any>> {
  return entries
    .filter(
      (entry) =>
        entry &&
        entry.state !== 'HISTORICAL' &&
        MERGE_LEAD_ROLES.has(String(entry.role ?? '').toLowerCase()),
    )
    .map((entry) => ({
      ...buildGateLeadRow(entry),
      researchEntityId,
      userId: entry.personId,
    }));
}

function pickBestUsefulText(values: string[], isUseful: (value: string) => boolean): string {
  const cleaned = values.map((value) => (value || '').trim()).filter(Boolean);
  const useful = cleaned.filter(isUseful);
  const pool = useful.length > 0 ? useful : cleaned;
  return pool.sort((a, b) => b.length - a.length)[0] || '';
}

/**
 * Picks the descriptions a merge survivor should end up with: the longest
 * quality-passing `fullDescription` and `shortDescription` across every twin,
 * read from the live documents rather than from a plan-time projection.
 *
 * This is deliberately lane-agnostic. The plan builders each compute their own
 * `canonicalFullDescription` carry from an aggregate projection, and not every
 * lane computes one, so a merge that relied on the plan could leave the richer
 * paragraph stranded on the archived twin (#2208).
 */
function bestMergeDescriptions(
  docs: Array<Record<string, any>>,
  unionAreas: string[],
): { fullDescription: string; shortDescription: string } {
  const fullDescription = pickBestUsefulText(
    docs.map((doc) => String(doc.fullDescription || '')),
    (value) => fullDescriptionQuality(value).isUseful,
  );
  const shortDescription = pickBestUsefulText(
    docs.map((doc) => String(doc.shortDescription || '')),
    (value) => shortDescriptionQuality(value, fullDescription, unionAreas, {}).isUseful,
  );
  return { fullDescription, shortDescription };
}

/**
 * Lane-agnostic description hydration for the merge apply path. `neverDemote`
 * already hydrates as part of its simulate-then-verify resolution; every other
 * lane previously fell back to whatever the plan carried, which is how the
 * richer paragraph was stranded in #2208.
 */
async function hydrateMergeDescriptions(
  canonicalId: mongoose.Types.ObjectId,
  duplicateIds: mongoose.Types.ObjectId[],
): Promise<{ fullDescription: string; shortDescription: string }> {
  const allDocs = await ResearchEntity.find({ _id: { $in: [canonicalId, ...duplicateIds] } })
    .select('_id slug fullDescription shortDescription researchAreas')
    .lean<Array<Record<string, any>>>();
  // Mirror the plan builders' `trustedAreaShellEntities` guard: an area or
  // funding shell's generated blurb must never be promoted onto a real research
  // home. Fall back to the full set when every twin is a shell, matching the
  // plan's own fallback.
  const trusted = allDocs.filter((doc) => !isLowTrustAreaShellSlug(doc.slug));
  const docs = trusted.length > 0 ? trusted : allDocs;
  const unionAreas = Array.from(
    new Set(
      docs
        .flatMap((doc) => (Array.isArray(doc.researchAreas) ? doc.researchAreas : []))
        .map((value) => String(value))
        .filter(Boolean),
    ),
  );
  return bestMergeDescriptions(docs, unionAreas);
}

export interface NonDemotingMergeResolution {
  defer: boolean;
  canonicalId: mongoose.Types.ObjectId;
  duplicateIds: mongoose.Types.ObjectId[];
  hydratedFullDescription: string;
  hydratedShortDescription: string;
  bestInputTier: string;
  simulatedTier: string;
}

/**
 * A merge keeps one survivor and archives the rest, so keeping a survivor that
 * is less student-visible than one of its twins silently drops a lab from
 * student view (the #2060 regression). This resolves the survivor by
 * hydrate-then-verify: hydrate a candidate canonical with the best card + the
 * union of leads/areas/urls across all twins, simulate the served tier with the
 * pure `computeResearchEntityStudentVisibility` gate, and accept the candidate
 * only when it does not demote below the best input twin. The preferred
 * (identity-consistent) canonical is tried first; if it would demote, higher-tier
 * twins are tried; if none holds the tier the merge is deferred rather than
 * demoting.
 */
export async function resolveNonDemotingMerge(
  preferredCanonicalId: mongoose.Types.ObjectId,
  duplicateIds: mongoose.Types.ObjectId[],
): Promise<NonDemotingMergeResolution> {
  const allIds = [preferredCanonicalId, ...duplicateIds];
  const docs = await ResearchEntity.find({ _id: { $in: allIds } }).lean<
    Array<Record<string, any>>
  >();
  const docById = new Map(docs.map((doc) => [String(doc._id), doc]));
  const bestInputRank = Math.max(
    ...allIds.map((id) => mergeTierRank(docById.get(String(id))?.studentVisibilityTier)),
  );
  const unionStrings = (field: string): string[] =>
    Array.from(
      new Set(
        docs
          .flatMap((doc) => (Array.isArray(doc[field]) ? doc[field] : []))
          .map((value) => String(value))
          .filter(Boolean),
      ),
    );
  const unionAreas = unionStrings('researchAreas');
  const unionSourceUrls = unionStrings('sourceUrls');
  const unionDepartments = unionStrings('departments');
  const { fullDescription: bestFull, shortDescription: bestShort } = bestMergeDescriptions(
    docs,
    unionAreas,
  );

  const rosterMap = await getResearchEntityRosterByEntityId(allIds);
  const allLeads = allIds.flatMap((id) =>
    renderLeadMembersFromRoster(rosterMap.get(String(id)) || [], id),
  );

  const candidateOrder = [
    preferredCanonicalId,
    ...duplicateIds
      .slice()
      .sort(
        (a, b) =>
          mergeTierRank(docById.get(String(b))?.studentVisibilityTier) -
          mergeTierRank(docById.get(String(a))?.studentVisibilityTier),
      ),
  ];

  for (const candidateId of candidateOrder) {
    const doc = docById.get(String(candidateId));
    if (!doc) continue;
    const hypothetical = {
      ...doc,
      fullDescription: bestFull || doc.fullDescription,
      shortDescription: bestShort || doc.shortDescription,
      researchAreas: unionAreas,
      sourceUrls: unionSourceUrls,
      departments: unionDepartments,
    };
    const leadMembers = allLeads.map((lead) => ({ ...lead, researchEntityId: candidateId }));
    const simulated = computeResearchEntityStudentVisibility({
      entity: hypothetical,
      leadMembers,
      duplicateRisk: false,
      exactUrlDuplicateRisk: false,
    });
    if (mergeTierRank(simulated.tier) >= bestInputRank) {
      return {
        defer: false,
        canonicalId: candidateId,
        duplicateIds: allIds.filter((id) => !id.equals(candidateId)),
        hydratedFullDescription: bestFull,
        hydratedShortDescription: bestShort,
        bestInputTier: STUDENT_VISIBILITY_RANK_TIER[bestInputRank],
        simulatedTier: simulated.tier,
      };
    }
  }

  return {
    defer: true,
    canonicalId: preferredCanonicalId,
    duplicateIds,
    hydratedFullDescription: bestFull,
    hydratedShortDescription: bestShort,
    bestInputTier: STUDENT_VISIBILITY_RANK_TIER[bestInputRank],
    simulatedTier: STUDENT_VISIBILITY_RANK_TIER[0],
  };
}

export async function applyResearchEntityDedupeMergeGroup(
  group: ResearchEntityDedupeMergeGroup,
  options: {
    deleteDuplicates: boolean;
    relinkReferences?: boolean;
    redirectReason?: string;
    neverDemote?: boolean;
  },
) {
  const requestedCanonicalId = objectId(group.canonicalEntityId);
  const requestedDuplicateIds = group.duplicateEntityIds
    .map((id) => objectId(id))
    .filter((id): id is mongoose.Types.ObjectId => Boolean(id));
  const zeroedResult = () => ({
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
    removedFromSearchIndex: 0,
    survivorVisibility: { regated: false } as MergeSurvivorVisibilityRepair,
    survivorIndexResynced: false,
  });
  if (
    !requestedCanonicalId ||
    requestedDuplicateIds.length !== group.duplicateEntityIds.length ||
    requestedDuplicateIds.length === 0
  ) {
    return zeroedResult();
  }
  const now = new Date();

  let canonicalId = requestedCanonicalId;
  let duplicateIds = requestedDuplicateIds;
  let hydratedFullDescription: string | undefined;
  let hydratedShortDescription: string | undefined;
  if (options.neverDemote) {
    const resolution = await resolveNonDemotingMerge(requestedCanonicalId, requestedDuplicateIds);
    if (resolution.defer) {
      return {
        ...zeroedResult(),
        deferredAsWouldDemote: true,
        bestInputTier: resolution.bestInputTier,
      };
    }
    canonicalId = resolution.canonicalId;
    duplicateIds = resolution.duplicateIds;
    hydratedFullDescription = resolution.hydratedFullDescription;
    hydratedShortDescription = resolution.hydratedShortDescription;
  } else {
    // Fill-only: when the plan builder carried a description we keep it
    // authoritative, but a lane that carried nothing must not leave the richer
    // paragraph stranded on the archived twin (#2208).
    const needsFull = !String(group.canonicalFullDescription || '').trim();
    const needsShort = !String(group.canonicalShortDescription || '').trim();
    if (needsFull || needsShort) {
      const hydrated = await hydrateMergeDescriptions(canonicalId, duplicateIds);
      if (needsFull) hydratedFullDescription = hydrated.fullDescription;
      if (needsShort) hydratedShortDescription = hydrated.shortDescription;
    }
  }

  const duplicateSlugDocs = await ResearchEntity.find({ _id: { $in: duplicateIds } })
    .select('_id slug')
    .lean<Array<{ _id: mongoose.Types.ObjectId; slug?: string }>>();
  const duplicateSlugById = new Map(duplicateSlugDocs.map((doc) => [String(doc._id), doc.slug]));
  await recordResearchEntityMergeRedirects({
    canonicalEntityId: canonicalId,
    mergedShells: duplicateIds.map((id) => ({
      entityId: id,
      slug: duplicateSlugById.get(String(id)),
    })),
    reason: options.redirectReason,
    mergedAt: now,
  });

  const canonicalIdentitySet: Record<string, unknown> = { lastObservedAt: new Date() };
  const carriedName = String(group.canonicalName || '').trim();
  const carriedWebsiteUrl = String(group.canonicalWebsiteUrl || '').trim();
  if (carriedName) {
    canonicalIdentitySet.name = carriedName;
    canonicalIdentitySet.displayName = carriedName;
  }
  if (carriedWebsiteUrl) canonicalIdentitySet.websiteUrl = carriedWebsiteUrl;
  const carriedFullDescription =
    (hydratedFullDescription || '').trim() || String(group.canonicalFullDescription || '').trim();
  const carriedShortDescription =
    (hydratedShortDescription || '').trim() || String(group.canonicalShortDescription || '').trim();
  if (carriedFullDescription) canonicalIdentitySet.fullDescription = carriedFullDescription;
  if (carriedShortDescription) canonicalIdentitySet.shortDescription = carriedShortDescription;
  if (group.mergedRecentGrants && group.mergedRecentGrants.length > 0) {
    canonicalIdentitySet.recentGrants = group.mergedRecentGrants;
  }
  if (typeof group.mergedRecentGrantCount === 'number' && group.mergedRecentGrantCount > 0) {
    canonicalIdentitySet.recentGrantCount = group.mergedRecentGrantCount;
  }
  if (group.mergedFundingAgencies && group.mergedFundingAgencies.length > 0) {
    canonicalIdentitySet.fundingAgencies = group.mergedFundingAgencies;
  }

  const canonicalUpdate = await ResearchEntity.updateOne(
    { _id: canonicalId, archived: { $ne: true } },
    {
      $addToSet: {
        departments: { $each: group.mergedDepartments },
        researchAreas: { $each: group.mergedResearchAreas },
        sourceUrls: { $each: group.mergedSourceUrls },
      },
      $set: canonicalIdentitySet,
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

  const duplicateMembers = await RoleAssignment.find({
    'target.kind': 'RESEARCH_ENTITY',
    'target.id': { $in: duplicateIds },
  })
    .select('_id personId role')
    .lean();
  const canonicalMemberKeys = new Set(
    (
      await RoleAssignment.find({
        'target.kind': 'RESEARCH_ENTITY',
        'target.id': canonicalId,
        personId: { $in: duplicateMembers.map((member) => member.personId).filter(Boolean) },
      })
        .select('personId role')
        .lean()
    ).map((member) => `${String(member.personId)}:${member.role || ''}`),
  );
  const conflictingMemberIds = duplicateMembers
    .filter((member) => canonicalMemberKeys.has(`${String(member.personId)}:${member.role || ''}`))
    .map((member) => member._id);

  const retiredConflictingMembers =
    conflictingMemberIds.length > 0
      ? await RoleAssignment.updateMany(
          {
            _id: { $in: conflictingMemberIds },
            state: { $ne: 'HISTORICAL' },
            archived: { $ne: true },
          },
          {
            $set: {
              state: 'HISTORICAL',
              endedAt: now,
              archived: true,
            },
          },
        )
      : { modifiedCount: 0 };

  const members = await RoleAssignment.updateMany(
    {
      'target.kind': 'RESEARCH_ENTITY',
      'target.id': { $in: duplicateIds },
      _id: { $nin: conflictingMemberIds },
    },
    { $set: { 'target.id': canonicalId } },
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

  // Every duplicate leaving the live ResearchEntity set (whether archived just
  // now, deleted just now, or already archived by a prior dedupe pass) must
  // never leave a "ghost" doc searchable in Meilisearch. Skip cleanup only
  // when deleteDuplicates left the duplicates untouched due to remaining refs.
  const idsToRemoveFromIndex =
    options.deleteDuplicates && (deleted.deletedCount || 0) === 0 ? [] : duplicateIds.map(String);
  await Promise.all(idsToRemoveFromIndex.map((id) => deleteFromIndex('researchEntity', id)));

  const survivorVisibility = await repairMergeSurvivorVisibility(canonicalId);

  // A merge relinks roster members and lead assignments onto the survivor, so its
  // Meilisearch document is stale even when its tier does not move. The visibility
  // repair syncs the index only when it actually re-gates, and it deliberately
  // short-circuits for an already-servable survivor - which is the common case
  // when a duplicate is folded into a healthy canonical entity. Browse reads the
  // index, so without this the most visible survivors keep pre-merge lead names
  // (issue #2239).
  const survivorIndexResynced = survivorVisibility.regated
    ? false
    : await resyncMergeSurvivorSearchDocument(canonicalId);

  return {
    canonicalEntityId: String(canonicalId),
    duplicateEntityIds: duplicateIds.map(String),
    canonicalUpdated: canonicalUpdate.modifiedCount || 0,
    archivedEntities: archived.modifiedCount || 0,
    deletedEntities: deleted.deletedCount || 0,
    retiredConflictingMembers: retiredConflictingMembers.modifiedCount || 0,
    relinkedMembers: members.modifiedCount || 0,
    artifactRelink,
    scalarRelink,
    arrayRelink,
    remainingReferencesBeforeDelete,
    removedFromSearchIndex: idsToRemoveFromIndex.length,
    survivorVisibility,
    survivorIndexResynced,
  };
}

async function resyncMergeSurvivorSearchDocument(
  survivorId: mongoose.Types.ObjectId | string,
): Promise<boolean> {
  const survivor = await ResearchEntity.findById(survivorId).lean();
  if (!survivor || (survivor as { archived?: boolean }).archived === true) return false;
  await syncEntities('researchEntity', [survivor]);
  return true;
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

      const retired = await RoleAssignment.updateMany(
        { _id: { $in: memberIds }, state: { $ne: 'HISTORICAL' }, archived: { $ne: true } },
        {
          $set: {
            state: 'HISTORICAL',
            endedAt: now,
            archived: true,
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
    profileLabUrlOnly,
    orgNameOnly,
    websiteUrlOnly,
    limit,
    maxApply,
    slug,
    reviewedProfileAreaOnly,
    sharedPersonId,
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

  const usesNonPiLane = officialLabUrlOnly || profileLabUrlOnly || orgNameOnly || websiteUrlOnly;
  const officialLabUrlRows: OfficialLabUrlDedupeRow[] = officialLabUrlOnly
    ? await loadOfficialLabUrlCandidateRows(limit)
    : [];
  const profileLabUrlRows: OfficialLabUrlDedupeRow[] = profileLabUrlOnly
    ? await loadSpecificProfileLabUrlCandidateRows(limit)
    : [];
  const orgNameRows: OrgNameDedupeEntity[] = orgNameOnly
    ? await loadOrgNameCandidateRows(limit)
    : [];
  const websiteUrlRows: WebsiteUrlDedupeRow[] = websiteUrlOnly
    ? await loadWebsiteUrlCandidateRows(limit)
    : [];
  const piRows: ResearchEntityPiDedupeRow[] = usesNonPiLane
    ? []
    : sharedPersonId
      ? await loadSamePiCandidateRows(limit, { includeRetiredMembers: true })
      : await loadCandidateRows(limit, {
          includeNameOnly: !deleteDuplicates,
          includeRetiredPiLinks: deleteDuplicates,
        });
  const rows = officialLabUrlOnly
    ? officialLabUrlRows
    : profileLabUrlOnly
      ? profileLabUrlRows
      : orgNameOnly
        ? orgNameRows
        : websiteUrlOnly
          ? websiteUrlRows
          : piRows;
  const sameNameDifferentPersonQuarantine: SameNameDifferentPersonQuarantine[] = sharedPersonId
    ? buildSameNameDifferentPersonQuarantine(piRows)
    : [];
  const multiPersonEntityQuarantine: MultiPersonEntityQuarantine[] = sharedPersonId
    ? buildMultiPersonEntityQuarantine(piRows)
    : [];
  const allPlan = dedupePlannedGroups(
    officialLabUrlOnly
      ? buildOfficialLabUrlResearchEntityDedupePlan(officialLabUrlRows)
      : profileLabUrlOnly
        ? buildSpecificProfileLabUrlResearchEntityDedupePlan(profileLabUrlRows)
        : orgNameOnly
          ? buildOrgNameResearchEntityDedupePlan(orgNameRows)
          : websiteUrlOnly
            ? buildWebsiteUrlResearchEntityDedupePlan(websiteUrlRows)
            : sharedPersonId
              ? buildSharedPersonIdResearchEntityDedupePlan(piRows)
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
      ? selectResearchEntityPiDedupePlansForAcceptedMergeApply(
          candidatePlan,
          reviewDecisionValidation,
        )
      : candidatePlan;
  const duplicateCurrentMembers =
    acceptedDecisions ||
    orgNameOnly ||
    websiteUrlOnly ||
    profileLabUrlOnly ||
    !shouldRetireDuplicateCurrentMembersForDedupeRun({ fundingOnly })
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
          neverDemote: profileLabUrlOnly,
        }),
      )
    : [];
  const retiredDuplicateCurrentMembers = apply
    ? await retireDuplicateCurrentMembers(duplicateCurrentMembers)
    : [];

  // Anti-stale safety net: merging duplicates and retiring members changes the
  // canonical survivor's lead/evidence, which would otherwise leave a stale
  // student-visibility tier and stale member names in the search index until the
  // next full gate run. Recompute the tier and force a canonical Meili re-sync for
  // the affected canonical entities immediately so reads never serve a stale tier
  // or stale member/lead names after a dedupe.
  let visibilityRecomputed = 0;
  let canonicalEntitiesResynced = 0;
  if (apply) {
    const canonicalIds = Array.from(
      new Set(
        applied
          .map((result: any) => result?.canonicalEntityId)
          .filter((id: unknown): id is string => typeof id === 'string' && id.length > 0),
      ),
    );
    const repair = await recomputeVisibilityAndResyncCanonicals(canonicalIds);
    visibilityRecomputed = repair.visibilityRecomputed;
    canonicalEntitiesResynced = repair.canonicalEntitiesResynced;
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
    profileLabUrlOnly,
    orgNameOnly,
    websiteUrlOnly,
    sharedPersonId,
    candidateGroups: rows.length,
    filteredBySlug: slug || null,
    reviewedProfileAreaOnly,
    maxApply,
    reviewCandidateGroups: candidatePlan.length,
    plannedGroups: plan.length,
    plannedDuplicateEntities,
    duplicateCurrentMemberGroups: duplicateCurrentMembers.length,
    plannedDuplicateCurrentMembers,
    sameNameDifferentPersonQuarantine,
    quarantinedSameNameGroups: sameNameDifferentPersonQuarantine.length,
    multiPersonEntityQuarantine,
    quarantinedMultiPersonEntities: multiPersonEntityQuarantine.length,
    reviewBreakdown: buildResearchEntityPiDedupeReviewBreakdown(plan),
    plan: fullPlan ? plan : plan.slice(0, 25),
    currentMemberPlan: duplicateCurrentMembers.slice(0, 25),
    ...(reviewDecisionValidation ? { reviewDecisionValidation } : {}),
    applied,
    retiredDuplicateCurrentMembers,
    visibilityRecomputed,
    canonicalEntitiesResynced,
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

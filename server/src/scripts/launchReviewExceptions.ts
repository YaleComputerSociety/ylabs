import dotenv from 'dotenv';
import fs from 'fs';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeConnections } from '../db/connections';
import { publicStudentVisibilityTiers } from '../models/studentVisibility';
import type { StudentVisibilityGateCollection, StudentVisibilityGatePlan } from '../services/studentVisibilityGateService';
import { planStudentVisibilityGate } from '../services/studentVisibilityGateService';
import { classifyVisibilityRepairStage } from '../services/visibilityRepairQueueService';
import { assertScriptApplyAllowed } from './scriptWriteGuards';

dotenv.config();

export const LAUNCH_REVIEW_EXCEPTION_DECISION_VALUES = [
  'keep_capped_formalization_only',
  'keep_capped_application_source_only',
  'promote_entry_route',
  'suppress_not_undergrad',
  'defer_review',
] as const;

type LaunchReviewExceptionDecisionValue =
  (typeof LAUNCH_REVIEW_EXCEPTION_DECISION_VALUES)[number];

export interface LaunchReviewExceptionCliOptions {
  collection: StudentVisibilityGateCollection;
  limit?: number;
  output?: string;
  decisionTemplateOutput?: string;
  acceptedDecisions?: string;
  allowEmptyDecisions?: boolean;
}

export interface LaunchReviewExceptionCandidateInput {
  collection: StudentVisibilityGatePlan['collection'];
  recordId: string;
  label: string;
  currentTier?: string;
  computedTier: string;
  targetTier: string;
  reasons: string[];
  programKind?: string;
  entryMode?: string;
  requiresMentorBeforeApply?: boolean;
  mentorMatching?: boolean;
  sourceUrl?: string;
  applicationLink?: string;
  bestNextStep?: string;
  studentFacingCategory?: string;
  undergraduateOnly?: boolean;
}

export interface LaunchReviewExceptionPlan extends LaunchReviewExceptionCandidateInput {
  planId: string;
  requiredReviewerDecision: string;
  acceptedDecisionValues: readonly LaunchReviewExceptionDecisionValue[];
  applyBlocked: true;
  applyBlockedReason: string;
}

export interface LaunchReviewExceptionDecision {
  planId?: unknown;
  decision?: unknown;
  reviewedBy?: unknown;
  reviewNote?: unknown;
  promotionEvidenceUrl?: unknown;
}

export interface LaunchReviewExceptionDecisionValidation {
  artifactPath: string;
  applyBlocked: true;
  applyBlockedReason: string;
  totalDecisions: number;
  validDecisionCount: number;
  invalidDecisionCount: number;
  unmatchedPlanDecisionCount: number;
  duplicatePlanDecisionCount: number;
  unreviewedPlanCount: number;
  decisions: Array<{
    planId: string;
    decision: string;
    valid: boolean;
    errors: string[];
  }>;
}

const __filename = fileURLToPath(import.meta.url);
const APPLY_BLOCKED_REASON =
  'Launch review-exception decisions are validation-only; no apply path is available from this command.';
const REQUIRED_REVIEWER_DECISION =
  'Confirm whether official source evidence proves a real entry route or only formalization/funding.';
const PUBLIC_TIERS = new Set<string>(publicStudentVisibilityTiers);
const textValue = (value: unknown): string => typeof value === 'string' ? value.trim() : '';

function isStudentReadyLaunchViolation(plan: StudentVisibilityGatePlan): boolean {
  const launchEligible = plan.tier === 'student_ready';
  const currentPublic = PUBLIC_TIERS.has(plan.currentTier || '');
  const publicVisibilityViolation = currentPublic && !launchEligible;
  const suppressedAndHidden = plan.tier === 'suppressed' && !publicVisibilityViolation;
  return (!launchEligible && !suppressedAndHidden) || publicVisibilityViolation;
}

function parsePositiveInteger(value: string, flag: string): number {
  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error(`${flag} must be a positive integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
}

export function parseLaunchReviewExceptionArgs(argv: string[]): LaunchReviewExceptionCliOptions {
  const options: LaunchReviewExceptionCliOptions = {
    collection: 'all',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (
      arg === '--collection=research' ||
      arg === '--collection=programs' ||
      arg === '--collection=all'
    ) {
      options.collection = arg.slice('--collection='.length) as StudentVisibilityGateCollection;
    } else if (arg.startsWith('--limit=')) {
      options.limit = parsePositiveInteger(arg.slice('--limit='.length), '--limit');
    } else if (arg === '--output') {
      options.output = parseRequiredPath(argv[index + 1], '--output');
      index += 1;
    } else if (arg.startsWith('--output=')) {
      options.output = parseRequiredPath(arg.slice('--output='.length), '--output');
    } else if (arg === '--decision-template-output') {
      options.decisionTemplateOutput = parseRequiredPath(
        argv[index + 1],
        '--decision-template-output',
      );
      index += 1;
    } else if (arg.startsWith('--decision-template-output=')) {
      options.decisionTemplateOutput = parseRequiredPath(
        arg.slice('--decision-template-output='.length),
        '--decision-template-output',
      );
    } else if (arg === '--accepted-decisions') {
      options.acceptedDecisions = parseRequiredPath(argv[index + 1], '--accepted-decisions');
      index += 1;
    } else if (arg.startsWith('--accepted-decisions=')) {
      options.acceptedDecisions = parseRequiredPath(
        arg.slice('--accepted-decisions='.length),
        '--accepted-decisions',
      );
    } else if (arg === '--allow-empty-decisions') {
      options.allowEmptyDecisions = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function parseRequiredPath(
  value: string | undefined,
  flag: '--output' | '--decision-template-output' | '--accepted-decisions',
): string {
  const pathValue = value?.trim();
  if (!pathValue || pathValue.startsWith('--')) {
    throw new Error(`${flag} requires a path`);
  }
  return pathValue;
}

export function buildLaunchReviewExceptionCandidates(
  plans: StudentVisibilityGatePlan[],
): LaunchReviewExceptionCandidateInput[] {
  return plans
    .filter(
      (plan) =>
        isStudentReadyLaunchViolation(plan) &&
        classifyVisibilityRepairStage(plan.reasons) === 'review_exception',
    )
    .map((plan) => ({
      collection: plan.collection,
      recordId: plan.recordId,
      label: plan.label,
      currentTier: plan.currentTier,
      computedTier: plan.computedTier,
      targetTier: plan.tier,
      reasons: [...plan.reasons],
    }));
}

export function buildLaunchReviewExceptionPlan(
  candidate: LaunchReviewExceptionCandidateInput,
): LaunchReviewExceptionPlan {
  return {
    ...candidate,
    planId: `launch-review-exception:${candidate.collection}:${candidate.recordId}`,
    requiredReviewerDecision: REQUIRED_REVIEWER_DECISION,
    acceptedDecisionValues: LAUNCH_REVIEW_EXCEPTION_DECISION_VALUES,
    applyBlocked: true,
    applyBlockedReason: APPLY_BLOCKED_REASON,
  };
}

export function buildLaunchReviewExceptionReview(
  candidates: LaunchReviewExceptionCandidateInput[],
  options: { limit?: number } = {},
) {
  const limit =
    Number.isFinite(options.limit) && Number(options.limit) > 0
      ? Math.floor(Number(options.limit))
      : candidates.length;
  const plans = candidates.slice(0, limit).map(buildLaunchReviewExceptionPlan);

  return {
    mode: 'dry-run' as const,
    applyBlocked: true as const,
    applyBlockedReason: APPLY_BLOCKED_REASON,
    reviewExceptionCount: candidates.length,
    planSummary: {
      plannedCount: plans.length,
      planLimit: limit,
      planTruncated: candidates.length > plans.length,
      acceptedDecisionValues: LAUNCH_REVIEW_EXCEPTION_DECISION_VALUES,
    },
    plans,
    nextAction:
      'Fill the review-exception decision template and validate accepted decisions before changing launch visibility for formalization-only or portal-only rows.',
  };
}

export function buildLaunchReviewExceptionDecisionTemplate(
  candidates: LaunchReviewExceptionCandidateInput[],
  options: { limit?: number } = {},
) {
  const review = buildLaunchReviewExceptionReview(candidates, options);
  return {
    decisions: review.plans.map((plan) => ({
      planId: plan.planId,
      collection: plan.collection,
      recordId: plan.recordId,
      label: plan.label,
      reasons: plan.reasons,
      programEvidence: {
        programKind: plan.programKind || '',
        entryMode: plan.entryMode || '',
        requiresMentorBeforeApply: plan.requiresMentorBeforeApply ?? '',
        mentorMatching: plan.mentorMatching ?? '',
        sourceUrl: plan.sourceUrl || '',
        applicationLink: plan.applicationLink || '',
        bestNextStep: plan.bestNextStep || '',
        studentFacingCategory: plan.studentFacingCategory || '',
        undergraduateOnly: plan.undergraduateOnly ?? '',
      },
      requiredReviewerDecision: plan.requiredReviewerDecision,
      acceptedDecisionValues: plan.acceptedDecisionValues,
      decision: '',
      promotionEvidenceUrl: '',
      reviewedBy: '',
      reviewNote: '',
    })),
  };
}

export function validateLaunchReviewExceptionDecisions(
  plans: LaunchReviewExceptionPlan[],
  decisions: LaunchReviewExceptionDecision[],
  artifactPath: string,
): LaunchReviewExceptionDecisionValidation {
  const planIds = new Set(plans.map((plan) => plan.planId));
  const acceptedValues = new Set<string>(LAUNCH_REVIEW_EXCEPTION_DECISION_VALUES);
  const seenPlanIds = new Set<string>();
  const validPlanIds = new Set<string>();
  let unmatchedPlanDecisionCount = 0;
  let duplicatePlanDecisionCount = 0;

  const validated = decisions.map((decision) => {
    const planId = typeof decision.planId === 'string' ? decision.planId : '';
    const decisionValue = typeof decision.decision === 'string' ? decision.decision : '';
    const reviewedBy = typeof decision.reviewedBy === 'string' ? decision.reviewedBy.trim() : '';
    const errors: string[] = [];

    if (!planId) errors.push('planId is required');
    if (planId && !planIds.has(planId)) {
      errors.push('planId does not match a current review-exception plan');
      unmatchedPlanDecisionCount += 1;
    }
    if (planId && seenPlanIds.has(planId)) {
      errors.push('duplicate decision for planId');
      duplicatePlanDecisionCount += 1;
    }
    if (!acceptedValues.has(decisionValue)) {
      errors.push('decision must be one of acceptedDecisionValues');
    }
    if (
      decisionValue === 'promote_entry_route' &&
      !textValue(decision.promotionEvidenceUrl)
    ) {
      errors.push('promotionEvidenceUrl is required for promote_entry_route decisions');
    }
    if (!reviewedBy) errors.push('reviewedBy is required');

    seenPlanIds.add(planId);
    if (errors.length === 0) validPlanIds.add(planId);
    return {
      planId,
      decision: decisionValue,
      valid: errors.length === 0,
      errors,
    };
  });

  return {
    artifactPath,
    applyBlocked: true,
    applyBlockedReason: APPLY_BLOCKED_REASON,
    totalDecisions: decisions.length,
    validDecisionCount: validated.filter((decision) => decision.valid).length,
    invalidDecisionCount: validated.filter((decision) => !decision.valid).length,
    unmatchedPlanDecisionCount,
    duplicatePlanDecisionCount,
    unreviewedPlanCount: plans.filter((plan) => !validPlanIds.has(plan.planId)).length,
    decisions: validated,
  };
}

export function readLaunchReviewExceptionDecisions(
  inputPath: string,
  options: { allowEmptyDecisions?: boolean } = {},
): LaunchReviewExceptionDecision[] {
  if (!fs.existsSync(inputPath)) {
    if (options.allowEmptyDecisions) return [];
    throw new Error(`Accepted decisions file not found: ${inputPath}`);
  }
  const parsed = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed?.decisions)) return parsed.decisions;
  throw new Error('Accepted decisions must be a JSON array or an object with a decisions array');
}

export function writeLaunchReviewExceptionOutput(value: unknown, output?: string): void {
  if (!output) return;
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(value, null, 2)}\n`);
}

export function buildLaunchReviewExceptionOutput(
  target: {
    environment: string;
    db: string;
    options?: LaunchReviewExceptionCliOptions;
  },
  report: Record<string, unknown>,
  now = new Date(),
) {
  return {
    generatedAt: now.toISOString(),
    environment: target.environment,
    db: target.db,
    ...(target.options ? { options: target.options } : {}),
    ...report,
  };
}

async function main() {
  const options = parseLaunchReviewExceptionArgs(process.argv.slice(2));
  const guard = assertScriptApplyAllowed({
    apply: false,
    scriptName: 'launchReviewExceptions',
    mongoUrl: process.env.MONGODBURL,
  });

  await initializeConnections();
  const gatePlans = await planStudentVisibilityGate({
    collection: options.collection,
    mode: 'dry-run',
  });
  const candidates = buildLaunchReviewExceptionCandidates(gatePlans);
  const review = buildLaunchReviewExceptionReview(candidates, options);

  if (options.decisionTemplateOutput) {
    writeLaunchReviewExceptionOutput(
      buildLaunchReviewExceptionDecisionTemplate(candidates, options),
      options.decisionTemplateOutput,
    );
  }

  const reviewDecisionValidation = options.acceptedDecisions
    ? validateLaunchReviewExceptionDecisions(
        review.plans,
        readLaunchReviewExceptionDecisions(options.acceptedDecisions, {
          allowEmptyDecisions: options.allowEmptyDecisions,
        }),
        options.acceptedDecisions,
      )
    : undefined;

  const output = buildLaunchReviewExceptionOutput(
    { environment: guard.environment, db: guard.dbLabel, options },
    {
      ...review,
      ...(options.decisionTemplateOutput
        ? { decisionTemplateOutput: options.decisionTemplateOutput }
        : {}),
      ...(reviewDecisionValidation ? { reviewDecisionValidation } : {}),
    },
  );

  writeLaunchReviewExceptionOutput(output, options.output);
  console.log(JSON.stringify(output, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main()
    .catch((error) => {
      console.error('Failed to run launch review-exception audit:', error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}

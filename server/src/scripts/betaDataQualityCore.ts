import fs from 'fs';
import path from 'path';
import { resolveSafeJsonReportOutputPath } from './scriptWriteGuards';

export type BetaDataQualitySeverity = 'ok' | 'warn' | 'error';
export type DataQualityWarningClassification =
  | 'must_fix_before_promotion'
  | 'accepted_release_warning'
  | 'post_promotion_backlog';

export interface BetaDataQualityOptions {
  strict: boolean;
  output?: string;
  days: number;
  liveLinks: boolean;
  linkSampleSize: number;
  includeSamples: boolean;
  progress: boolean;
}

export interface BetaDataQualityProgressEvent {
  phase: string;
  status: 'started' | 'finished';
  durationMs?: number;
}

export interface BetaDataQualityCheck {
  name: string;
  severity: Exclude<BetaDataQualitySeverity, 'ok'>;
  count: number;
  message: string;
  target: number | string;
  classification?: DataQualityWarningClassification;
  owner?: string;
  nextCommand?: string;
}

export interface BetaDataQualitySummary {
  status: BetaDataQualitySeverity;
  errorCount: number;
  warnCount: number;
  errors: BetaDataQualityCheck[];
  warnings: BetaDataQualityCheck[];
  promotionReady: boolean;
  promotionBlockerCount: number;
  promotionBlockers: BetaDataQualityCheck[];
  promotionBlockersByOwner: Array<{
    owner: string;
    count: number;
    blockerNames: string[];
  }>;
}

export interface BetaDataQualityScorecard {
  generatedAt: string;
  environment?: string;
  db?: string;
  mongoTarget: string;
  options?: BetaDataQualityOptions;
  diagnostics?: BetaDataQualityDiagnostics;
  summary: BetaDataQualitySummary;
  counts?: Record<string, number>;
  [key: string]: unknown;
}

export interface BetaDataQualityDiagnostics {
  totalMeasuredDurationMs: number;
  slowestPhase?: {
    name: string;
    durationMs: number;
  };
  phaseDurationsMs: Record<string, number>;
}

export interface ReferenceAuditInput {
  name: string;
  required: boolean;
  missingRequired: number;
  orphanedPresentRefs: number;
  samples?: ReferenceAuditSample[];
}

export interface ReferenceAuditItem extends ReferenceAuditInput {
  missingRequired: number;
  orphanedPresentRefs: number;
  failureCount: number;
  severity: BetaDataQualitySeverity;
}

export type ReferenceAuditFailureType = 'missing_required' | 'orphaned_present_ref';

export interface ReferenceAuditSample {
  collection: string;
  field: string;
  id: string;
  failureType: ReferenceAuditFailureType;
  value?: unknown;
}

export interface ReferenceIntegritySummary {
  items: ReferenceAuditItem[];
  missingRequiredTotal: number;
  orphanedPresentRefTotal: number;
  hardFailureTotal: number;
}

export interface BetaDataQualitySummaryInput {
  referenceHardFailures: number;
  invalidUrlCount: number;
  invalidEmailCount?: number;
  expiredOpenOpportunityCount: number;
  paperAuthorshipIntegrityFailures: number;
  sourceHealthErrors: number;
  sourceHealthWarnings: number;
  duplicateEntityClusterCount: number;
  researchEntityContentPageLeakCount?: number;
  missingShortDescriptionCount: number;
  weakShortDescriptionCount: number;
  suspiciousUserEmailCount: number;
  suspiciousUserEmailsProductionCopyExclusionComplete?: boolean;
  betaStudentAnalyticsEventCount?: number;
  retentionCandidateCount: number;
  liveLinkFailureCount?: number;
  coverageGaps: {
    withoutPathways: number;
    withoutAccessSignals: number;
    withoutContactRoutes: number;
  };
}

export interface LinkCandidateInput {
  value?: unknown;
  source: string;
}

export interface LiveLinkCandidate {
  url: string;
  sources: string[];
}

export interface ResearchEntityContentPageLeakInput {
  id?: string;
  name?: string;
  displayName?: string;
  slug?: string;
  kind?: string;
  entityType?: string;
  website?: string;
  websiteUrl?: string;
  sourceUrls?: string[];
}

export interface ResearchEntityContentPageLeakSample extends ResearchEntityContentPageLeakInput {
  id: string;
  name: string;
  reasons: string[];
}

export interface ResearchEntityContentPageLeakSummary {
  count: number;
  samples: ResearchEntityContentPageLeakSample[];
}

export type DuplicateEntityReviewCategory =
  | 'shared_website_merge_review'
  | 'cross_department_same_person_review'
  | 'same_label_disambiguation'
  | 'manual_review';

export interface DuplicateEntityReviewEntity {
  id: string;
  name: string;
  slug?: string;
  kind?: string;
  entityType?: string;
  departments?: string[];
  website?: string;
  websiteUrl?: string;
  sourceUrls?: string[];
}

export interface DuplicateEntityReviewCluster {
  normalizedName: string;
  count: number;
  entities: DuplicateEntityReviewEntity[];
}

export interface DuplicateEntityReviewSummary {
  totalClusters: number;
  byCategory: Array<{ category: DuplicateEntityReviewCategory; count: number }>;
}

export interface DuplicateEntityPlanReviewCommand {
  label: string;
  category?: DuplicateEntityReviewCategory;
  clusterCount: number;
  outputPath: string;
  command: string;
}

export interface DuplicateEntityPlanReviewSummary {
  applyBlocked: true;
  planLimit: number;
  totalClusters: number;
  categoryCounts: Array<{ category: DuplicateEntityReviewCategory; count: number }>;
  preflightGuidance: DuplicateEntityPlanPreflightGuidance;
  recommendedCommands: DuplicateEntityPlanReviewCommand[];
  nextAction: string;
}

export interface DuplicateEntityPlanReviewOptions {
  acceptedDecisionValidationInputPath?: string;
  acceptedDecisionValidationOutputPath?: string;
}

export interface SamePiDedupeReviewOptions {
  reviewArtifactPath?: string;
  acceptedDecisionInputPath?: string;
  decisionTemplateOutputPath?: string;
}

export interface SamePiDedupeReviewSummary {
  applyBlocked: boolean;
  applyBlockedReason?: string;
  applyStatus?: string;
  artifactAvailable: boolean;
  reviewArtifactPath: string;
  acceptedDecisionInputPath: string;
  decisionTemplateOutputPath: string;
  acceptedDecisionValidationOutputPath: string;
  command: string;
  plannedGroups?: number;
  plannedDuplicateEntities?: number;
  reviewBreakdown?: Record<string, unknown>;
  acceptedDecisionValidation: {
    artifactAvailable: boolean;
    totalDecisions?: number;
    validDecisionCount?: number;
    invalidDecisionCount?: number;
    unreviewedPlanCount?: number;
  };
  nextAction: string;
}

const SAME_PI_DEDUPE_APPLY_STATUS =
  'Accepted same-PI dedupe decisions can drive bounded apply mode; only valid merge_into_canonical decisions are applied.';
const BETA_ENV_PREFIX = 'SCRAPER_ENV=beta';

export interface DuplicateEntityPlanPreflightGuidance {
  applyBlocked: true;
  expectedArtifactFields: ['planSummary.preflightSummary', 'plans[].reviewPreflight'];
  sharedWebsiteReview?: {
    category: 'shared_website_merge_review';
    clusterCount: number;
    outputPath: string;
    expectedStatus: 'merge_preflight_ready_for_review';
    requiredReviewerDecisions: string[];
  };
  manualReviewCategories: Array<{
    category: Exclude<DuplicateEntityReviewCategory, 'shared_website_merge_review'>;
    clusterCount: number;
    expectedStatus: 'manual_disambiguation_required';
  }>;
  acceptedDecisionTemplate: {
    outputPath: string;
    expectedArtifactFields: [
      'decisions[].planId',
      'decisions[].entityIds',
      'decisions[].decision',
      'decisions[].canonicalEntityId',
    ];
    command: string;
  };
  acceptedDecisionValidation: {
    inputPath: string;
    outputPath: string;
    expectedArtifactField: 'reviewDecisionValidation';
    acceptedDecisionFields: ['planId', 'decision', 'canonicalEntityId', 'reviewedBy'];
    command: string;
    artifactAvailable?: boolean;
    totalDecisions?: number;
    validDecisionCount?: number;
    invalidDecisionCount?: number;
    unreviewedPlanCount?: number;
  };
}

export interface SuspiciousUserEmailScorecardSampleInput {
  id: string;
  netid?: string;
  name: string;
  email: string;
  reason: string;
  productionCopyExcludedByDefault: boolean;
}

export interface SuspiciousUserEmailScorecardSample
  extends SuspiciousUserEmailScorecardSampleInput {
  productionCopyDisposition:
    | 'excluded_from_lane_a_users_copy'
    | 'review_before_lane_a_copy';
}

export interface SuspiciousUserEmailScorecardSummary {
  count: number;
  productionCopyExclusion: {
    lane: 'Lane A accepted Beta copy';
    strategy: string;
    sampledExcludedByDefault: number;
    sampledNeedsReviewBeforeCopy: number;
    sampledCoverageComplete: boolean;
    nextAction: string;
  };
  samples?: SuspiciousUserEmailScorecardSample[];
}

const BETA_CHECK_OPERATOR_METADATA: Record<
  string,
  Pick<BetaDataQualityCheck, 'classification' | 'owner' | 'nextCommand'>
> = {
  referenceIntegrity: {
    owner: 'data-quality operator',
    nextCommand: betaCommand(
      'yarn --cwd server research-entity-members:audit-user-refs --limit=1000 --output /tmp/ylabs-member-user-ref-audit.json',
    ),
  },
  sourceHealthWarnings: {
    classification: 'must_fix_before_promotion',
    owner: 'scraper-source operator',
    nextCommand: betaCommand('yarn --cwd server source:health --output /tmp/ylabs-source-health.json'),
  },
  duplicateEntityNames: {
    classification: 'must_fix_before_promotion',
    owner: 'data-quality operator',
    nextCommand: betaCommand(
      'yarn --cwd server research-entity:duplicate-name-review --limit=10000 --output /tmp/ylabs-duplicate-entity-name-review.json',
    ),
  },
  researchEntityContentPageLeaks: {
    classification: 'must_fix_before_promotion',
    owner: 'data-quality operator',
    nextCommand: betaCommand(
      'yarn --cwd server beta:data-quality --include-samples --output /tmp/ylabs-beta-quality.json',
    ),
  },
  missingShortDescriptions: {
    classification: 'accepted_release_warning',
    owner: 'content-quality operator',
    nextCommand: betaCommand(
      'yarn --cwd server beta:data-quality --include-samples --output /tmp/ylabs-beta-quality.json',
    ),
  },
  weakShortDescriptions: {
    classification: 'post_promotion_backlog',
    owner: 'content-quality operator',
    nextCommand: betaCommand(
      'yarn --cwd server beta:data-quality --include-samples --output /tmp/ylabs-beta-quality.json',
    ),
  },
  coverageWithoutPathways: {
    classification: 'accepted_release_warning',
    owner: 'pathway coverage operator',
    nextCommand: betaCommand(
      'yarn --cwd server beta:data-quality --include-samples --output /tmp/ylabs-beta-quality.json',
    ),
  },
  coverageWithoutAccessSignals: {
    classification: 'accepted_release_warning',
    owner: 'pathway coverage operator',
    nextCommand: betaCommand(
      'yarn --cwd server beta:data-quality --include-samples --output /tmp/ylabs-beta-quality.json',
    ),
  },
  coverageWithoutContactRoutes: {
    classification: 'accepted_release_warning',
    owner: 'contact coverage operator',
    nextCommand: betaCommand(
      'yarn --cwd server beta:data-quality --include-samples --output /tmp/ylabs-beta-quality.json',
    ),
  },
  suspiciousUserEmails: {
    classification: 'must_fix_before_promotion',
    owner: 'identity/account operator',
    nextCommand: betaCommand(
      'yarn --cwd server users:email-hygiene --limit=1000 --output /tmp/ylabs-user-email-hygiene.json',
    ),
  },
  betaStudentAnalyticsEvents: {
    classification: 'must_fix_before_promotion',
    owner: 'identity/account operator',
    nextCommand: betaCommand(
      'yarn --cwd server beta:clear-student-analytics --output /tmp/ylabs-beta-student-analytics-cleanup.json',
    ),
  },
};

export function buildBetaDataQualityRecommendedCommands() {
  const retentionOptions = buildBetaDataQualityRetentionOptions();
  return {
    weeklyAudit: betaCommand(
      'yarn --cwd server beta:data-quality --include-samples --progress --output /tmp/ylabs-beta-quality.json',
    ),
    strictAudit: betaCommand(
      'yarn --cwd server beta:data-quality --strict --include-samples --progress',
    ),
    retentionDryRun:
      `SCRAPER_ENV=beta yarn --cwd server scrape prune-observations --source ${retentionOptions.sourceName} --older-than-days ${retentionOptions.olderThanDays} --keep-runs ${retentionOptions.keepRuns} --output /tmp/ylabs-openalex-prune-dry-run.json`,
  };
}

export function buildBetaDataQualityDiagnostics(
  phaseDurationsMs: Record<string, number>,
): BetaDataQualityDiagnostics {
  const normalizedDurations = Object.fromEntries(
    Object.entries(phaseDurationsMs).map(([name, duration]) => [
      name,
      Math.max(0, Math.round(Number(duration) || 0)),
    ]),
  );
  const phaseEntries = Object.entries(normalizedDurations);
  const slowestPhase = phaseEntries.reduce<
    BetaDataQualityDiagnostics['slowestPhase']
  >((slowest, [name, durationMs]) => {
    if (!slowest || durationMs > slowest.durationMs) return { name, durationMs };
    return slowest;
  }, undefined);

  return {
    totalMeasuredDurationMs: phaseEntries.reduce(
      (total, [, durationMs]) => total + durationMs,
      0,
    ),
    ...(slowestPhase ? { slowestPhase } : {}),
    phaseDurationsMs: normalizedDurations,
  };
}

export function buildBetaDataQualityRetentionOptions() {
  return {
    apply: false,
    olderThanDays: 30,
    keepRuns: 3,
    sourceName: 'openalex',
  };
}

export function parseBetaDataQualityArgs(argv: string[]): BetaDataQualityOptions {
  const options: BetaDataQualityOptions = {
    strict: false,
    days: 30,
    liveLinks: false,
    linkSampleSize: 50,
    includeSamples: false,
    progress: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--strict') {
      options.strict = true;
      continue;
    }
    if (arg === '--live-links') {
      options.liveLinks = true;
      continue;
    }
    if (arg === '--include-samples') {
      options.includeSamples = true;
      continue;
    }
    if (arg === '--progress') {
      options.progress = true;
      continue;
    }
    if (arg === '--output') {
      options.output = parseRequiredOutputPath(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith('--output=')) {
      options.output = parseRequiredOutputPath(arg.slice('--output='.length));
      continue;
    }
    if (arg.startsWith('--days=')) {
      options.days = parsePositiveIntegerFlag(arg, '--days=');
      continue;
    }
    if (arg === '--days') {
      const next = argv[index + 1];
      if (!next) {
        throw new Error('--days requires a number');
      }
      options.days = parsePositiveIntegerValue(next, '--days');
      index += 1;
      continue;
    }
    if (arg.startsWith('--link-sample-size=')) {
      options.linkSampleSize = parsePositiveIntegerFlag(arg, '--link-sample-size=');
      continue;
    }
    if (arg === '--link-sample-size') {
      const next = argv[index + 1];
      if (!next) {
        throw new Error('--link-sample-size requires a number');
      }
      options.linkSampleSize = parsePositiveIntegerValue(next, '--link-sample-size');
      index += 1;
      continue;
    }
    throw new Error(`Unknown beta:data-quality option: ${arg}`);
  }

  return options;
}

export function formatBetaDataQualityProgressEvent(
  event: BetaDataQualityProgressEvent,
): string {
  if (event.status === 'started') {
    return `[beta:data-quality] ${event.phase} started`;
  }
  const durationMs = Math.max(0, Math.round(Number(event.durationMs) || 0));
  return `[beta:data-quality] ${event.phase} finished in ${durationMs}ms`;
}

function parseRequiredOutputPath(value: string | undefined): string {
  return resolveSafeJsonReportOutputPath(value);
}

export function isInvalidOptionalUrl(value: unknown): boolean {
  if (value === undefined || value === null) {
    return false;
  }
  if (typeof value !== 'string') {
    return true;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol !== 'http:' && parsed.protocol !== 'https:';
  } catch {
    return true;
  }
}

export function isInvalidObservationSourceUrl(value: unknown): boolean {
  if (value === undefined || value === null) {
    return false;
  }
  if (typeof value !== 'string') {
    return true;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }
  try {
    const parsed = new URL(trimmed);
    return (
      parsed.protocol !== 'http:' && parsed.protocol !== 'https:' && parsed.protocol !== 'file:'
    );
  } catch {
    return true;
  }
}

export function isInvalidOptionalEmail(value: unknown): boolean {
  if (value === undefined || value === null) {
    return false;
  }
  if (typeof value !== 'string') {
    return true;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }
  return !/^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(trimmed);
}

export function buildReferenceIntegritySummary(
  inputs: ReferenceAuditInput[],
): ReferenceIntegritySummary {
  const items = inputs.map((input) => {
    const missingRequired = input.required ? Math.max(0, input.missingRequired) : 0;
    const orphanedPresentRefs = Math.max(0, input.orphanedPresentRefs);
    const failureCount = missingRequired + orphanedPresentRefs;
    return {
      ...input,
      missingRequired,
      orphanedPresentRefs,
      failureCount,
      severity: failureCount > 0 ? 'error' : 'ok',
    } satisfies ReferenceAuditItem;
  });

  const missingRequiredTotal = items.reduce((total, item) => total + item.missingRequired, 0);
  const orphanedPresentRefTotal = items.reduce(
    (total, item) => total + item.orphanedPresentRefs,
    0,
  );

  return {
    items,
    missingRequiredTotal,
    orphanedPresentRefTotal,
    hardFailureTotal: missingRequiredTotal + orphanedPresentRefTotal,
  };
}

export function buildMissingRequiredRefSamplePipeline(
  localField: string,
  sampleLimit: number,
  ownerFilter: Record<string, unknown> = {},
): Array<Record<string, unknown>> {
  return [
    {
      $match: {
        ...ownerFilter,
        $or: [{ [localField]: { $exists: false } }, { [localField]: null }],
      },
    },
    { $project: { id: { $toString: '$_id' }, value: `$${localField}` } },
    { $limit: sampleLimit },
  ];
}

export function buildScalarRefOrphanSamplePipeline(
  localField: string,
  targetCollectionName: string,
  sampleLimit: number,
  ownerFilter: Record<string, unknown> = {},
): Array<Record<string, unknown>> {
  return [
    { $match: { ...ownerFilter, [localField]: { $exists: true, $nin: [null, ''] } } },
    {
      $lookup: {
        from: targetCollectionName,
        localField,
        foreignField: '_id',
        as: '_refTarget',
      },
    },
    { $match: { _refTarget: { $size: 0 } } },
    { $project: { id: { $toString: '$_id' }, value: `$${localField}` } },
    { $limit: sampleLimit },
  ];
}

export function buildArrayRefOrphanSamplePipeline(
  localField: string,
  targetCollectionName: string,
  sampleLimit: number,
  ownerFilter: Record<string, unknown> = {},
): Array<Record<string, unknown>> {
  const pipeline: Array<Record<string, unknown>> = [
    { $project: { ref: { $ifNull: [`$${localField}`, []] } } },
    { $unwind: '$ref' },
    { $match: { ref: { $ne: null } } },
    {
      $lookup: {
        from: targetCollectionName,
        localField: 'ref',
        foreignField: '_id',
        as: '_refTarget',
      },
    },
    { $match: { _refTarget: { $size: 0 } } },
    { $project: { id: { $toString: '$_id' }, value: '$ref' } },
    { $limit: sampleLimit },
  ];
  return Object.keys(ownerFilter).length > 0 ? [{ $match: ownerFilter }, ...pipeline] : pipeline;
}

export function buildBetaDataQualitySummary(
  input: BetaDataQualitySummaryInput,
): BetaDataQualitySummary {
  const errors = compactChecks([
    buildCheck(
      'referenceIntegrity',
      'error',
      input.referenceHardFailures,
      'Broken required references or orphaned present references need repair.',
      0,
    ),
    buildCheck(
      'urlSyntax',
      'error',
      input.invalidUrlCount,
      'Invalid URL syntax found in optional URL fields.',
      0,
    ),
    buildCheck(
      'emailSyntax',
      'error',
      input.invalidEmailCount ?? 0,
      'Invalid email syntax found in email fields.',
      0,
    ),
    buildCheck(
      'expiredOpenOpportunities',
      'error',
      input.expiredOpenOpportunityCount,
      'Open posted opportunities have deadlines in the past.',
      0,
    ),
    buildCheck(
      'paperAuthorship',
      'error',
      input.paperAuthorshipIntegrityFailures,
      'Paper-authorship integrity audit found hard failures.',
      0,
    ),
    buildCheck(
      'sourceHealthErrors',
      'error',
      input.sourceHealthErrors,
      'Source health has error-risk sources.',
      0,
    ),
  ]);

  const warnings = compactChecks([
    buildCheck(
      'sourceHealthWarnings',
      'warn',
      input.sourceHealthWarnings,
      'Source health has warning-risk sources.',
      0,
    ),
    buildCheck(
      'duplicateEntityNames',
      'warn',
      input.duplicateEntityClusterCount,
      'Research entities share normalized names and need review before merging.',
      0,
    ),
    buildCheck(
      'researchEntityContentPageLeaks',
      'warn',
      input.researchEntityContentPageLeakCount ?? 0,
      'Active research entities look like blogs, news, events, or other content pages rather than research homes.',
      0,
    ),
    buildCheck(
      'missingShortDescriptions',
      'warn',
      input.missingShortDescriptionCount,
      'Research entities are missing student-facing short descriptions.',
      0,
    ),
    buildCheck(
      'weakShortDescriptions',
      'warn',
      input.weakShortDescriptionCount,
      'Research entities have very short descriptions that may be weak.',
      0,
    ),
    buildCheck(
      'coverageWithoutPathways',
      'warn',
      input.coverageGaps.withoutPathways,
      'Active research entities do not yet have entry pathways.',
      0,
    ),
    buildCheck(
      'coverageWithoutAccessSignals',
      'warn',
      input.coverageGaps.withoutAccessSignals,
      'Active research entities do not yet have access signals.',
      0,
    ),
    buildCheck(
      'coverageWithoutContactRoutes',
      'warn',
      input.coverageGaps.withoutContactRoutes,
      'Active research entities do not yet have contact routes.',
      0,
    ),
    buildCheck(
      'suspiciousUserEmails',
      'warn',
      input.suspiciousUserEmailCount,
      'User emails look synthetic, placeholder, or otherwise suspicious.',
      0,
      input.suspiciousUserEmailsProductionCopyExclusionComplete
        ? { classification: 'accepted_release_warning' }
        : undefined,
    ),
    buildCheck(
      'betaStudentAnalyticsEvents',
      'warn',
      input.betaStudentAnalyticsEventCount ?? 0,
      'Beta analytics contains real student telemetry and must be cleared before production-copy review.',
      0,
    ),
    buildCheck(
      'retentionCandidates',
      'warn',
      input.retentionCandidateCount,
      'Superseded scraper observations are eligible for compact retention pruning.',
      0,
    ),
    buildCheck(
      'liveLinkFailures',
      'warn',
      input.liveLinkFailureCount ?? 0,
      'Sampled live links did not return a successful response.',
      0,
    ),
  ]);

  const promotionBlockers = warnings.filter(
    (warning) => warning.classification === 'must_fix_before_promotion',
  );
  const promotionBlockersByOwner = Array.from(
    promotionBlockers.reduce<Map<string, string[]>>((groups, blocker) => {
      const owner = blocker.owner || 'unassigned operator';
      groups.set(owner, [...(groups.get(owner) || []), blocker.name]);
      return groups;
    }, new Map()),
  )
    .map(([owner, blockerNames]) => ({
      owner,
      count: blockerNames.length,
      blockerNames: [...blockerNames].sort(),
    }))
    .sort((left, right) => left.owner.localeCompare(right.owner));

  return {
    status: errors.length > 0 ? 'error' : warnings.length > 0 ? 'warn' : 'ok',
    errorCount: errors.length,
    warnCount: warnings.length,
    errors,
    warnings,
    promotionReady: errors.length === 0 && promotionBlockers.length === 0,
    promotionBlockerCount: promotionBlockers.length,
    promotionBlockers,
    promotionBlockersByOwner,
  };
}

export function buildSuspiciousUserEmailScorecardSummary(input: {
  count: number;
  includeSamples: boolean;
  samples: SuspiciousUserEmailScorecardSampleInput[];
}): SuspiciousUserEmailScorecardSummary {
  const count = Math.max(0, input.count);
  const samples = input.samples.map((sample) => ({
    ...sample,
    productionCopyDisposition: sample.productionCopyExcludedByDefault
      ? 'excluded_from_lane_a_users_copy'
      : 'review_before_lane_a_copy',
  })) satisfies SuspiciousUserEmailScorecardSample[];
  const sampledExcludedByDefault = samples.filter(
    (sample) => sample.productionCopyExcludedByDefault,
  ).length;
  const sampledNeedsReviewBeforeCopy = samples.length - sampledExcludedByDefault;

  return {
    count,
    productionCopyExclusion: {
      lane: 'Lane A accepted Beta copy',
      strategy:
        "The guarded Lane A copy excludes known dev/test users from the users collection and separately blocks copied records that still reference excluded users.",
      sampledExcludedByDefault,
      sampledNeedsReviewBeforeCopy,
      sampledCoverageComplete:
        count === 0 || (samples.length === count && sampledNeedsReviewBeforeCopy === 0),
      nextAction:
        'Review any sampled users not covered by the Lane A copy filter before production copy; do not delete users as part of this data-quality audit.',
    },
    ...(input.includeSamples ? { samples } : {}),
  };
}

export function shouldStrictModeFail(summary: BetaDataQualitySummary): boolean {
  return summary.errorCount > 0;
}

const CONTENT_PAGE_TITLE_RE =
  /\b(blog|news|event|events|calendar|newsletter|article|story|press release|podcast|video|webinar)\b/i;
const CONTENT_PAGE_PATH_RE =
  /(^|[-/])(blog|blogs|news|events|calendar|newsletter|article|stories|press|podcast|video|webinar)([-/]|$)/i;

function normalizedContentPageTitleText(entity: ResearchEntityContentPageLeakInput): string {
  return [entity.displayName, entity.name, entity.slug]
    .map((value) => String(value || ''))
    .join(' ')
    .replace(/[^a-z0-9]+/gi, ' ')
    .trim();
}

function contentPageUrlPathText(values: Array<string | undefined>): string {
  return values
    .flatMap((value) => {
      if (!value) return [];
      try {
        return [new URL(value).pathname];
      } catch {
        return [value];
      }
    })
    .join(' ');
}

export function isLikelyResearchEntityContentPageLeak(
  entity: ResearchEntityContentPageLeakInput,
): string[] {
  const reasons: string[] = [];
  const titleText = normalizedContentPageTitleText(entity);
  const pathText = contentPageUrlPathText([
    entity.websiteUrl,
    entity.website,
    ...(entity.sourceUrls || []),
  ]);

  if (CONTENT_PAGE_TITLE_RE.test(titleText)) {
    reasons.push('content-page-title');
  }
  if (CONTENT_PAGE_PATH_RE.test(pathText)) {
    reasons.push('content-page-url');
  }
  if (
    reasons.length > 0 &&
    (String(entity.kind || '').toLowerCase() === 'lab' || entity.entityType === 'LAB')
  ) {
    reasons.push('content-page-classified-as-lab');
  }

  return reasons;
}

export function buildResearchEntityContentPageLeakSummary(
  entities: ResearchEntityContentPageLeakInput[],
  sampleLimit = 25,
): ResearchEntityContentPageLeakSummary {
  const samples: ResearchEntityContentPageLeakSample[] = [];
  let count = 0;

  for (const entity of entities) {
    const reasons = isLikelyResearchEntityContentPageLeak(entity);
    if (reasons.length === 0) continue;
    count += 1;
    if (samples.length < sampleLimit) {
      samples.push({
        ...entity,
        id: String(entity.id || ''),
        name: String(entity.displayName || entity.name || ''),
        reasons,
      });
    }
  }

  return { count, samples };
}

function normalizedWebsiteKey(value: string | undefined): string {
  if (!value?.trim()) return '';
  try {
    const parsed = new URL(value.trim());
    const host = parsed.hostname.replace(/^www\./i, '').toLowerCase();
    const urlPath = parsed.pathname.replace(/\/+$/, '').toLowerCase();
    return `${host}${urlPath}`;
  } catch {
    return value.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '').toLowerCase();
  }
}

function normalizedNameTokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function hasSingleSharedWebsite(cluster: DuplicateEntityReviewCluster): boolean {
  const websiteKeys = cluster.entities
    .map((entity) => normalizedWebsiteKey(entity.websiteUrl) || normalizedWebsiteKey(entity.website))
    .filter(Boolean);
  return websiteKeys.length >= 2 && new Set(websiteKeys).size === 1;
}

function distinctDepartmentCount(cluster: DuplicateEntityReviewCluster): number {
  return new Set(cluster.entities.flatMap((entity) => entity.departments || []).filter(Boolean))
    .size;
}

function isSingleSurnameLabName(normalizedName: string): boolean {
  const tokens = normalizedNameTokens(normalizedName);
  return tokens.length === 2 && tokens[1] === 'lab';
}

function isFullPersonResearchName(normalizedName: string): boolean {
  const tokens = normalizedNameTokens(normalizedName);
  if (tokens.length < 3) return false;
  const suffix = tokens.slice(-2).join(' ');
  return suffix === 'faculty research' || tokens.at(-1) === 'lab' || tokens.at(-1) === 'laboratory';
}

export function classifyDuplicateEntityCluster(
  cluster: DuplicateEntityReviewCluster,
): DuplicateEntityReviewCategory {
  if (hasSingleSharedWebsite(cluster)) return 'shared_website_merge_review';
  if (isSingleSurnameLabName(cluster.normalizedName)) return 'same_label_disambiguation';
  if (isFullPersonResearchName(cluster.normalizedName) && distinctDepartmentCount(cluster) > 1) {
    return 'cross_department_same_person_review';
  }
  return 'manual_review';
}

export function buildDuplicateEntityReviewSummary(
  clusters: DuplicateEntityReviewCluster[],
): DuplicateEntityReviewSummary {
  const counts = clusters.reduce<Map<DuplicateEntityReviewCategory, number>>((map, cluster) => {
    const category = classifyDuplicateEntityCluster(cluster);
    map.set(category, (map.get(category) || 0) + 1);
    return map;
  }, new Map());

  return {
    totalClusters: clusters.length,
    byCategory: Array.from(counts.entries())
      .map(([category, count]) => ({ category, count }))
      .sort((left, right) => right.count - left.count || left.category.localeCompare(right.category)),
  };
}

export function buildDuplicateEntityPlanReviewSummary(
  reviewSummary: DuplicateEntityReviewSummary,
  planLimit?: number,
  options: DuplicateEntityPlanReviewOptions = {},
): DuplicateEntityPlanReviewSummary {
  const effectivePlanLimit = planLimit ?? Math.max(reviewSummary.totalClusters, 1);
  const categoryCounts = reviewSummary.byCategory.filter((item) => item.count > 0);
  const recommendedCommands: DuplicateEntityPlanReviewCommand[] =
    reviewSummary.totalClusters > 0
      ? [
          duplicateEntityPlanReviewCommand({
            label: 'all_duplicate_name_plans',
            clusterCount: reviewSummary.totalClusters,
            outputPath: '/tmp/ylabs-duplicate-entity-name-review.json',
            planLimit: effectivePlanLimit,
          }),
          ...categoryCounts.map((item) =>
            duplicateEntityPlanReviewCommand({
              label: item.category,
              category: item.category,
              clusterCount: item.count,
              outputPath: duplicateEntityCategoryPlanOutputPath(item.category),
              planLimit: effectivePlanLimit,
            }),
          ),
        ]
      : [];

  return {
    applyBlocked: true,
    planLimit: effectivePlanLimit,
    totalClusters: reviewSummary.totalClusters,
    categoryCounts,
    preflightGuidance: buildDuplicateEntityPlanPreflightGuidance(
      categoryCounts,
      effectivePlanLimit,
      options,
    ),
    recommendedCommands,
    nextAction:
      reviewSummary.totalClusters > 0
        ? 'Run the category-specific dry-run review commands and inspect the saved artifacts before designing any guarded merge/archive apply path.'
        : 'No duplicate-name plan review is needed unless duplicate normalized-name clusters reappear.',
  };
}

function buildDuplicateEntityPlanPreflightGuidance(
  categoryCounts: Array<{ category: DuplicateEntityReviewCategory; count: number }>,
  planLimit: number,
  options: DuplicateEntityPlanReviewOptions = {},
): DuplicateEntityPlanPreflightGuidance {
  const sharedWebsite = categoryCounts.find(
    (item) => item.category === 'shared_website_merge_review',
  );
  const manualReviewCategories = categoryCounts
    .filter(
      (
        item,
      ): item is {
        category: Exclude<DuplicateEntityReviewCategory, 'shared_website_merge_review'>;
        count: number;
      } => item.category !== 'shared_website_merge_review',
    )
    .map((item) => ({
      category: item.category,
      clusterCount: item.count,
      expectedStatus: 'manual_disambiguation_required' as const,
    }));

  return {
    applyBlocked: true,
    expectedArtifactFields: ['planSummary.preflightSummary', 'plans[].reviewPreflight'],
    ...(sharedWebsite
      ? {
          sharedWebsiteReview: {
            category: 'shared_website_merge_review' as const,
            clusterCount: sharedWebsite.count,
            outputPath: duplicateEntityCategoryPlanOutputPath('shared_website_merge_review'),
            expectedStatus: 'merge_preflight_ready_for_review' as const,
            requiredReviewerDecisions: [
              'Confirm the shared website represents one research home.',
              'Select the canonical ResearchEntity before any apply path.',
              'Confirm guarded reference rewrite and archive behavior for active references.',
            ],
          },
        }
      : {}),
    manualReviewCategories,
    acceptedDecisionTemplate: duplicateEntityAcceptedDecisionTemplateCommand(planLimit),
    acceptedDecisionValidation: duplicateEntityAcceptedDecisionValidationCommand(
      planLimit,
      options,
    ),
  };
}

function duplicateEntityAcceptedDecisionTemplateCommand(planLimit: number) {
  const outputPath = '/tmp/ylabs-duplicate-entity-name-review-accepted-decisions-template.json';
  return {
    outputPath,
    expectedArtifactFields: [
      'decisions[].planId',
      'decisions[].entityIds',
      'decisions[].decision',
      'decisions[].canonicalEntityId',
    ] as [
      'decisions[].planId',
      'decisions[].entityIds',
      'decisions[].decision',
      'decisions[].canonicalEntityId',
    ],
    command: betaCommand(
      `yarn --cwd server research-entity:duplicate-name-review --limit=10000` +
        ` --plan-limit=${planLimit} --decision-template-output ${outputPath}` +
        ' --output /tmp/ylabs-duplicate-entity-name-review.json',
    ),
  };
}

function duplicateEntityAcceptedDecisionValidationCommand(
  planLimit: number,
  options: DuplicateEntityPlanReviewOptions = {},
) {
  const inputPath =
    options.acceptedDecisionValidationInputPath ||
    '/tmp/ylabs-duplicate-entity-name-review-accepted-decisions.json';
  const outputPath =
    options.acceptedDecisionValidationOutputPath ||
    '/tmp/ylabs-duplicate-entity-name-review-decision-validation.json';
  return {
    inputPath,
    outputPath,
    expectedArtifactField: 'reviewDecisionValidation' as const,
    acceptedDecisionFields: [
      'planId',
      'decision',
      'canonicalEntityId',
      'reviewedBy',
    ] as ['planId', 'decision', 'canonicalEntityId', 'reviewedBy'],
    command: betaCommand(
      `yarn --cwd server research-entity:duplicate-name-review --limit=10000` +
        ` --plan-limit=${planLimit} --accepted-decisions=${inputPath}` +
        ` --allow-empty-decisions --output ${outputPath}`,
    ),
    ...readDuplicateEntityDecisionValidationStatus(outputPath),
  };
}

function duplicateEntityPlanReviewCommand(input: {
  label: string;
  category?: DuplicateEntityReviewCategory;
  clusterCount: number;
  outputPath: string;
  planLimit: number;
}): DuplicateEntityPlanReviewCommand {
  const categoryFlag = input.category ? ` --category=${input.category}` : '';
  return {
    label: input.label,
    ...(input.category ? { category: input.category } : {}),
    clusterCount: input.clusterCount,
    outputPath: input.outputPath,
    command: betaCommand(
      `yarn --cwd server research-entity:duplicate-name-review --limit=10000${categoryFlag}` +
        ` --plan-limit=${input.planLimit} --output ${input.outputPath}`,
    ),
  };
}

function readDuplicateEntityDecisionValidationStatus(
  outputPath: string,
): {
  artifactAvailable: boolean;
  totalDecisions?: number;
  validDecisionCount?: number;
  invalidDecisionCount?: number;
  unreviewedPlanCount?: number;
} {
  const safeOutputPath = resolveSafeJsonReportOutputPath(
    outputPath,
    '--accepted-decision-validation-output',
  );
  if (!fs.existsSync(safeOutputPath)) {
    return { artifactAvailable: false };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(safeOutputPath, 'utf8')) as unknown;
    const validation =
      parsed &&
      typeof parsed === 'object' &&
      'reviewDecisionValidation' in parsed &&
      (parsed as { reviewDecisionValidation?: unknown }).reviewDecisionValidation &&
      typeof (parsed as { reviewDecisionValidation?: unknown }).reviewDecisionValidation ===
        'object'
        ? ((parsed as { reviewDecisionValidation: Record<string, unknown> })
            .reviewDecisionValidation)
        : undefined;
    if (!validation) {
      return { artifactAvailable: false };
    }
    return {
      artifactAvailable: true,
      ...copyFiniteNumericField(validation, 'totalDecisions'),
      ...copyFiniteNumericField(validation, 'validDecisionCount'),
      ...copyFiniteNumericField(validation, 'invalidDecisionCount'),
      ...copyFiniteNumericField(validation, 'unreviewedPlanCount'),
    };
  } catch {
    return { artifactAvailable: false };
  }
}

export function buildSamePiDedupeReviewSummary(
  options: SamePiDedupeReviewOptions = {},
): SamePiDedupeReviewSummary {
  const reviewArtifactPath =
    options.reviewArtifactPath || '/tmp/ylabs-research-entity-dedupe.json';
  const acceptedDecisionInputPath =
    options.acceptedDecisionInputPath ||
    '/tmp/ylabs-research-entity-pi-dedupe-accepted-decisions.json';
  const decisionTemplateOutputPath =
    options.decisionTemplateOutputPath ||
    '/tmp/ylabs-research-entity-pi-dedupe-accepted-decisions-template.json';
  const base = {
    applyBlocked: false,
    applyStatus: SAME_PI_DEDUPE_APPLY_STATUS,
    reviewArtifactPath,
    acceptedDecisionInputPath,
    decisionTemplateOutputPath,
    acceptedDecisionValidationOutputPath: reviewArtifactPath,
    command: betaCommand(
      `yarn --cwd server research-entity:dedupe-by-pi --limit=10000` +
        ` --accepted-decisions=${acceptedDecisionInputPath}` +
        ` --allow-empty-decisions --decision-template-output ${decisionTemplateOutputPath}` +
        ` --output ${reviewArtifactPath}`,
    ),
    nextAction:
      'Review the same-PI dedupe decision template and validate accepted decisions before considering a bounded guarded apply.',
  };
  const safeReviewArtifactPath = resolveSafeJsonReportOutputPath(
    reviewArtifactPath,
    '--review-artifact',
  );

  if (!fs.existsSync(safeReviewArtifactPath)) {
    return {
      ...base,
      artifactAvailable: false,
      acceptedDecisionValidation: { artifactAvailable: false },
    };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(safeReviewArtifactPath, 'utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('not an object');
    }
    const record = parsed as Record<string, unknown>;
    const validation = extractValidationCounts(record.reviewDecisionValidation);
    const applyBlockedReason =
      extractStringField(record.reviewDecisionValidation, 'applyBlockedReason');
    const applyStatus =
      extractStringField(record.reviewDecisionValidation, 'applyStatus') || base.applyStatus;
    return {
      ...base,
      artifactAvailable: true,
      ...(applyBlockedReason ? { applyBlockedReason } : {}),
      ...(applyStatus ? { applyStatus } : {}),
      ...copyFiniteNumericField(record, 'plannedGroups'),
      ...copyFiniteNumericField(record, 'plannedDuplicateEntities'),
      ...(record.reviewBreakdown && typeof record.reviewBreakdown === 'object'
        ? { reviewBreakdown: record.reviewBreakdown as Record<string, unknown> }
        : {}),
      acceptedDecisionValidation: validation
        ? { artifactAvailable: true, ...validation }
        : { artifactAvailable: false },
    };
  } catch {
    return {
      ...base,
      artifactAvailable: false,
      acceptedDecisionValidation: { artifactAvailable: false },
    };
  }
}

function extractValidationCounts(value: unknown):
  | {
      totalDecisions?: number;
      validDecisionCount?: number;
      invalidDecisionCount?: number;
      unreviewedPlanCount?: number;
    }
  | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  const counts = {
    ...copyFiniteNumericField(record, 'totalDecisions'),
    ...copyFiniteNumericField(record, 'validDecisionCount'),
    ...copyFiniteNumericField(record, 'invalidDecisionCount'),
    ...copyFiniteNumericField(record, 'unreviewedPlanCount'),
  };
  return Object.keys(counts).length > 0 ? counts : undefined;
}

function extractStringField(value: unknown, field: string): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = (value as Record<string, unknown>)[field];
  return typeof raw === 'string' && raw.trim() ? raw.trim() : undefined;
}

function copyFiniteNumericField(
  value: Record<string, unknown>,
  field: string,
): Record<string, number> {
  const raw = value[field];
  return typeof raw === 'number' && Number.isFinite(raw) ? { [field]: raw } : {};
}

function duplicateEntityCategoryPlanOutputPath(
  category: DuplicateEntityReviewCategory,
): string {
  const suffixByCategory: Record<DuplicateEntityReviewCategory, string> = {
    shared_website_merge_review: 'shared-website',
    cross_department_same_person_review: 'cross-department-same-person',
    same_label_disambiguation: 'same-label-disambiguation',
    manual_review: 'manual-review',
  };
  return `/tmp/ylabs-duplicate-entity-name-review-${suffixByCategory[category]}-plan.json`;
}

export function selectLiveLinkCandidates(
  inputs: LinkCandidateInput[],
  sampleSize: number,
): LiveLinkCandidate[] {
  const byUrl = new Map<string, LiveLinkCandidate>();

  for (const input of inputs) {
    if (isInvalidOptionalUrl(input.value) || typeof input.value !== 'string') {
      continue;
    }
    const url = input.value.trim();
    if (!url) {
      continue;
    }
    const existing = byUrl.get(url);
    if (existing) {
      if (!existing.sources.includes(input.source)) {
        existing.sources.push(input.source);
      }
      continue;
    }
    byUrl.set(url, { url, sources: [input.source] });
  }

  return [...byUrl.values()].slice(0, sampleSize);
}

export function writeScorecardOutput(
  scorecard: BetaDataQualityScorecard,
  outputPath?: string,
): void {
  if (!outputPath) {
    return;
  }
  const safeOutput = resolveSafeJsonReportOutputPath(outputPath);
  fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
  fs.writeFileSync(safeOutput, `${JSON.stringify(scorecard, null, 2)}\n`);
}

export function buildBetaDataQualityOutput<T extends object>(
  scorecard: T,
  metadata: {
    environment?: string;
    db?: string;
    options: BetaDataQualityOptions;
  },
): T & {
  environment?: string;
  db?: string;
  options: BetaDataQualityOptions;
} {
  return {
    ...scorecard,
    ...(metadata.environment ? { environment: metadata.environment } : {}),
    ...(metadata.db ? { db: metadata.db } : {}),
    options: metadata.options,
  };
}

function compactChecks(checks: Array<BetaDataQualityCheck | null>): BetaDataQualityCheck[] {
  return checks.filter((check): check is BetaDataQualityCheck => check !== null);
}

function buildCheck(
  name: string,
  severity: Exclude<BetaDataQualitySeverity, 'ok'>,
  count: number,
  message: string,
  target: number | string,
  metadataOverride?: Partial<Pick<BetaDataQualityCheck, 'classification' | 'owner' | 'nextCommand'>>,
): BetaDataQualityCheck | null {
  if (count <= 0) {
    return null;
  }
  return {
    name,
    severity,
    count,
    message,
    target,
    ...BETA_CHECK_OPERATOR_METADATA[name],
    ...metadataOverride,
  };
}

function betaCommand(command: string): string {
  return command.startsWith(`${BETA_ENV_PREFIX} `) ? command : `${BETA_ENV_PREFIX} ${command}`;
}

function parsePositiveIntegerFlag(arg: string, prefix: string): number {
  return parsePositiveIntegerValue(arg.slice(prefix.length), prefix.replace(/=$/, ''));
}

function parsePositiveIntegerValue(value: string, flagName: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed.toString() !== value) {
    throw new Error(`${flagName} must be a positive integer`);
  }
  return parsed;
}

import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ScrapeRun } from '../models/scrapeRun';
import { Source } from '../models/source';
import { buildSourceHealthRows, type SourceHealthRow } from '../services/sourceHealthService';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import { sanitizeLogValue } from '../utils/logSanitizer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export interface SourceHealthCliOptions {
  days: number;
  includeDisabled: boolean;
  strict: boolean;
  output?: string;
}

export interface SourceHealthReviewSummary {
  warningRows: number;
  materializationConflictRows: number;
  reportArtifacts: {
    available: number;
    missing: number;
    withConflictReview: number;
  };
  activeObservationConflictCount: number;
  actionableConflictCount: number;
  sameSourceConflictCount: number;
  crossSourceConflictCount: number;
  priorityReviewConflictCount: number;
  contextReviewConflictCount: number;
  metadataReviewConflictCount: number;
  categoryCounts: Array<{ category: string; count: number }>;
  reviewQueues: SourceHealthReviewQueueSummary[];
  reviewArtifactStatus: {
    staleObservationReview: SourceHealthReviewArtifactStatus;
    crossSourceObservationReview: SourceHealthReviewArtifactStatus;
  };
  reviewDecisionValidationStatus: {
    staleObservationReview: SourceHealthReviewDecisionValidationStatus;
    crossSourceObservationReview: SourceHealthReviewDecisionValidationStatus;
  };
  reviewArtifactRollups: {
    staleObservationReview: SourceHealthReviewArtifactRollup;
    crossSourceObservationReview: SourceHealthReviewArtifactRollup;
  };
  rows: Array<{
    sourceName: string;
    risk: SourceHealthRow['risk'];
    reviewReason?: string;
    nextCommand?: string;
    reportOutputPath?: string;
    reportAvailable: boolean;
    conflictReviewAvailable: boolean;
    materializationConflicts?: number;
    materializationErrors?: number;
    activeObservationConflictCount?: number;
    actionableConflictCount?: number;
    sameSourceConflictCount?: number;
    crossSourceConflictCount?: number;
    priorityReviewConflictCount?: number;
    contextReviewConflictCount?: number;
    metadataReviewConflictCount?: number;
    primaryReviewQueue?: SourceHealthReviewQueueName;
    staleObservationReview?: {
      command: string;
      outputPath: string;
      sameSourceConflictCount: number;
      reviewQueue?: SourceHealthReviewQueueName;
      artifactAvailable: boolean;
      acceptedDecisionTemplate?: SourceHealthAcceptedDecisionTemplateCommand;
      acceptedDecisionValidation?: SourceHealthAcceptedDecisionValidationCommand;
      candidateGroups?: number;
      plannedGroups?: number;
      planTruncated?: boolean;
      fieldCounts?: Array<{ field: string; count: number }>;
      categoryCounts?: Array<{ category: string; count: number }>;
      policyBucketCounts?: Array<{ policyBucket: string; count: number }>;
    };
    staleObservationReviews?: Array<{
      command: string;
      outputPath: string;
      sameSourceConflictCount: number;
      reviewQueue?: SourceHealthReviewQueueName;
      artifactAvailable: boolean;
      acceptedDecisionTemplate?: SourceHealthAcceptedDecisionTemplateCommand;
      acceptedDecisionValidation?: SourceHealthAcceptedDecisionValidationCommand;
      candidateGroups?: number;
      plannedGroups?: number;
      planTruncated?: boolean;
      fieldCounts?: Array<{ field: string; count: number }>;
      categoryCounts?: Array<{ category: string; count: number }>;
      policyBucketCounts?: Array<{ policyBucket: string; count: number }>;
    }>;
    crossSourceObservationReview?: {
      command: string;
      outputPath: string;
      crossSourceConflictCount: number;
      reviewQueue?: SourceHealthReviewQueueName;
      artifactAvailable: boolean;
      acceptedDecisionTemplate?: SourceHealthAcceptedDecisionTemplateCommand;
      acceptedDecisionValidation?: SourceHealthAcceptedDecisionValidationCommand;
      candidateGroups?: number;
      plannedGroups?: number;
      planTruncated?: boolean;
      fieldCounts?: Array<{ field: string; count: number }>;
      categoryCounts?: Array<{ category: string; count: number }>;
      policyBucketCounts?: Array<{ policyBucket: string; count: number }>;
    };
    crossSourceObservationReviews?: Array<{
      command: string;
      outputPath: string;
      crossSourceConflictCount: number;
      reviewQueue?: SourceHealthReviewQueueName;
      artifactAvailable: boolean;
      acceptedDecisionTemplate?: SourceHealthAcceptedDecisionTemplateCommand;
      acceptedDecisionValidation?: SourceHealthAcceptedDecisionValidationCommand;
      candidateGroups?: number;
      plannedGroups?: number;
      planTruncated?: boolean;
      fieldCounts?: Array<{ field: string; count: number }>;
      categoryCounts?: Array<{ category: string; count: number }>;
      policyBucketCounts?: Array<{ policyBucket: string; count: number }>;
    }>;
    reviewQueues?: SourceHealthReviewQueueSummary[];
    categoryCounts?: Array<{ category: string; count: number }>;
  }>;
}

export type SourceHealthReviewQueueName = 'priority_review' | 'context_review' | 'metadata_review';

export interface SourceHealthReviewQueueSummary {
  queue: SourceHealthReviewQueueName;
  label: string;
  count: number;
  categories: Array<{ category: string; count: number }>;
}

export interface SourceHealthAcceptedDecisionTemplateCommand {
  command: string;
  outputPath: string;
  expectedArtifactFields: string[];
}

export interface SourceHealthAcceptedDecisionValidationCommand {
  command: string;
  inputPath: string;
  outputPath: string;
  expectedArtifactField: string;
  acceptedDecisionFields: string[];
  artifactAvailable?: boolean;
  totalDecisions?: number;
  validDecisionCount?: number;
  invalidDecisionCount?: number;
  unreviewedPlanCount?: number;
}

export interface SourceHealthReviewArtifactFollowupCommand {
  sourceName: string;
  command: string;
  outputPath: string;
  reviewQueue?: SourceHealthReviewQueueName;
  sameSourceConflictCount?: number;
  crossSourceConflictCount?: number;
  acceptedDecisionTemplate?: SourceHealthAcceptedDecisionTemplateCommand;
  acceptedDecisionValidation?: SourceHealthAcceptedDecisionValidationCommand;
}

export interface SourceHealthReviewArtifactStatus {
  total: number;
  available: number;
  missing: number;
  missingCommands: SourceHealthReviewArtifactFollowupCommand[];
}

export interface SourceHealthReviewArtifactRollup {
  fieldCounts: Array<{ field: string; count: number }>;
  policyBucketCounts: Array<{ policyBucket: string; count: number }>;
}

export interface SourceHealthAcceptedDecisionValidationFollowupCommand {
  sourceName: string;
  command: string;
  inputPath: string;
  outputPath: string;
  reviewQueue?: SourceHealthReviewQueueName;
  sameSourceConflictCount?: number;
  crossSourceConflictCount?: number;
}

export interface SourceHealthReviewDecisionValidationStatus {
  total: number;
  available: number;
  missing: number;
  totalDecisions: number;
  validDecisionCount: number;
  invalidDecisionCount: number;
  unreviewedPlanCount: number;
  withInvalidDecisions: number;
  withUnreviewedPlans: number;
  missingCommands: SourceHealthAcceptedDecisionValidationFollowupCommand[];
}

const SOURCE_HEALTH_REVIEW_QUEUE_DEFINITIONS: Array<{
  queue: SourceHealthReviewQueueName;
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

const PRIORITY_REVIEW_CATEGORIES = new Set(['identity_or_routing', 'access_evidence', 'content']);
const METADATA_REVIEW_CATEGORIES = new Set(['additive_metadata']);
const SOURCE_HEALTH_REVIEW_LIMIT = 1000;
const SOURCE_HEALTH_REVIEW_SAMPLE_SIZE = 20;

export function parseSourceHealthArgs(argv: string[]): SourceHealthCliOptions {
  const options: SourceHealthCliOptions = {
    days: 30,
    includeDisabled: false,
    strict: false,
  };
  const parseRequiredOutputPath = (value: string | undefined): string =>
    resolveSafeJsonReportOutputPath(value);

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--include-disabled') {
      options.includeDisabled = true;
      continue;
    }
    if (arg === '--strict') {
      options.strict = true;
      continue;
    }
    if (arg.startsWith('--days=')) {
      options.days = parsePositiveInteger(arg.slice('--days='.length), '--days');
      continue;
    }
    if (arg === '--output') {
      options.output = parseRequiredOutputPath(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg.startsWith('--output=')) {
      options.output = parseRequiredOutputPath(arg.slice('--output='.length));
      continue;
    }

    throw new Error(`Unknown source health argument: ${arg}`);
  }

  return options;
}

function parsePositiveInteger(value: string, flag: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || String(parsed) !== value.trim()) {
    throw new Error(`${flag} requires a positive integer`);
  }
  return parsed;
}

export function writeSourceHealthOutput(report: Record<string, unknown>, output?: string): void {
  if (!output) return;
  const safeOutput = resolveSafeJsonReportOutputPath(output);
  fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
  fs.writeFileSync(safeOutput, `${JSON.stringify(report, null, 2)}\n`);
}

export function buildSourceHealthOutput<T extends object>(
  report: T,
  metadata: {
    environment?: string;
    db?: string;
    options: SourceHealthCliOptions;
  },
): T & {
  environment?: string;
  db?: string;
  options: SourceHealthCliOptions;
} {
  return {
    ...report,
    ...(metadata.environment ? { environment: metadata.environment } : {}),
    ...(metadata.db ? { db: metadata.db } : {}),
    options: metadata.options,
  };
}

export function resolveSourceHealthRowsWithReviewArtifacts(
  rows: SourceHealthRow[],
  readReportJson: (reportPath: string) => unknown | undefined = readJsonIfExists,
): SourceHealthRow[] {
  return rows.map((row) => {
    if (row.risk !== 'warn' || row.reviewArtifact?.reason !== 'materialization_conflicts') {
      return row;
    }
    const report = readReportJson(row.reviewArtifact.outputPath);
    const conflictReview = extractMaterializationConflictReview(report);
    if (!conflictReview?.available) {
      return row;
    }
    if (numberValue(conflictReview.activeObservationConflictCount) !== 0) {
      if (!hasCompleteMaterializationConflictReview(row, conflictReview, readReportJson)) {
        return row;
      }

      return sourceHealthRowResolvedByReview(row);
    }

    return sourceHealthRowResolvedByInactiveReview(row);
  });
}

function sourceHealthRowResolvedByInactiveReview(row: SourceHealthRow): SourceHealthRow {
  const { nextCommand, reviewArtifact, ...rest } = row;
  void nextCommand;
  void reviewArtifact;
  return {
    ...rest,
    risk: 'ok',
    action:
      'Latest scraper report has no active materialization conflicts; historical conflict counter is resolved.',
  };
}

function sourceHealthRowResolvedByReview(row: SourceHealthRow): SourceHealthRow {
  const { nextCommand, reviewArtifact, ...rest } = row;
  void nextCommand;
  void reviewArtifact;
  return {
    ...rest,
    risk: 'ok',
    action:
      'Active materialization conflicts have complete valid review decisions for source-health purposes.',
  };
}

function hasCompleteMaterializationConflictReview(
  row: SourceHealthRow,
  conflictReview: Record<string, unknown>,
  readReportJson: (reportPath: string) => unknown | undefined,
): boolean {
  const sameSourceConflictCount = numberValue(conflictReview.sameSourceConflictCount);
  const crossSourceConflictCount = numberValue(conflictReview.crossSourceConflictCount);
  const activeReviewQueues = buildReviewQueues(
    categoryCountValues(conflictReview.categoryCounts),
  ).filter((queue) => queue.count > 0);
  if (activeReviewQueues.length === 0) {
    return false;
  }

  return activeReviewQueues.every((queue) => {
    const staleReview = attachReviewArtifactSummary(
      buildStaleObservationReviewCommand(row.sourceName, sameSourceConflictCount, queue.queue),
      readReportJson,
    );
    const crossSourceReview = attachReviewArtifactSummary(
      buildCrossSourceObservationReviewCommand(
        row.sourceName,
        crossSourceConflictCount,
        queue.queue,
      ),
      readReportJson,
    );
    const staleReviewComplete =
      sameSourceConflictCount === 0 || reviewArtifactIsComplete(staleReview);
    const crossSourceReviewComplete =
      crossSourceConflictCount === 0 || reviewArtifactIsComplete(crossSourceReview);
    return staleReviewComplete && crossSourceReviewComplete;
  });
}

function reviewArtifactIsComplete(artifact: {
  artifactAvailable: boolean;
  plannedGroups?: number;
  candidateGroups?: number;
  acceptedDecisionValidation?: SourceHealthAcceptedDecisionValidationCommand;
}): boolean {
  if (!artifact.artifactAvailable) {
    return false;
  }
  const plannedGroups = numberValue(artifact.plannedGroups ?? artifact.candidateGroups);
  if (plannedGroups === 0) {
    return true;
  }
  const validation = artifact.acceptedDecisionValidation;
  return Boolean(
    validation?.artifactAvailable &&
    numberValue(validation.invalidDecisionCount) === 0 &&
    numberValue(validation.unreviewedPlanCount) === 0,
  );
}

export function buildSourceHealthReviewSummary(
  rows: SourceHealthRow[],
  readReportJson: (reportPath: string) => unknown | undefined = readJsonIfExists,
): SourceHealthReviewSummary {
  const warningRows = rows.filter((row) => row.risk === 'warn');
  const categoryCounts = new Map<string, number>();
  let reportArtifactsAvailable = 0;
  let reportArtifactsMissing = 0;
  let reportArtifactsWithConflictReview = 0;
  let activeObservationConflictCount = 0;
  let actionableConflictCount = 0;
  let sameSourceConflictCount = 0;
  let crossSourceConflictCount = 0;

  const reviewRows = warningRows.map((row) => {
    const reportOutputPath = row.reviewArtifact?.outputPath;
    const report = reportOutputPath ? readReportJson(reportOutputPath) : undefined;
    const reportAvailable = Boolean(report);
    const conflictReview = extractMaterializationConflictReview(report);
    const conflictReviewAvailable = Boolean(conflictReview?.available);

    if (reportOutputPath) {
      if (reportAvailable) {
        reportArtifactsAvailable += 1;
      } else {
        reportArtifactsMissing += 1;
      }
    }
    if (conflictReviewAvailable) {
      reportArtifactsWithConflictReview += 1;
      activeObservationConflictCount += numberValue(conflictReview?.activeObservationConflictCount);
      actionableConflictCount += numberValue(conflictReview?.actionableConflictCount);
      sameSourceConflictCount += numberValue(conflictReview?.sameSourceConflictCount);
      crossSourceConflictCount += numberValue(conflictReview?.crossSourceConflictCount);
      for (const item of categoryCountValues(conflictReview?.categoryCounts)) {
        categoryCounts.set(item.category, (categoryCounts.get(item.category) || 0) + item.count);
      }
    }
    const rowReviewQueues = buildReviewQueues(categoryCountValues(conflictReview?.categoryCounts));
    const rowQueueCounts = countsForReviewQueues(rowReviewQueues);
    const primaryReviewQueue = rowReviewQueues.find((queue) => queue.count > 0)?.queue;
    const rowSameSourceConflictCount = numberValue(conflictReview?.sameSourceConflictCount);
    const rowCrossSourceConflictCount = numberValue(conflictReview?.crossSourceConflictCount);
    const activeReviewQueues = rowReviewQueues.filter((queue) => queue.count > 0);
    const staleObservationReviews =
      rowSameSourceConflictCount > 0
        ? activeReviewQueues.map((queue) =>
            attachReviewArtifactSummary(
              buildStaleObservationReviewCommand(
                row.sourceName,
                rowSameSourceConflictCount,
                queue.queue,
              ),
              readReportJson,
            ),
          )
        : [];
    const crossSourceObservationReviews =
      rowCrossSourceConflictCount > 0
        ? activeReviewQueues.map((queue) =>
            attachReviewArtifactSummary(
              buildCrossSourceObservationReviewCommand(
                row.sourceName,
                rowCrossSourceConflictCount,
                queue.queue,
              ),
              readReportJson,
            ),
          )
        : [];
    const staleObservationReview = staleObservationReviews[0];
    const crossSourceObservationReview = crossSourceObservationReviews[0];

    return {
      sourceName: row.sourceName,
      risk: row.risk,
      reviewReason: row.reviewArtifact?.reason,
      nextCommand: row.nextCommand,
      reportOutputPath,
      reportAvailable,
      conflictReviewAvailable,
      materializationConflicts: row.reviewArtifact?.materializationConflicts,
      materializationErrors: row.reviewArtifact?.materializationErrors,
      ...(conflictReview
        ? {
            activeObservationConflictCount: numberValue(
              conflictReview.activeObservationConflictCount,
            ),
            actionableConflictCount: numberValue(conflictReview.actionableConflictCount),
            sameSourceConflictCount: rowSameSourceConflictCount,
            crossSourceConflictCount: rowCrossSourceConflictCount,
            priorityReviewConflictCount: rowQueueCounts.priorityReviewConflictCount,
            contextReviewConflictCount: rowQueueCounts.contextReviewConflictCount,
            metadataReviewConflictCount: rowQueueCounts.metadataReviewConflictCount,
            ...(primaryReviewQueue ? { primaryReviewQueue } : {}),
            ...(staleObservationReview ? { staleObservationReview } : {}),
            ...(staleObservationReviews.length > 0 ? { staleObservationReviews } : {}),
            ...(crossSourceObservationReview ? { crossSourceObservationReview } : {}),
            ...(crossSourceObservationReviews.length > 0 ? { crossSourceObservationReviews } : {}),
            reviewQueues: rowReviewQueues,
            categoryCounts: categoryCountValues(conflictReview.categoryCounts),
          }
        : {}),
    };
  });
  const reviewQueues = buildReviewQueues(
    Array.from(categoryCounts.entries()).map(([category, count]) => ({ category, count })),
  );
  const queueCounts = countsForReviewQueues(reviewQueues);
  const reviewArtifactStatus = buildReviewArtifactStatus(reviewRows);
  const reviewDecisionValidationStatus = buildReviewDecisionValidationStatus(reviewRows);
  const reviewArtifactRollups = buildReviewArtifactRollups(reviewRows);

  return {
    warningRows: warningRows.length,
    materializationConflictRows: warningRows.filter(
      (row) => row.reviewArtifact?.reason === 'materialization_conflicts',
    ).length,
    reportArtifacts: {
      available: reportArtifactsAvailable,
      missing: reportArtifactsMissing,
      withConflictReview: reportArtifactsWithConflictReview,
    },
    activeObservationConflictCount,
    actionableConflictCount,
    sameSourceConflictCount,
    crossSourceConflictCount,
    ...queueCounts,
    categoryCounts: Array.from(categoryCounts.entries())
      .map(([category, count]) => ({ category, count }))
      .sort(
        (left, right) => right.count - left.count || left.category.localeCompare(right.category),
      ),
    reviewQueues,
    reviewArtifactStatus,
    reviewDecisionValidationStatus,
    reviewArtifactRollups,
    rows: reviewRows,
  };
}

async function main(): Promise<void> {
  const options = parseSourceHealthArgs(process.argv.slice(2));
  const guard = assertScriptApplyAllowed({
    apply: false,
    scriptName: 'source:health',
    mongoUrl: process.env.MONGODBURL,
  });
  await initializeConnections();

  const since = new Date(Date.now() - options.days * 24 * 60 * 60 * 1000);
  const sourceFilter = options.includeDisabled ? {} : { enabled: { $ne: false } };
  const sources = await Source.find(sourceFilter)
    .select('name displayName enabled cadence coverage')
    .sort({ 'coverage.priority': 1, name: 1 })
    .lean();
  const sourceNames = sources.map((source) => source.name);
  const runs = await ScrapeRun.find({
    sourceName: { $in: sourceNames },
    startedAt: { $gte: since },
  })
    .select(
      'sourceName status startedAt finishedAt observationCount materializationErrors materializationConflicts invalidated',
    )
    .sort({ sourceName: 1, startedAt: -1 })
    .lean();
  const rows = resolveSourceHealthRowsWithReviewArtifacts(
    buildSourceHealthRows(sources as any[], runs as any[]),
  );
  const riskCounts = rows.reduce(
    (counts, row) => {
      counts[row.risk] += 1;
      return counts;
    },
    { ok: 0, warn: 0, error: 0 },
  );

  const result = {
    generatedAt: new Date().toISOString(),
    windowDays: options.days,
    sources: rows.length,
    riskCounts,
    reviewSummary: buildSourceHealthReviewSummary(rows),
    rows,
  };

  const output = buildSourceHealthOutput(result, {
    environment: guard.environment,
    db: mongoose.connection.db?.databaseName || mongoose.connection.name || guard.dbLabel,
    options,
  });
  console.log(JSON.stringify(output, null, 2));
  writeSourceHealthOutput(output, options.output);
  if (options.strict && riskCounts.error > 0) process.exitCode = 1;
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

function readJsonIfExists(reportPath: string): unknown | undefined {
  let safeReportPath: string;
  try {
    safeReportPath = resolveSafeJsonReportOutputPath(reportPath, 'report path');
  } catch {
    return undefined;
  }
  if (!fs.existsSync(safeReportPath)) {
    return undefined;
  }
  try {
    return JSON.parse(fs.readFileSync(safeReportPath, 'utf8'));
  } catch {
    return undefined;
  }
}

function extractMaterializationConflictReview(
  report: unknown,
): Record<string, unknown> | undefined {
  if (!report || typeof report !== 'object') {
    return undefined;
  }
  const quality = (report as { quality?: unknown }).quality;
  if (!quality || typeof quality !== 'object') {
    return undefined;
  }
  const review = (quality as { materializationConflictReview?: unknown })
    .materializationConflictReview;
  return review && typeof review === 'object' ? (review as Record<string, unknown>) : undefined;
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function categoryCountValues(value: unknown): Array<{ category: string; count: number }> {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item): Array<{ category: string; count: number }> => {
    if (!item || typeof item !== 'object') {
      return [];
    }
    const category = (item as { category?: unknown }).category;
    const count = (item as { count?: unknown }).count;
    if (typeof category !== 'string' || typeof count !== 'number' || !Number.isFinite(count)) {
      return [];
    }
    return [{ category, count }];
  });
}

function reviewQueueForCategory(category: string): SourceHealthReviewQueueName {
  if (PRIORITY_REVIEW_CATEGORIES.has(category)) return 'priority_review';
  if (METADATA_REVIEW_CATEGORIES.has(category)) return 'metadata_review';
  return 'context_review';
}

function buildReviewQueues(
  categoryCounts: Array<{ category: string; count: number }>,
): SourceHealthReviewQueueSummary[] {
  const categoriesByQueue = new Map<
    SourceHealthReviewQueueName,
    Array<{ category: string; count: number }>
  >();

  for (const item of categoryCounts) {
    const queue = reviewQueueForCategory(item.category);
    const categories = categoriesByQueue.get(queue) || [];
    const existing = categories.find((category) => category.category === item.category);
    if (existing) {
      existing.count += item.count;
    } else {
      categories.push({ category: item.category, count: item.count });
    }
    categoriesByQueue.set(queue, categories);
  }

  return SOURCE_HEALTH_REVIEW_QUEUE_DEFINITIONS.map((definition) => {
    const categories = (categoriesByQueue.get(definition.queue) || [])
      .filter((item) => item.count > 0)
      .sort(
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

function countsForReviewQueues(reviewQueues: SourceHealthReviewQueueSummary[]): {
  priorityReviewConflictCount: number;
  contextReviewConflictCount: number;
  metadataReviewConflictCount: number;
} {
  const countForQueue = (queue: SourceHealthReviewQueueName) =>
    reviewQueues.find((item) => item.queue === queue)?.count || 0;
  return {
    priorityReviewConflictCount: countForQueue('priority_review'),
    contextReviewConflictCount: countForQueue('context_review'),
    metadataReviewConflictCount: countForQueue('metadata_review'),
  };
}

function buildReviewArtifactStatus(
  rows: SourceHealthReviewSummary['rows'],
): SourceHealthReviewSummary['reviewArtifactStatus'] {
  const staleCommands = rows.flatMap((row): ReviewArtifactCommandInput[] =>
    (
      row.staleObservationReviews ||
      (row.staleObservationReview ? [row.staleObservationReview] : [])
    ).map((review) => ({
      sourceName: row.sourceName,
      command: review.command,
      outputPath: review.outputPath,
      artifactAvailable: review.artifactAvailable,
      sameSourceConflictCount: review.sameSourceConflictCount,
      ...(review.reviewQueue ? { reviewQueue: review.reviewQueue } : {}),
      ...(review.acceptedDecisionTemplate
        ? {
            acceptedDecisionTemplate: review.acceptedDecisionTemplate,
          }
        : {}),
      ...(review.acceptedDecisionValidation
        ? {
            acceptedDecisionValidation: review.acceptedDecisionValidation,
          }
        : {}),
    })),
  );
  const crossSourceCommands = rows.flatMap((row): ReviewArtifactCommandInput[] =>
    (
      row.crossSourceObservationReviews ||
      (row.crossSourceObservationReview ? [row.crossSourceObservationReview] : [])
    ).map((review) => ({
      sourceName: row.sourceName,
      command: review.command,
      outputPath: review.outputPath,
      artifactAvailable: review.artifactAvailable,
      crossSourceConflictCount: review.crossSourceConflictCount,
      ...(review.reviewQueue ? { reviewQueue: review.reviewQueue } : {}),
      ...(review.acceptedDecisionTemplate
        ? {
            acceptedDecisionTemplate: review.acceptedDecisionTemplate,
          }
        : {}),
      ...(review.acceptedDecisionValidation
        ? {
            acceptedDecisionValidation: review.acceptedDecisionValidation,
          }
        : {}),
    })),
  );

  return {
    staleObservationReview: summarizeReviewArtifactCommands(staleCommands),
    crossSourceObservationReview: summarizeReviewArtifactCommands(crossSourceCommands),
  };
}

type ReviewArtifactCommandInput = SourceHealthReviewArtifactFollowupCommand & {
  artifactAvailable: boolean;
};

function summarizeReviewArtifactCommands(
  commands: ReviewArtifactCommandInput[],
): SourceHealthReviewArtifactStatus {
  const missingCommands = commands
    .filter((command) => !command.artifactAvailable)
    .map(({ artifactAvailable: _artifactAvailable, ...command }) => command);
  return {
    total: commands.length,
    available: commands.length - missingCommands.length,
    missing: missingCommands.length,
    missingCommands,
  };
}

function buildReviewDecisionValidationStatus(
  rows: SourceHealthReviewSummary['rows'],
): SourceHealthReviewSummary['reviewDecisionValidationStatus'] {
  const staleCommands = rows.flatMap((row): AcceptedDecisionValidationCommandInput[] =>
    (
      row.staleObservationReviews ||
      (row.staleObservationReview ? [row.staleObservationReview] : [])
    )
      .filter((review) => review.acceptedDecisionValidation)
      .map((review) => ({
        sourceName: row.sourceName,
        validation: review.acceptedDecisionValidation!,
        ...(review.reviewQueue ? { reviewQueue: review.reviewQueue } : {}),
        sameSourceConflictCount: review.sameSourceConflictCount,
      })),
  );
  const crossSourceCommands = rows.flatMap((row): AcceptedDecisionValidationCommandInput[] =>
    (
      row.crossSourceObservationReviews ||
      (row.crossSourceObservationReview ? [row.crossSourceObservationReview] : [])
    )
      .filter((review) => review.acceptedDecisionValidation)
      .map((review) => ({
        sourceName: row.sourceName,
        validation: review.acceptedDecisionValidation!,
        ...(review.reviewQueue ? { reviewQueue: review.reviewQueue } : {}),
        crossSourceConflictCount: review.crossSourceConflictCount,
      })),
  );

  return {
    staleObservationReview: summarizeAcceptedDecisionValidations(staleCommands),
    crossSourceObservationReview: summarizeAcceptedDecisionValidations(crossSourceCommands),
  };
}

interface AcceptedDecisionValidationCommandInput {
  sourceName: string;
  validation: SourceHealthAcceptedDecisionValidationCommand;
  reviewQueue?: SourceHealthReviewQueueName;
  sameSourceConflictCount?: number;
  crossSourceConflictCount?: number;
}

function summarizeAcceptedDecisionValidations(
  commands: AcceptedDecisionValidationCommandInput[],
): SourceHealthReviewDecisionValidationStatus {
  const missingCommands = commands
    .filter((item) => !item.validation.artifactAvailable)
    .map((item) => ({
      sourceName: item.sourceName,
      command: item.validation.command,
      inputPath: item.validation.inputPath,
      outputPath: item.validation.outputPath,
      ...(item.reviewQueue ? { reviewQueue: item.reviewQueue } : {}),
      ...(item.sameSourceConflictCount !== undefined
        ? { sameSourceConflictCount: item.sameSourceConflictCount }
        : {}),
      ...(item.crossSourceConflictCount !== undefined
        ? { crossSourceConflictCount: item.crossSourceConflictCount }
        : {}),
    }));

  return {
    total: commands.length,
    available: commands.length - missingCommands.length,
    missing: missingCommands.length,
    totalDecisions: commands.reduce(
      (sum, item) => sum + numberValue(item.validation.totalDecisions),
      0,
    ),
    validDecisionCount: commands.reduce(
      (sum, item) => sum + numberValue(item.validation.validDecisionCount),
      0,
    ),
    invalidDecisionCount: commands.reduce(
      (sum, item) => sum + numberValue(item.validation.invalidDecisionCount),
      0,
    ),
    unreviewedPlanCount: commands.reduce(
      (sum, item) => sum + numberValue(item.validation.unreviewedPlanCount),
      0,
    ),
    withInvalidDecisions: commands.filter(
      (item) => numberValue(item.validation.invalidDecisionCount) > 0,
    ).length,
    withUnreviewedPlans: commands.filter(
      (item) => numberValue(item.validation.unreviewedPlanCount) > 0,
    ).length,
    missingCommands,
  };
}

function buildReviewArtifactRollups(
  rows: SourceHealthReviewSummary['rows'],
): SourceHealthReviewSummary['reviewArtifactRollups'] {
  return {
    staleObservationReview: summarizeArtifactRollup(
      rows.flatMap((row) =>
        (
          row.staleObservationReviews ||
          (row.staleObservationReview ? [row.staleObservationReview] : [])
        ).filter((review) => review.artifactAvailable),
      ),
    ),
    crossSourceObservationReview: summarizeArtifactRollup(
      rows.flatMap((row) =>
        (
          row.crossSourceObservationReviews ||
          (row.crossSourceObservationReview ? [row.crossSourceObservationReview] : [])
        ).filter((review) => review.artifactAvailable),
      ),
    ),
  };
}

function summarizeArtifactRollup(
  artifacts: Array<{
    fieldCounts?: Array<{ field: string; count: number }>;
    policyBucketCounts?: Array<{ policyBucket: string; count: number }>;
  }>,
): SourceHealthReviewArtifactRollup {
  const fieldCounts = new Map<string, number>();
  const policyBucketCounts = new Map<string, number>();
  for (const artifact of artifacts) {
    for (const item of artifact.fieldCounts || []) {
      fieldCounts.set(item.field, (fieldCounts.get(item.field) || 0) + item.count);
    }
    for (const item of artifact.policyBucketCounts || []) {
      policyBucketCounts.set(
        item.policyBucket,
        (policyBucketCounts.get(item.policyBucket) || 0) + item.count,
      );
    }
  }

  return {
    fieldCounts: sortCountEntries(fieldCounts, 'field'),
    policyBucketCounts: sortCountEntries(policyBucketCounts, 'policyBucket'),
  };
}

function sortCountEntries<K extends 'field' | 'policyBucket'>(
  counts: Map<string, number>,
  key: K,
): Array<Record<K, string> & { count: number }> {
  return Array.from(counts.entries())
    .map(([name, count]) => ({ [key]: name, count }) as Record<K, string> & { count: number })
    .sort((left, right) => right.count - left.count || left[key].localeCompare(right[key]));
}

function buildStaleObservationReviewCommand(
  sourceName: string,
  sameSourceConflictCount: number,
  reviewQueue?: SourceHealthReviewQueueName,
): {
  command: string;
  outputPath: string;
  sameSourceConflictCount: number;
  reviewQueue?: SourceHealthReviewQueueName;
  acceptedDecisionTemplate: SourceHealthAcceptedDecisionTemplateCommand;
  acceptedDecisionValidation: SourceHealthAcceptedDecisionValidationCommand;
} {
  const sourceSlug = slugForPath(sourceName);
  const queueSuffix = reviewQueue ? `-${reviewQueue}` : '';
  const outputPath = `/tmp/ylabs-stale-observation-conflicts-${sourceSlug}${queueSuffix}.json`;
  const queueFlag = reviewQueue ? ` --queue=${reviewQueue}` : '';
  const baseCommand =
    `SCRAPER_ENV=beta yarn --cwd server observations:stale-conflict-review --source=${sourceName}${queueFlag}` +
    ` --limit=${SOURCE_HEALTH_REVIEW_LIMIT}` +
    ` --sample-size=${SOURCE_HEALTH_REVIEW_SAMPLE_SIZE}` +
    ` --plan-limit=${SOURCE_HEALTH_REVIEW_LIMIT}`;
  const acceptedDecisionTemplateOutputPath =
    `/tmp/ylabs-stale-observation-conflicts-${sourceSlug}` +
    `${queueSuffix}-accepted-decisions-template.json`;
  const acceptedDecisionInputPath =
    `/tmp/ylabs-stale-observation-conflicts-${sourceSlug}` +
    `${queueSuffix}-accepted-decisions.json`;
  const acceptedDecisionValidationOutputPath =
    `/tmp/ylabs-stale-observation-conflicts-${sourceSlug}` +
    `${queueSuffix}-decision-validation.json`;
  return {
    command: `${baseCommand} --output ${outputPath}`,
    outputPath,
    sameSourceConflictCount,
    ...(reviewQueue ? { reviewQueue } : {}),
    acceptedDecisionTemplate: {
      command:
        `${baseCommand} --decision-template-output ${acceptedDecisionTemplateOutputPath}` +
        ` --output ${outputPath}`,
      outputPath: acceptedDecisionTemplateOutputPath,
      expectedArtifactFields: [
        'decisions[].planId',
        'decisions[].keepObservationId',
        'decisions[].supersedeObservationIds',
        'decisions[].decision',
      ],
    },
    acceptedDecisionValidation: {
      command:
        `${baseCommand} --accepted-decisions=${acceptedDecisionInputPath}` +
        ` --allow-empty-decisions` +
        ` --output ${acceptedDecisionValidationOutputPath}`,
      inputPath: acceptedDecisionInputPath,
      outputPath: acceptedDecisionValidationOutputPath,
      expectedArtifactField: 'reviewDecisionValidation',
      acceptedDecisionFields: [
        'planId',
        'decision',
        'keepObservationId',
        'supersedeObservationIds',
        'reviewedBy',
      ],
    },
  };
}

function buildCrossSourceObservationReviewCommand(
  sourceName: string,
  crossSourceConflictCount: number,
  reviewQueue?: SourceHealthReviewQueueName,
): {
  command: string;
  outputPath: string;
  crossSourceConflictCount: number;
  reviewQueue?: SourceHealthReviewQueueName;
  acceptedDecisionTemplate: SourceHealthAcceptedDecisionTemplateCommand;
  acceptedDecisionValidation: SourceHealthAcceptedDecisionValidationCommand;
} {
  const sourceSlug = slugForPath(sourceName);
  const queueSuffix = reviewQueue ? `-${reviewQueue}` : '';
  const outputPath = `/tmp/ylabs-cross-source-observation-conflicts-${sourceSlug}${queueSuffix}.json`;
  const queueFlag = reviewQueue ? ` --queue=${reviewQueue}` : '';
  const baseCommand =
    `SCRAPER_ENV=beta yarn --cwd server observations:cross-source-conflict-review --source=${sourceName}${queueFlag}` +
    ` --limit=${SOURCE_HEALTH_REVIEW_LIMIT}` +
    ` --sample-size=${SOURCE_HEALTH_REVIEW_SAMPLE_SIZE}` +
    ` --plan-limit=${SOURCE_HEALTH_REVIEW_LIMIT}`;
  const acceptedDecisionTemplateOutputPath =
    `/tmp/ylabs-cross-source-observation-conflicts-${sourceSlug}` +
    `${queueSuffix}-accepted-decisions-template.json`;
  const acceptedDecisionInputPath =
    `/tmp/ylabs-cross-source-observation-conflicts-${sourceSlug}` +
    `${queueSuffix}-accepted-decisions.json`;
  const acceptedDecisionValidationOutputPath =
    `/tmp/ylabs-cross-source-observation-conflicts-${sourceSlug}` +
    `${queueSuffix}-decision-validation.json`;
  return {
    command: `${baseCommand} --output ${outputPath}`,
    outputPath,
    crossSourceConflictCount,
    ...(reviewQueue ? { reviewQueue } : {}),
    acceptedDecisionTemplate: {
      command:
        `${baseCommand} --decision-template-output ${acceptedDecisionTemplateOutputPath}` +
        ` --output ${outputPath}`,
      outputPath: acceptedDecisionTemplateOutputPath,
      expectedArtifactFields: [
        'decisions[].planId',
        'decisions[].sourceNames',
        'decisions[].observationIdsBySource',
        'decisions[].decision',
        'decisions[].preferredSourceName',
      ],
    },
    acceptedDecisionValidation: {
      command:
        `${baseCommand} --accepted-decisions=${acceptedDecisionInputPath}` +
        ` --allow-empty-decisions` +
        ` --output ${acceptedDecisionValidationOutputPath}`,
      inputPath: acceptedDecisionInputPath,
      outputPath: acceptedDecisionValidationOutputPath,
      expectedArtifactField: 'reviewDecisionValidation',
      acceptedDecisionFields: [
        'planId',
        'decision',
        'preferredSourceName',
        'sourceNames',
        'observationIdsBySource',
        'reviewedBy',
      ],
    },
  };
}

function attachReviewArtifactSummary<
  T extends {
    outputPath: string;
    acceptedDecisionValidation?: SourceHealthAcceptedDecisionValidationCommand;
  },
>(
  command: T,
  readReportJson: (reportPath: string) => unknown | undefined,
): T & {
  artifactAvailable: boolean;
  candidateGroups?: number;
  plannedGroups?: number;
  planTruncated?: boolean;
  fieldCounts?: Array<{ field: string; count: number }>;
  categoryCounts?: Array<{ category: string; count: number }>;
  policyBucketCounts?: Array<{ policyBucket: string; count: number }>;
} {
  const commandWithDecisionValidation = attachAcceptedDecisionValidationSummary(
    command,
    readReportJson,
  );
  const artifact = readReportJson(command.outputPath);
  if (!artifact || typeof artifact !== 'object') {
    return { ...commandWithDecisionValidation, artifactAvailable: false };
  }
  const record = artifact as Record<string, unknown>;
  return {
    ...commandWithDecisionValidation,
    artifactAvailable: true,
    ...optionalNumberField(record, 'candidateGroups'),
    ...optionalNumberField(record, 'plannedGroups'),
    ...(typeof record.planTruncated === 'boolean' ? { planTruncated: record.planTruncated } : {}),
    ...optionalFieldCounts(record),
    ...optionalCategoryCounts(record),
    ...optionalPolicyBucketCounts(record),
  };
}

function attachAcceptedDecisionValidationSummary<
  T extends { acceptedDecisionValidation?: SourceHealthAcceptedDecisionValidationCommand },
>(command: T, readReportJson: (reportPath: string) => unknown | undefined): T {
  const validation = command.acceptedDecisionValidation;
  if (!validation) return command;
  const artifact = readReportJson(validation.outputPath);
  const summary = extractReviewDecisionValidationSummary(artifact);
  return {
    ...command,
    acceptedDecisionValidation: {
      ...validation,
      artifactAvailable: Boolean(summary),
      ...(summary || {}),
    },
  };
}

function extractReviewDecisionValidationSummary(
  artifact: unknown,
):
  | Pick<
      SourceHealthAcceptedDecisionValidationCommand,
      'totalDecisions' | 'validDecisionCount' | 'invalidDecisionCount' | 'unreviewedPlanCount'
    >
  | undefined {
  if (!artifact || typeof artifact !== 'object') return undefined;
  const validation = (artifact as Record<string, unknown>).reviewDecisionValidation;
  if (!validation || typeof validation !== 'object') return undefined;
  const record = validation as Record<string, unknown>;
  const totalDecisions = finiteNumber(record.totalDecisions);
  const validDecisionCount = finiteNumber(record.validDecisionCount);
  const invalidDecisionCount = finiteNumber(record.invalidDecisionCount);
  const unreviewedPlanCount = finiteNumber(record.unreviewedPlanCount);
  if (
    totalDecisions === undefined &&
    validDecisionCount === undefined &&
    invalidDecisionCount === undefined &&
    unreviewedPlanCount === undefined
  ) {
    return undefined;
  }
  return {
    ...(totalDecisions !== undefined ? { totalDecisions } : {}),
    ...(validDecisionCount !== undefined ? { validDecisionCount } : {}),
    ...(invalidDecisionCount !== undefined ? { invalidDecisionCount } : {}),
    ...(unreviewedPlanCount !== undefined ? { unreviewedPlanCount } : {}),
  };
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function optionalNumberField(
  record: Record<string, unknown>,
  field: 'candidateGroups' | 'plannedGroups',
): Partial<Record<'candidateGroups' | 'plannedGroups', number>> {
  const value = record[field];
  return typeof value === 'number' && Number.isFinite(value) ? { [field]: value } : {};
}

function optionalCategoryCounts(record: Record<string, unknown>): {
  categoryCounts?: Array<{ category: string; count: number }>;
} {
  const value = record.categoryCounts;
  if (!Array.isArray(value)) {
    return {};
  }
  const counts = value.flatMap((item): Array<{ category: string; count: number }> => {
    if (!item || typeof item !== 'object') return [];
    const category = (item as Record<string, unknown>).category;
    const count = (item as Record<string, unknown>).count;
    if (typeof category !== 'string' || typeof count !== 'number' || !Number.isFinite(count)) {
      return [];
    }
    return [{ category, count }];
  });
  return counts.length > 0 ? { categoryCounts: counts } : {};
}

function optionalFieldCounts(record: Record<string, unknown>): {
  fieldCounts?: Array<{ field: string; count: number }>;
} {
  const value = record.fieldCounts;
  if (!Array.isArray(value)) {
    return {};
  }
  const counts = value.flatMap((item): Array<{ field: string; count: number }> => {
    if (!item || typeof item !== 'object') return [];
    const field = (item as Record<string, unknown>).field;
    const count = (item as Record<string, unknown>).count;
    if (typeof field !== 'string' || typeof count !== 'number' || !Number.isFinite(count)) {
      return [];
    }
    return [{ field, count }];
  });
  return counts.length > 0 ? { fieldCounts: counts } : {};
}

function optionalPolicyBucketCounts(record: Record<string, unknown>): {
  policyBucketCounts?: Array<{ policyBucket: string; count: number }>;
} {
  const value = record.policyBucketCounts;
  if (!Array.isArray(value)) {
    return {};
  }
  const counts = value.flatMap((item): Array<{ policyBucket: string; count: number }> => {
    if (!item || typeof item !== 'object') return [];
    const policyBucket = (item as Record<string, unknown>).policyBucket;
    const count = (item as Record<string, unknown>).count;
    if (typeof policyBucket !== 'string' || typeof count !== 'number' || !Number.isFinite(count)) {
      return [];
    }
    return [{ policyBucket, count }];
  });
  return counts.length > 0 ? { policyBucketCounts: counts } : {};
}

function slugForPath(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'source';
}

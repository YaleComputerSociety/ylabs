import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
import { initializeConnections } from '../db/connections';
import { Fellowship } from '../models/fellowship';
import {
  publicStudentVisibilityTiers,
  type StudentVisibilityTier,
} from '../models/studentVisibility';
import {
  ARCHIVE_REVIEW_STUDENT_FACING_CATEGORY,
  classifyProgram,
  type ProgramClassification,
} from '../services/programClassifier';
import { computeProgramStudentVisibility } from '../services/studentVisibilityTier';
import { serializedDocumentId } from '../utils/idSerialization';
import { sanitizeLogValue } from '../utils/logSanitizer';
import {
  assertScriptApplyAllowed,
  resolveSafeJsonReportOutputPath,
  type ScriptApplyGuardResult,
} from './scriptWriteGuards';

dotenv.config();

export interface BackfillProgramClassificationsCliOptions {
  apply: boolean;
  confirmProgramClassificationBackfill: boolean;
  confirmStudentVisibilityLoss: boolean;
  confirmCategoryRewrites: boolean;
  limit: number;
  onlyArchiveReview: boolean;
  output?: string;
}

export const CLASSIFICATION_OPTIONAL_FIELDS = [
  'undergraduateOnly',
  'yaleCollegeOnly',
  'compensationSummary',
  'hoursPerWeek',
  'programDates',
] as const;

export type ClassificationOptionalField = (typeof CLASSIFICATION_OPTIONAL_FIELDS)[number];

const REPORTED_SAMPLE_LIMIT = 20;
const REPORTED_DEMOTED_ROW_LIMIT = 50;
const REPORTED_CATEGORY_REWRITE_COHORT_LIMIT = 50;

export interface ProgramClassificationWritePlan {
  set: ProgramClassification;
  retainedOptionalFields: ClassificationOptionalField[];
}

// `classifyProgram` only asserts the optional fields it has evidence for, so an omission is
// silence rather than a retraction: the classifier has no channel for "this row is not
// undergraduate-only" other than asserting `undergraduateOnly: false`, which lands in `$set`.
// Treating an omission as a clear used to `$unset` stored `undergraduateOnly` / `yaleCollegeOnly`
// and drop the row out of the visibility gate's `audienceKnown` branch (#2910), so the write now
// only ever asserts and never retracts.
export function planProgramClassificationWrite(
  stored: Record<string, unknown>,
  classification: ProgramClassification,
): ProgramClassificationWritePlan {
  return {
    set: classification,
    retainedOptionalFields: CLASSIFICATION_OPTIONAL_FIELDS.filter(
      (field) => !(field in classification) && stored[field] !== undefined,
    ),
  };
}

export function projectProgramClassificationWrite(
  stored: Record<string, unknown>,
  plan: ProgramClassificationWritePlan,
): Record<string, unknown> {
  return { ...stored, ...plan.set };
}

// `publicStudentVisibilityTiers` rather than `publicSafeStudentVisibilityTiers`, because that is
// the set every student-facing program query gates on (`publicFellowshipFilter`). Counting against
// the wider public-safe set reports `publicTierLost: 0` for a row that just left the catalog.
const STUDENT_VISIBLE_TIERS = new Set<string>(publicStudentVisibilityTiers);

export interface ProgramClassificationVisibilityProjection {
  before: StudentVisibilityTier;
  after: StudentVisibilityTier;
}

export interface ProgramClassificationVisibilityImpact {
  studentReadyBefore: number;
  studentReadyAfter: number;
  publicTierLost: number;
}

export function losesStudentVisibleTier(
  projection: ProgramClassificationVisibilityProjection,
): boolean {
  return (
    STUDENT_VISIBLE_TIERS.has(projection.before) && !STUDENT_VISIBLE_TIERS.has(projection.after)
  );
}

export function evaluateProgramClassificationVisibilityImpact(
  projections: ProgramClassificationVisibilityProjection[],
): ProgramClassificationVisibilityImpact {
  return projections.reduce<ProgramClassificationVisibilityImpact>(
    (acc, projection) => ({
      studentReadyBefore: acc.studentReadyBefore + (projection.before === 'student_ready' ? 1 : 0),
      studentReadyAfter: acc.studentReadyAfter + (projection.after === 'student_ready' ? 1 : 0),
      publicTierLost: acc.publicTierLost + (losesStudentVisibleTier(projection) ? 1 : 0),
    }),
    { studentReadyBefore: 0, studentReadyAfter: 0, publicTierLost: 0 },
  );
}

export function describeProgramClassificationVisibilityLoss(
  impact: ProgramClassificationVisibilityImpact,
  options: Pick<BackfillProgramClassificationsCliOptions, 'confirmStudentVisibilityLoss'>,
): string | undefined {
  if (options.confirmStudentVisibilityLoss) return undefined;
  if (impact.publicTierLost > 0) {
    return `programs:backfill-classification would cost ${impact.publicTierLost} program row(s) their student-visible tier; pass --confirm-student-visibility-loss to accept the demotion`;
  }
  if (impact.studentReadyAfter < impact.studentReadyBefore) {
    return `programs:backfill-classification would reduce student_ready program rows from ${impact.studentReadyBefore} to ${impact.studentReadyAfter}; pass --confirm-student-visibility-loss to accept the demotion`;
  }
  return undefined;
}

export function assertProgramClassificationVisibilityPreserved(
  impact: ProgramClassificationVisibilityImpact,
  options: Pick<BackfillProgramClassificationsCliOptions, 'confirmStudentVisibilityLoss'>,
): void {
  const loss = describeProgramClassificationVisibilityLoss(impact, options);
  if (loss) throw new Error(loss);
}

// `studentFacingCategory` is stored rather than recomputed at serve time, and the student reads it
// straight off the card through `publicProgramForReader`, so replacing it is a served-copy change
// that the tier guard above cannot see: a row can keep `student_ready` while a curated label is
// replaced by a generic derived one (#2925). Refusing on served rewrites is what makes the guard
// able to fire at all.
export interface ProgramCategoryRewrite {
  before: unknown;
  after: string;
  servedToStudents: boolean;
}

export interface ProgramCategoryRewriteImpact {
  rewritten: number;
  servedRewritten: number;
  servedCohorts: Array<{ change: string; count: number }>;
}

// A row with no stored label is a fill rather than an overwrite, so it is not a rewrite.
export function rewritesStoredProgramCategory(rewrite: ProgramCategoryRewrite): boolean {
  return (
    typeof rewrite.before === 'string' && rewrite.before !== '' && rewrite.before !== rewrite.after
  );
}

// The served surface filters on the stored `studentVisibilityTier` (`publicFellowshipFilter`), not
// on a freshly computed one, so the stored tier is what decides whether a student reads this label.
export function programCategoryIsServedToStudents(stored: Record<string, unknown>): boolean {
  return STUDENT_VISIBLE_TIERS.has(String(stored.studentVisibilityTier));
}

export function evaluateProgramCategoryRewriteImpact(
  rewrites: ProgramCategoryRewrite[],
): ProgramCategoryRewriteImpact {
  const cohorts = new Map<string, number>();
  let rewritten = 0;
  let servedRewritten = 0;

  for (const rewrite of rewrites) {
    if (!rewritesStoredProgramCategory(rewrite)) continue;
    rewritten += 1;
    if (!rewrite.servedToStudents) continue;
    servedRewritten += 1;
    const change = `${String(rewrite.before)} -> ${rewrite.after}`;
    cohorts.set(change, (cohorts.get(change) || 0) + 1);
  }

  return {
    rewritten,
    servedRewritten,
    servedCohorts: [...cohorts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, REPORTED_CATEGORY_REWRITE_COHORT_LIMIT)
      .map(([change, count]) => ({ change, count })),
  };
}

export function describeProgramCategoryRewriteRefusal(
  impact: ProgramCategoryRewriteImpact,
  options: Pick<BackfillProgramClassificationsCliOptions, 'confirmCategoryRewrites'>,
): string | undefined {
  if (options.confirmCategoryRewrites) return undefined;
  if (impact.servedRewritten === 0) return undefined;
  return `programs:backfill-classification would replace the served studentFacingCategory on ${impact.servedRewritten} program row(s); read the categoryRewrites cohorts, then pass --confirm-category-rewrites to accept the relabel`;
}

export function describeBackfillProgramClassificationsRefusals(
  studentVisibility: ProgramClassificationVisibilityImpact,
  categoryRewrites: ProgramCategoryRewriteImpact,
  options: Pick<
    BackfillProgramClassificationsCliOptions,
    'confirmStudentVisibilityLoss' | 'confirmCategoryRewrites'
  >,
): string[] {
  return [
    describeProgramClassificationVisibilityLoss(studentVisibility, options),
    describeProgramCategoryRewriteRefusal(categoryRewrites, options),
  ].filter((refusal): refusal is string => Boolean(refusal));
}

export function assertBackfillProgramClassificationsAccepted(
  studentVisibility: ProgramClassificationVisibilityImpact,
  categoryRewrites: ProgramCategoryRewriteImpact,
  options: Pick<
    BackfillProgramClassificationsCliOptions,
    'confirmStudentVisibilityLoss' | 'confirmCategoryRewrites'
  >,
): void {
  const refusals = describeBackfillProgramClassificationsRefusals(
    studentVisibility,
    categoryRewrites,
    options,
  );
  if (refusals.length > 0) throw new Error(refusals.join('; '));
}

export function buildBackfillProgramClassificationsMatch(
  options: Pick<BackfillProgramClassificationsCliOptions, 'onlyArchiveReview'>,
): Record<string, unknown> {
  return {
    archived: { $ne: true },
    ...(options.onlyArchiveReview
      ? { studentFacingCategory: ARCHIVE_REVIEW_STUDENT_FACING_CATEGORY }
      : {}),
  };
}

function parseRequiredOutputPath(value: string | undefined): string {
  return resolveSafeJsonReportOutputPath(value);
}

export function parseBackfillProgramClassificationsArgs(
  argv: string[],
): BackfillProgramClassificationsCliOptions {
  const options: BackfillProgramClassificationsCliOptions = {
    apply: false,
    confirmProgramClassificationBackfill: false,
    confirmStudentVisibilityLoss: false,
    confirmCategoryRewrites: false,
    limit: Infinity,
    onlyArchiveReview: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') {
      options.apply = true;
      continue;
    }
    if (arg === '--only-archive-review') {
      options.onlyArchiveReview = true;
      continue;
    }
    if (arg.startsWith('--only-archive-review=')) {
      throw new Error('--only-archive-review does not accept a value');
    }
    if (arg === '--confirm-program-classification-backfill') {
      options.confirmProgramClassificationBackfill = true;
      continue;
    }
    if (arg.startsWith('--confirm-program-classification-backfill=')) {
      throw new Error('--confirm-program-classification-backfill does not accept a value');
    }
    if (arg === '--confirm-student-visibility-loss') {
      options.confirmStudentVisibilityLoss = true;
      continue;
    }
    if (arg.startsWith('--confirm-student-visibility-loss=')) {
      throw new Error('--confirm-student-visibility-loss does not accept a value');
    }
    if (arg === '--confirm-category-rewrites') {
      options.confirmCategoryRewrites = true;
      continue;
    }
    if (arg.startsWith('--confirm-category-rewrites=')) {
      throw new Error('--confirm-category-rewrites does not accept a value');
    }
    if (arg.startsWith('--limit=')) {
      options.limit = parsePositiveInteger(arg.slice('--limit='.length), '--limit');
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

    throw new Error(`Unknown program classification backfill argument: ${arg}`);
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

export function writeBackfillProgramClassificationsOutput(report: unknown, output?: string): void {
  if (!output) return;
  const safeOutput = resolveSafeJsonReportOutputPath(output);
  fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
  fs.writeFileSync(safeOutput, `${JSON.stringify(report, null, 2)}\n`);
}

export function buildBackfillProgramClassificationsOutput<T extends object>(
  report: T,
  metadata: {
    environment?: string;
    db?: string;
    options: BackfillProgramClassificationsCliOptions;
  },
): T & {
  environment?: string;
  db?: string;
  options: BackfillProgramClassificationsCliOptions;
} {
  return {
    ...report,
    ...(metadata.environment ? { environment: metadata.environment } : {}),
    ...(metadata.db ? { db: metadata.db } : {}),
    options: metadata.options,
  };
}

export function assertBackfillProgramClassificationsApplyAllowed(
  options: Pick<
    BackfillProgramClassificationsCliOptions,
    'apply' | 'confirmProgramClassificationBackfill' | 'limit'
  >,
  env: NodeJS.ProcessEnv = process.env,
  mongoUrl?: string,
): ScriptApplyGuardResult {
  if (options.apply && !Number.isFinite(options.limit)) {
    throw new Error('--limit is required when --apply is set for programs:backfill-classification');
  }
  if (options.apply && !options.confirmProgramClassificationBackfill) {
    throw new Error(
      '--confirm-program-classification-backfill is required when --apply is set for programs:backfill-classification',
    );
  }
  return assertScriptApplyAllowed({
    apply: options.apply,
    scriptName: 'programs:backfill-classification',
    mongoUrl,
    env,
  });
}

async function main() {
  const options = parseBackfillProgramClassificationsArgs(process.argv.slice(2));
  const guard = assertBackfillProgramClassificationsApplyAllowed(
    options,
    process.env,
    process.env.MONGODBURL,
  );
  await initializeConnections();

  const query = Fellowship.find(buildBackfillProgramClassificationsMatch(options)).sort({
    title: 1,
  });
  if (Number.isFinite(options.limit)) query.limit(options.limit);
  const rows = await query.lean();
  const planned: Array<{
    id: unknown;
    serializedId: string;
    title: string;
    classification: ProgramClassification;
    plan: ProgramClassificationWritePlan;
    projection: ProgramClassificationVisibilityProjection;
    categoryRewrite: ProgramCategoryRewrite;
  }> = [];
  const optionalFieldsRetained: Record<string, number> = {};

  for (const row of rows) {
    const stored = row as Record<string, unknown>;
    const classification = classifyProgram({
      title: row.title,
      competitionType: row.competitionType,
      summary: row.summary,
      description: row.description,
      applicationInformation: row.applicationInformation,
      eligibility: row.eligibility,
      additionalInformation: row.additionalInformation,
      purpose: row.purpose,
      termOfAward: row.termOfAward,
      sourceUrl: row.sourceUrl,
    });
    const plan = planProgramClassificationWrite(stored, classification);
    const projected = projectProgramClassificationWrite(stored, plan);
    planned.push({
      id: row._id,
      serializedId: serializedDocumentId(row._id) || '',
      title: row.title,
      classification,
      plan,
      projection: {
        before: computeProgramStudentVisibility(stored).tier,
        after: computeProgramStudentVisibility(projected).tier,
      },
      categoryRewrite: {
        before: stored.studentFacingCategory,
        after: classification.studentFacingCategory,
        servedToStudents: programCategoryIsServedToStudents(stored),
      },
    });
    for (const field of plan.retainedOptionalFields) {
      optionalFieldsRetained[field] = (optionalFieldsRetained[field] || 0) + 1;
    }
  }

  const studentVisibility = evaluateProgramClassificationVisibilityImpact(
    planned.map((item) => item.projection),
  );
  const categoryRewrites = evaluateProgramCategoryRewriteImpact(
    planned.map((item) => item.categoryRewrite),
  );
  const refusals = options.apply
    ? describeBackfillProgramClassificationsRefusals(studentVisibility, categoryRewrites, options)
    : [];

  if (options.apply && refusals.length === 0) {
    for (const { id, plan } of planned) {
      await Fellowship.updateOne({ _id: id }, { $set: plan.set });
    }
  }

  const counts = planned.reduce<Record<string, number>>((acc, item) => {
    const key = item.classification.studentFacingCategory;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const report = buildBackfillProgramClassificationsOutput(
    {
      mode: options.apply ? (refusals.length > 0 ? 'refused' : 'apply') : 'dry-run',
      scanned: rows.length,
      counts,
      optionalFieldsRetained,
      studentVisibility,
      categoryRewrites,
      ...(refusals.length > 0 ? { refusals } : {}),
      demotedRows: planned
        .filter((item) => losesStudentVisibleTier(item.projection))
        .slice(0, REPORTED_DEMOTED_ROW_LIMIT)
        .map((item) => ({
          id: item.serializedId,
          title: item.title,
          studentVisibility: item.projection,
        })),
      sample: planned.slice(0, REPORTED_SAMPLE_LIMIT).map((item) => ({
        id: item.serializedId,
        title: item.title,
        classification: item.classification,
        retainedOptionalFields: item.plan.retainedOptionalFields,
        studentVisibility: item.projection,
      })),
    },
    {
      environment: guard.environment,
      db: guard.dbLabel,
      options,
    },
  );

  console.log(JSON.stringify(report, null, 2));
  writeBackfillProgramClassificationsOutput(report, options.output);

  if (options.apply) {
    assertBackfillProgramClassificationsAccepted(studentVisibility, categoryRewrites, options);
  }
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isDirectRun) {
  main()
    .catch((error) => {
      console.error('Failed to backfill program classifications:', sanitizeLogValue(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
import { initializeConnections } from '../db/connections';
import { Fellowship } from '../models/fellowship';
import {
  publicSafeStudentVisibilityTiers,
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

const PUBLIC_SAFE_TIERS = new Set<string>(publicSafeStudentVisibilityTiers);

export interface ProgramClassificationVisibilityProjection {
  before: StudentVisibilityTier;
  after: StudentVisibilityTier;
}

export interface ProgramClassificationVisibilityImpact {
  studentReadyBefore: number;
  studentReadyAfter: number;
  publicTierLost: number;
}

export function evaluateProgramClassificationVisibilityImpact(
  projections: ProgramClassificationVisibilityProjection[],
): ProgramClassificationVisibilityImpact {
  return projections.reduce<ProgramClassificationVisibilityImpact>(
    (acc, projection) => ({
      studentReadyBefore: acc.studentReadyBefore + (projection.before === 'student_ready' ? 1 : 0),
      studentReadyAfter: acc.studentReadyAfter + (projection.after === 'student_ready' ? 1 : 0),
      publicTierLost:
        acc.publicTierLost +
        (PUBLIC_SAFE_TIERS.has(projection.before) && !PUBLIC_SAFE_TIERS.has(projection.after)
          ? 1
          : 0),
    }),
    { studentReadyBefore: 0, studentReadyAfter: 0, publicTierLost: 0 },
  );
}

export function assertProgramClassificationVisibilityPreserved(
  impact: ProgramClassificationVisibilityImpact,
  options: Pick<BackfillProgramClassificationsCliOptions, 'confirmStudentVisibilityLoss'>,
): void {
  if (options.confirmStudentVisibilityLoss) return;
  if (impact.publicTierLost > 0) {
    throw new Error(
      `programs:backfill-classification would cost ${impact.publicTierLost} program row(s) their student-visible tier; pass --confirm-student-visibility-loss to accept the demotion`,
    );
  }
  if (impact.studentReadyAfter < impact.studentReadyBefore) {
    throw new Error(
      `programs:backfill-classification would reduce student_ready program rows from ${impact.studentReadyBefore} to ${impact.studentReadyAfter}; pass --confirm-student-visibility-loss to accept the demotion`,
    );
  }
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
  const updates: Array<{
    id: string;
    title: string;
    classification: ProgramClassification;
    retainedOptionalFields: ClassificationOptionalField[];
  }> = [];
  const optionalFieldsRetained: Record<string, number> = {};
  const projections: ProgramClassificationVisibilityProjection[] = [];
  const plans: Array<{ id: unknown; plan: ProgramClassificationWritePlan }> = [];

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
    updates.push({
      id: serializedDocumentId(row._id) || '',
      title: row.title,
      classification,
      retainedOptionalFields: plan.retainedOptionalFields,
    });
    plans.push({ id: row._id, plan });
    for (const field of plan.retainedOptionalFields) {
      optionalFieldsRetained[field] = (optionalFieldsRetained[field] || 0) + 1;
    }
    projections.push({
      before: computeProgramStudentVisibility(stored).tier,
      after: computeProgramStudentVisibility(projectProgramClassificationWrite(stored, plan)).tier,
    });
  }

  const studentVisibility = evaluateProgramClassificationVisibilityImpact(projections);

  if (options.apply) {
    assertProgramClassificationVisibilityPreserved(studentVisibility, options);
    for (const { id, plan } of plans) {
      await Fellowship.updateOne({ _id: id }, { $set: plan.set });
    }
  }

  const counts = updates.reduce<Record<string, number>>((acc, item) => {
    const key = item.classification.studentFacingCategory;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const report = buildBackfillProgramClassificationsOutput(
    {
      mode: options.apply ? 'apply' : 'dry-run',
      scanned: rows.length,
      counts,
      optionalFieldsRetained,
      studentVisibility,
      sample: updates.slice(0, 20),
    },
    {
      environment: guard.environment,
      db: guard.dbLabel,
      options,
    },
  );

  console.log(JSON.stringify(report, null, 2));
  writeBackfillProgramClassificationsOutput(report, options.output);
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

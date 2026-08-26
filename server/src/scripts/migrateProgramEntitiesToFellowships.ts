import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { RoleAssignment } from '../models/roleAssignment';
import { Signal } from '../models/signal';
import { Fellowship } from '../models/fellowship';
import { classifyProgram } from '../services/programClassifier';
import { runStudentVisibilityGate } from '../services/studentVisibilityGateService';
import { deleteFromIndex } from '../services/meiliSyncService';
import { slugify } from '../scrapers/utils/scraperHelpers';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const SCRIPT_NAME = 'programs:migrate-program-entities-to-fellowships';

interface CliOptions {
  dryRun: boolean;
  confirm: boolean;
  limit?: number;
  output?: string;
}

function parsePositiveInt(value: string | undefined, flag: string): number {
  if (!value || value.startsWith('--') || !/^[1-9]\d*$/.test(value)) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return Number(value);
}

export function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { dryRun: true, confirm: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply' || arg === '--mode=apply') options.dryRun = false;
    else if (arg === '--dry-run' || arg === '--mode=dry-run') options.dryRun = true;
    else if (arg === '--confirm-program-entity-migration') options.confirm = true;
    else if (arg.startsWith('--limit=')) options.limit = parsePositiveInt(arg.slice('--limit='.length), '--limit');
    else if (arg === '--limit') {
      options.limit = parsePositiveInt(argv[i + 1], '--limit');
      i += 1;
    } else if (arg === '--output') {
      options.output = resolveSafeJsonReportOutputPath(argv[i + 1]);
      i += 1;
    } else if (arg.startsWith('--output=')) {
      options.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

const normalizeTitle = (value: string | undefined): string =>
  (value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const firstNonEmpty = (...values: Array<unknown>): string => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
};

type ProgramEntityRow = {
  _id: unknown;
  slug: string;
  name?: string;
  fullDescription?: string;
  shortDescription?: string;
  officialUrl?: string;
  primaryUrl?: string;
  websiteUrl?: string;
  joinPageUrl?: string;
  departments?: string[];
};

type Disposition = 'created' | 'deduped_existing_fellowship' | 'reconciled_by_source_key';

interface PlanRow {
  slug: string;
  entityId: string;
  title: string;
  sourceKey: string;
  disposition: Disposition;
  existingFellowshipId?: string;
  signalsToDelete: number;
  roleAssignmentsToArchive: number;
}

interface MigrationPlan {
  rows: PlanRow[];
  entities: ProgramEntityRow[];
}

async function planMigration(limit?: number): Promise<MigrationPlan> {
  const query = ResearchEntity.find({ entityType: 'PROGRAM' as never })
    .select('_id slug name fullDescription shortDescription officialUrl primaryUrl websiteUrl joinPageUrl departments')
    .lean();
  if (Number.isFinite(limit) && (limit as number) > 0) query.limit(limit as number);
  const entities = (await query) as unknown as ProgramEntityRow[];

  const rows: PlanRow[] = [];
  for (const entity of entities) {
    const title = firstNonEmpty(entity.name, entity.slug);
    const sourceKey = entity.slug;
    const entityId = String(entity._id);

    const bySourceKey = await Fellowship.findOne({ sourceKey }).select('_id').lean();
    const byTitle = bySourceKey
      ? null
      : (
          await Fellowship.find({}).select('_id title sourceKey').lean()
        ).find((f: any) => normalizeTitle(f.title) === normalizeTitle(title));

    let disposition: Disposition = 'created';
    let existingFellowshipId: string | undefined;
    if (bySourceKey) {
      disposition = 'reconciled_by_source_key';
      existingFellowshipId = String((bySourceKey as any)._id);
    } else if (byTitle) {
      disposition = 'deduped_existing_fellowship';
      existingFellowshipId = String((byTitle as any)._id);
    }

    const [signalsToDelete, roleAssignmentsToArchive] = await Promise.all([
      Signal.countDocuments({ researchEntityId: entity._id }),
      RoleAssignment.countDocuments({ 'target.id': entity._id, archived: { $ne: true } }),
    ]);

    rows.push({
      slug: entity.slug,
      entityId,
      title,
      sourceKey,
      disposition,
      existingFellowshipId,
      signalsToDelete,
      roleAssignmentsToArchive,
    });
  }
  return { rows, entities };
}

function buildFellowshipDoc(entity: ProgramEntityRow): Record<string, unknown> {
  const title = firstNonEmpty(entity.name, entity.slug);
  const description = firstNonEmpty(entity.fullDescription, entity.shortDescription);
  const summary = firstNonEmpty(entity.shortDescription, entity.fullDescription);
  const sourceUrl = firstNonEmpty(entity.officialUrl, entity.primaryUrl, entity.websiteUrl);
  const applicationLink = firstNonEmpty(entity.joinPageUrl, entity.primaryUrl, sourceUrl);
  const undergraduateOnly = entity.slug.startsWith('department-undergrad-research-');

  const classification = classifyProgram({ title, summary, description, sourceUrl });

  return {
    sourceKey: entity.slug,
    title,
    summary,
    description,
    sourceUrl,
    applicationLink,
    undergraduateOnly: undergraduateOnly || Boolean(classification.undergraduateOnly),
    programCategory: classification.programCategory,
    programKind: classification.programKind,
    entryMode: classification.entryMode,
    studentFacingCategory: classification.studentFacingCategory,
    requiresMentorBeforeApply: classification.requiresMentorBeforeApply,
    mentorMatching: classification.mentorMatching,
    bestNextStep: classification.bestNextStep,
    prepSteps: classification.prepSteps,
  };
}

export async function runMigration(options: CliOptions) {
  const planned = await planMigration(options.limit);
  const rows = planned.rows;
  const entities = planned.entities;
  const apply = !options.dryRun;

  const entityBySlug = new Map(entities.map((entity) => [entity.slug, entity]));

  let created = 0;
  let deduped = 0;
  let reconciled = 0;
  let entitiesDeleted = 0;
  let signalsDeleted = 0;
  let roleAssignmentsArchived = 0;

  for (const row of rows) {
    const entity = entityBySlug.get(row.slug);
    if (!entity) continue;

    if (apply) {
      if (row.disposition === 'deduped_existing_fellowship') {
        deduped += 1;
      } else {
        const doc = buildFellowshipDoc(entity);
        await Fellowship.updateOne({ sourceKey: row.sourceKey }, { $set: doc }, { upsert: true });
        if (row.disposition === 'reconciled_by_source_key') reconciled += 1;
        else created += 1;
      }

      const signalMatch = await Signal.deleteMany({ researchEntityId: entity._id });
      const roleMatch = await RoleAssignment.updateMany(
        { 'target.id': entity._id, archived: { $ne: true } },
        { $set: { archived: true } },
      );
      await deleteFromIndex('researchEntity', row.entityId);
      await ResearchEntity.deleteOne({ _id: entity._id });

      signalsDeleted += signalMatch.deletedCount || 0;
      roleAssignmentsArchived += roleMatch.modifiedCount || 0;
      entitiesDeleted += 1;
    } else {
      if (row.disposition === 'deduped_existing_fellowship') deduped += 1;
      else if (row.disposition === 'reconciled_by_source_key') reconciled += 1;
      else created += 1;
    }
  }

  let gateReport: unknown;
  if (apply && entitiesDeleted > 0) {
    gateReport = await runStudentVisibilityGate({ collection: 'programs', mode: 'apply' });
  }

  return {
    mode: apply ? 'apply' : 'dry-run',
    summary: {
      programEntities: rows.length,
      fellowshipsCreated: created,
      fellowshipsReconciled: reconciled,
      dedupedAgainstExisting: deduped,
      researchEntitiesDeleted: entitiesDeleted,
      signalsDeleted,
      roleAssignmentsArchived,
    },
    changes: rows,
    gateReport,
  };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const apply = !options.dryRun;
  if (apply && !options.confirm) {
    throw new Error(`--confirm-program-entity-migration is required when --apply is set for ${SCRIPT_NAME}`);
  }

  const guard = assertScriptApplyAllowed({
    apply,
    scriptName: SCRIPT_NAME,
    mongoUrl: process.env.MONGODBURL,
  });
  console.log(
    `Environment: ${guard.environment}; Mongo target: ${guard.dbLabel}; mode: ${apply ? 'apply' : 'dry-run'}`,
  );

  await initializeConnections();
  try {
    const result = await runMigration(options);
    const payload = {
      generatedAt: new Date().toISOString(),
      environment: guard.environment,
      db: guard.dbLabel,
      options,
      result,
    };
    if (options.output) {
      const safeOutput = resolveSafeJsonReportOutputPath(options.output);
      fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
      fs.writeFileSync(safeOutput, JSON.stringify(payload, null, 2));
      console.log(`Saved report to ${safeOutput}`);
    }
    console.log(JSON.stringify(result.summary, null, 2));
    console.log(JSON.stringify(result.changes, null, 2));
  } finally {
    await mongoose.disconnect();
  }
}

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(sanitizeLogValue(error));
    process.exit(1);
  });
}

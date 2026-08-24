/**
 * Repairs `LAB`/`FACULTY_RESEARCH_AREA` `shortDescription` values flagged
 * `topic-label-list` by `shortDescriptionQuality` (#1616): a bare researchAreas
 * tag dump ("Studies <tag>, <tag>, and <tag>.") or possessive-name lead
 * ("<Name>'s research fields include <tag>, ...") that is not a faithful
 * compression of its own fullDescription - either because there is no real
 * fullDescription prose to compress (blank, itself the same bare list, or
 * literally identical to the short), or because a listed item names an
 * affiliation (a Council, Program, Institute, ...) rather than a topic.
 *
 * Each flagged row is repaired by re-deriving a short from the entity's own
 * fullDescription (`deriveShortDescriptionFromFullDescription`); a row whose
 * full carries no usable sentence to derive from has its bad short cleared
 * rather than left serving the label dump or affiliation fragment. Clearing
 * (like re-materializing the entity) also re-runs the `student_ready` gate
 * live at serve time, so an entity with no other usable short degrades to a
 * lower tier until a future scrape backfills real prose - this is the
 * intended "gate below student_ready when there is no real description to
 * draw from" behavior from the issue, not a bug.
 *
 * Dry-run-first. Apply requires `--confirm-1616-topic-label-list-repair`, is
 * blocked against production by `assertScriptApplyAllowed`, and only rewrites
 * entities whose short actually changes. Meilisearch is re-synced for the
 * changed entities after an apply so the search card matches Mongo.
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { syncEntities } from '../services/meiliSyncService';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  planTopicLabelListRepairRow,
  summarizeTopicLabelListRepair,
  type TopicLabelListRepairPlanRow,
  type TopicLabelListRepairSummary,
} from './repair1616TopicLabelListShortDescriptionsCore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export interface TopicLabelListRepairCliOptions {
  dryRun: boolean;
  confirm: boolean;
  syncMeili: boolean;
  limit?: number;
  batchSize: number;
  output?: string;
}

function parsePositiveInt(value: string | undefined, flag: string): number {
  if (!value || value.startsWith('--') || !/^[1-9]\d*$/.test(value)) {
    throw new Error(`${flag} must be a positive integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${flag} must be a positive integer`);
  return parsed;
}

export function parseTopicLabelListRepairArgs(argv: string[]): TopicLabelListRepairCliOptions {
  const options: TopicLabelListRepairCliOptions = {
    dryRun: true,
    confirm: false,
    syncMeili: true,
    batchSize: 200,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply' || arg === '--mode=apply') options.dryRun = false;
    else if (arg === '--dry-run' || arg === '--mode=dry-run') options.dryRun = true;
    else if (arg === '--confirm-1616-topic-label-list-repair') options.confirm = true;
    else if (arg === '--no-sync') options.syncMeili = false;
    else if (arg.startsWith('--limit='))
      options.limit = parsePositiveInt(arg.slice('--limit='.length), '--limit');
    else if (arg === '--limit') {
      options.limit = parsePositiveInt(argv[i + 1], '--limit');
      i += 1;
    } else if (arg.startsWith('--batch-size=')) {
      options.batchSize = parsePositiveInt(arg.slice('--batch-size='.length), '--batch-size');
    } else if (arg === '--batch-size') {
      options.batchSize = parsePositiveInt(argv[i + 1], '--batch-size');
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

export interface TopicLabelListRepairResult {
  mode: 'dry-run' | 'apply';
  summary: TopicLabelListRepairSummary;
  changes: TopicLabelListRepairPlanRow[];
  meiliSynced: number;
}

interface EntityRow {
  _id: unknown;
  slug?: string;
  name?: string;
  entityType?: unknown;
  shortDescription?: unknown;
  fullDescription?: unknown;
  researchAreas?: unknown;
}

export async function runTopicLabelListRepair(options: {
  dryRun: boolean;
  syncMeili: boolean;
  limit?: number;
  batchSize: number;
}): Promise<TopicLabelListRepairResult> {
  const query = ResearchEntity.find({
    archived: { $ne: true },
    studentVisibilityTier: 'student_ready',
    entityType: { $in: ['LAB', 'FACULTY_RESEARCH_AREA'] },
    shortDescription: { $type: 'string' },
  })
    .select('_id slug name entityType shortDescription fullDescription researchAreas')
    .sort({ _id: 1 });
  if (options.limit) query.limit(options.limit);
  const entities = (await query.lean()) as EntityRow[];

  const rows = entities.map((entity) =>
    planTopicLabelListRepairRow({
      id: String(entity._id),
      slug: entity.slug,
      name: entity.name,
      entityType: entity.entityType,
      shortDescription: entity.shortDescription,
      fullDescription: entity.fullDescription,
      researchAreas: entity.researchAreas,
    }),
  );
  const changedRows = rows.filter((row) => row.changed);

  let meiliSynced = 0;
  if (!options.dryRun && changedRows.length > 0) {
    for (let i = 0; i < changedRows.length; i += options.batchSize) {
      const batch = changedRows.slice(i, i + options.batchSize);
      await ResearchEntity.bulkWrite(
        batch.map((row) => ({
          updateOne: {
            filter: { _id: row.id },
            update: { $set: { shortDescription: row.after } },
          },
        })),
      );
    }
    if (options.syncMeili) {
      const changedIds = changedRows.map((row) => row.id);
      const freshDocs = await ResearchEntity.find({ _id: { $in: changedIds } }).lean();
      await syncEntities('researchEntity', freshDocs);
      meiliSynced = freshDocs.length;
    }
  }

  return {
    mode: options.dryRun ? 'dry-run' : 'apply',
    summary: summarizeTopicLabelListRepair(rows),
    changes: changedRows,
    meiliSynced,
  };
}

async function main(): Promise<void> {
  const options = parseTopicLabelListRepairArgs(process.argv.slice(2));
  const apply = !options.dryRun;

  if (apply && !options.confirm) {
    throw new Error('Apply mode requires --confirm-1616-topic-label-list-repair.');
  }

  const guard = assertScriptApplyAllowed({
    apply,
    scriptName: '#1616 topic-label-list shortDescription repair',
    mongoUrl: process.env.MONGODBURL,
  });
  console.log(
    `Environment: ${guard.environment}; Mongo target: ${guard.dbLabel}; mode: ${apply ? 'apply' : 'dry-run'}`,
  );

  await initializeConnections();
  try {
    const result = await runTopicLabelListRepair({
      dryRun: options.dryRun,
      syncMeili: options.syncMeili,
      limit: options.limit,
      batchSize: options.batchSize,
    });
    const payload = {
      generatedAt: new Date().toISOString(),
      environment: guard.environment,
      db: guard.dbLabel,
      options: {
        dryRun: options.dryRun,
        syncMeili: options.syncMeili,
        limit: options.limit,
        batchSize: options.batchSize,
      },
      result,
    };
    if (options.output) {
      const safeOutput = resolveSafeJsonReportOutputPath(options.output);
      fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
      fs.writeFileSync(safeOutput, JSON.stringify(payload, null, 2));
      console.log(`Saved #1616 topic-label-list repair report to ${safeOutput}`);
    }
    console.log(
      JSON.stringify({ summary: result.summary, meiliSynced: result.meiliSynced }, null, 2),
    );
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

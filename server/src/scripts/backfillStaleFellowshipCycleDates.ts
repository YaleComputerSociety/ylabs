/**
 * Data repair for #1557: a fellowship/grant/program description that embedded
 * a specific past application cycle's date ("invites applications for the
 * 2024 X Fellowship.", "by April, 2025.") kept asserting an expired cycle as
 * live because nothing re-scraped or re-gated on the embedded date. This
 * re-runs the new `evergreenizeStaleCycleDatePhrase` normalizer (now also
 * wired into the write-time `sanitizeCatalogDescription`/`sanitizeStoredCatalogDescription`
 * chokepoint, so future scrapes are normalized automatically) over the
 * already-stored `fullDescription`/`shortDescription` of every research
 * entity, so the corpus and Meilisearch index catch up without waiting on a
 * rescrape. Only the stale-date normalization is applied here - not the full
 * hygiene chain - so the diff is exactly the dated-cycle fix and nothing else.
 *
 * Dry-run by default.
 *   yarn --cwd server tsx src/scripts/backfillStaleFellowshipCycleDates.ts
 *   yarn --cwd server tsx src/scripts/backfillStaleFellowshipCycleDates.ts \
 *     --apply --confirm-stale-fellowship-cycle-dates-backfill
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { syncEntities } from '../services/meiliSyncService';
import { assertScriptApplyAllowed } from './scriptWriteGuards';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { evergreenizeStaleCycleDatePhrase } from '../utils/descriptionHygiene';

dotenv.config();

interface CliOptions {
  apply: boolean;
  confirm: boolean;
}

export function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { apply: false, confirm: false };
  for (const arg of argv) {
    if (arg === '--apply') options.apply = true;
    else if (arg === '--confirm-stale-fellowship-cycle-dates-backfill') options.confirm = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (options.apply && !options.confirm) {
    throw new Error(
      '--confirm-stale-fellowship-cycle-dates-backfill is required when --apply is set.',
    );
  }
  return options;
}

const DATE_HINT_PATTERN = /\b(19|20)\d{2}\b/;

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const guard = assertScriptApplyAllowed({
    apply: options.apply,
    scriptName: 'backfillStaleFellowshipCycleDates',
    mongoUrl: process.env.MONGODBURL,
  });
  await initializeConnections();

  const candidates: any[] = await ResearchEntity.find({
    $or: [{ fullDescription: DATE_HINT_PATTERN }, { shortDescription: DATE_HINT_PATTERN }],
  })
    .select('_id entityType displayName fullDescription shortDescription')
    .lean();

  const plannedUpdates: Array<{ recordId: string; entityType: string; set: Record<string, unknown> }> =
    [];
  const report: Array<Record<string, unknown>> = [];

  for (const entity of candidates) {
    const recordId = String(entity._id);
    const set: Record<string, unknown> = {};
    const changedFields: string[] = [];

    if (typeof entity.fullDescription === 'string') {
      const cleaned = evergreenizeStaleCycleDatePhrase(entity.fullDescription);
      if (cleaned !== entity.fullDescription) {
        set.fullDescription = cleaned;
        changedFields.push('fullDescription');
      }
    }
    if (typeof entity.shortDescription === 'string') {
      const cleaned = evergreenizeStaleCycleDatePhrase(entity.shortDescription);
      if (cleaned !== entity.shortDescription) {
        set.shortDescription = cleaned;
        changedFields.push('shortDescription');
      }
    }

    if (changedFields.length === 0) continue;
    plannedUpdates.push({ recordId, entityType: entity.entityType, set });
    report.push({
      recordId,
      displayName: entity.displayName,
      status: 'planned',
      changedFields,
      before: {
        fullDescription: entity.fullDescription,
        shortDescription: entity.shortDescription,
      },
      after: {
        fullDescription: set.fullDescription ?? entity.fullDescription,
        shortDescription: set.shortDescription ?? entity.shortDescription,
      },
    });
  }

  const summary = {
    mode: options.apply ? 'apply' : 'dry-run',
    environment: guard.environment,
    db: guard.dbLabel,
    scanned: candidates.length,
    plannedUpdates: plannedUpdates.length,
  };

  if (options.apply && plannedUpdates.length > 0) {
    await ResearchEntity.bulkWrite(
      plannedUpdates.map((update) => ({
        updateOne: { filter: { _id: update.recordId }, update: { $set: update.set } },
      })),
      { ordered: false },
    );
    const updatedDocs = await ResearchEntity.find({
      _id: { $in: plannedUpdates.map((update) => update.recordId) },
    }).lean();
    const byEntityType = new Map<string, any[]>();
    for (const doc of updatedDocs) {
      const key = String(doc.entityType);
      const bucket = byEntityType.get(key) || [];
      bucket.push(doc);
      byEntityType.set(key, bucket);
    }
    for (const [, docs] of byEntityType) {
      await syncEntities('researchEntity', docs);
    }
  }

  console.log(JSON.stringify({ summary, entries: report }, null, 2));
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isDirectRun) {
  main()
    .catch((error) => {
      console.error(
        'Failed to backfill stale fellowship cycle dates:',
        sanitizeLogValue(error),
      );
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}

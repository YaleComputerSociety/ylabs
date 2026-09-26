import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { Observation } from '../models/observation';
import { ResearchEntity } from '../models/researchEntity';
import { sanitizeLogValue } from '../utils/logSanitizer';
import {
  fieldValueRefusalsPath,
  refusalLaneEvidenceFields,
  type LaneAttributableObservation,
} from '../utils/researchEntityFieldValueRefusals';
import {
  planRefusalLaneAttributions,
  type RefusalAttributionRow,
} from './attributeFieldValueRefusalLanesCore';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const SCRIPT_NAME = 'refusals:attribute-lanes';
export const CONFIRM_FLAG = '--confirm-attribute-refusal-lanes';

export function parseAttributeRefusalLanesArgs(argv: string[]): {
  dryRun: boolean;
  confirmed: boolean;
  output?: string;
} {
  const options: { dryRun: boolean; confirmed: boolean; output?: string } = {
    dryRun: true,
    confirmed: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') options.dryRun = false;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === CONFIRM_FLAG) options.confirmed = true;
    else if (arg === '--output') {
      options.output = resolveSafeJsonReportOutputPath(argv[i + 1]);
      i += 1;
    } else if (arg.startsWith('--output=')) {
      options.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
    } else throw new Error(`Unknown ${SCRIPT_NAME} argument: ${arg}`);
  }
  return options;
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

async function loadRows(): Promise<Array<RefusalAttributionRow & { _id: unknown }>> {
  const docs = (await ResearchEntity.find({
    fieldValueRefusals: { $exists: true, $ne: {} },
  })
    .select('_id slug fieldValueRefusals')
    .lean()) as unknown as Array<Record<string, unknown>>;
  return docs
    .filter((doc) => text(doc.slug))
    .map((doc) => ({
      _id: doc._id,
      slug: text(doc.slug),
      fieldValueRefusals: doc.fieldValueRefusals,
    }));
}

async function loadObservations(
  rows: ReadonlyArray<RefusalAttributionRow & { _id: unknown }>,
): Promise<Map<string, LaneAttributableObservation[]>> {
  const slugById = new Map(rows.map((row) => [String(row._id), row.slug]));
  const fields = new Set<string>();
  for (const row of rows) {
    for (const field of Object.keys((row.fieldValueRefusals as Record<string, unknown>) ?? {})) {
      for (const evidenceField of refusalLaneEvidenceFields(field)) fields.add(evidenceField);
    }
  }
  const docs = (await Observation.find({
    entityType: 'researchEntity',
    field: { $in: [...fields] },
    $or: [
      { entityKey: { $in: rows.map((row) => row.slug) } },
      { entityId: { $in: rows.map((row) => row._id) } },
    ],
  })
    .select('entityKey entityId field value sourceName')
    .lean()) as unknown as Array<Record<string, unknown>>;
  const bySlug = new Map<string, LaneAttributableObservation[]>();
  for (const doc of docs) {
    const slug = text(doc.entityKey) || slugById.get(String(doc.entityId)) || '';
    if (!slug) continue;
    const list = bySlug.get(slug) ?? [];
    list.push({ field: text(doc.field), value: doc.value, sourceName: doc.sourceName });
    bySlug.set(slug, list);
  }
  return bySlug;
}

function countAttributed(rows: readonly RefusalAttributionRow[]): number {
  let attributed = 0;
  for (const row of rows) {
    for (const refusals of Object.values(
      (row.fieldValueRefusals as Record<string, unknown>) ?? {},
    )) {
      if (!Array.isArray(refusals)) continue;
      for (const refusal of refusals) {
        if (Array.isArray(refusal?.attributedSourceNames) && refusal.attributedSourceNames.length) {
          attributed += 1;
        }
      }
    }
  }
  return attributed;
}

async function main(): Promise<void> {
  const options = parseAttributeRefusalLanesArgs(process.argv.slice(2));
  const guard = assertScriptApplyAllowed({
    apply: !options.dryRun,
    scriptName: SCRIPT_NAME,
    mongoUrl: process.env.MONGODBURL,
  });
  if (!options.dryRun && !options.confirmed) {
    throw new Error(`${SCRIPT_NAME} apply requires ${CONFIRM_FLAG}`);
  }
  console.log(
    `Environment: ${guard.environment}; Mongo target: ${guard.dbLabel}; mode: ${
      options.dryRun ? 'dry-run' : 'apply'
    }`,
  );
  await initializeConnections();

  const rows = await loadRows();
  const outcome = planRefusalLaneAttributions(rows, await loadObservations(rows));
  const attributedBefore = countAttributed(rows);
  let applied = 0;
  let stale = 0;
  let attributedAfter: number | null = null;

  if (!options.dryRun) {
    const attributedAt = new Date();
    for (const plan of outcome.plans) {
      const entryPath = `${fieldValueRefusalsPath(plan.field)}.${plan.index}`;
      // Keyed on the value as well as the position, so a refusal list a peer rewrote
      // since the read is skipped rather than attributed to the wrong entry.
      const result = await ResearchEntity.updateOne(
        { slug: plan.slug, [`${entryPath}.valueKey`]: plan.valueKey },
        {
          $set: {
            [`${entryPath}.attributedSourceNames`]: plan.attributedSourceNames,
            [`${entryPath}.attributedAt`]: attributedAt,
          },
        },
        { timestamps: false },
      );
      if (result.matchedCount === 0) stale += 1;
      else applied += result.modifiedCount;
    }
    attributedAfter = countAttributed(await loadRows());
  }

  const report = {
    script: SCRIPT_NAME,
    mode: options.dryRun ? 'dry-run' : 'apply',
    rowsWithRefusals: rows.length,
    refusalsScanned: outcome.refusalsScanned,
    planned: outcome.plans.length,
    multiLanePlans: outcome.multiLanePlans,
    skipped: outcome.skipped,
    unattributableByFieldAndRule: outcome.unattributableByFieldAndRule,
    applied: options.dryRun ? null : applied,
    staleSkipped: options.dryRun ? null : stale,
    attributedBefore,
    attributedAfter,
  };
  console.log(JSON.stringify(report, null, 2));
  if (options.output) {
    fs.mkdirSync(path.dirname(options.output), { recursive: true });
    fs.writeFileSync(options.output, `${JSON.stringify(report, null, 2)}\n`);
  }
  await mongoose.disconnect();
}

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(sanitizeLogValue(error));
    process.exit(1);
  });
}

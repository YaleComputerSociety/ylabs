import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { Observation } from '../models/observation';
import { ResearchEntity } from '../models/researchEntity';
import { syncEntities } from '../services/meiliSyncService';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  planLinkChromeNameRepair,
  summarizeLinkChromeNameRepair,
  type LinkChromeNameRow,
} from './repairLinkChromeEntityNamesCore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const SCRIPT_NAME = 'research-entity:repair-link-chrome-names';
const NOT_ARCHIVED = { $or: [{ archived: { $exists: false } }, { archived: false }] };
const NAME_FIELDS = ['name', 'displayName'];

export interface LinkChromeNameCliOptions {
  dryRun: boolean;
  confirm: boolean;
  output?: string;
}

export function parseLinkChromeNameArgs(argv: string[]): LinkChromeNameCliOptions {
  const options: LinkChromeNameCliOptions = { dryRun: true, confirm: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply' || arg === '--mode=apply') options.dryRun = false;
    else if (arg === '--dry-run' || arg === '--mode=dry-run') options.dryRun = true;
    else if (arg === '--confirm-link-chrome-names') options.confirm = true;
    else if (arg === '--output') {
      options.output = resolveSafeJsonReportOutputPath(argv[i + 1]);
      i += 1;
    } else if (arg.startsWith('--output=')) {
      options.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
    } else throw new Error(`Unknown ${SCRIPT_NAME} argument: ${arg}`);
  }
  return options;
}

export interface LinkChromeNameResult {
  mode: 'dry-run' | 'apply';
  scanned: number;
  summary: ReturnType<typeof summarizeLinkChromeNameRepair>;
  entitiesUpdated: number;
  observationsRewritten: number;
  observationsWithdrawn: number;
  synced: number;
  rows: LinkChromeNameRow[];
}

export async function runLinkChromeNameRepair(options: {
  dryRun: boolean;
}): Promise<LinkChromeNameResult> {
  const entities = (await ResearchEntity.find(NOT_ARCHIVED)
    .select('_id slug name displayName manuallyLockedFields')
    .lean()) as Array<Record<string, unknown>>;

  const rows = planLinkChromeNameRepair(
    entities.map((entity) => ({
      slug: String(entity.slug),
      name: entity.name,
      displayName: entity.displayName,
      manuallyLockedFields: entity.manuallyLockedFields,
    })),
  );
  const actionable = rows.filter((row) => row.outcome === 'strip' || row.outcome === 'withdraw');
  const result: LinkChromeNameResult = {
    mode: options.dryRun ? 'dry-run' : 'apply',
    scanned: entities.length,
    summary: summarizeLinkChromeNameRepair(rows),
    entitiesUpdated: 0,
    observationsRewritten: 0,
    observationsWithdrawn: 0,
    synced: 0,
    rows: actionable,
  };
  if (options.dryRun || actionable.length === 0) return result;

  const strips = actionable.filter((row) => row.outcome === 'strip');
  const withdrawals = actionable.filter((row) => row.outcome === 'withdraw');

  // Rewrite the observation as well as the document. The document field alone is
  // reverted by the next materialization, because the observation still asserts the
  // value with its chrome attached.
  for (const row of strips) {
    for (const field of NAME_FIELDS) {
      const repaired = field === 'name' ? row.repairedName : row.repairedDisplayName;
      const stored = field === 'name' ? row.storedName : row.storedDisplayName;
      if (!repaired || !stored) continue;
      const written = await Observation.updateMany(
        { entityKey: row.slug, field, value: stored },
        { $set: { value: repaired } },
      );
      result.observationsRewritten += written.modifiedCount ?? 0;
    }
  }
  for (const row of withdrawals) {
    const withdrawn = await Observation.updateMany(
      { entityKey: row.slug, field: { $in: NAME_FIELDS }, value: row.storedName },
      { $set: { superseded: true } },
    );
    result.observationsWithdrawn += withdrawn.modifiedCount ?? 0;
  }

  if (strips.length > 0) {
    await ResearchEntity.bulkWrite(
      strips.map((row) => ({
        updateOne: {
          filter: { slug: row.slug },
          update: {
            $set: {
              ...(row.repairedName ? { name: row.repairedName } : {}),
              ...(row.repairedDisplayName ? { displayName: row.repairedDisplayName } : {}),
            },
          },
        },
      })),
    );
  }
  // A withdrawn name leaves the document holding a value no live observation asserts,
  // so it falls back to the best remaining assertion. Picking that here rather than
  // leaving the label in place is what stops the row serving it until the next
  // materialization.
  for (const row of withdrawals) {
    const fallback = (await Observation.find({
      entityKey: row.slug,
      field: 'name',
      superseded: { $ne: true },
    })
      .select('value confidence')
      .sort({ confidence: -1, observedAt: -1 })
      .lean()) as Array<{ value?: unknown }>;
    const next = fallback
      .map((o) => (typeof o.value === 'string' ? o.value.trim() : ''))
      .find(Boolean);
    if (!next) continue;
    await ResearchEntity.updateOne({ slug: row.slug }, { $set: { name: next, displayName: next } });
  }

  const slugs = actionable.map((row) => row.slug);
  const fresh = await ResearchEntity.find({ slug: { $in: slugs } }).lean();
  result.entitiesUpdated = fresh.filter((entity) => {
    const row = actionable.find((candidate) => candidate.slug === (entity as any).slug);
    return row ? String((entity as any).name).trim() !== row.storedName : false;
  }).length;
  await syncEntities('researchEntity', fresh as never[]);
  result.synced = fresh.length;
  return result;
}

async function main(): Promise<void> {
  const options = parseLinkChromeNameArgs(process.argv.slice(2));
  const apply = !options.dryRun;
  if (apply && !options.confirm) {
    throw new Error(`${SCRIPT_NAME} apply mode requires --confirm-link-chrome-names.`);
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
    const result = await runLinkChromeNameRepair({ dryRun: options.dryRun });
    if (options.output) {
      const safeOutput = resolveSafeJsonReportOutputPath(options.output);
      fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
      fs.writeFileSync(
        safeOutput,
        `${JSON.stringify({ generatedAt: new Date().toISOString(), environment: guard.environment, ...result }, null, 2)}\n`,
      );
      console.log(`Saved link-chrome name repair report to ${safeOutput}`);
    }
    console.log(JSON.stringify({ ...result, rows: undefined }, null, 2));
    if (apply && result.summary.withdraw > 0) {
      console.log(
        `${result.summary.withdraw} rows had their name withdrawn and now serve a fallback. Run lab-microsite-description-llm over them to adopt the name their own site gives, which is what the withdrawn label was pointing at.`,
      );
    }
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

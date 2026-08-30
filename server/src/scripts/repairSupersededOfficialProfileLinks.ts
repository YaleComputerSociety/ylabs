import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { Observation } from '../models/observation';
import { Researcher } from '../models/researcher';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import { sanitizeLogValue } from '../utils/logSanitizer';
import {
  canonicalOfficialProfileUrlKey,
  planSupersededOfficialProfileLinkRepair,
  summarizeSupersededOfficialProfileLinkRepair,
  type SupersededOfficialProfileLinkPlanRow,
  type SupersededOfficialProfileLinkSummary,
} from './repairSupersededOfficialProfileLinksCore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export interface RepairSupersededOfficialProfileLinksOptions {
  apply: boolean;
  confirm: boolean;
  limit: number;
  explicitLimit: boolean;
  output?: string;
}

function parsePositiveInt(value: string | undefined): number {
  if (!value || value.startsWith('--') || !/^[1-9]\d*$/.test(value)) {
    throw new Error('--limit must be a positive integer');
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error('--limit must be a positive integer');
  return parsed;
}

export function parseRepairSupersededOfficialProfileLinksArgs(
  argv: string[],
): RepairSupersededOfficialProfileLinksOptions {
  const options: RepairSupersededOfficialProfileLinksOptions = {
    apply: false,
    confirm: false,
    limit: 0,
    explicitLimit: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') continue;
    if (arg === '--apply') options.apply = true;
    else if (arg === '--dry-run') options.apply = false;
    else if (arg === '--confirm-superseded-profile-link-repair') options.confirm = true;
    else if (arg.startsWith('--limit=')) {
      options.limit = parsePositiveInt(arg.slice('--limit='.length));
      options.explicitLimit = true;
    } else if (arg === '--limit') {
      options.limit = parsePositiveInt(argv[i + 1]);
      options.explicitLimit = true;
      i += 1;
    } else if (arg === '--output') {
      options.output = resolveSafeJsonReportOutputPath(argv[i + 1]);
      i += 1;
    } else if (arg.startsWith('--output=')) {
      options.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
    } else {
      throw new Error(`Unknown repair-superseded-official-profile-links argument: ${arg}`);
    }
  }
  return options;
}

export function assertRepairSupersededOfficialProfileLinksApplyAllowed(
  options: Pick<RepairSupersededOfficialProfileLinksOptions, 'apply' | 'confirm' | 'explicitLimit'>,
): void {
  if (!options.apply) return;
  if (!options.confirm) {
    throw new Error('Apply mode requires --confirm-superseded-profile-link-repair.');
  }
  if (!options.explicitLimit) {
    throw new Error('Apply mode requires an explicit --limit.');
  }
}

export interface RepairSupersededOfficialProfileLinksResult extends SupersededOfficialProfileLinkSummary {
  mode: 'dry-run' | 'apply';
  updated: number;
  rows: SupersededOfficialProfileLinkPlanRow[];
}

async function observedProfileUrlKeys(): Promise<Set<string>> {
  const keys = new Set<string>();
  const cursor = Observation.find({ entityType: 'user', field: 'profileUrls' })
    .select('value')
    .lean()
    .cursor();
  for await (const observation of cursor) {
    const value = (observation as { value?: unknown }).value;
    if (!value || typeof value !== 'object') continue;
    for (const candidate of Object.values(value as Record<string, unknown>)) {
      const key = canonicalOfficialProfileUrlKey(candidate);
      if (key) keys.add(key);
    }
  }
  return keys;
}

export async function runRepairSupersededOfficialProfileLinks(options: {
  apply: boolean;
  limit?: number;
}): Promise<RepairSupersededOfficialProfileLinksResult> {
  const observedKeys = await observedProfileUrlKeys();
  const candidates = await Researcher.find({
    archived: { $ne: true },
    profileLinks: { $elemMatch: { kind: 'YALE_OFFICIAL' } },
  })
    .select('_id displayName profileLinks')
    .lean();

  const rows: SupersededOfficialProfileLinkPlanRow[] = [];
  for (const candidate of candidates) {
    const row = planSupersededOfficialProfileLinkRepair(
      {
        id: String(candidate._id),
        displayName: (candidate as { displayName?: string }).displayName,
        profileLinks: (candidate as { profileLinks?: unknown }).profileLinks,
      },
      observedKeys,
    );
    if (row) rows.push(row);
  }

  const selected = options.limit ? rows.slice(0, options.limit) : rows;
  let updated = 0;
  if (options.apply) {
    const verifiedAt = new Date();
    for (const row of selected) {
      const result = await Researcher.updateOne(
        { _id: row.id },
        {
          $set: {
            'profileLinks.$[stale].url': row.after,
            'profileLinks.$[stale].verifiedAt': verifiedAt,
            'profileLinks.$[stale].healthStatus': 'UNKNOWN',
          },
        },
        { arrayFilters: [{ 'stale.kind': 'YALE_OFFICIAL', 'stale.url': row.before }] },
      );
      updated += result.modifiedCount || 0;
    }
  }

  return {
    ...summarizeSupersededOfficialProfileLinkRepair(candidates.length, rows),
    mode: options.apply ? 'apply' : 'dry-run',
    updated,
    rows: selected,
  };
}

async function main(): Promise<void> {
  const options = parseRepairSupersededOfficialProfileLinksArgs(process.argv.slice(2));
  assertRepairSupersededOfficialProfileLinksApplyAllowed(options);

  const guard = assertScriptApplyAllowed({
    apply: options.apply,
    scriptName: 'repair:superseded-official-profile-links',
    mongoUrl: process.env.MONGODBURL,
  });
  console.log(
    `Environment: ${guard.environment}; Mongo target: ${guard.dbLabel}; mode: ${
      options.apply ? 'apply' : 'dry-run'
    }`,
  );

  await mongoose.connect(process.env.MONGODBURL as string);
  try {
    const result = await runRepairSupersededOfficialProfileLinks({
      apply: options.apply,
      limit: options.explicitLimit ? options.limit : undefined,
    });
    const payload = {
      generatedAt: new Date().toISOString(),
      environment: guard.environment,
      db: guard.dbLabel,
      options: { apply: options.apply, limit: options.explicitLimit ? options.limit : undefined },
      result,
    };
    if (options.output) {
      const safeOutput = resolveSafeJsonReportOutputPath(options.output);
      fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
      fs.writeFileSync(safeOutput, `${JSON.stringify(payload, null, 2)}\n`);
      console.log(`Saved repair report to ${safeOutput}`);
    }
    console.log(JSON.stringify({ ...result, rows: result.rows.length }, null, 2));
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

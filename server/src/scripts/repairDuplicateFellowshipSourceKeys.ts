import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { Fellowship } from '../models/fellowship';
import { mongoOptions } from '../db/connections';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import { sanitizeLogValue } from '../utils/logSanitizer';
import {
  planDuplicateFellowshipSourceKeyRetirements,
  retiredFellowshipIds,
  type FellowshipSourceKeyPlan,
  type FellowshipSourceKeyRow,
} from './repairDuplicateFellowshipSourceKeysCore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export interface RepairDuplicateFellowshipSourceKeysOptions {
  apply: boolean;
  confirm: boolean;
  output?: string;
}

export function parseRepairDuplicateFellowshipSourceKeysArgs(
  argv: string[],
): RepairDuplicateFellowshipSourceKeysOptions {
  const options: RepairDuplicateFellowshipSourceKeysOptions = { apply: false, confirm: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') continue;
    if (arg === '--apply') options.apply = true;
    else if (arg === '--dry-run') options.apply = false;
    else if (arg === '--confirm-duplicate-source-key-retirement') options.confirm = true;
    else if (arg === '--output') {
      options.output = resolveSafeJsonReportOutputPath(argv[i + 1]);
      i += 1;
    } else if (arg.startsWith('--output=')) {
      options.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
    } else {
      throw new Error(`Unknown fellowships:repair-duplicate-source-keys argument: ${arg}`);
    }
  }
  return options;
}

export function assertRepairDuplicateFellowshipSourceKeysApplyAllowed(
  options: Pick<RepairDuplicateFellowshipSourceKeysOptions, 'apply' | 'confirm'>,
): void {
  if (!options.apply) return;
  if (!options.confirm) {
    throw new Error('Apply mode requires --confirm-duplicate-source-key-retirement.');
  }
}

export interface RepairDuplicateFellowshipSourceKeysResult {
  mode: 'dry-run' | 'apply';
  rowsWithStringSourceKey: number;
  plan: FellowshipSourceKeyPlan;
  retired: number;
}

export async function runRepairDuplicateFellowshipSourceKeys(options: {
  apply: boolean;
}): Promise<RepairDuplicateFellowshipSourceKeysResult> {
  const docs = (await Fellowship.find({ sourceKey: { $type: 'string' } })
    .select('_id sourceKey title archived')
    .lean()) as Array<{ _id: unknown; sourceKey?: string; title?: string; archived?: boolean }>;
  const rows: FellowshipSourceKeyRow[] = docs.map((doc) => ({
    id: String(doc._id),
    sourceKey: String(doc.sourceKey ?? ''),
    title: doc.title,
    archived: doc.archived,
  }));
  const plan = planDuplicateFellowshipSourceKeyRetirements(rows);

  let retired = 0;
  if (options.apply) {
    const ids = retiredFellowshipIds(plan);
    for (const id of ids) {
      const result = await Fellowship.updateOne({ _id: id }, { $unset: { sourceKey: '' } });
      retired += result.modifiedCount || 0;
    }
  }

  return {
    mode: options.apply ? 'apply' : 'dry-run',
    rowsWithStringSourceKey: rows.length,
    plan,
    retired,
  };
}

async function main(): Promise<void> {
  const options = parseRepairDuplicateFellowshipSourceKeysArgs(process.argv.slice(2));
  assertRepairDuplicateFellowshipSourceKeysApplyAllowed(options);

  const guard = assertScriptApplyAllowed({
    apply: options.apply,
    scriptName: 'fellowships:repair-duplicate-source-keys',
    mongoUrl: process.env.MONGODBURL,
  });
  console.log(
    `Environment: ${guard.environment}; Mongo target: ${guard.dbLabel}; mode: ${
      options.apply ? 'apply' : 'dry-run'
    }`,
  );

  await mongoose.connect(process.env.MONGODBURL as string, mongoOptions);
  try {
    const result = await runRepairDuplicateFellowshipSourceKeys({ apply: options.apply });
    const payload = {
      generatedAt: new Date().toISOString(),
      environment: guard.environment,
      db: guard.dbLabel,
      result,
    };
    if (options.output) {
      fs.mkdirSync(path.dirname(options.output), { recursive: true });
      fs.writeFileSync(options.output, `${JSON.stringify(payload, null, 2)}\n`);
      console.log(`Saved retirement report to ${options.output}`);
    }
    console.log(JSON.stringify(payload, null, 2));
    if (result.plan.refusals.length > 0) {
      throw new Error(
        `${result.plan.refusals.length} duplicate sourceKey group(s) were refused because no ` +
          'single live row decides them. The unique index cannot build until each is resolved by ' +
          'a reviewed judgement.',
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

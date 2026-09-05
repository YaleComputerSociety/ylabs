import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { OrgUnit } from '../models/orgUnit';
import { resetOrgUnitCanonicalizerCache } from '../scrapers/orgUnitCanonicalization';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  planOrgUnitCatalogGapSeed,
  summarizeOrgUnitSeedPlan,
  type ExistingOrgUnitRow,
  type OrgUnitSeedPlan,
} from './seedOrgUnitCatalogGapsCore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export interface OrgUnitSeedCliOptions {
  dryRun: boolean;
  confirmOrgUnitSeed: boolean;
  output?: string;
}

export function parseOrgUnitSeedArgs(argv: string[]): OrgUnitSeedCliOptions {
  const options: OrgUnitSeedCliOptions = { dryRun: true, confirmOrgUnitSeed: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply' || arg === '--mode=apply') {
      options.dryRun = false;
    } else if (arg === '--dry-run' || arg === '--mode=dry-run') {
      options.dryRun = true;
    } else if (arg === '--confirm-org-unit-seed') {
      options.confirmOrgUnitSeed = true;
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

export async function runOrgUnitCatalogGapSeed(options: { dryRun: boolean }): Promise<{
  mode: 'dry-run' | 'apply';
  plan: OrgUnitSeedPlan;
  summary: ReturnType<typeof summarizeOrgUnitSeedPlan>;
}> {
  const existingDocs = await OrgUnit.find({ archived: { $ne: true } })
    .select('_id name slug kind aliases')
    .lean<
      {
        _id: unknown;
        name: string;
        slug: string;
        kind: ExistingOrgUnitRow['kind'];
        aliases?: string[];
      }[]
    >();
  const existing: ExistingOrgUnitRow[] = existingDocs.map((doc) => ({
    id: String(doc._id),
    name: doc.name,
    slug: doc.slug,
    kind: doc.kind,
    aliases: doc.aliases,
  }));

  const plan = planOrgUnitCatalogGapSeed(existing);

  if (!options.dryRun) {
    for (const row of plan.rows) {
      if (row.action === 'add-aliases') {
        await OrgUnit.updateOne({ _id: row.targetId }, { $set: { aliases: row.aliases } });
        continue;
      }
      await OrgUnit.create({
        name: row.name,
        slug: row.slug,
        kind: 'DEPARTMENT',
        aliases: row.aliases,
        parentOrgUnitId: row.parentId,
        status: 'ACTIVE',
      });
    }
    resetOrgUnitCanonicalizerCache();
  }

  return {
    mode: options.dryRun ? 'dry-run' : 'apply',
    plan,
    summary: summarizeOrgUnitSeedPlan(plan),
  };
}

async function main(): Promise<void> {
  const options = parseOrgUnitSeedArgs(process.argv.slice(2));
  const apply = !options.dryRun;

  if (apply && !options.confirmOrgUnitSeed) {
    throw new Error('Apply mode requires --confirm-org-unit-seed.');
  }

  const guard = assertScriptApplyAllowed({
    apply,
    scriptName: 'org-unit catalog gap seed',
    mongoUrl: process.env.MONGODBURL,
  });
  console.log(
    `Environment: ${guard.environment}; Mongo target: ${guard.dbLabel}; mode: ${apply ? 'apply' : 'dry-run'}`,
  );

  await initializeConnections();
  try {
    const result = await runOrgUnitCatalogGapSeed({ dryRun: options.dryRun });
    if (options.output) {
      const safeOutput = resolveSafeJsonReportOutputPath(options.output);
      fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
      fs.writeFileSync(
        safeOutput,
        JSON.stringify(
          { generatedAt: new Date().toISOString(), environment: guard.environment, ...result },
          null,
          2,
        ),
      );
      console.log(`Saved org-unit catalog seed report to ${safeOutput}`);
    }
    console.log(JSON.stringify(result, null, 2));
    if (apply && result.summary.created + result.summary.aliasUpdates > 0) {
      console.log(
        'Run research-homes:backfill-org-units next so live entities pick up the new catalog rows.',
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

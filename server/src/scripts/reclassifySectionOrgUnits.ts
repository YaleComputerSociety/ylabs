import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { OrgUnit, type OrgUnitKind } from '../models/orgUnit';
import { resetOrgUnitCanonicalizerCache } from '../scrapers/orgUnitCanonicalization';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  planSectionReclassification,
  type SectionReclassificationPlan,
} from './reclassifySectionOrgUnitsCore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export const CONFIRM_SECTION_RECLASSIFY_FLAG = '--confirm-section-reclassify';

export interface SectionReclassifyCliOptions {
  dryRun: boolean;
  confirmed: boolean;
  output?: string;
}

export function parseSectionReclassifyArgs(argv: string[]): SectionReclassifyCliOptions {
  const options: SectionReclassifyCliOptions = { dryRun: true, confirmed: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') {
      options.dryRun = false;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === CONFIRM_SECTION_RECLASSIFY_FLAG) {
      options.confirmed = true;
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

interface OrgUnitRow {
  _id: unknown;
  name: string;
  slug: string;
  kind: OrgUnitKind;
  parentOrgUnitId?: unknown;
}

export async function runSectionReclassification(options: {
  dryRun: boolean;
}): Promise<{ mode: 'dry-run' | 'apply'; plan: SectionReclassificationPlan }> {
  const rows = await OrgUnit.find({ archived: { $ne: true } })
    .select('_id name slug kind parentOrgUnitId')
    .lean<OrgUnitRow[]>();

  const plan = planSectionReclassification(
    rows.map((row) => ({
      id: String(row._id),
      name: row.name,
      slug: row.slug,
      kind: row.kind,
      ...(row.parentOrgUnitId ? { parentOrgUnitId: String(row.parentOrgUnitId) } : {}),
    })),
  );

  if (!options.dryRun && plan.reclassified.length > 0) {
    await OrgUnit.bulkWrite(
      plan.reclassified.map((row) => ({
        updateOne: { filter: { _id: row.id }, update: { $set: { kind: 'SECTION' } } },
      })),
    );
    resetOrgUnitCanonicalizerCache();
  }

  return { mode: options.dryRun ? 'dry-run' : 'apply', plan };
}

async function main(): Promise<void> {
  const options = parseSectionReclassifyArgs(process.argv.slice(2));
  const apply = !options.dryRun;

  if (apply && !options.confirmed) {
    throw new Error(`Apply mode requires ${CONFIRM_SECTION_RECLASSIFY_FLAG}.`);
  }

  const guard = assertScriptApplyAllowed({
    apply,
    scriptName: 'org-unit section reclassification',
    mongoUrl: process.env.MONGODBURL,
  });
  console.log(
    `Environment: ${guard.environment}; Mongo target: ${guard.dbLabel}; mode: ${apply ? 'apply' : 'dry-run'}`,
  );

  await initializeConnections();
  try {
    const result = await runSectionReclassification({ dryRun: options.dryRun });
    const payload = {
      generatedAt: new Date().toISOString(),
      environment: guard.environment,
      db: guard.dbLabel,
      result,
    };
    if (options.output) {
      const safeOutput = resolveSafeJsonReportOutputPath(options.output);
      fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
      fs.writeFileSync(safeOutput, JSON.stringify(payload, null, 2));
      console.log(`Saved section reclassification report to ${safeOutput}`);
    }
    console.log(
      JSON.stringify(
        {
          mode: result.mode,
          scanned: result.plan.scanned,
          toReclassify: result.plan.reclassified.length,
          alreadySection: result.plan.alreadySection,
          cycles: result.plan.cycles,
          rows: result.plan.reclassified.map(
            (row) => `${row.name} -> SECTION of ${row.parentName}`,
          ),
        },
        null,
        2,
      ),
    );
    if (apply && result.plan.reclassified.length > 0) {
      console.log(
        'Run research-homes:backfill-org-units next so served departments[] pick up the rolled-up parent department.',
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

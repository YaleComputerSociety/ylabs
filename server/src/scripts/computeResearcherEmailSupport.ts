/**
 * Computes `identifiers.emailSupport` for every live researcher holding a stored email, from
 * that researcher's own evidence (#5627). The user materializer recomputes the marker only for
 * a researcher some `user` key reaches, so a researcher no key reaches would otherwise never
 * carry one and no coverage count could ever read complete.
 *
 * Dry-run by default. `--apply` writes only a marker whose value changed, so a settled corpus
 * plans nothing. It is a manual step of the routine Development maintenance pass, run in the
 * same operation as the materialize (`docs/release-process.md`); a sweep stage waits on #5713.
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { Researcher, type ResearcherEmailSupport } from '../models/researcher';
import { researcherEmailSupport, sameResearcherEmailSupport } from '../scrapers/entityMaterializer';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

export const SCRIPT_NAME = 'researchers:compute-email-support';
export const CONFIRM_FLAG = '--confirm-compute-email-support';

export interface ComputeResearcherEmailSupportArgs {
  dryRun: boolean;
  confirmed: boolean;
  output?: string;
}

export function parseComputeResearcherEmailSupportArgs(
  argv: string[],
): ComputeResearcherEmailSupportArgs {
  const options: ComputeResearcherEmailSupportArgs = { dryRun: true, confirmed: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') continue;
    else if (arg === '--apply') options.dryRun = false;
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

export interface ResearcherEmailSupportPassReport {
  researchersScanned: number;
  supported: number;
  unsupported: number;
  cleared: number;
  planned: number;
  applied: number | null;
  staleSkipped: number | null;
}

/**
 * The `identifiers.email` filter on the write makes a researcher whose address changed after
 * the read a skip rather than a marker for the wrong address.
 */
export async function runResearcherEmailSupportPass(
  options: { apply: boolean } = { apply: false },
): Promise<ResearcherEmailSupportPassReport> {
  const researchers = (await Researcher.find({
    archived: { $ne: true },
    $or: [
      { 'identifiers.email': { $nin: [null, ''] } },
      { 'identifiers.emailSupport': { $exists: true } },
    ],
  })
    .select('_id identifiers.email identifiers.emailSupport')
    .sort({ _id: 1 })
    .lean()) as Array<{
    _id: mongoose.Types.ObjectId;
    identifiers?: { email?: string; emailSupport?: ResearcherEmailSupport };
  }>;
  const report: ResearcherEmailSupportPassReport = {
    researchersScanned: researchers.length,
    supported: 0,
    unsupported: 0,
    cleared: 0,
    planned: 0,
    applied: options.apply ? 0 : null,
    staleSkipped: options.apply ? 0 : null,
  };
  for (const researcher of researchers) {
    const computed = await researcherEmailSupport(researcher);
    if (computed?.supported) report.supported += 1;
    else if (computed) report.unsupported += 1;
    if (sameResearcherEmailSupport(researcher.identifiers?.emailSupport, computed)) continue;
    report.planned += 1;
    if (!computed) report.cleared += 1;
    if (!options.apply) continue;
    const result = await Researcher.updateOne(
      { _id: researcher._id, 'identifiers.email': researcher.identifiers?.email ?? null },
      computed
        ? { $set: { 'identifiers.emailSupport': computed } }
        : { $unset: { 'identifiers.emailSupport': 1 } },
      { timestamps: false },
    );
    if (result.matchedCount === 0) report.staleSkipped = (report.staleSkipped ?? 0) + 1;
    else report.applied = (report.applied ?? 0) + result.modifiedCount;
  }
  return report;
}

async function main(): Promise<void> {
  const options = parseComputeResearcherEmailSupportArgs(process.argv.slice(2));
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
  const report = {
    script: SCRIPT_NAME,
    mode: options.dryRun ? 'dry-run' : 'apply',
    ...(await runResearcherEmailSupportPass({ apply: !options.dryRun })),
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

import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { probeSourceLink } from '../services/sourceLinkHealth';
import {
  applyStudentVisibilityGatePlans,
  planStudentVisibilityGate,
} from '../services/studentVisibilityGateService';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  PROMOTION_REGRESSED_WEBSITE_URL_DECISIONS,
  planWebsiteUrlRepair,
  summarizeWebsiteUrlRepairPlans,
  type WebsiteUrlRepairEntity,
  type WebsiteUrlRepairPlan,
} from './repairPromotionRegressedWebsiteUrlsCore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const SCRIPT_NAME = 'repair-promotion-regressed-website-urls';

export interface RepairPromotionRegressedWebsiteUrlsOptions {
  apply: boolean;
  confirm: boolean;
  output?: string;
}

export function parseRepairPromotionRegressedWebsiteUrlsArgs(
  argv: string[],
): RepairPromotionRegressedWebsiteUrlsOptions {
  const options: RepairPromotionRegressedWebsiteUrlsOptions = { apply: false, confirm: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') continue;
    if (arg === '--apply') options.apply = true;
    else if (arg === '--dry-run') options.apply = false;
    else if (arg === '--confirm-website-url-repair') options.confirm = true;
    else if (arg === '--output') {
      options.output = resolveSafeJsonReportOutputPath(argv[i + 1]);
      i += 1;
    } else if (arg.startsWith('--output=')) {
      options.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
    } else {
      throw new Error(`Unknown ${SCRIPT_NAME} argument: ${arg}`);
    }
  }
  return options;
}

/**
 * Reachability is probed live on every run, never read from the stored
 * `sourceLinkHealth`. One of these three rows records its dead host as `UNKNOWN`
 * rather than `UNAVAILABLE` because a DNS failure is misreported as a private
 * address (#2555), so a repair keyed on the stored verdict would silently skip it.
 */
async function probeReachability(urls: readonly string[]): Promise<Map<string, boolean>> {
  const reachability = new Map<string, boolean>();
  for (const url of urls) {
    if (reachability.has(url)) continue;
    const { status } = await probeSourceLink(url);
    reachability.set(url, typeof status === 'number' && status >= 200 && status < 400);
  }
  return reachability;
}

export async function runRepairPromotionRegressedWebsiteUrls(
  options: RepairPromotionRegressedWebsiteUrlsOptions,
): Promise<{ plans: WebsiteUrlRepairPlan[]; applied: boolean }> {
  const slugs = PROMOTION_REGRESSED_WEBSITE_URL_DECISIONS.map((decision) => decision.slug);
  const entities = await ResearchEntity.find({ slug: { $in: slugs } })
    .select('slug websiteUrl sourceUrls manuallyLockedFields')
    .lean<(WebsiteUrlRepairEntity & { _id: mongoose.Types.ObjectId })[]>();
  const bySlug = new Map(entities.map((entity) => [entity.slug, entity]));

  const probeTargets = PROMOTION_REGRESSED_WEBSITE_URL_DECISIONS.flatMap((decision) =>
    decision.action === 'restore' && decision.intendedWebsiteUrl
      ? [decision.intendedWebsiteUrl]
      : [decision.expectedCurrentWebsiteUrl],
  );
  const reachability = await probeReachability(probeTargets);

  const plans = PROMOTION_REGRESSED_WEBSITE_URL_DECISIONS.map((decision) =>
    planWebsiteUrlRepair(decision, bySlug.get(decision.slug), (url) => ({
      reachable: reachability.get(url) === true,
    })),
  );

  if (!options.apply) return { plans, applied: false };

  const regateIds: string[] = [];
  for (const plan of plans) {
    if (plan.skipped || plan.nextWebsiteUrl === undefined) continue;
    const entity = bySlug.get(plan.slug);
    if (!entity) continue;
    await ResearchEntity.updateOne(
      { _id: entity._id, websiteUrl: plan.currentWebsiteUrl },
      plan.nextWebsiteUrl === ''
        ? { $unset: { websiteUrl: '' } }
        : { $set: { websiteUrl: plan.nextWebsiteUrl } },
    );
    if (plan.requiresVisibilityRegate) regateIds.push(String(entity._id));
  }

  // Clearing a served field changes what the gate had to work with, so the row
  // has to be re-decided rather than left student_ready on withdrawn evidence.
  if (regateIds.length > 0) {
    const gatePlans = await planStudentVisibilityGate({
      collection: 'research',
      mode: 'apply',
      recordIds: regateIds,
    });
    await applyStudentVisibilityGatePlans(gatePlans);
  }

  return { plans, applied: true };
}

async function main(): Promise<void> {
  const options = parseRepairPromotionRegressedWebsiteUrlsArgs(process.argv.slice(2));
  assertScriptApplyAllowed({
    apply: options.apply,
    scriptName: SCRIPT_NAME,
    mongoUrl: process.env.MONGODBURL,
  });
  if (options.apply && !options.confirm) {
    throw new Error(
      `${SCRIPT_NAME} --apply requires --confirm-website-url-repair; it mutates a served websiteUrl.`,
    );
  }
  await initializeConnections();
  try {
    const { plans, applied } = await runRepairPromotionRegressedWebsiteUrls(options);
    const summary = summarizeWebsiteUrlRepairPlans(plans);
    console.log(`${SCRIPT_NAME}: ${applied ? 'APPLIED' : 'DRY RUN'}`);
    for (const plan of plans) {
      const outcome = plan.skipped
        ? `SKIP (${plan.skipped})`
        : plan.nextWebsiteUrl === ''
          ? 'CLEAR'
          : `RESTORE -> ${plan.nextWebsiteUrl}`;
      console.log(`  ${plan.slug}\n     from ${plan.currentWebsiteUrl ?? '(none)'}\n     ${outcome}`);
    }
    console.log(`\n${JSON.stringify(summary)}`);
    if (summary.regateSlugs.length > 0) {
      console.log(
        `Re-gated after clearing: ${summary.regateSlugs.join(', ')}${applied ? '' : ' (would re-gate on --apply)'}`,
      );
    }
    if (options.output) {
      const safeOutput = resolveSafeJsonReportOutputPath(options.output);
      fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
      fs.writeFileSync(
        safeOutput,
        JSON.stringify({ generatedAt: new Date().toISOString(), applied, summary, plans }, null, 2),
      );
      console.log(`Saved report to ${safeOutput}`);
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

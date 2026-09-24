import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { getResearchGroupDetail } from '../services/researchGroupService';
import { isKnownDeadSourceUrl } from '../services/sourceLinkHealth';
import {
  applyStudentVisibilityGatePlans,
  planStudentVisibilityGate,
} from '../services/studentVisibilityGateService';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  normalizeWebsiteUrl,
  planDeadResearchWebsiteClears,
  reportDeadWebsiteRefusals,
  type DeadWebsiteRow,
} from './clearDeadResearchWebsitesCore';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const SCRIPT_NAME = 'research-entity:clear-dead-research-websites';
export const CONFIRM_FLAG = '--confirm-clear-dead-research-websites';
const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

export function parseClearDeadWebsiteArgs(argv: string[]): {
  dryRun: boolean;
  confirmed: boolean;
  output?: string;
} {
  const options = { dryRun: true, confirmed: false } as {
    dryRun: boolean;
    confirmed: boolean;
    output?: string;
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

interface Served {
  slug: string;
  resolved: boolean;
  tier: string;
  websitePresent: boolean;
  cardPresent: boolean;
  departments: number;
  liveCitations: number;
}

async function readServed(slugs: readonly string[]): Promise<Served[]> {
  const tiers = new Map<string, string>();
  const docs = (await ResearchEntity.find({ slug: { $in: [...slugs] } })
    .select('slug studentVisibilityTier sourceLinkHealth')
    .lean()) as unknown as Array<Record<string, any>>;
  for (const doc of docs) tiers.set(String(doc.slug), text(doc.studentVisibilityTier));

  const out: Served[] = [];
  for (const slug of slugs) {
    let detail: Awaited<ReturnType<typeof getResearchGroupDetail>> | null = null;
    try {
      detail = await getResearchGroupDetail(slug);
    } catch {
      detail = null;
    }
    const entity = (detail?.researchEntity ?? {}) as Record<string, any>;
    out.push({
      slug,
      resolved: Boolean(detail),
      tier: tiers.get(slug) ?? '',
      websitePresent: Boolean(text(entity.websiteUrl) || text(entity.website)),
      cardPresent: Boolean(text(entity.shortDescription)),
      departments: Array.isArray(entity.departments) ? entity.departments.length : 0,
      liveCitations: Array.isArray(entity.sourceUrls) ? entity.sourceUrls.length : 0,
    });
  }
  return out;
}

async function main(): Promise<void> {
  const options = parseClearDeadWebsiteArgs(process.argv.slice(2));
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

  const all = (await ResearchEntity.find({ archived: { $ne: true } })
    .select(
      'slug name displayName entityType websiteUrl website sourceLinkHealth sourceUrls studentVisibilityTier manuallyLockedFields',
    )
    .lean()) as unknown as Array<Record<string, any>>;

  const ownerCount = new Map<string, number>();
  for (const row of all) {
    for (const url of [text(row.websiteUrl), text(row.website)]) {
      if (!url) continue;
      const key = normalizeWebsiteUrl(url);
      ownerCount.set(key, (ownerCount.get(key) ?? 0) + 1);
    }
  }

  const served = all.filter((row) => text(row.studentVisibilityTier) === 'student_ready');
  const outcome = planDeadResearchWebsiteClears(
    served as DeadWebsiteRow[],
    (row, url) =>
      isKnownDeadSourceUrl((row as unknown as Record<string, unknown>).sourceLinkHealth, url),
    (row) => {
      const record = row as unknown as Record<string, any>;
      const health = record.sourceLinkHealth;
      const urls = Array.isArray(record.sourceUrls) ? record.sourceUrls : [];
      return urls
        .map((entry: any) => text(typeof entry === 'string' ? entry : entry?.url))
        .filter((url: string) => url && !isKnownDeadSourceUrl(health, url)).length;
    },
    (key) => ownerCount.get(key) ?? 0,
  );

  // A scheduled job that dies without a report is the failure shape this pass must not
  // have: an unreported death is indistinguishable from a run that found nothing to do.
  // Every exit writes a report, and `completed` plus `stoppedAfter` say whether it is the
  // whole story (#3309, #3303).
  let stoppedAfter = 'planned';
  let completed = false;

  const slugs = outcome.plans.map((plan) => plan.slug);
  const before = await readServed(slugs);
  let cleared = 0;
  let gateChangedSlugs: string[] = [];
  let after: Served[] = [];
  let collateral: Served[] = [];

  const writeReport = (): void => {
    const report = {
      script: SCRIPT_NAME,
      mode: options.dryRun ? 'dry-run' : 'apply',
      completed,
      stoppedAfter,
      servedRowsScanned: served.length,
      plannedClears: outcome.plans.length,
      ...reportDeadWebsiteRefusals(outcome.refused),
      cleared,
      gateChangedRows: gateChangedSlugs.length,
      demotedRepairedRows: after.filter(
        (row, index) =>
          before[index] && before[index].tier === 'student_ready' && row.tier !== 'student_ready',
      ).length,
      repairedRowsStillServing: after.filter((row) => row.resolved).length,
      collateralRowsChanged: after.length > 0 ? collateral.length : null,
      collateralNowServing:
        after.length > 0 ? collateral.filter((row) => row.resolved).length : null,
      servedBefore: before,
      servedAfter: after,
      collateral,
    };
    console.log(JSON.stringify(report, null, 2));
    if (options.output) {
      fs.mkdirSync(path.dirname(options.output), { recursive: true });
      fs.writeFileSync(options.output, `${JSON.stringify(report, null, 2)}\n`);
      console.log(`\nReport written to ${options.output}`);
    }
  };

  try {
    if (!options.dryRun && outcome.plans.length > 0) {
      for (const plan of outcome.plans) {
        // Cleared, never locked. #3191 measured a repair that froze a cleared field whose
        // value was correct and withheld working research links, so the field stays open
        // for a later source to fill.
        const result = await ResearchEntity.updateOne(
          { slug: plan.slug },
          { $set: { [plan.field]: '' } },
        );
        cleared += result.modifiedCount || 0;
        stoppedAfter = 'clearing';
      }

      // The ordinary gate decides the tier. Stamping one would be the failure this repair
      // exists to avoid: `studentVisibilityTier` is stored, so a cleared gate input only
      // decides what the NEXT evaluation computes.
      const plans = await planStudentVisibilityGate({ collection: 'research', mode: 'apply' });
      // `currentTier` and `recordId`, never `previousTier` or `slug`. A plan carries no such
      // keys, so reading them compared undefined with undefined and reported that nothing
      // moved, which is indistinguishable from a repair with no collateral. The label is the
      // row's key, so the collateral read below can resolve it.
      const changed = plans.filter((plan) => text(plan.tier) !== text(plan.currentTier));
      const changedIds = changed.map((plan) => text(plan.recordId)).filter(Boolean);
      gateChangedSlugs = (
        (await ResearchEntity.find({
          _id: {
            $in: changedIds
              .filter((id) => mongoose.isValidObjectId(id))
              .map((id) => new mongoose.Types.ObjectId(id)),
          },
        })
          .select('slug')
          .lean()) as unknown as Array<Record<string, unknown>>
      )
        .map((doc) => text(doc.slug))
        .filter(Boolean);
      await applyStudentVisibilityGatePlans(plans);

      after = await readServed(slugs);
      // Read every row whose standing changed, not only the repaired side: a pass that
      // read only what it touched cleared ten borrowed urls and published three grafted
      // rows (#2583).
      stoppedAfter = 'regated';
      collateral = await readServed(gateChangedSlugs.filter((slug) => !slugs.includes(slug)));
      stoppedAfter = 'read-back';
    }
    completed = true;
  } finally {
    writeReport();
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

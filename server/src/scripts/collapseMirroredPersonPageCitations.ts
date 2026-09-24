/**
 * research-entity:collapse-citation-mirrors - drops the redundant spellings of a citation
 * that names one person's page more than once on one host (#3240).
 *
 * `research-entity:audit-citation-mirrors` measures the shape; this collapses it. The
 * serve-time half already renders the group as one source row, so this changes nothing a
 * student reads: it removes the redundancy from the corpus, where it otherwise makes a
 * link-health re-probe pay twice for one fetch and lets any predicate weaker than the
 * mirror key surface the duplicate again.
 *
 * A collapse is a narrowing, so two things travel with it rather than after it. Measured on
 * Development, 95 `fieldProvenance` entries cite a spelling this drops, and dropping the
 * citation while leaving the provenance pointing at it would strand the row's evidence the
 * way #2525 stranded `sourceUrls` after repairing `profileLinks`; each is repointed to the
 * surviving spelling in the same update. A `sourceLinkHealth` entry for a dropped spelling
 * is removed too, so nothing records health for a URL the row no longer cites, and the
 * surviving spelling is left for the existing `source-link-health` stage to probe: a verdict
 * for one path is not a verdict for another, even when both reach the same page.
 *
 *   yarn --cwd server research-entity:collapse-citation-mirrors
 *   yarn --cwd server research-entity:collapse-citation-mirrors --all-tiers --show-paths
 *   yarn --cwd server research-entity:collapse-citation-mirrors --apply \
 *     --confirm-citation-mirror-collapse --limit=500
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import { ResearchEntity } from '../models/researchEntity';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import { sanitizeLogValue } from '../utils/logSanitizer';
import {
  formatMirroredCitationCollapsePlan,
  planMirroredCitationCollapse,
  type MirroredCitationRow,
} from './collapseMirroredPersonPageCitationsCore';

dotenv.config();

export interface CollapseMirroredCitationsOptions {
  apply: boolean;
  confirm: boolean;
  limit: number;
  explicitLimit: boolean;
  allTiers: boolean;
  showPaths: boolean;
  output?: string;
}

function parsePositiveInt(value: string | undefined, flag: string): number {
  if (!value || value.startsWith('--') || !/^[1-9]\d*$/.test(value)) {
    throw new Error(`${flag} must be a positive integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${flag} must be a positive integer`);
  return parsed;
}

export function parseCollapseMirroredCitationsArgs(
  argv: string[],
): CollapseMirroredCitationsOptions {
  const options: CollapseMirroredCitationsOptions = {
    apply: false,
    confirm: false,
    limit: 0,
    explicitLimit: false,
    allTiers: false,
    showPaths: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') continue;
    if (arg === '--apply') options.apply = true;
    else if (arg === '--dry-run') options.apply = false;
    else if (arg === '--confirm-citation-mirror-collapse') options.confirm = true;
    else if (arg === '--all-tiers') options.allTiers = true;
    else if (arg === '--show-paths') options.showPaths = true;
    else if (arg.startsWith('--limit=')) {
      options.limit = parsePositiveInt(arg.slice('--limit='.length), '--limit');
      options.explicitLimit = true;
    } else if (arg === '--limit') {
      options.limit = parsePositiveInt(argv[i + 1], '--limit');
      options.explicitLimit = true;
      i += 1;
    } else if (arg === '--output') {
      options.output = resolveSafeJsonReportOutputPath(argv[i + 1]);
      i += 1;
    } else if (arg.startsWith('--output=')) {
      options.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
    } else {
      throw new Error(`Unknown collapse-citation-mirrors argument: ${arg}`);
    }
  }
  return options;
}

export function assertCollapseMirroredCitationsApplyAllowed(
  options: Pick<CollapseMirroredCitationsOptions, 'apply' | 'confirm' | 'explicitLimit'>,
): void {
  if (!options.apply) return;
  if (!options.confirm) {
    throw new Error('Apply mode requires --confirm-citation-mirror-collapse.');
  }
  if (!options.explicitLimit) {
    throw new Error('Apply mode requires an explicit --limit.');
  }
}

async function main(): Promise<void> {
  const options = parseCollapseMirroredCitationsArgs(process.argv.slice(2));
  assertCollapseMirroredCitationsApplyAllowed(options);

  const guard = assertScriptApplyAllowed({
    apply: options.apply,
    scriptName: 'research-entity:collapse-citation-mirrors',
    mongoUrl: process.env.MONGODBURL,
  });
  console.log(
    `Environment: ${guard.environment}; Mongo target: ${guard.dbLabel}; mode: ${
      options.apply ? 'apply' : 'dry-run'
    }`,
  );

  await mongoose.connect(process.env.MONGODBURL as string, { maxPoolSize: 5 });
  try {
    const filter = options.allTiers
      ? { archived: { $ne: true } }
      : { archived: { $ne: true }, studentVisibilityTier: 'student_ready' };
    const rows = (await ResearchEntity.find(filter)
      .select('_id slug entityType sourceUrls fieldProvenance sourceLinkHealth')
      .lean()) as unknown as MirroredCitationRow[];

    const plan = planMirroredCitationCollapse(rows);
    const collapsible = plan.rows.filter((row) => !row.refusal);
    const targets = options.explicitLimit ? collapsible.slice(0, options.limit) : collapsible;

    let rowsWritten = 0;
    let rowsAlreadyCollapsed = 0;
    if (options.apply) {
      for (const rowPlan of targets) {
        const result = await ResearchEntity.updateOne(
          { slug: rowPlan.slug },
          {
            $set: { sourceUrls: rowPlan.sourceUrls, ...rowPlan.provenanceRepoint },
            ...(rowPlan.droppedLinkHealthUrls.length
              ? { $pull: { sourceLinkHealth: { url: { $in: rowPlan.droppedLinkHealthUrls } } } }
              : {}),
          },
        );
        if (result.modifiedCount) rowsWritten += 1;
        else rowsAlreadyCollapsed += 1;
      }
    }

    console.log(formatMirroredCitationCollapsePlan(plan, options.apply ? 'apply' : 'dry-run'));
    console.log(`rows attempted:                     ${targets.length}`);
    console.log(`rows written:                       ${options.apply ? rowsWritten : 0}`);
    console.log(
      `rows already collapsed:             ${options.apply ? rowsAlreadyCollapsed : 'n/a'}`,
    );

    if (options.showPaths) {
      console.log('');
      console.log('mirror groups (paths only):');
      for (const rowPlan of plan.rows) {
        console.log(`  ${rowPlan.entityType || 'unknown'}${rowPlan.refusal ? ' REFUSED' : ''}`);
        for (const group of rowPlan.groups) {
          console.log(`    ${group.host} keep ${group.keepPath}`);
          for (const dropPath of group.dropPaths) console.log(`      drop ${dropPath}`);
        }
      }
    }

    if (options.output) {
      const safeOutput = resolveSafeJsonReportOutputPath(options.output);
      fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
      fs.writeFileSync(
        safeOutput,
        `${JSON.stringify(
          {
            generatedAt: new Date().toISOString(),
            environment: guard.environment,
            db: guard.dbLabel,
            mode: options.apply ? 'apply' : 'dry-run',
            rowsAttempted: targets.length,
            rowsWritten,
            rowsAlreadyCollapsed,
            plan,
          },
          null,
          2,
        )}\n`,
      );
      console.log(`Saved collapse report to ${safeOutput}`);
    }
  } finally {
    await mongoose.disconnect();
  }
}

const invokedDirectly = process.argv[1]?.includes('collapseMirroredPersonPageCitations');
if (invokedDirectly) {
  main().catch((error) => {
    console.error(sanitizeLogValue(error));
    process.exit(1);
  });
}

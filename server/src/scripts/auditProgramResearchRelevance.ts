/**
 * Audit (and optionally remove) programs/fellowships that are not research-related, for
 * the research-focused programs surface.
 *
 * Two removal modes, both dry-run by default:
 *  - suppress (default): `studentVisibilityOverrideTier='suppressed'` + reason. Reversible;
 *    only touches records not already operator-overridden.
 *    Apply: `--apply --confirm-remove-non-research --limit=N`
 *  - delete (`--archive`): `archived=true` (the codebase soft-delete; removes the program from
 *    every surface, recoverable by unsetting archived). Acts on ALL non-research records.
 *    Apply: `--apply --archive --confirm-delete-non-research --limit=N`
 *
 *   yarn --cwd server tsx src/scripts/auditProgramResearchRelevance.ts                 # dry-run audit
 *   yarn --cwd server tsx src/scripts/auditProgramResearchRelevance.ts --apply --archive \
 *     --confirm-delete-non-research --limit=NN
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { Fellowship } from '../models/fellowship';
import { VisibilityReleaseQueueItem } from '../models/visibilityReleaseQueueItem';
import { classifyProgramResearchRelevance } from '../services/programResearchRelevance';
import {
  applyStudentVisibilityGatePlans,
  planStudentVisibilityGate,
} from '../services/studentVisibilityGateService';
import { assertScriptApplyAllowed } from './scriptWriteGuards';

dotenv.config();

interface CliOptions {
  apply: boolean;
  archive: boolean;
  confirm: boolean;
  confirmDelete: boolean;
  limit: number;
  output?: string;
}

const NON_RESEARCH_SUPPRESSION_REASON = 'non_research_program';

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    apply: false,
    archive: false,
    confirm: false,
    confirmDelete: false,
    limit: Infinity,
  };
  for (const arg of argv) {
    if (arg === '--apply') options.apply = true;
    else if (arg === '--archive') options.archive = true;
    else if (arg === '--confirm-remove-non-research') options.confirm = true;
    else if (arg === '--confirm-delete-non-research') options.confirmDelete = true;
    else if (arg.startsWith('--limit=')) {
      const raw = arg.slice('--limit='.length);
      if (!/^[1-9]\d*$/.test(raw)) throw new Error('--limit must be a positive integer');
      options.limit = Number(raw);
    } else if (arg.startsWith('--output=')) options.output = arg.slice('--output='.length).trim();
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (options.apply && options.archive && !options.confirmDelete) {
    throw new Error('--confirm-delete-non-research is required when --apply --archive is set.');
  }
  if (options.apply && !options.archive && !options.confirm) {
    throw new Error('--confirm-remove-non-research is required when --apply is set.');
  }
  if (options.apply && !Number.isFinite(options.limit)) {
    throw new Error('--limit is required when --apply is set.');
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const guard = assertScriptApplyAllowed({
    apply: options.apply,
    scriptName: 'auditProgramResearchRelevance',
    mongoUrl: process.env.MONGODBURL,
  });
  await initializeConnections();

  const programs: any[] = await Fellowship.find({ archived: false })
    .select('title purpose studentFacingCategory programKind summary description eligibility studentVisibilityTier studentVisibilityOverrideTier')
    .lean();

  const nonResearch: any[] = [];
  const research: any[] = [];
  for (const program of programs) {
    const verdict = classifyProgramResearchRelevance(program);
    const row = {
      recordId: String(program._id),
      title: program.title,
      tier: program.studentVisibilityTier,
      alreadyOverridden: program.studentVisibilityOverrideTier || null,
      reasons: verdict.reasons,
    };
    if (verdict.researchRelated) research.push(row);
    else nonResearch.push(row);
  }

  // Suppress mode only acts on records not already operator-overridden (respect prior
  // decisions). Delete/archive mode acts on ALL non-research records.
  const removable = nonResearch.filter((r) => r.alreadyOverridden == null);
  const actionable = options.archive ? nonResearch : removable;

  let modified = 0;
  if (options.apply && actionable.length > 0) {
    if (actionable.length > options.limit) {
      throw new Error(`Actionable count ${actionable.length} exceeds --limit ${options.limit}.`);
    }
    const slice = actionable.slice(0, options.limit);
    const now = new Date();

    if (options.archive) {
      // Soft-delete: remove non-research programs from every surface.
      await Fellowship.bulkWrite(
        slice.map((r) => ({
          updateOne: {
            filter: { _id: r.recordId },
            update: {
              $set: {
                archived: true,
                studentVisibilitySuppressionReason: NON_RESEARCH_SUPPRESSION_REASON,
                studentVisibilityReviewedAt: now,
              },
            },
          },
        })),
        { ordered: false },
      );
      // Close any open release-queue items for the archived programs.
      await VisibilityReleaseQueueItem.updateMany(
        { collection: 'programs', recordId: { $in: slice.map((r) => r.recordId) }, status: 'open' },
        { $set: { status: 'suppressed', repairStatus: 'resolved', resolvedAt: now, lastSeenAt: now } },
      );
      modified = slice.length;
    } else {
      await Fellowship.bulkWrite(
        slice.map((r) => ({
          updateOne: {
            filter: { _id: r.recordId },
            update: {
              $set: {
                studentVisibilityOverrideTier: 'suppressed',
                studentVisibilitySuppressionReason: NON_RESEARCH_SUPPRESSION_REASON,
                studentVisibilityReviewedAt: now,
              },
            },
          },
        })),
        { ordered: false },
      );
      // Recompute tiers + resolve queue items for the suppressed records.
      const plans = await planStudentVisibilityGate({
        collection: 'programs',
        mode: 'apply',
        recordIds: slice.map((r) => r.recordId),
      });
      await applyStudentVisibilityGatePlans(plans);
      modified = slice.length;
    }
  }

  const output = {
    mode: options.apply ? (options.archive ? 'apply-archive' : 'apply-suppress') : 'dry-run',
    environment: guard.environment,
    db: guard.dbLabel,
    totals: {
      scanned: programs.length,
      researchRelated: research.length,
      nonResearch: nonResearch.length,
      removableNow: removable.length,
      actionable: actionable.length,
      alreadyOverridden: nonResearch.length - removable.length,
      modified,
    },
    nonResearchCandidates: nonResearch.map((r) => ({
      title: r.title,
      tier: r.tier,
      overridden: r.alreadyOverridden,
      reasons: r.reasons,
    })),
  };
  console.log(JSON.stringify(output, null, 2));
  if (options.output) {
    fs.mkdirSync(path.dirname(options.output), { recursive: true });
    fs.writeFileSync(options.output, `${JSON.stringify(output, null, 2)}\n`);
  }
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isDirectRun) {
  main()
    .catch((error) => {
      console.error('Failed to audit program research relevance:', error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}

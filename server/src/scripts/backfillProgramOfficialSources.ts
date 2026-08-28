/**
 * Review-first backfill of official source pages for legacy program (fellowship)
 * records whose stored `sourceUrl` is only a CommunityForce application portal
 * (the `application_source_only` visibility blocker).
 *
 * For each `promote` entry it sets a real official `sourceUrl` while preserving the
 * CommunityForce link as `applicationLink`, then recomputes student visibility so the
 * record can reach `student_ready`. `hold` entries are reported and left unchanged.
 *
 * Dry-run by default. Apply requires `--apply --confirm-program-official-source-backfill --limit=N`.
 *
 *   yarn --cwd server tsx src/scripts/backfillProgramOfficialSources.ts           # dry-run
 *   yarn --cwd server tsx src/scripts/backfillProgramOfficialSources.ts --apply \
 *     --confirm-program-official-source-backfill --limit=14
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { Fellowship } from '../models/fellowship';
import { computeProgramStudentVisibility } from '../services/studentVisibilityTier';
import {
  applyStudentVisibilityGatePlans,
  planStudentVisibilityGate,
} from '../services/studentVisibilityGateService';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import { sanitizeLogValue } from '../utils/logSanitizer';

dotenv.config();

const DEFAULT_INPUT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'data',
  'programOfficialSourceBackfill.json',
);

interface BackfillEntry {
  recordId: string;
  title: string;
  action: 'promote' | 'hold';
  sourceUrl?: string;
  undergradEligible?: string;
  confidence?: string;
  note?: string;
}

interface CliOptions {
  apply: boolean;
  confirm: boolean;
  limit: number;
  input: string;
  output?: string;
}

const isHttpUrl = (value: unknown): boolean =>
  typeof value === 'string' && /^https?:\/\//i.test(value.trim());

const isCommunityForcePortal = (value: unknown): boolean =>
  typeof value === 'string' &&
  /^https:\/\/yale\.communityforce\.com\/Funds\/FundDetails\.aspx\?/i.test(value.trim());

function resolveProgramOfficialSourceInputPath(value: string | undefined): string {
  const input = value?.trim();
  if (!input || input.startsWith('--')) {
    throw new Error('--input requires a path');
  }
  const resolved = path.resolve(input);
  if (resolved === path.resolve(DEFAULT_INPUT)) return resolved;
  return resolveSafeJsonReportOutputPath(input, '--input');
}

export function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    apply: false,
    confirm: false,
    limit: Infinity,
    input: DEFAULT_INPUT,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') options.apply = true;
    else if (arg === '--confirm-program-official-source-backfill') options.confirm = true;
    else if (arg.startsWith('--limit=')) {
      const raw = arg.slice('--limit='.length);
      if (!/^[1-9]\d*$/.test(raw)) throw new Error('--limit must be a positive integer');
      options.limit = Number(raw);
    } else if (arg.startsWith('--input=')) {
      options.input = resolveProgramOfficialSourceInputPath(arg.slice('--input='.length));
    } else if (arg.startsWith('--output=')) {
      options.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
    }
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (options.apply && !options.confirm) {
    throw new Error('--confirm-program-official-source-backfill is required when --apply is set.');
  }
  if (options.apply && !Number.isFinite(options.limit)) {
    throw new Error('--limit is required when --apply is set.');
  }
  return options;
}

function loadEntries(input: string): BackfillEntry[] {
  const safeInput = resolveProgramOfficialSourceInputPath(input);
  const parsed = JSON.parse(fs.readFileSync(safeInput, 'utf8'));
  const entries: BackfillEntry[] = Array.isArray(parsed) ? parsed : parsed.entries;
  if (!Array.isArray(entries)) throw new Error('Change-set must be an array or { entries: [...] }.');
  return entries;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const guard = assertScriptApplyAllowed({
    apply: options.apply,
    scriptName: 'backfillProgramOfficialSources',
    mongoUrl: process.env.MONGODBURL,
  });
  const entries = loadEntries(options.input);
  await initializeConnections();

  const plannedUpdates: Array<{ recordId: string; sourceUrl: string; applicationLink: string }> = [];
  const report: Array<Record<string, unknown>> = [];

  for (const entry of entries) {
    const program: any = await Fellowship.findById(entry.recordId).lean();
    if (!program) {
      report.push({ ...entry, status: 'missing_record' });
      continue;
    }
    const currentTier = program.studentVisibilityTier;

    if (entry.action === 'hold') {
      report.push({ recordId: entry.recordId, title: entry.title, action: 'hold', currentTier, note: entry.note });
      continue;
    }

    if (!isHttpUrl(entry.sourceUrl)) {
      report.push({ ...entry, status: 'invalid_source_url' });
      continue;
    }
    if (isCommunityForcePortal(entry.sourceUrl)) {
      report.push({ ...entry, status: 'rejected_portal_as_source' });
      continue;
    }

    // Preserve the existing CommunityForce link as the application route.
    const applicationLink =
      isHttpUrl(program.applicationLink) && !entry.sourceUrl
        ? program.applicationLink
        : isCommunityForcePortal(program.applicationLink)
          ? program.applicationLink
          : isCommunityForcePortal(program.sourceUrl)
            ? program.sourceUrl
            : program.applicationLink || '';

    const projected = computeProgramStudentVisibility({
      ...program,
      sourceUrl: entry.sourceUrl,
      applicationLink,
    });

    plannedUpdates.push({ recordId: entry.recordId, sourceUrl: entry.sourceUrl!, applicationLink });
    report.push({
      recordId: entry.recordId,
      title: entry.title,
      action: 'promote',
      currentTier,
      projectedTier: projected.tier,
      willPromote: currentTier !== projected.tier,
      newSourceUrl: entry.sourceUrl,
      applicationLink,
      confidence: entry.confidence,
      note: entry.note,
    });
  }

  const promoteCount = report.filter((r) => r.projectedTier === 'student_ready').length;
  const summary = {
    mode: options.apply ? 'apply' : 'dry-run',
    environment: guard.environment,
    db: guard.dbLabel,
    input: options.input,
    scanned: entries.length,
    plannedSourceUpdates: plannedUpdates.length,
    projectedStudentReady: promoteCount,
    held: report.filter((r) => r.action === 'hold').length,
  };

  if (options.apply) {
    const slice = plannedUpdates.slice(0, options.limit);
    if (slice.length > options.limit) throw new Error('Planned updates exceed --limit.');
    await Fellowship.bulkWrite(
      slice.map((u) => ({
        updateOne: {
          filter: { _id: u.recordId },
          update: { $set: { sourceUrl: u.sourceUrl, applicationLink: u.applicationLink } },
        },
      })),
      { ordered: false },
    );
    // Recompute student visibility (and resolve queue items) for just these records.
    const plans = await planStudentVisibilityGate({
      collection: 'programs',
      mode: 'apply',
      recordIds: slice.map((u) => u.recordId),
    });
    await applyStudentVisibilityGatePlans(plans);
  }

  const output = { summary, entries: report };
  console.log(JSON.stringify(output, null, 2));
  if (options.output) {
    const safeOutput = resolveSafeJsonReportOutputPath(options.output);
    fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
    fs.writeFileSync(safeOutput, `${JSON.stringify(output, null, 2)}\n`);
  }
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isDirectRun) {
  main()
    .catch((error) => {
      console.error('Failed to backfill program official sources:', sanitizeLogValue(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}

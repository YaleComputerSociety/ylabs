/**
 * Review-first canonical overrides for PI-shell research entities whose real lab
 * website, name, and description were not auto-derived by the scrapers.
 *
 * For each entry it sets the supplied canonical fields (name/displayName,
 * website/websiteUrl, short/full description), appends the website to sourceUrls,
 * and locks the applied fields via `manuallyLockedFields` so scrapers cannot
 * revert them, then recomputes student visibility for the affected records.
 *
 * Dry-run by default. Apply requires
 * `--apply --confirm-research-entity-canonical-overrides --limit=N`.
 *
 *   yarn --cwd server tsx src/scripts/backfillResearchEntityCanonicalOverrides.ts
 *   yarn --cwd server tsx src/scripts/backfillResearchEntityCanonicalOverrides.ts --apply \
 *     --confirm-research-entity-canonical-overrides --limit=1
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import {
  applyStudentVisibilityGatePlans,
  planStudentVisibilityGate,
} from '../services/studentVisibilityGateService';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import { sanitizeLogValue } from '../utils/logSanitizer';
import {
  planCanonicalOverride,
  planHasChanges,
  validateCanonicalOverrideEntry,
  type CanonicalOverrideEntry,
} from './backfillResearchEntityCanonicalOverridesCore';

dotenv.config();

const DEFAULT_INPUT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'data',
  'researchEntityCanonicalOverrides.json',
);

interface CliOptions {
  apply: boolean;
  confirm: boolean;
  limit: number;
  input: string;
  output?: string;
}

function resolveCanonicalOverrideInputPath(value: string | undefined): string {
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
    else if (arg === '--confirm-research-entity-canonical-overrides') options.confirm = true;
    else if (arg.startsWith('--limit=')) {
      const raw = arg.slice('--limit='.length);
      if (!/^[1-9]\d*$/.test(raw)) throw new Error('--limit must be a positive integer');
      options.limit = Number(raw);
    } else if (arg.startsWith('--input=')) {
      options.input = resolveCanonicalOverrideInputPath(arg.slice('--input='.length));
    } else if (arg.startsWith('--output=')) {
      options.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (options.apply && !options.confirm) {
    throw new Error(
      '--confirm-research-entity-canonical-overrides is required when --apply is set.',
    );
  }
  if (options.apply && !Number.isFinite(options.limit)) {
    throw new Error('--limit is required when --apply is set.');
  }
  return options;
}

function loadEntries(input: string): CanonicalOverrideEntry[] {
  const safeInput = resolveCanonicalOverrideInputPath(input);
  const parsed = JSON.parse(fs.readFileSync(safeInput, 'utf8'));
  const entries: CanonicalOverrideEntry[] = Array.isArray(parsed) ? parsed : parsed.entries;
  if (!Array.isArray(entries)) {
    throw new Error('Change-set must be an array or { entries: [...] }.');
  }
  return entries;
}

function entityFilter(entry: CanonicalOverrideEntry): Record<string, unknown> | null {
  const slug = typeof entry.slug === 'string' ? entry.slug.trim() : '';
  const recordId = typeof entry.recordId === 'string' ? entry.recordId.trim() : '';
  if (slug) return { slug };
  if (recordId && /^[a-f0-9]{24}$/i.test(recordId)) return { _id: recordId };
  return null;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const guard = assertScriptApplyAllowed({
    apply: options.apply,
    scriptName: 'backfillResearchEntityCanonicalOverrides',
    mongoUrl: process.env.MONGODBURL,
  });
  const entries = loadEntries(options.input);
  await initializeConnections();

  const plannedUpdates: Array<{ recordId: string; set: Record<string, unknown> }> = [];
  const report: Array<Record<string, unknown>> = [];

  for (const entry of entries) {
    const validationError = validateCanonicalOverrideEntry(entry);
    if (validationError) {
      report.push({
        slug: entry.slug,
        recordId: entry.recordId,
        status: 'invalid_entry',
        reason: validationError,
      });
      continue;
    }
    const filter = entityFilter(entry);
    if (!filter) {
      report.push({
        slug: entry.slug,
        recordId: entry.recordId,
        status: 'invalid_entry',
        reason: 'unresolvable identifier',
      });
      continue;
    }
    const entity: any = await ResearchEntity.findOne(filter)
      .select(
        '_id slug name displayName website websiteUrl shortDescription fullDescription sourceUrls manuallyLockedFields',
      )
      .lean();
    if (!entity) {
      report.push({ slug: entry.slug, recordId: entry.recordId, status: 'missing_record' });
      continue;
    }

    const plan = planCanonicalOverride(entity, entry);
    const recordId = String(entity._id);
    if (!planHasChanges(plan)) {
      report.push({
        slug: entity.slug,
        recordId,
        status: 'noop',
        confidence: entry.confidence,
        note: entry.note,
      });
      continue;
    }
    plannedUpdates.push({ recordId, set: plan.set });
    report.push({
      slug: entity.slug,
      recordId,
      status: 'planned',
      changedFields: plan.changedFields,
      lockedFields: plan.lockedFields,
      addedSourceUrls: plan.addedSourceUrls,
      confidence: entry.confidence,
      note: entry.note,
    });
  }

  const summary = {
    mode: options.apply ? 'apply' : 'dry-run',
    environment: guard.environment,
    db: guard.dbLabel,
    input: options.input,
    scanned: entries.length,
    plannedUpdates: plannedUpdates.length,
    noop: report.filter((r) => r.status === 'noop').length,
    missing: report.filter((r) => r.status === 'missing_record').length,
    invalid: report.filter((r) => r.status === 'invalid_entry').length,
  };

  if (options.apply) {
    const slice = plannedUpdates.slice(0, options.limit);
    if (plannedUpdates.length > options.limit) {
      throw new Error(
        `Planned updates (${plannedUpdates.length}) exceed --limit (${options.limit}).`,
      );
    }
    await ResearchEntity.bulkWrite(
      slice.map((update) => ({
        updateOne: { filter: { _id: update.recordId }, update: { $set: update.set } },
      })),
      { ordered: false },
    );
    const plans = await planStudentVisibilityGate({
      collection: 'research',
      mode: 'apply',
      recordIds: slice.map((update) => update.recordId),
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
      console.error(
        'Failed to backfill research entity canonical overrides:',
        sanitizeLogValue(error),
      );
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}

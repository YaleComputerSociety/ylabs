/**
 * Backfill of program (fellowship) `links[]` entries whose stored `label` is a
 * bare URL (the label is the raw URL string, e.g. "http://studentgrants.yale.edu/",
 * which the modal renders verbatim as link text - #774). Re-derives a host-based
 * human label through the shared `humanizeProgramLinkLabel` helper, which also
 * clears the http-vs-https label/url scheme mismatch on the affected records.
 *
 * Dry-run by default. Apply requires `--apply --confirm-program-link-label-backfill`.
 *
 *   yarn --cwd server tsx src/scripts/backfillProgramLinkLabels.ts            # dry-run
 *   yarn --cwd server tsx src/scripts/backfillProgramLinkLabels.ts --apply \
 *     --confirm-program-link-label-backfill
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose, { type AnyBulkWriteOperation } from 'mongoose';
import { initializeConnections } from '../db/connections';
import { Fellowship } from '../models/fellowship';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import { humanizeProgramLinkLabel, isBareUrlLinkLabel } from '../utils/programLinkLabel';
import { sanitizeLogValue } from '../utils/logSanitizer';

dotenv.config();

interface CliOptions {
  apply: boolean;
  confirm: boolean;
  output?: string;
}

export function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { apply: false, confirm: false };
  for (const arg of argv) {
    if (arg === '--apply') options.apply = true;
    else if (arg === '--confirm-program-link-label-backfill') options.confirm = true;
    else if (arg.startsWith('--output=')) {
      options.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (options.apply && !options.confirm) {
    throw new Error('--confirm-program-link-label-backfill is required when --apply is set.');
  }
  return options;
}

interface RelabeledLink {
  url: string;
  from: string;
  to: string;
}

interface PlannedUpdate {
  recordId: string;
  title: unknown;
  links: Array<{ label: string; url: string }>;
  relabeled: RelabeledLink[];
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const guard = assertScriptApplyAllowed({
    apply: options.apply,
    scriptName: 'backfillProgramLinkLabels',
    mongoUrl: process.env.MONGODBURL,
  });
  await initializeConnections();

  const programs: any[] = await Fellowship.find({ 'links.0': { $exists: true } })
    .select({ title: 1, links: 1 })
    .lean();

  const plannedUpdates: PlannedUpdate[] = [];
  for (const program of programs) {
    const links: Array<{ label?: unknown; url?: unknown }> = Array.isArray(program.links)
      ? program.links
      : [];
    const relabeled: RelabeledLink[] = [];
    const nextLinks = links.map((link) => {
      const label = typeof link.label === 'string' ? link.label : '';
      const url = typeof link.url === 'string' ? link.url : '';
      if (!url || !isBareUrlLinkLabel(label)) return { label, url };
      const humanized = humanizeProgramLinkLabel(label, url) || label;
      if (humanized !== label) relabeled.push({ url, from: label, to: humanized });
      return { label: humanized, url };
    });
    if (relabeled.length > 0) {
      plannedUpdates.push({
        recordId: String(program._id),
        title: program.title,
        links: nextLinks,
        relabeled,
      });
    }
  }

  const summary = {
    mode: options.apply ? 'apply' : 'dry-run',
    environment: guard.environment,
    db: guard.dbLabel,
    scannedWithLinks: programs.length,
    recordsWithBareUrlLabels: plannedUpdates.length,
    linksRelabeled: plannedUpdates.reduce((total, u) => total + u.relabeled.length, 0),
  };

  if (options.apply) {
    const operations: AnyBulkWriteOperation[] = plannedUpdates.map((u) => ({
      updateOne: { filter: { _id: u.recordId }, update: { $set: { links: u.links } } },
    }));
    await Fellowship.bulkWrite(operations, { ordered: false });
  }

  const output = {
    summary,
    entries: plannedUpdates.map((u) => ({
      recordId: u.recordId,
      title: u.title,
      relabeled: u.relabeled,
    })),
  };
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
      console.error('Failed to backfill program link labels:', sanitizeLogValue(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}

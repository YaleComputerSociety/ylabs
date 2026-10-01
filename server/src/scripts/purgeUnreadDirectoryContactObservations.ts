/**
 * Deletes the directory-lane observations of fields nothing reads: a person's phone
 * number and residential college from the Yalies lane, and the physical-location
 * values a retired CSV lane left behind (#4161).
 *
 * The lane stopped emitting them in the same change, so this clears what earlier runs
 * already stored. The selection is fixed in this file rather than taken from the
 * command line: an operator-supplied field could name one a materializer reads, and
 * the point of the operation is that these three have no reader at all.
 *
 * An observation a served document cites, through a `fieldProvenance` entry or a signal's
 * evidence, is history and is never deleted: the run reports it as protected and leaves it
 * alone. A `supersededBy` pointer from one of these observations to another is not such a
 * reader, because the whole supersession chain of a retired field goes in one pass, and
 * counting it would keep every superseded value a later run replaced.
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { connectScriptMongo } from '../db/connections';
import { Observation } from '../models/observation';
import {
  OBSERVATION_REFERENCE_SPECS,
  scanReferencedObservations,
} from '../scrapers/observationRetention';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import { sanitizeLogValue } from '../utils/logSanitizer';

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export const SCRIPT_NAME = 'observations:purge-unread-directory-contact';
export const PURGE_CONFIRM_FLAG = '--confirm-purge-unread-directory-contact';
export const PURGE_DELETE_BATCH_SIZE = 5000;

export interface UnreadContactFieldSelector {
  field: string;
  sourceName: string;
}

export const UNREAD_DIRECTORY_CONTACT_SELECTORS: UnreadContactFieldSelector[] = [
  { field: 'phone', sourceName: 'yale-directory' },
  { field: 'college', sourceName: 'yale-directory' },
  { field: 'physicalLocation', sourceName: 'yale-directory-csv' },
];

export interface PurgeUnreadDirectoryContactArgs {
  apply: boolean;
  confirm: boolean;
  output?: string;
}

export function parsePurgeUnreadDirectoryContactArgs(
  argv: string[],
): PurgeUnreadDirectoryContactArgs {
  const args: PurgeUnreadDirectoryContactArgs = { apply: false, confirm: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') continue;
    else if (arg === '--apply' || arg === '--mode=apply') args.apply = true;
    else if (arg === '--dry-run' || arg === '--mode=dry-run') args.apply = false;
    else if (arg === PURGE_CONFIRM_FLAG) args.confirm = true;
    else if (arg.startsWith('--output=')) args.output = arg.slice('--output='.length);
    else if (arg === '--output') {
      args.output = argv[index + 1];
      index += 1;
    } else throw new Error(`Unknown ${SCRIPT_NAME} argument: ${arg}`);
  }
  return args;
}

export function assertPurgeUnreadDirectoryContactApplyAllowed(
  args: PurgeUnreadDirectoryContactArgs,
): void {
  if (!args.apply) return;
  if (!args.confirm) {
    throw new Error(`${PURGE_CONFIRM_FLAG} is required when --apply is set.`);
  }
}

export const EXTERNAL_READER_REFERENCE_SPECS = OBSERVATION_REFERENCE_SPECS.filter(
  (spec) => !(spec.collection === 'observations' && spec.field === 'supersededBy'),
);

export interface SelectorPurgeReport extends UnreadContactFieldSelector {
  selected: number;
  protectedByReader: number;
  deletable: number;
  deleted: number;
}

export interface PurgeUnreadDirectoryContactReport {
  script: string;
  apply: boolean;
  readerSpecs: string[];
  selectors: SelectorPurgeReport[];
  selected: number;
  protectedByReader: number;
  deletable: number;
  deleted: number;
}

export async function purgeUnreadDirectoryContactObservations(options: {
  apply: boolean;
}): Promise<PurgeUnreadDirectoryContactReport> {
  const referenceScan = await scanReferencedObservations(EXTERNAL_READER_REFERENCE_SPECS);
  const referencedKeys = new Set(referenceScan.ids.map((id) => String(id)));
  const selectors: SelectorPurgeReport[] = [];

  for (const selector of UNREAD_DIRECTORY_CONTACT_SELECTORS) {
    const rows = await Observation.find({
      field: selector.field,
      sourceName: selector.sourceName,
    })
      .select('_id')
      .lean();
    const deletableIds = rows.filter((row) => !referencedKeys.has(String(row._id)));
    let deleted = 0;
    if (options.apply) {
      for (let start = 0; start < deletableIds.length; start += PURGE_DELETE_BATCH_SIZE) {
        const batch = deletableIds.slice(start, start + PURGE_DELETE_BATCH_SIZE).map((r) => r._id);
        const result = await Observation.deleteMany({ _id: { $in: batch } });
        deleted += result.deletedCount || 0;
      }
    }
    selectors.push({
      ...selector,
      selected: rows.length,
      protectedByReader: rows.length - deletableIds.length,
      deletable: deletableIds.length,
      deleted,
    });
  }

  const total = (pick: (entry: SelectorPurgeReport) => number): number =>
    selectors.reduce((sum, entry) => sum + pick(entry), 0);

  return {
    script: SCRIPT_NAME,
    apply: options.apply,
    readerSpecs: referenceScan.specs.map((spec) => `${spec.collection}.${spec.field}`),
    selectors,
    selected: total((entry) => entry.selected),
    protectedByReader: total((entry) => entry.protectedByReader),
    deletable: total((entry) => entry.deletable),
    deleted: total((entry) => entry.deleted),
  };
}

function writeReport(report: PurgeUnreadDirectoryContactReport, output?: string): void {
  if (!output) return;
  const safeOutput = resolveSafeJsonReportOutputPath(output);
  fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
  fs.writeFileSync(safeOutput, `${JSON.stringify(report, null, 2)}\n`);
}

async function main(): Promise<void> {
  const args = parsePurgeUnreadDirectoryContactArgs(process.argv.slice(2));
  assertPurgeUnreadDirectoryContactApplyAllowed(args);

  const mongoUrl = process.env.MONGODBURL;
  if (!mongoUrl) throw new Error('MONGODBURL not set');
  const guard = assertScriptApplyAllowed({ apply: args.apply, scriptName: SCRIPT_NAME, mongoUrl });

  await connectScriptMongo(mongoUrl);
  try {
    const report = await purgeUnreadDirectoryContactObservations({ apply: args.apply });
    writeReport(report, args.output);
    console.log(
      `${SCRIPT_NAME} ${args.apply ? 'apply' : 'dry-run'} against ${guard.dbLabel}: ${JSON.stringify(report.selectors)}`,
    );
    console.log(
      `selected=${report.selected} protectedByReader=${report.protectedByReader} deletable=${report.deletable} deleted=${report.deleted}`,
    );
  } finally {
    await mongoose.disconnect();
  }
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch(async (error) => {
    console.error(`${SCRIPT_NAME} failed:`, sanitizeLogValue(error));
    await mongoose.disconnect().catch(() => undefined);
    process.exit(1);
  });
}

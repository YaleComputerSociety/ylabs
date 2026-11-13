import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeConnections, runScriptMain } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { servesStudentVisibilityTier } from '../models/studentVisibility';
import { getOrgUnitCanonicalizer } from '../scrapers/orgUnitCanonicalization';
import {
  loadResolvedSchoolObservationsByRow,
  storedSchoolBackingClass,
  storedSchoolIsBacked,
} from '../scrapers/storedSchoolBacking';
import { serializedDocumentId } from '../utils/idSerialization';
import { resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  summarizeStoredSchoolBacking,
  type StoredSchoolBackingReportRow,
} from './storedSchoolBackingReportCore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

const USAGE =
  'Usage: research-entity:school-backing-report [--output <path.json>] [--rows-output <path.json>]\n' +
  'Read-only. Counts the backing of every live row stored school (#6096); writes nothing.';

export function parseStoredSchoolBackingReportArgs(argv: readonly string[]): {
  output?: string;
  rowsOutput?: string;
} {
  let output: string | undefined;
  let rowsOutput: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--output') {
      output = resolveSafeJsonReportOutputPath(argv[index + 1]);
      index += 1;
    } else if (arg === '--rows-output') {
      rowsOutput = resolveSafeJsonReportOutputPath(argv[index + 1], '--rows-output');
      index += 1;
    } else if (arg === '--help' || arg === '-h') {
      console.log(USAGE);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument ${arg}\n${USAGE}`);
    }
  }
  return { ...(output ? { output } : {}), ...(rowsOutput ? { rowsOutput } : {}) };
}

async function main(): Promise<void> {
  const args = parseStoredSchoolBackingReportArgs(process.argv.slice(2));
  await initializeConnections();
  const rows = (await ResearchEntity.find({ archived: { $ne: true } })
    .select(
      '_id slug school departments websiteUrl sourceUrls fieldProvenance.school manuallyLockedFields studentVisibilityTier studentVisibilityOverrideTier',
    )
    .lean()) as Array<StoredSchoolBackingReportRow & Record<string, unknown>>;
  const reportRows = rows.map((row) => ({ ...row, served: servesStudentVisibilityTier(row) }));
  const observationsByRow = await loadResolvedSchoolObservationsByRow(reportRows);
  const canonicalizer = await getOrgUnitCanonicalizer();
  const summary = summarizeStoredSchoolBacking(reportRows, observationsByRow, canonicalizer);
  const report = { generatedAt: new Date().toISOString(), issue: 6096, ...summary };
  console.log(JSON.stringify(report, null, 2));
  if (args.output) {
    fs.mkdirSync(path.dirname(args.output), { recursive: true });
    fs.writeFileSync(args.output, `${JSON.stringify(report, null, 2)}\n`);
  }
  if (args.rowsOutput) {
    const listed = reportRows.flatMap((row) => {
      const id = serializedDocumentId(row._id) ?? '';
      const observations = observationsByRow.get(id) ?? [];
      const backing = storedSchoolBackingClass(row, observations, canonicalizer);
      const supersededOnly =
        backing === 'school-observation' &&
        !storedSchoolIsBacked(
          row.school,
          observations.filter((observation) => observation.superseded !== true),
          canonicalizer,
        );
      if (backing !== 'never-backed' && !supersededOnly) return [];
      return [{ id, slug: row.slug, served: row.served, backing, supersededOnly }];
    });
    fs.mkdirSync(path.dirname(args.rowsOutput), { recursive: true });
    fs.writeFileSync(args.rowsOutput, `${JSON.stringify(listed, null, 2)}\n`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  void runScriptMain(main);
}

import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeConnections, runScriptMain } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { servesStudentVisibilityTier } from '../models/studentVisibility';
import { getOrgUnitCanonicalizer } from '../scrapers/orgUnitCanonicalization';
import { OrgUnit } from '../models/orgUnit';
import {
  loadResolvedSchoolObservationsByRow,
  schoolDerivedByOrgUnitCanonicalization,
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
      '_id slug school schools departments entityType websiteUrl sourceUrls fieldProvenance.school manuallyLockedFields studentVisibilityTier studentVisibilityOverrideTier',
    )
    .lean()) as Array<StoredSchoolBackingReportRow & Record<string, unknown>>;
  if ((await OrgUnit.countDocuments({ kind: 'SCHOOL' })) === 0) {
    throw new Error(
      'The org-unit catalog holds no school, so every comparison would be raw-only and inflate never-backed. Seed org_units first.',
    );
  }
  const reportRows = rows.map((row) => ({ ...row, served: servesStudentVisibilityTier(row) }));
  const readingsByRow = await loadResolvedSchoolObservationsByRow(reportRows);
  const derivedSchoolByRow = new Map<string, string>();
  for (const row of reportRows) {
    const id = serializedDocumentId(row._id);
    if (id) derivedSchoolByRow.set(id, await schoolDerivedByOrgUnitCanonicalization(row));
  }
  const canonicalizer = await getOrgUnitCanonicalizer();
  const summary = summarizeStoredSchoolBacking(
    reportRows,
    readingsByRow,
    derivedSchoolByRow,
    canonicalizer,
  );
  const report = { generatedAt: new Date().toISOString(), issue: 6096, ...summary };
  console.log(JSON.stringify(report, null, 2));
  if (args.output) {
    fs.mkdirSync(path.dirname(args.output), { recursive: true });
    fs.writeFileSync(args.output, `${JSON.stringify(report, null, 2)}\n`);
  }
  if (args.rowsOutput) {
    const listed = reportRows.flatMap((row) => {
      const id = serializedDocumentId(row._id) ?? '';
      const readings = readingsByRow.get(id) ?? { own: [], mergedIn: [] };
      const backing = storedSchoolBackingClass(
        row,
        readings,
        canonicalizer,
        derivedSchoolByRow.get(id) ?? '',
      );
      const supersededOnly =
        backing === 'school-observation' &&
        !storedSchoolIsBacked(
          row.school,
          readings.own.filter((observation) => observation.superseded !== true),
          canonicalizer,
        );
      if (backing !== 'never-backed' && backing !== 'merged-in-reading-only' && !supersededOnly) {
        return [];
      }
      return [{ id, slug: row.slug, served: row.served, backing, supersededOnly }];
    });
    fs.mkdirSync(path.dirname(args.rowsOutput), { recursive: true });
    fs.writeFileSync(args.rowsOutput, `${JSON.stringify(listed, null, 2)}\n`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  void runScriptMain(main);
}

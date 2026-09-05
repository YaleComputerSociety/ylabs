import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { OrgUnit, type OrgUnitKind } from '../models/orgUnit';
import { ResearchEntity } from '../models/researchEntity';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  auditDepartmentFacetCatalog,
  type DepartmentFacetAudit,
} from './auditDepartmentFacetCatalogCore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const DEFAULT_TOP = 40;

export interface DepartmentFacetAuditCliOptions {
  top: number;
  output?: string;
}

export function parseDepartmentFacetAuditArgs(argv: string[]): DepartmentFacetAuditCliOptions {
  const options: DepartmentFacetAuditCliOptions = { top: DEFAULT_TOP };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--top=')) {
      const raw = arg.slice('--top='.length);
      if (!/^[1-9]\d*$/.test(raw)) throw new Error('--top must be a positive integer');
      options.top = Number(raw);
    } else if (arg === '--output') {
      options.output = resolveSafeJsonReportOutputPath(argv[i + 1]);
      i += 1;
    } else if (arg.startsWith('--output=')) {
      options.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

export async function runDepartmentFacetAudit(): Promise<DepartmentFacetAudit> {
  const orgUnitRows = await OrgUnit.find({ archived: { $ne: true }, status: { $ne: 'INACTIVE' } })
    .select('slug name kind aliases')
    .lean<{ slug: string; name: string; kind: OrgUnitKind; aliases?: string[] }[]>();
  const entities = await ResearchEntity.find({
    studentVisibilityTier: 'student_ready',
    archived: { $ne: true },
  })
    .select('departments orgAffiliationLabels')
    .lean<{ departments?: unknown; orgAffiliationLabels?: unknown }[]>();
  return auditDepartmentFacetCatalog(entities, orgUnitRows);
}

async function main(): Promise<void> {
  const options = parseDepartmentFacetAuditArgs(process.argv.slice(2));
  await initializeConnections();
  try {
    const audit = await runDepartmentFacetAudit();
    console.log(
      `Served rows: ${audit.servedRows}; canonical department facet values: ${audit.canonicalFacetValues.length}; rows with no canonical department: ${audit.rowsWithNoCanonicalDepartment}`,
    );
    console.log(`\nTop ${options.top} canonical department facet values`);
    for (const row of audit.canonicalFacetValues.slice(0, options.top)) {
      console.log(`  ${row.servedRows}\t${row.label}`);
    }
    console.log(
      `\nUncataloged labels sources presented as departments: ${audit.uncatalogedLabels.length}`,
    );
    console.log(`Top ${options.top} by served rows (triage: add a real department to org_units)`);
    for (const row of audit.uncatalogedLabels.slice(0, options.top)) {
      console.log(`  ${row.servedRows}\t${row.label}`);
    }
    if (options.output) {
      const safeOutput = resolveSafeJsonReportOutputPath(options.output);
      fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
      fs.writeFileSync(
        safeOutput,
        JSON.stringify({ generatedAt: new Date().toISOString(), audit }, null, 2),
      );
      console.log(`\nSaved department facet audit to ${safeOutput}`);
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

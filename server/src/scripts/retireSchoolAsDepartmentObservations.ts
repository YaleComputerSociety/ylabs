import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { Observation } from '../models/observation';
import { OrgUnit } from '../models/orgUnit';
import { Researcher } from '../models/researcher';
import { materializeEntity } from '../scrapers/entityMaterializer';
import { rosterDeptNameNamesItsOwnSchool } from '../scrapers/sources/departmentRosterScraper';
import {
  orgUnitMatchKey,
  resetOrgUnitCanonicalizerCache,
} from '../scrapers/orgUnitCanonicalization';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  planSchoolAsDepartmentRetirement,
  SCHOOL_AS_DEPARTMENT_ROLLBACK_REASON,
  type SchoolAsDepartmentPlan,
} from './retireSchoolAsDepartmentObservationsCore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export const CONFIRM_FLAG = '--confirm-retire-school-as-department';
const DEPARTMENT_CLAIMING_FIELDS = ['primaryDepartment', 'departments'];
const ROSTER_SOURCE = 'dept-faculty-roster';

export interface RetireSchoolAsDepartmentOptions {
  dryRun: boolean;
  confirmed: boolean;
  limit?: number;
  output?: string;
}

function parsePositiveInt(value: string | undefined, flag: string): number {
  if (!value || value.startsWith('--') || !/^[1-9]\d*$/.test(value)) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return Number(value);
}

export function parseRetireSchoolAsDepartmentArgs(argv: string[]): RetireSchoolAsDepartmentOptions {
  const options: RetireSchoolAsDepartmentOptions = { dryRun: true, confirmed: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') options.dryRun = false;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === CONFIRM_FLAG) options.confirmed = true;
    else if (arg.startsWith('--limit=')) {
      options.limit = parsePositiveInt(arg.slice('--limit='.length), '--limit');
    } else if (arg === '--limit') {
      options.limit = parsePositiveInt(argv[i + 1], '--limit');
      i += 1;
    } else if (arg === '--output') {
      options.output = resolveSafeJsonReportOutputPath(argv[i + 1]);
      i += 1;
    } else if (arg.startsWith('--output=')) {
      options.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

interface OrgUnitNameRow {
  name: string;
  kind: string;
  aliases?: string[];
}

/**
 * A value is a school name for this repair only when the catalog knows it as a
 * school and does NOT also know it as a department or section. Without the second
 * half a `DIVISION` such as Faculty of Arts and Sciences, which is legitimately
 * both, would take its real department rows down with it.
 */
export function buildSchoolNamePredicate(rows: OrgUnitNameRow[]): (value: string) => boolean {
  const schoolNames = rows.filter((row) => row.kind === 'SCHOOL').map((row) => row.name);
  const departmentKeys = new Set<string>();
  for (const row of rows) {
    if (row.kind !== 'DEPARTMENT' && row.kind !== 'SECTION' && row.kind !== 'DIVISION') continue;
    for (const value of [row.name, ...(row.aliases || [])]) {
      const key = orgUnitMatchKey(value);
      if (key) departmentKeys.add(key);
    }
  }
  return (value: string): boolean => {
    if (departmentKeys.has(orgUnitMatchKey(value))) return false;
    return schoolNames.some((schoolName) =>
      rosterDeptNameNamesItsOwnSchool({ deptName: value, schoolName }),
    );
  };
}

export interface RetireSchoolAsDepartmentResult {
  mode: 'dry-run' | 'apply';
  plan: Omit<SchoolAsDepartmentPlan, 'rows'> & { people: number };
  claimedDepartments: Array<[string, number]>;
  retiredObservations: number;
  clearedStoredDepartments: number;
  rematerializedPeople: number;
  researchersStoringASchool: { before: number; after: number };
  sampleRows: SchoolAsDepartmentPlan['rows'];
}

export async function runRetireSchoolAsDepartment(options: {
  dryRun: boolean;
  limit?: number;
}): Promise<RetireSchoolAsDepartmentResult> {
  resetOrgUnitCanonicalizerCache();
  const orgUnits = await OrgUnit.find({ archived: { $ne: true } })
    .select('name kind aliases')
    .lean<OrgUnitNameRow[]>();
  const isSchoolName = buildSchoolNamePredicate(orgUnits);

  const observations = (await Observation.find({
    sourceName: ROSTER_SOURCE,
    entityType: 'user',
    field: { $in: DEPARTMENT_CLAIMING_FIELDS },
    superseded: { $ne: true },
  })
    .select('_id entityKey field value sourceUrl')
    .lean()) as Array<{
    _id: unknown;
    entityKey: string;
    field: string;
    value: unknown;
    sourceUrl?: string;
  }>;

  const plan = planSchoolAsDepartmentRetirement(
    observations.map((observation) => ({
      id: String(observation._id),
      entityKey: observation.entityKey,
      field: observation.field,
      value: observation.value,
      sourceUrl: observation.sourceUrl,
    })),
    isSchoolName,
  );

  const rows = options.limit ? plan.rows.slice(0, options.limit) : plan.rows;
  const claimed = new Map<string, number>();
  for (const row of rows)
    claimed.set(row.claimedDepartment, (claimed.get(row.claimedDepartment) || 0) + 1);

  // Counted by the same predicate that drives the retirement rather than by a list
  // of school names, because the corpus also holds the conversational short forms
  // ("Divinity", "Law", "Management") that a name list silently misses.
  const storedDepartments = await Researcher.find({
    archived: { $ne: true },
    'profile.primaryDepartment': { $nin: ['', null] },
  })
    .select('_id profile.primaryDepartment')
    .lean<Array<{ _id: unknown; profile?: { primaryDepartment?: string } }>>();
  const storedSchoolIds = storedDepartments
    .filter((row) => isSchoolName(String(row.profile?.primaryDepartment || '')))
    .map((row) => row._id);
  const before = storedSchoolIds.length;

  let retiredObservations = 0;
  let rematerializedPeople = 0;
  let clearedStoredDepartments = 0;
  if (!options.dryRun) {
    for (const row of rows) {
      const result = await Observation.updateMany(
        {
          _id: { $in: row.observationIds.map((id) => new mongoose.Types.ObjectId(id)) },
          superseded: { $ne: true },
        },
        {
          $set: {
            superseded: true,
            rollback: {
              rolledBackAt: new Date(),
              reason: SCHOOL_AS_DEPARTMENT_ROLLBACK_REASON,
            },
          },
        },
      );
      retiredObservations += result.modifiedCount || 0;
    }
    // Retiring the observation does not clear the document: materializeEntity only
    // writes a field it can resolve, so a person whose only department claim was the
    // school keeps the stored value forever. A school is never a valid home
    // department whatever produced it, so the stored value is cleared by the same
    // predicate, and the re-materialize below restores a real one wherever a
    // surviving observation still reports one.
    if (storedSchoolIds.length > 0) {
      const cleared = await Researcher.updateMany(
        { _id: { $in: storedSchoolIds } },
        { $unset: { 'profile.primaryDepartment': '' } },
      );
      clearedStoredDepartments = cleared.modifiedCount || 0;
    }
    // Rebuild through the ordinary materializer rather than writing the person
    // document directly, so the surviving observations decide the replacement
    // department and every other guard on that path still applies.
    for (const row of rows) {
      await materializeEntity('user', { entityKey: row.entityKey });
      rematerializedPeople += 1;
    }
  }

  let after = before;
  if (!options.dryRun) {
    const stillStored = await Researcher.find({
      archived: { $ne: true },
      'profile.primaryDepartment': { $nin: ['', null] },
    })
      .select('_id profile.primaryDepartment')
      .lean<Array<{ profile?: { primaryDepartment?: string } }>>();
    after = stillStored.filter((row) =>
      isSchoolName(String(row.profile?.primaryDepartment || '')),
    ).length;
  }

  return {
    mode: options.dryRun ? 'dry-run' : 'apply',
    plan: {
      scanned: plan.scanned,
      observationsToRetire: rows.reduce((total, row) => total + row.observationIds.length, 0),
      skippedNotASchool: plan.skippedNotASchool,
      people: rows.length,
    },
    claimedDepartments: [...claimed.entries()].sort((left, right) => right[1] - left[1]),
    retiredObservations,
    clearedStoredDepartments,
    rematerializedPeople,
    researchersStoringASchool: { before, after },
    sampleRows: rows.slice(0, 10),
  };
}

async function main(): Promise<void> {
  const options = parseRetireSchoolAsDepartmentArgs(process.argv.slice(2));
  const apply = !options.dryRun;
  if (apply && !options.confirmed) throw new Error(`Apply mode requires ${CONFIRM_FLAG}.`);

  const guard = assertScriptApplyAllowed({
    apply,
    scriptName: 'retire school-as-department roster observations',
    mongoUrl: process.env.MONGODBURL,
  });
  console.log(
    `Environment: ${guard.environment}; Mongo target: ${guard.dbLabel}; mode: ${apply ? 'apply' : 'dry-run'}`,
  );

  await initializeConnections();
  try {
    const result = await runRetireSchoolAsDepartment({
      dryRun: options.dryRun,
      limit: options.limit,
    });
    if (options.output) {
      const safeOutput = resolveSafeJsonReportOutputPath(options.output);
      fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
      fs.writeFileSync(
        safeOutput,
        JSON.stringify(
          { generatedAt: new Date().toISOString(), environment: guard.environment, result },
          null,
          2,
        ),
      );
      console.log(`Saved report to ${safeOutput}`);
    }
    console.log(
      JSON.stringify(
        {
          mode: result.mode,
          ...result.plan,
          claimedDepartments: result.claimedDepartments,
          retiredObservations: result.retiredObservations,
          clearedStoredDepartments: result.clearedStoredDepartments,
          rematerializedPeople: result.rematerializedPeople,
          researchersStoringASchool: result.researchersStoringASchool,
        },
        null,
        2,
      ),
    );
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

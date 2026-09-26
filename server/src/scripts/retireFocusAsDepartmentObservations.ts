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
import {
  orgUnitMatchKey,
  resetOrgUnitCanonicalizerCache,
} from '../scrapers/orgUnitCanonicalization';
import { serializedDocumentId } from '../utils/idSerialization';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  planSchoolAsDepartmentRetirement,
  type SchoolAsDepartmentObservationRow,
} from './retireSchoolAsDepartmentObservationsCore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const SCRIPT_NAME = 'observations:retire-focus-as-department';
export const CONFIRM_FLAG = '--confirm-retire-focus-as-department';
const DEPARTMENT_CLAIMING_FIELDS = ['primaryDepartment', 'departments'];

export const FOCUS_AS_DEPARTMENT_ROLLBACK_REASON =
  'interdepartmental focus retired from the department slot';

/**
 * Cross-cutting groupings Yale School of Public Health publishes under
 * "Interdepartmental Foci", concentrations and tracks, none of which is a home
 * department. A lane pointed at one lists a person because their research falls in
 * that area, so stamping the grouping as their department fabricates an
 * appointment: the 19 rows carrying "Global Health" have titles naming
 * Epidemiology, Environmental Health Sciences, Biostatistics and Nursing (#2866).
 *
 * A closed list rather than "anything the catalog does not know", because an
 * uncatalogued value is usually a real division the catalog is missing - #2867
 * seeded 17 of those - and clearing those would destroy true labels.
 */
export const NEVER_A_HOME_DEPARTMENT_VALUES = [
  'Global Health',
  'Climate Change and Health',
  'Implementation Science',
  'Maternal and Child Health Promotion',
  'Public Health Modeling',
  'U.S. Health Justice',
  // The org-unit key slugifies "U.S." to "u-s", so a stored spelling without the
  // periods does not share a key with the published one and needs its own entry.
  'US Health Justice',
] as const;

export interface RetireFocusAsDepartmentOptions {
  dryRun: boolean;
  confirmed: boolean;
  output?: string;
}

export function parseRetireFocusAsDepartmentArgs(argv: string[]): RetireFocusAsDepartmentOptions {
  const options: RetireFocusAsDepartmentOptions = { dryRun: true, confirmed: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') options.dryRun = false;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === CONFIRM_FLAG) options.confirmed = true;
    else if (arg === '--output') {
      options.output = resolveSafeJsonReportOutputPath(argv[i + 1]);
      i += 1;
    } else if (arg.startsWith('--output=')) {
      options.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
    } else throw new Error(`Unknown ${SCRIPT_NAME} argument: ${arg}`);
  }
  return options;
}

/**
 * A value on the closed list is only retired while the catalog still does not
 * publish it as a department or division. If one is ever promoted to a real
 * org unit, this repair stops matching it rather than clearing a true label.
 */
export function buildFocusNamePredicate(
  rows: Array<{ name: string; kind: string; aliases?: string[] }>,
): (value: string) => boolean {
  const departmentKeys = new Set<string>();
  for (const row of rows) {
    if (row.kind !== 'DEPARTMENT' && row.kind !== 'SECTION' && row.kind !== 'DIVISION') continue;
    for (const value of [row.name, ...(row.aliases || [])]) {
      const key = orgUnitMatchKey(value);
      if (key) departmentKeys.add(key);
    }
  }
  const focusKeys = new Set(
    NEVER_A_HOME_DEPARTMENT_VALUES.map((value) => orgUnitMatchKey(value)).filter(Boolean),
  );
  return (value: string): boolean => {
    const key = orgUnitMatchKey(value);
    if (!key || departmentKeys.has(key)) return false;
    return focusKeys.has(key);
  };
}

async function main(): Promise<void> {
  const options = parseRetireFocusAsDepartmentArgs(process.argv.slice(2));
  assertScriptApplyAllowed({
    apply: !options.dryRun,
    scriptName: SCRIPT_NAME,
    mongoUrl: process.env.MONGODBURL,
  });
  if (!options.dryRun && !options.confirmed) {
    throw new Error(`${SCRIPT_NAME} apply requires ${CONFIRM_FLAG}`);
  }

  await initializeConnections();
  resetOrgUnitCanonicalizerCache();

  const orgUnits = (await OrgUnit.find({ archived: { $ne: true } })
    .select('name kind aliases')
    .lean()) as unknown as Array<{ name: string; kind: string; aliases?: string[] }>;
  const isFocusName = buildFocusNamePredicate(orgUnits);

  // Selected on the VALUE rather than on the lane that wrote it, the way #2841
  // established: a focus is never a home department whatever produced it, and a
  // source pin would miss every other lane that ever stamped one.
  const observationDocs = (await Observation.find({
    entityType: 'user',
    field: { $in: DEPARTMENT_CLAIMING_FIELDS },
    superseded: { $ne: true },
  })
    .select('_id entityKey field value sourceUrl')
    .lean()) as unknown as Array<{
    _id: unknown;
    entityKey: string;
    field: string;
    value: unknown;
    sourceUrl?: string;
  }>;
  const observations: SchoolAsDepartmentObservationRow[] = observationDocs.flatMap((row) => {
    const id = serializedDocumentId(row._id);
    return id
      ? [
          {
            id,
            entityKey: row.entityKey,
            field: row.field,
            value: row.value,
            sourceUrl: row.sourceUrl,
          },
        ]
      : [];
  });

  const plan = planSchoolAsDepartmentRetirement(observations, isFocusName);

  const storedIds = (
    await Researcher.find({
      archived: { $ne: true },
      'profile.primaryDepartment': { $in: [...NEVER_A_HOME_DEPARTMENT_VALUES] },
    })
      .select('_id')
      .lean()
  ).map((row: { _id: unknown }) => row._id);

  let retiredObservations = 0;
  let clearedStoredDepartments = 0;
  let rematerializedPeople = 0;

  if (!options.dryRun) {
    for (const row of plan.rows) {
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
              reason: FOCUS_AS_DEPARTMENT_ROLLBACK_REASON,
            },
          },
        },
      );
      retiredObservations += result.modifiedCount || 0;
    }
    // Retiring the observation does not clear the document: materializeEntity only
    // writes a field it can resolve, so a person whose only department claim was the
    // focus would keep it forever.
    if (storedIds.length > 0) {
      const cleared = await Researcher.updateMany(
        { _id: { $in: storedIds } },
        { $unset: { 'profile.primaryDepartment': '' } },
      );
      clearedStoredDepartments = cleared.modifiedCount || 0;
    }
    // Rebuild through the ordinary materializer so a surviving observation decides
    // the replacement department and every guard on that path still applies.
    for (const row of plan.rows) {
      await materializeEntity('user', { entityKey: row.entityKey });
      rematerializedPeople += 1;
    }
  }

  const stillStored = await Researcher.countDocuments({
    archived: { $ne: true },
    'profile.primaryDepartment': { $in: [...NEVER_A_HOME_DEPARTMENT_VALUES] },
  });

  const report = {
    script: SCRIPT_NAME,
    mode: options.dryRun ? 'dry-run' : 'apply',
    retiredValues: [...NEVER_A_HOME_DEPARTMENT_VALUES],
    observationsScanned: observations.length,
    peopleWithAFocusClaim: plan.rows.length,
    observationsPlannedForRetirement: plan.rows.reduce(
      (total, row) => total + row.observationIds.length,
      0,
    ),
    storedFocusDepartmentsBefore: storedIds.length,
    retiredObservations,
    clearedStoredDepartments,
    rematerializedPeople,
    storedFocusDepartmentsAfter: stillStored,
  };
  console.log(JSON.stringify(report, null, 2));

  if (options.output) {
    fs.mkdirSync(path.dirname(options.output), { recursive: true });
    fs.writeFileSync(options.output, JSON.stringify(report, null, 2));
    console.log(`Saved report to ${options.output}`);
  }

  await mongoose.disconnect();
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isDirectRun) {
  main().catch((error) => {
    console.error(sanitizeLogValue(error instanceof Error ? error.message : error));
    process.exit(1);
  });
}

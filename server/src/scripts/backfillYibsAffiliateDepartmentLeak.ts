/**
 * Backfill for the YIBS faculty-affiliates department leak (#1427).
 *
 * The `dept-faculty-roster` scraper's `yibs` config scraped
 * `https://yibs.yale.edu/people/faculty-affiliates` - a cross-cutting
 * institute *affiliates* listing, not a home-department roster - and stamped
 * "Biospheric Studies" onto every listed affiliate's `departments` and
 * `primaryDepartment`, overwriting real home departments (Mechanical
 * Engineering, Epidemiology, Ecology and Evolutionary Biology, ...) with the
 * institute's own label. The scraper no longer emits these fields for the
 * `yibs` config (see `departmentRosterScraper.ts`'s `affiliatesOnly` flag), so
 * this backfill (a) restores each affected user's own most recent non-YIBS
 * department observation (or clears the field when none exists) and (b)
 * retires the leaking observations so a future re-materialize cannot
 * re-inject them.
 *
 * Dry-run by default. Apply requires `--apply --confirm-yibs-department-backfill`.
 *
 *   yarn --cwd server tsx src/scripts/backfillYibsAffiliateDepartmentLeak.ts            # dry-run
 *   yarn --cwd server tsx src/scripts/backfillYibsAffiliateDepartmentLeak.ts --apply \
 *     --confirm-yibs-department-backfill
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose, { type AnyBulkWriteOperation } from 'mongoose';
import { initializeConnections } from '../db/connections';
import { User } from '../models/user';
import { Observation } from '../models/observation';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { stripUncorroboratedLeak } from './backfillCenterSeedDepartmentLeakCore';
import { planPrimaryDepartmentReplacement } from './backfillYibsAffiliateDepartmentLeakCore';

dotenv.config();

const LEAKED_DEPARTMENT = 'Biospheric Studies';
const YIBS_SOURCE_URL = 'https://yibs.yale.edu/people/faculty-affiliates';

interface CliOptions {
  apply: boolean;
  confirm: boolean;
  output?: string;
}

export function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { apply: false, confirm: false };
  for (const arg of argv) {
    if (arg === '--apply') options.apply = true;
    else if (arg === '--confirm-yibs-department-backfill') options.confirm = true;
    else if (arg.startsWith('--output=')) {
      options.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (options.apply && !options.confirm) {
    throw new Error('--confirm-yibs-department-backfill is required when --apply is set.');
  }
  return options;
}

interface PlannedUpdate {
  netid: string;
  name: string;
  departments?: { from: string[]; to: string[]; removed: string[] };
  primaryDepartment?: { from: string | undefined; to: string | undefined };
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

interface OwnEvidence {
  departments: string[];
  latestPrimaryDepartment?: string;
}

/**
 * Every scraper guesses a `user` entityKey from whatever identifier it found
 * on its own roster page (a real netid, or a slugified name/email local-part
 * when no netid is visible) - so the same real person can be observed under
 * several different entityKeys across sources (e.g. `netid:amd78` from one
 * roster, `netid:aaron.dollar` from another), all reconciled onto one User
 * doc via email match at materialize time. Restoring this user's own
 * (non-YIBS) department evidence therefore has to walk every entityKey that
 * resolves to them by email or by their real netid, not just `netid:<netid>`.
 */
async function entityKeysForUser(netid: string, email: string | undefined): Promise<string[]> {
  const keys = new Set<string>([`netid:${netid}`]);
  if (email) {
    const emailObs = await Observation.find({
      entityType: 'user',
      field: 'email',
      value: email.toLowerCase(),
    })
      .select('entityKey')
      .lean();
    for (const o of emailObs as Array<{ entityKey?: unknown }>) {
      if (typeof o.entityKey === 'string') keys.add(o.entityKey);
    }
  }
  return [...keys];
}

async function ownEvidenceForUser(netid: string, email: string | undefined): Promise<OwnEvidence> {
  const entityKeys = await entityKeysForUser(netid, email);
  const obs = await Observation.find({
    entityKey: { $in: entityKeys },
    field: { $in: ['departments', 'primaryDepartment'] },
    sourceUrl: { $ne: YIBS_SOURCE_URL },
    superseded: { $ne: true },
  })
    .select('field value observedAt')
    .sort({ observedAt: -1 })
    .lean();

  const departments = new Set<string>();
  let latestPrimaryDepartment: string | undefined;
  for (const o of obs as Array<{ field?: unknown; value?: unknown; observedAt?: unknown }>) {
    if (o.field === 'departments') {
      for (const v of asStringArray(o.value)) departments.add(v);
    } else if (o.field === 'primaryDepartment' && !latestPrimaryDepartment) {
      const text = typeof o.value === 'string' ? o.value.trim() : '';
      if (text) latestPrimaryDepartment = text;
    }
  }
  return { departments: [...departments], latestPrimaryDepartment };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const guard = assertScriptApplyAllowed({
    apply: options.apply,
    scriptName: 'backfillYibsAffiliateDepartmentLeak',
    mongoUrl: process.env.MONGODBURL,
  });
  await initializeConnections();

  const affected = await User.find({
    $or: [{ departments: LEAKED_DEPARTMENT }, { primaryDepartment: LEAKED_DEPARTMENT }],
  })
    .select({ netid: 1, email: 1, fname: 1, lname: 1, departments: 1, primaryDepartment: 1 })
    .lean();

  const plannedUpdates: PlannedUpdate[] = [];
  for (const user of affected as Array<{
    netid?: unknown;
    email?: unknown;
    fname?: unknown;
    lname?: unknown;
    departments?: unknown;
    primaryDepartment?: unknown;
  }>) {
    const netid = typeof user.netid === 'string' ? user.netid : '';
    if (!netid) continue;
    const email = typeof user.email === 'string' ? user.email : undefined;
    const name = [user.fname, user.lname].filter(Boolean).join(' ');
    const currentDepts = asStringArray(user.departments);
    const currentPrimary =
      typeof user.primaryDepartment === 'string' ? user.primaryDepartment : undefined;

    const own = await ownEvidenceForUser(netid, email);
    const ownObserved = own.latestPrimaryDepartment
      ? [...own.departments, own.latestPrimaryDepartment]
      : own.departments;

    const deptResult = stripUncorroboratedLeak({
      current: currentDepts,
      ownObserved,
      leaked: [LEAKED_DEPARTMENT],
    });
    // The YIBS scrape overwrote (not appended to) `departments`, so a strip
    // that empties the array should repopulate it from the affiliate's own
    // evidence rather than leave a real, multi-department person blank.
    const restoredDepartments =
      deptResult.cleaned.length > 0
        ? deptResult.cleaned
        : [...new Set(own.departments.length > 0 ? own.departments : ownObserved)];
    const departmentsChanged =
      restoredDepartments.length !== currentDepts.length ||
      restoredDepartments.some((d, i) => d !== currentDepts[i]);
    const primaryResult = planPrimaryDepartmentReplacement({
      currentPrimaryDepartment: currentPrimary,
      leaked: LEAKED_DEPARTMENT,
      ownObserved,
      latestOwnPrimaryDepartment: own.latestPrimaryDepartment,
      fallbackDepartments: restoredDepartments,
    });

    if (!departmentsChanged && !primaryResult.changed) continue;
    plannedUpdates.push({
      netid,
      name,
      ...(departmentsChanged
        ? {
            departments: {
              from: currentDepts,
              to: restoredDepartments,
              removed: deptResult.removed,
            },
          }
        : {}),
      ...(primaryResult.changed
        ? { primaryDepartment: { from: currentPrimary, to: primaryResult.to } }
        : {}),
    });
  }

  const summary = {
    mode: options.apply ? 'apply' : 'dry-run',
    environment: guard.environment,
    db: guard.dbLabel,
    scannedAffected: affected.length,
    usersChanged: plannedUpdates.length,
    departmentsCleaned: plannedUpdates.filter((u) => u.departments).length,
    primaryDepartmentCleaned: plannedUpdates.filter((u) => u.primaryDepartment).length,
    legacyObservationsRetired: 0,
  };

  if (options.apply && plannedUpdates.length > 0) {
    const operations: AnyBulkWriteOperation[] = plannedUpdates.map((u) => {
      const set: Record<string, unknown> = {};
      const unset: Record<string, ''> = {};
      if (u.departments) set.departments = u.departments.to;
      if (u.primaryDepartment) {
        if (u.primaryDepartment.to === undefined) unset.primaryDepartment = '';
        else set.primaryDepartment = u.primaryDepartment.to;
      }
      const update: Record<string, unknown> = {};
      if (Object.keys(set).length > 0) update.$set = set;
      if (Object.keys(unset).length > 0) update.$unset = unset;
      return { updateOne: { filter: { netid: u.netid }, update } };
    });
    await User.bulkWrite(operations, { ordered: false });

    const retire = await Observation.updateMany(
      {
        entityType: 'user',
        field: { $in: ['departments', 'primaryDepartment'] },
        sourceUrl: YIBS_SOURCE_URL,
        superseded: { $ne: true },
      },
      { $set: { superseded: true } },
    );
    summary.legacyObservationsRetired = retire.modifiedCount ?? 0;
  }

  const output = { summary, entries: plannedUpdates };
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
      console.error('Failed to backfill YIBS affiliate department leak:', sanitizeLogValue(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}

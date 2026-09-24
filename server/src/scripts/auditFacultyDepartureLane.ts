/**
 * research-entity:audit-departure-lane - reads what the faculty-departure lane
 * would do, without enabling it (#2428).
 *
 * `SCRAPER_FACULTY_DEPARTURE_DETECTION` is read in one file and set nowhere, so no
 * operator could enable the lane without already knowing the string exists, and
 * its dormancy was invisible: the lane had never evaluated a row in any
 * environment and that silence read as "no departures happened". This is the
 * documented way in. It plans, it never writes, and it never needs the flag.
 *
 * It takes the plan from the reconciler itself rather than reimplementing the
 * decision, so the audit cannot disagree with the lane about what it would do.
 *
 *   yarn --cwd server research-entity:audit-departure-lane
 *   yarn --cwd server research-entity:audit-departure-lane --run <scrapeRunId>
 *   yarn --cwd server research-entity:audit-departure-lane --output "$TMPDIR/departure.json"
 *
 * There is deliberately no `--apply`. Suppression removes a research home from the
 * directory, so it happens only through a materialize pass with the flag
 * explicitly on, after the plan here has been read.
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { Observation } from '../models/observation';
import { ResearchEntity } from '../models/researchEntity';
import {
  DEPARTMENT_ROSTER_HEALTH_FIELD,
  facultyRosterDepartureDetectionEnabled,
  reconcileFacultyRosterDeparturesFromRun,
} from '../scrapers/facultyRosterDepartureReconciler';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  summarizeFacultyDepartureLaneAudit,
  type FacultyDepartureLaneFacts,
} from './auditFacultyDepartureLaneCore';

export interface FacultyDepartureLaneAuditOptions {
  runId?: string;
  output?: string;
}

export function parseFacultyDepartureLaneAuditArgs(
  argv: string[],
): FacultyDepartureLaneAuditOptions {
  const options: FacultyDepartureLaneAuditOptions = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--run') {
      const raw = argv[(index += 1)];
      if (!raw) throw new Error('--run requires a scrapeRunId');
      options.runId = raw.trim();
    } else if (arg.startsWith('--run=')) {
      const raw = arg.slice('--run='.length).trim();
      if (!raw) throw new Error('--run requires a scrapeRunId');
      options.runId = raw;
    } else if (arg === '--output') {
      options.output = resolveSafeJsonReportOutputPath(argv[(index += 1)]);
    } else if (arg.startsWith('--output=')) {
      options.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
    } else if (arg === '--apply') {
      throw new Error(
        'research-entity:audit-departure-lane never writes: enable SCRAPER_FACULTY_DEPARTURE_DETECTION on a materialize pass instead',
      );
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

/** The most recent run carrying live roster-health snapshots, the lane's input. */
export async function latestRosterHealthRunId(): Promise<string | undefined> {
  const latest = await Observation.findOne({
    entityType: 'departmentRosterHealth',
    field: DEPARTMENT_ROSTER_HEALTH_FIELD,
    superseded: { $ne: true },
  })
    .sort({ observedAt: -1 })
    .select('scrapeRunId')
    .lean();
  const runId = (latest as { scrapeRunId?: unknown } | null)?.scrapeRunId;
  return runId ? String(runId) : undefined;
}

async function main(): Promise<void> {
  const options = parseFacultyDepartureLaneAuditArgs(process.argv.slice(2));
  mongoose.set('autoIndex', false);
  await initializeConnections();
  try {
    const [rosterHealthObservations, rosterHealthRunIds] = await Promise.all([
      Observation.countDocuments({
        entityType: 'departmentRosterHealth',
        field: DEPARTMENT_ROSTER_HEALTH_FIELD,
        superseded: { $ne: true },
      }),
      Observation.distinct('scrapeRunId', {
        entityType: 'departmentRosterHealth',
        field: DEPARTMENT_ROSTER_HEALTH_FIELD,
        superseded: { $ne: true },
      }),
    ]);
    const runId = options.runId ?? (await latestRosterHealthRunId());
    const plan = runId
      ? await reconcileFacultyRosterDeparturesFromRun(runId, { dryRun: true })
      : undefined;

    const [
      liveEntities,
      entitiesWithLastSeen,
      entitiesWithAbsenceRecorded,
      entitiesReasonDeparted,
    ] = await Promise.all([
      ResearchEntity.countDocuments({ archived: { $ne: true } }),
      ResearchEntity.countDocuments({ lastSeenInCompleteRosterAt: { $exists: true, $ne: null } }),
      ResearchEntity.countDocuments({
        absentFromRosterSinceRunId: { $exists: true, $nin: ['', null] },
      }),
      ResearchEntity.countDocuments({ yaleStatusReasonCache: 'departed' }),
    ]);

    const facts: FacultyDepartureLaneFacts = {
      flagEnabled: facultyRosterDepartureDetectionEnabled(),
      rosterHealthObservations,
      rosterHealthRuns: rosterHealthRunIds.length,
      ...(runId ? { plannedRunId: runId } : {}),
      ...(plan ? { planOutcome: plan.outcome, plan: plan.planned } : {}),
      governedDepartments: plan?.governedDepartments.length ?? 0,
      unresolvedDepartments: plan?.unresolvedDepartments.length ?? 0,
      frozenDepartments: plan?.frozenDepartments ?? 0,
      liveEntities,
      entitiesWithLastSeen,
      entitiesWithAbsenceRecorded,
      entitiesReasonDeparted,
    };
    const report = summarizeFacultyDepartureLaneAudit(facts);
    const evidenceFreshness = plan?.evidenceFreshness;
    const output = {
      mode: 'plan',
      ...report,
      ...(evidenceFreshness ? { evidenceFreshness } : {}),
    };
    console.log(JSON.stringify(output, null, 2));
    if (evidenceFreshness) {
      if (evidenceFreshness.snapshotsDerived > 0) {
        console.warn(
          `[faculty-departure] ${evidenceFreshness.snapshotsDerived} of ${evidenceFreshness.snapshotsRead} ` +
            'snapshots record that their run did not read the department page, so their absences are ' +
            'derived rather than observed and they govern no row',
        );
      }
      if (evidenceFreshness.snapshotsUnrecorded > 0) {
        console.warn(
          `[faculty-departure] ${evidenceFreshness.snapshotsUnrecorded} of ${evidenceFreshness.snapshotsRead} ` +
            'snapshots predate the read record, so whether their department page was read is unknown ' +
            'rather than false: re-run the roster lane before enabling the departure lane',
        );
      }
      if (
        evidenceFreshness.planningRunFetchesSucceeded === 0 &&
        evidenceFreshness.snapshotsObserved === 0
      ) {
        console.warn(
          '[faculty-departure] the planning run records no successful page read, so nothing in this ' +
            'plan rests on an observation: do not enable the lane on the strength of its snapshot dates',
        );
      }
    }
    // The per-row explanations go only to the report file. An operator needs them to
    // answer "why this row", and a thousand of them on a terminal is how a reader
    // stops reading, which is the failure this whole audit exists to prevent.
    if (options.output) {
      const rows = plan?.plannedRows ?? [];
      fs.mkdirSync(path.dirname(options.output), { recursive: true });
      fs.writeFileSync(
        options.output,
        `${JSON.stringify({ ...output, plannedRowCount: rows.length, plannedRows: rows }, null, 2)}\n`,
      );
      console.log(`\nReport written to ${options.output} (${rows.length} per-row explanations)`);
    } else if ((plan?.plannedRows.length ?? 0) > 0) {
      console.log(
        `\n${plan?.plannedRows.length} rows were decided; re-run with --output <path> to read why each one.`,
      );
    }
  } finally {
    await mongoose.disconnect();
  }
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isDirectRun) {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  dotenv.config({ path: path.resolve(__dirname, '../../.env') });
  main().catch((error) => {
    console.error('Failed to audit the faculty-departure lane:', sanitizeLogValue(error));
    process.exitCode = 1;
  });
}

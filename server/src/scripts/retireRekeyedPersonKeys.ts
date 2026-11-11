/**
 * observations:retire-rekeyed-person-keys - retires the live observations a person lane left
 * on a key it later re-keyed (#5817), for the keys stored before the lane retired them at
 * write time. It runs the planner the lanes run, over the stored reads, and never deletes.
 *
 * A dry run by default: it reports counts by lane, pair and category, checks every planned key
 * against the engine's researcher join, and projects every twin key and every row naming an
 * old key through the engine with and without the planned observations.
 *
 *   yarn --cwd server observations:retire-rekeyed-person-keys --lanes=dept-faculty-roster \
 *     --detail-output=<tmp>.json
 *   DEV_WRITE_OWNER=<session> yarn --cwd server observations:retire-rekeyed-person-keys \
 *     --lanes=<same list> --apply --confirm-retire-rekeyed-person-keys --detail-output=<tmp>.json
 */
import dotenv from 'dotenv';
import fs from 'fs';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeConnections } from '../db/connections';
import { Observation } from '../models/observation';
import { ResearchEntity } from '../models/researchEntity';
import { materializationReadScopeFilter } from '../scrapers/entityMaterializer';
import {
  isRekeyingPersonLane,
  personKeyRecordsFromObservations,
  planRekeyedPersonKeyRetirements,
  rekeyPlanCounts,
  type LanePersonObservation,
  type PersonKeyRecord,
  type RekeyingPersonLane,
  type RekeyPlanCounts,
} from '../scrapers/rekeyedPersonKeyPlan';
import {
  checkTwinJoins,
  governingReadsFromStoredRuns,
  loadDirectoryIdentityIndex,
  loadLanePersonObservations,
  loadStoredRuns,
  retireRekeyedPersonKeyPairs,
  type JoinCheckedPlan,
  type UserKeyJoinReader,
} from '../scrapers/rekeyedPersonKeyRetirement';
import { runWithBoundedConcurrency } from '../scrapers/utils/boundedConcurrency';
import { serializedDocumentId } from '../utils/idSerialization';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { projectRow, retiredIdentityKey } from './retireOrphanedLaneConfigs';
import { servedFieldChanges, type ServedFieldChange } from './retireOrphanedLaneConfigsCore';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../../.env'), quiet: true });

export const SCRIPT_NAME = 'observations:retire-rekeyed-person-keys';
export const CONFIRM_FLAG = '--confirm-retire-rekeyed-person-keys';
export const ACCEPT_SERVED_CHANGES_FLAG = '--accept-served-changes';
const SERVED_TIER = 'student_ready';
const PROJECTION_CONCURRENCY = 8;

export interface RetireRekeyedPersonKeysOptions {
  apply: boolean;
  confirmed: boolean;
  acceptServedChanges: boolean;
  lanes: RekeyingPersonLane[];
  detailOutput?: string;
}

export function parseRetireRekeyedPersonKeysArgs(argv: string[]): RetireRekeyedPersonKeysOptions {
  const options: RetireRekeyedPersonKeysOptions = {
    apply: false,
    confirmed: false,
    acceptServedChanges: false,
    lanes: [],
  };
  const valueOf = (arg: string, flag: string, index: number): [string, number] =>
    arg === flag ? [argv[index + 1] ?? '', index + 1] : [arg.slice(flag.length + 1), index];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') options.apply = true;
    else if (arg === '--dry-run') options.apply = false;
    else if (arg === CONFIRM_FLAG) options.confirmed = true;
    else if (arg === ACCEPT_SERVED_CHANGES_FLAG) options.acceptServedChanges = true;
    else if (arg === '--lanes' || arg.startsWith('--lanes=')) {
      const [value, next] = valueOf(arg, '--lanes', i);
      for (const lane of value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)) {
        if (!isRekeyingPersonLane(lane))
          throw new Error(`${SCRIPT_NAME} does not plan lane ${lane}`);
        if (!options.lanes.includes(lane)) options.lanes.push(lane);
      }
      i = next;
    } else if (arg === '--detail-output' || arg.startsWith('--detail-output=')) {
      const [value, next] = valueOf(arg, '--detail-output', i);
      options.detailOutput = resolveSafeJsonReportOutputPath(value, '--detail-output');
      i = next;
    } else throw new Error(`Unknown ${SCRIPT_NAME} argument: ${arg}`);
  }
  if (options.lanes.length === 0) {
    throw new Error(`${SCRIPT_NAME} requires --lanes, so a run names exactly what it judges`);
  }
  return options;
}

const SCHOOL_DIRECTORY_LANES: ReadonlySet<string> = new Set([
  'ysm-faculty-directory',
  'yse-faculty-directory',
]);

function laneWideNameCensus(
  records: readonly PersonKeyRecord[],
  governedRunByPage: ReadonlyMap<string, string>,
): Map<string, number> {
  const census = new Map<string, number>();
  for (const record of records) {
    if (!record.nameKey) continue;
    const governed = [...record.listingPages].some(([page, presence]) => {
      const runId = governedRunByPage.get(page);
      return Boolean(runId) && presence.runIds.has(runId!);
    });
    if (governed) census.set(record.nameKey, (census.get(record.nameKey) ?? 0) + 1);
  }
  return census;
}

export interface LanePlanReport {
  liveKeys: number;
  governedListingPages: number;
  counts: RekeyPlanCounts;
  held: Record<string, number>;
  twinJoinBasis: Record<string, number>;
  wouldRetireKeys: number;
  wouldRetireObservations: number;
}

interface LanePlanResult {
  lane: RekeyingPersonLane;
  checked: JoinCheckedPlan;
  observations: LanePersonObservation[];
  report: LanePlanReport;
}

function tally(values: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of [...values].sort()) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}

export async function planLane(input: {
  lane: RekeyingPersonLane;
  readJoins?: UserKeyJoinReader;
  log?: (message: string) => void;
}): Promise<LanePlanResult> {
  const observations = await loadLanePersonObservations(input.lane);
  const records = [...personKeyRecordsFromObservations(observations).values()];
  const runs = await loadStoredRuns(
    records.flatMap((record) => [...record.listingPages.values()].flatMap((p) => [...p.runIds])),
  );
  const reads = governingReadsFromStoredRuns(records, runs);
  const governedRunByPage = new Map(reads.map((read) => [read.pageKey, read.runId]));
  const plan = planRekeyedPersonKeyRetirements({
    records,
    reads,
    directory: await loadDirectoryIdentityIndex(),
    laneNameCensus: SCHOOL_DIRECTORY_LANES.has(input.lane)
      ? laneWideNameCensus(records, governedRunByPage)
      : undefined,
  });
  input.log?.(
    `${input.lane}: ${plan.admitted.length} admitted keys to check against the twin join`,
  );
  const checked = await checkTwinJoins(plan, input.readJoins, (done, total) => {
    if (done % 250 === 0 || done === total)
      input.log?.(`${input.lane}: twin join ${done}/${total}`);
  });
  return {
    lane: input.lane,
    checked,
    observations,
    report: {
      liveKeys: records.length,
      governedListingPages: reads.length,
      counts: rekeyPlanCounts(plan),
      held: tally(checked.held.map((pair) => pair.reason)),
      twinJoinBasis: tally(checked.retire.map((pair) => pair.basis)),
      wouldRetireKeys: checked.retire.length,
      wouldRetireObservations: checked.retire.reduce(
        (sum, pair) => sum + pair.observationIds.length,
        0,
      ),
    },
  };
}

export interface ProjectedSubjectDiff {
  entityType: 'user' | 'researchEntity';
  entityKey: string;
  served?: boolean;
  changes: ServedFieldChange[];
  skippedWithoutRetired?: string;
  retiredEvidenceReadLive: number;
}

export interface ProjectionReport {
  twinKeysProjected: number;
  twinKeysWithChanges: number;
  twinFieldChangeCounts: Record<string, number>;
  twinKeysWithRetiredEvidenceReadLive: number;
  rowsNamingAnOldKey: number;
  servedRowsNamingAnOldKey: number;
  rowsWithChanges: number;
  servedRowsWithChanges: number;
  servedFieldChangeCounts: Record<string, number>;
  servedFieldsBecomingEmpty: Record<string, number>;
  servedFieldsBecomingLessComplete: Record<string, number>;
  rowsWithRetiredEvidenceReadLive: number;
}

async function rowsNamingKeys(keys: readonly string[]): Promise<Array<Record<string, unknown>>> {
  if (keys.length === 0) return [];
  const filter: Record<string, unknown> = {
    entityType: { $in: ['researchEntity', 'researchGroup'] },
    field: 'inferredPiUserKey',
    value: { $in: [...keys] },
    ...materializationReadScopeFilter(),
  };
  const naming = await Observation.find(filter, { entityKey: 1, entityId: 1 }).lean<
    Array<{ entityKey?: string; entityId?: unknown }>
  >();
  const slugs = new Set(naming.map((row) => row.entityKey).filter(Boolean) as string[]);
  const ids = naming
    .map((row) => serializedDocumentId(row.entityId))
    .filter((id): id is string => Boolean(id) && mongoose.Types.ObjectId.isValid(id!));
  return ResearchEntity.find(
    {
      archived: { $ne: true },
      $or: [
        { slug: { $in: [...slugs] } },
        { _id: { $in: ids.map((id) => new mongoose.Types.ObjectId(id)) } },
      ],
    },
    { slug: 1, studentVisibilityTier: 1 },
  ).lean<Array<Record<string, unknown>>>();
}

export async function projectRetirement(input: {
  lanes: readonly LanePlanResult[];
  log?: (message: string) => void;
}): Promise<{ report: ProjectionReport; subjects: ProjectedSubjectDiff[] }> {
  const pairs = input.lanes.flatMap((lane) => lane.checked.retire);
  const excludedIds = pairs
    .flatMap((pair) => pair.observationIds)
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map((id) => new mongoose.Types.ObjectId(id));
  const retiredIdentities = new Set(pairs.map((pair) => retiredIdentityKey('user', pair.oldKey)));
  const fieldById = new Map(
    input.lanes.flatMap((lane) => lane.observations.map((row) => [row.id, row.field] as const)),
  );
  const fieldsByTwin = new Map<string, Set<string>>();
  for (const pair of pairs) {
    const fields = fieldsByTwin.get(pair.newKey) ?? new Set<string>();
    for (const id of pair.observationIds) {
      const field = fieldById.get(id);
      if (field) fields.add(field);
    }
    fieldsByTwin.set(pair.newKey, fields);
  }
  const subjects: ProjectedSubjectDiff[] = [];
  const twins = [...fieldsByTwin.keys()].sort();
  let projectedTwins = 0;
  await runWithBoundedConcurrency(twins, PROJECTION_CONCURRENCY, async (twin) => {
    const onlyFields = [...(fieldsByTwin.get(twin) ?? [])].sort();
    const withRetired = await projectRow('user', twin, [], retiredIdentities, onlyFields);
    const withoutRetired = await projectRow(
      'user',
      twin,
      excludedIds,
      retiredIdentities,
      onlyFields,
    );
    subjects.push({
      entityType: 'user',
      entityKey: twin,
      changes: servedFieldChanges({
        stored: {},
        withOrphans: withRetired,
        withoutOrphans: withoutRetired,
        creditedFields: new Set(),
      }),
      ...(withoutRetired.skipped && !withRetired.skipped
        ? { skippedWithoutRetired: withoutRetired.skipped }
        : {}),
      retiredEvidenceReadLive: withoutRetired.retiredEvidenceReadLive,
    });
    projectedTwins += 1;
    if (projectedTwins % 100 === 0) {
      input.log?.(`projected twin key ${projectedTwins} of ${twins.length}`);
    }
  });
  const rows = await rowsNamingKeys([...new Set(pairs.map((pair) => pair.oldKey))]);
  await runWithBoundedConcurrency(rows, PROJECTION_CONCURRENCY, async (row) => {
    const slug = String(row.slug ?? '');
    const withRetired = await projectRow('researchEntity', slug, [], retiredIdentities);
    const withoutRetired = await projectRow('researchEntity', slug, excludedIds, retiredIdentities);
    subjects.push({
      entityType: 'researchEntity',
      entityKey: slug,
      served: row.studentVisibilityTier === SERVED_TIER,
      changes: servedFieldChanges({
        stored: row,
        withOrphans: withRetired,
        withoutOrphans: withoutRetired,
        creditedFields: new Set(),
      }),
      ...(withoutRetired.skipped && !withRetired.skipped
        ? { skippedWithoutRetired: withoutRetired.skipped }
        : {}),
      retiredEvidenceReadLive: withoutRetired.retiredEvidenceReadLive,
    });
  });
  subjects.sort((left, right) =>
    `${left.entityType}:${left.entityKey}`.localeCompare(`${right.entityType}:${right.entityKey}`),
  );
  const twinDiffs = subjects.filter((subject) => subject.entityType === 'user');
  const rowDiffs = subjects.filter((subject) => subject.entityType === 'researchEntity');
  const servedRows = rowDiffs.filter((subject) => subject.served);
  const changed = (subject: ProjectedSubjectDiff) =>
    subject.changes.length > 0 || Boolean(subject.skippedWithoutRetired);
  return {
    report: {
      twinKeysProjected: twinDiffs.length,
      twinKeysWithChanges: twinDiffs.filter(changed).length,
      twinFieldChangeCounts: tally(twinDiffs.flatMap((s) => s.changes.map((c) => c.field))),
      twinKeysWithRetiredEvidenceReadLive: twinDiffs.filter((s) => s.retiredEvidenceReadLive > 0)
        .length,
      rowsNamingAnOldKey: rowDiffs.length,
      servedRowsNamingAnOldKey: servedRows.length,
      rowsWithChanges: rowDiffs.filter(changed).length,
      servedRowsWithChanges: servedRows.filter(changed).length,
      servedFieldChangeCounts: tally(servedRows.flatMap((s) => s.changes.map((c) => c.field))),
      servedFieldsBecomingEmpty: tally(
        servedRows.flatMap((s) => s.changes.filter((c) => c.becomesEmpty).map((c) => c.field)),
      ),
      servedFieldsBecomingLessComplete: tally(
        servedRows.flatMap((s) =>
          s.changes.filter((c) => c.becomesLessComplete).map((c) => c.field),
        ),
      ),
      rowsWithRetiredEvidenceReadLive: rowDiffs.filter((s) => s.retiredEvidenceReadLive > 0).length,
    },
    subjects,
  };
}

export interface RetireRekeyedPersonKeysReport {
  mode: 'dry-run' | 'apply';
  lanes: Record<string, LanePlanReport>;
  projection: ProjectionReport;
  retiredObservations: number;
}

export async function runRekeyedPersonKeyRetirement(input: {
  apply: boolean;
  acceptServedChanges?: boolean;
  lanes: readonly RekeyingPersonLane[];
  readJoins?: UserKeyJoinReader;
  log?: (message: string) => void;
}): Promise<{
  report: RetireRekeyedPersonKeysReport;
  detail: Record<string, unknown>;
}> {
  const planned: LanePlanResult[] = [];
  for (const lane of input.lanes) {
    planned.push(await planLane({ lane, readJoins: input.readJoins, log: input.log }));
  }
  const projection = await projectRetirement({ lanes: planned, log: input.log });
  const servedChanges =
    projection.report.servedRowsWithChanges + projection.report.twinKeysWithChanges;
  if (input.apply && servedChanges > 0 && !input.acceptServedChanges) {
    throw new Error(
      `${SCRIPT_NAME} refuses to apply: the projection shows ${servedChanges} changed subject(s); review the dry run and pass ${ACCEPT_SERVED_CHANGES_FLAG} to accept them`,
    );
  }
  let retiredObservations = 0;
  if (input.apply) {
    for (const lane of planned) {
      retiredObservations += await retireRekeyedPersonKeyPairs(lane.lane, lane.checked.retire);
    }
  }
  return {
    report: {
      mode: input.apply ? 'apply' : 'dry-run',
      lanes: Object.fromEntries(planned.map((lane) => [lane.lane, lane.report])),
      projection: projection.report,
      retiredObservations,
    },
    detail: {
      lanes: Object.fromEntries(
        planned.map((lane) => [
          lane.lane,
          {
            retire: lane.checked.retire.map(({ observationIds, ...pair }) => ({
              ...pair,
              observations: observationIds.length,
            })),
            held: lane.checked.held.map(({ observationIds, ...pair }) => ({
              ...pair,
              observations: observationIds.length,
            })),
            refused: lane.checked.plan.refused,
            admissibleButNotReread: lane.checked.plan.admissibleButNotReread,
          },
        ]),
      ),
      projection: projection.subjects.filter(
        (subject) => subject.changes.length > 0 || subject.skippedWithoutRetired,
      ),
    },
  };
}

function writePrivateJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

async function main(): Promise<void> {
  const options = parseRetireRekeyedPersonKeysArgs(process.argv.slice(2));
  assertScriptApplyAllowed({
    apply: options.apply,
    scriptName: SCRIPT_NAME,
    mongoUrl: process.env.MONGODBURL,
  });
  if (options.apply && !options.confirmed) {
    throw new Error(`${SCRIPT_NAME} apply requires ${CONFIRM_FLAG}`);
  }
  await initializeConnections();
  try {
    const { report, detail } = await runRekeyedPersonKeyRetirement({
      apply: options.apply,
      acceptServedChanges: options.acceptServedChanges,
      lanes: options.lanes,
      log: (message) => console.error(`[${SCRIPT_NAME}] ${message}`),
    });
    if (options.detailOutput) writePrivateJson(options.detailOutput, { report, ...detail });
    console.log(JSON.stringify({ script: SCRIPT_NAME, ...report }, null, 2));
  } finally {
    await mongoose.disconnect();
  }
}

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(sanitizeLogValue(error instanceof Error ? error.message : error));
    process.exit(1);
  });
}

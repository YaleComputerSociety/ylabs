import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections, runScriptMain } from '../db/connections';
import { AdminAuditEvent } from '../models/adminAuditEvent';
import { Observation } from '../models/observation';
import { ResearchEntity } from '../models/researchEntity';
import { ScrapeRun } from '../models/scrapeRun';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertScriptApplyAllowed } from './scriptWriteGuards';
import { observationIdsBackingLockedFields } from './supersedeObservationsCore';
import { resolveAuditActor } from './unfoldResearcherShellCore';
import {
  chunk,
  MAX_RETIRE_IDS_PER_RUN,
  planObservationIdRetirement,
  RETIRE_AUDIT_BATCH_SIZE,
  RETIRE_OBSERVATION_IDS_AUDIT_ACTION,
  RETIRE_OBSERVATION_IDS_AUDIT_TARGET_TYPE,
  RETIRE_OBSERVATION_IDS_REASON_PREFIX,
  RETIRE_OBSERVATION_IDS_SCRIPT,
  type RetirePlanEntry,
} from './retireObservationIdsCore';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../../.env'), quiet: true });

const CONFIRM_FLAG = '--confirm-retire-observation-ids';
const RESTORE_FLAG = '--restore-superseded';
const MAX_REASON_LENGTH = 500 - RETIRE_OBSERVATION_IDS_REASON_PREFIX.length;
const OBJECT_ID_PATTERN = /^[0-9a-f]{24}$/i;
const SHA_PATTERN = /^[0-9a-f]{7,40}$/i;
const VALUE_FLAGS = ['run', 'ids-file', 'reason', 'actor', 'floor-sha'];

export const RETIRE_OBSERVATION_IDS_HELP = `${RETIRE_OBSERVATION_IDS_SCRIPT}: retires a named set of live observations from ONE scrape run.
  --run=<scrapeRunId> --ids-file=<path> --reason=<text> [--apply ${CONFIRM_FLAG}] [${RESTORE_FLAG} --floor-sha=<sha>] [--actor=<who>]
The ids file is a JSON array of observation ids or one id per line. The whole batch is refused, writing
nothing, when an id does not exist, belongs to another run, is not live, or backs an owner-decided value
(an operator-authored source or a manuallyLockedFields provenance). Ids this tool already retired are
reported and skipped, so a second run is a no-op. It reports how many retired observations had superseded
a predecessor and restores none unless ${RESTORE_FLAG} is given, which restores only predecessors whose own
run was launched from a commit at or after --floor-sha. Dry run by default; an apply needs an actor
(--actor or DEV_WRITE_OWNER), ${CONFIRM_FLAG}, ALLOW_NON_PROD_SCRAPER_WRITES=true and the Development
database, takes the Development write lease, and writes one admin_audit_events record per batch of
${RETIRE_AUDIT_BATCH_SIZE} holding the pre-images. Rematerialize the subjects afterwards.`;

export interface RetireObservationIdsArgs {
  runId: string;
  ids: string[];
  reason: string;
  actor?: string;
  apply: boolean;
  confirmed: boolean;
  restoreSuperseded: boolean;
  floorSha?: string;
}

export function readIdsFile(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const raw: unknown[] = trimmed.startsWith('[')
    ? (JSON.parse(trimmed) as unknown[])
    : trimmed.split(/\r?\n/);
  return raw
    .map((id) =>
      String(id ?? '')
        .trim()
        .toLowerCase(),
    )
    .filter(Boolean);
}

export function parseRetireObservationIdsArgs(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
  readFile: (file: string) => string = (file) => fs.readFileSync(file, 'utf8'),
): RetireObservationIdsArgs {
  if (argv.includes('--help')) throw new Error(RETIRE_OBSERVATION_IDS_HELP);
  const valueFlag = new RegExp(`^--(${VALUE_FLAGS.join('|')})=`);
  for (const arg of argv) {
    if (!valueFlag.test(arg) && ![CONFIRM_FLAG, RESTORE_FLAG, '--apply'].includes(arg)) {
      throw new Error(`Unknown ${RETIRE_OBSERVATION_IDS_SCRIPT} argument: ${arg.split('=')[0]}`);
    }
  }
  for (const flag of VALUE_FLAGS) {
    if (argv.filter((arg) => arg.startsWith(`--${flag}=`)).length > 1) {
      throw new Error(`${RETIRE_OBSERVATION_IDS_SCRIPT} takes --${flag} at most once`);
    }
  }
  const value = (name: string) =>
    argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
  const runId = String(value('run') ?? '')
    .trim()
    .toLowerCase();
  if (!OBJECT_ID_PATTERN.test(runId))
    throw new Error('--run=<24-character scrapeRunId> is required');
  const idsFile = String(value('ids-file') ?? '').trim();
  if (!idsFile) throw new Error('--ids-file=<path> is required');
  const ids = readIdsFile(readFile(idsFile));
  if (ids.length === 0) throw new Error('--ids-file names no observation id');
  if (ids.length > MAX_RETIRE_IDS_PER_RUN) {
    throw new Error(
      `${RETIRE_OBSERVATION_IDS_SCRIPT} refuses more than ${MAX_RETIRE_IDS_PER_RUN} ids per run`,
    );
  }
  if (ids.some((id) => !OBJECT_ID_PATTERN.test(id))) {
    throw new Error('--ids-file must hold 24-character observation ids');
  }
  if (new Set(ids).size !== ids.length) throw new Error('--ids-file names an observation twice');
  const reason = String(value('reason') ?? '').trim();
  if (!reason) throw new Error('--reason is required: record why these observations are retired');
  if (reason.length > MAX_REASON_LENGTH) {
    throw new Error(`--reason must be at most ${MAX_REASON_LENGTH} characters`);
  }
  const restoreSuperseded = argv.includes(RESTORE_FLAG);
  const floorSha = value('floor-sha')?.trim().toLowerCase();
  if (restoreSuperseded && !floorSha) {
    throw new Error(`${RESTORE_FLAG} requires --floor-sha=<commit>`);
  }
  if (floorSha && !restoreSuperseded) {
    throw new Error(`--floor-sha only applies with ${RESTORE_FLAG}`);
  }
  if (floorSha && !SHA_PATTERN.test(floorSha)) throw new Error('--floor-sha must be a commit sha');
  const apply = argv.includes('--apply');
  const actor = resolveAuditActor(value('actor'), env.DEV_WRITE_OWNER, apply);
  if (apply && !actor) {
    throw new Error(
      `${RETIRE_OBSERVATION_IDS_SCRIPT} --apply requires an actor: set DEV_WRITE_OWNER or --actor`,
    );
  }
  return {
    runId,
    ids,
    reason,
    ...(actor ? { actor } : {}),
    apply,
    confirmed: argv.includes(CONFIRM_FLAG),
    restoreSuperseded,
    ...(floorSha ? { floorSha } : {}),
  };
}

function databaseName(mongoUrl: string | undefined): string {
  try {
    return new URL(mongoUrl || '').pathname.replace(/^\//, '');
  } catch {
    return '';
  }
}

export function assertRetireObservationIdsWriteAllowed(
  args: Pick<RetireObservationIdsArgs, 'apply' | 'confirmed'>,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (!args.apply) return;
  if (!args.confirmed) {
    throw new Error(`${RETIRE_OBSERVATION_IDS_SCRIPT} --apply requires ${CONFIRM_FLAG}`);
  }
  if (env.ALLOW_NON_PROD_SCRAPER_WRITES !== 'true') {
    throw new Error(
      `${RETIRE_OBSERVATION_IDS_SCRIPT} --apply requires ALLOW_NON_PROD_SCRAPER_WRITES=true`,
    );
  }
  const database = databaseName(env.MONGODBURL);
  if (database.toLowerCase() !== 'development') {
    throw new Error(
      `${RETIRE_OBSERVATION_IDS_SCRIPT} only applies against the Development database; refusing target "${database || '(unknown)'}"`,
    );
  }
}

export type FloorCheck = (runSha: string, floorSha: string) => boolean;

export const gitAncestryFloorCheck: FloorCheck = (runSha, floorSha) => {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', floorSha, runSha], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

export interface RetireObservationIdsResult {
  runFound: boolean;
  entries: RetirePlanEntry[];
  refused: boolean;
  toRetire: number;
  alreadyRetired: number;
  retired: number;
  retiredWithSupersededPredecessor: number;
  predecessors: number;
  predecessorsAtOrAboveFloor: number;
  predecessorsBelowFloorOrUnknown: number;
  restored: number;
  auditIds: string[];
}

export async function retireObservationIds(
  args: Pick<
    RetireObservationIdsArgs,
    'runId' | 'ids' | 'reason' | 'actor' | 'apply' | 'restoreSuperseded' | 'floorSha'
  >,
  options: { floorCheck?: FloorCheck; now?: () => Date } = {},
): Promise<RetireObservationIdsResult> {
  const floorCheck = options.floorCheck ?? gitAncestryFloorCheck;
  const now = options.now ?? (() => new Date());
  const empty = {
    toRetire: 0,
    alreadyRetired: 0,
    retired: 0,
    retiredWithSupersededPredecessor: 0,
    predecessors: 0,
    predecessorsAtOrAboveFloor: 0,
    predecessorsBelowFloorOrUnknown: 0,
    restored: 0,
    auditIds: [] as string[],
  };
  const run = await ScrapeRun.findById(args.runId).select('_id').lean();
  if (!run) return { runFound: false, entries: [], refused: true, ...empty };

  const objectIds = args.ids.map((id) => new mongoose.Types.ObjectId(id));
  const [observations, lockedRows] = (await Promise.all([
    Observation.find({ _id: { $in: objectIds } })
      .select('_id scrapeRunId sourceName superseded rollback')
      .lean(),
    ResearchEntity.find({ 'manuallyLockedFields.0': { $exists: true } })
      .select('manuallyLockedFields fieldProvenance')
      .lean(),
  ])) as [any[], any[]];
  const plan = planObservationIdRetirement({
    runId: args.runId,
    ids: args.ids,
    observations,
    lockedBackingIds: observationIdsBackingLockedFields(lockedRows),
  });
  const toRetire = plan.entries.filter((entry) => entry.status === 'retire').map((e) => e.id);
  const alreadyRetired = plan.entries.filter((entry) => entry.status === 'already-retired');
  const result: RetireObservationIdsResult = {
    runFound: true,
    ...plan,
    ...empty,
    toRetire: toRetire.length,
    alreadyRetired: alreadyRetired.length,
  };
  if (plan.refused) return result;

  const retiredIds = [...toRetire, ...alreadyRetired.map((entry) => entry.id)];
  const predecessorRows = (await Observation.find({
    supersededBy: { $in: retiredIds.map((id) => new mongoose.Types.ObjectId(id)) },
    superseded: true,
    'rollback.rolledBackAt': { $exists: false },
  })
    .select('_id scrapeRunId supersededBy superseded')
    .lean()) as any[];
  const supersedingIds = new Set(predecessorRows.map((row) => String(row.supersededBy)));
  result.retiredWithSupersededPredecessor = toRetire.filter((id) => supersedingIds.has(id)).length;
  result.predecessors = predecessorRows.length;

  const restorable = new Set<string>();
  if (args.restoreSuperseded && args.floorSha) {
    const runIds = [...new Set(predecessorRows.map((row) => String(row.scrapeRunId ?? '')))].filter(
      (id) => OBJECT_ID_PATTERN.test(id),
    );
    const runs = (await ScrapeRun.find({
      _id: { $in: runIds.map((id) => new mongoose.Types.ObjectId(id)) },
    })
      .select('_id launch.gitSha')
      .lean()) as any[];
    const runAtOrAboveFloor = new Map(
      runs.map((row) => {
        const sha = String(row.launch?.gitSha ?? '').trim();
        return [String(row._id), Boolean(sha) && floorCheck(sha, args.floorSha as string)];
      }),
    );
    for (const row of predecessorRows) {
      if (runAtOrAboveFloor.get(String(row.scrapeRunId)) === true) restorable.add(String(row._id));
    }
  }
  result.predecessorsAtOrAboveFloor = restorable.size;
  result.predecessorsBelowFloorOrUnknown = args.restoreSuperseded
    ? predecessorRows.length - restorable.size
    : 0;
  if (!args.apply) return result;
  if (!args.actor) throw new Error(`${RETIRE_OBSERVATION_IDS_SCRIPT} apply needs an actor`);

  const reason = `${RETIRE_OBSERVATION_IDS_REASON_PREFIX}${args.reason}`;
  const batchRunId = randomUUID();
  const predecessorsBySuperseder = new Map<string, any[]>();
  for (const row of predecessorRows) {
    const key = String(row.supersededBy);
    predecessorsBySuperseder.set(key, [...(predecessorsBySuperseder.get(key) ?? []), row]);
  }
  const toRetireSet = new Set(toRetire);
  for (const batch of chunk(retiredIds, RETIRE_AUDIT_BATCH_SIZE)) {
    const batchObjectIds = batch.map((id) => new mongoose.Types.ObjectId(id));
    const restoreIds = batch
      .flatMap((id) => predecessorsBySuperseder.get(id) ?? [])
      .map((row) => String(row._id))
      .filter((id) => restorable.has(id));
    const retireInBatch = batch.filter((id) => toRetireSet.has(id));
    if (retireInBatch.length === 0 && restoreIds.length === 0) continue;
    const before = await Observation.find({
      _id: { $in: [...batchObjectIds, ...restoreIds.map((id) => new mongoose.Types.ObjectId(id))] },
    }).lean();
    const audit = await AdminAuditEvent.create({
      actorNetid: args.actor,
      action: RETIRE_OBSERVATION_IDS_AUDIT_ACTION,
      targetType: RETIRE_OBSERVATION_IDS_AUDIT_TARGET_TYPE,
      targetId: args.runId,
      summary: {
        fields: ['superseded', 'rollback', 'supersededBy'],
        note: args.reason,
        status: 'applying',
      },
      metadata: {
        script: RETIRE_OBSERVATION_IDS_SCRIPT,
        batchRunId,
        retireIds: batch,
        restoreIds,
        floorSha: args.floorSha ?? null,
        before,
      },
      timestamp: now(),
    });
    const retired = await Observation.updateMany(
      { _id: { $in: batchObjectIds }, scrapeRunId: run._id, superseded: { $ne: true } },
      { $set: { superseded: true, rollback: { rolledBackAt: now(), reason } } },
    );
    result.retired += retired.modifiedCount ?? 0;
    if (restoreIds.length > 0) {
      const restored = await Observation.updateMany(
        {
          _id: { $in: restoreIds.map((id) => new mongoose.Types.ObjectId(id)) },
          superseded: true,
          supersededBy: { $in: batchObjectIds },
          'rollback.rolledBackAt': { $exists: false },
        },
        { $set: { superseded: false }, $unset: { supersededBy: 1 } },
      );
      result.restored += restored.modifiedCount ?? 0;
    }
    await AdminAuditEvent.updateOne({ _id: audit._id }, { $set: { 'summary.status': 'applied' } });
    result.auditIds.push(String(audit._id));
  }
  return result;
}

export async function runRetireObservationIdsCommand(
  argv: string[],
  options: { log?: (line: string) => void; floorCheck?: FloorCheck } = {},
): Promise<RetireObservationIdsResult> {
  const args = parseRetireObservationIdsArgs(argv);
  assertRetireObservationIdsWriteAllowed(args);
  assertScriptApplyAllowed({
    apply: args.apply,
    scriptName: RETIRE_OBSERVATION_IDS_SCRIPT,
    mongoUrl: process.env.MONGODBURL,
  });
  await initializeConnections();
  try {
    const result = await retireObservationIds(args, { floorCheck: options.floorCheck });
    (options.log ?? console.log)(
      JSON.stringify({ mode: args.apply ? 'apply' : 'dry-run', ...result }),
    );
    if (!result.runFound)
      throw new Error('Refused: the scrape run does not exist. Nothing was written.');
    if (result.refused) throw new Error('Refused: see entries. Nothing was written.');
    return result;
  } finally {
    await mongoose.disconnect();
  }
}

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  void runScriptMain(() => runRetireObservationIdsCommand(process.argv.slice(2)), {
    logFailure: (error) => console.error(sanitizeLogValue(error)),
  });
}

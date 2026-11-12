import dotenv from 'dotenv';
import path from 'path';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections, runScriptMain } from '../db/connections';
import { AdminAuditEvent } from '../models/adminAuditEvent';
import { Observation } from '../models/observation';
import { ResearchEntity } from '../models/researchEntity';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertScriptApplyAllowed } from './scriptWriteGuards';
import {
  MAX_SUPERSEDE_IDS_PER_RUN,
  observationIdsBackingLockedFields,
  planObservationSupersede,
  SUPERSEDE_OBSERVATIONS_AUDIT_ACTION,
  SUPERSEDE_OBSERVATIONS_AUDIT_TARGET_TYPE,
  SUPERSEDE_OBSERVATIONS_SCRIPT,
  type SupersedePlanEntry,
} from './supersedeObservationsCore';
import { auditActorFor } from './unfoldResearcherShellCore';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../../.env'), quiet: true });

const CONFIRM_FLAG = '--confirm-supersede-observations';
const MAX_REASON_LENGTH = 500;
const OBJECT_ID_PATTERN = /^[0-9a-f]{24}$/i;
const VALUE_FLAGS = ['ids', 'reason', 'actor'];

export const SUPERSEDE_OBSERVATIONS_HELP = `${SUPERSEDE_OBSERVATIONS_SCRIPT}: an operator tool for one-row judgements, not a bulk repair path.
Supersedes at most ${MAX_SUPERSEDE_IDS_PER_RUN} named observation ids per run, each one read and judged by
an operator, with a required --reason stored in rollback.reason. A wrongness a predicate can express
belongs to a lane or a class retirement script instead. It refuses the whole run, writing nothing, when
an id does not exist or backs an owner-decided value (an operator-authored source, or the provenance of
a manuallyLockedFields entry). Dry run by default; an apply needs an actor (--actor or DEV_WRITE_OWNER),
${CONFIRM_FLAG} and ALLOW_NON_PROD_SCRAPER_WRITES=true, takes the Development write lease, and writes one
admin_audit_events record per superseded observation holding its pre-image. Rematerialize the subject
afterwards so the stored fields follow the evidence.`;

export interface SupersedeObservationsArgs {
  ids: string[];
  reason: string;
  actor?: string;
  apply: boolean;
  confirmed: boolean;
}

export function parseSupersedeObservationsArgs(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
): SupersedeObservationsArgs {
  if (argv.includes('--help')) throw new Error(SUPERSEDE_OBSERVATIONS_HELP);
  const valueFlag = new RegExp(`^--(${VALUE_FLAGS.join('|')})=`);
  for (const arg of argv) {
    if (!valueFlag.test(arg) && arg !== '--apply' && arg !== CONFIRM_FLAG) {
      throw new Error(`Unknown ${SUPERSEDE_OBSERVATIONS_SCRIPT} argument: ${arg.split('=')[0]}`);
    }
  }
  for (const flag of VALUE_FLAGS) {
    if (argv.filter((arg) => arg.startsWith(`--${flag}=`)).length > 1) {
      throw new Error(`${SUPERSEDE_OBSERVATIONS_SCRIPT} takes --${flag} at most once`);
    }
  }
  const value = (name: string) =>
    argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
  const ids = String(value('ids') ?? '')
    .split(',')
    .map((id) => id.trim().toLowerCase())
    .filter(Boolean);
  if (ids.length === 0) throw new Error('--ids=<id>,<id> is required');
  if (ids.length > MAX_SUPERSEDE_IDS_PER_RUN) {
    throw new Error(
      `${SUPERSEDE_OBSERVATIONS_SCRIPT} refuses more than ${MAX_SUPERSEDE_IDS_PER_RUN} ids per run: it is an operator tool for one-row judgements, not a bulk repair path`,
    );
  }
  if (ids.some((id) => !OBJECT_ID_PATTERN.test(id))) {
    throw new Error('--ids must be 24-character observation ids');
  }
  if (new Set(ids).size !== ids.length) throw new Error('--ids names an observation twice');
  const reason = String(value('reason') ?? '').trim();
  if (!reason) throw new Error('--reason is required: record why each observation is wrong');
  if (reason.length > MAX_REASON_LENGTH) {
    throw new Error(`--reason must be at most ${MAX_REASON_LENGTH} characters`);
  }
  const actor = auditActorFor(value('actor') ?? env.DEV_WRITE_OWNER);
  const apply = argv.includes('--apply');
  if (apply && !actor) {
    throw new Error(
      `${SUPERSEDE_OBSERVATIONS_SCRIPT} --apply requires an actor: set DEV_WRITE_OWNER or --actor`,
    );
  }
  return {
    ids,
    reason,
    ...(actor ? { actor } : {}),
    apply,
    confirmed: argv.includes(CONFIRM_FLAG),
  };
}

export function assertSupersedeObservationsWriteAllowed(
  args: SupersedeObservationsArgs,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (!args.apply) return;
  if (!args.confirmed) {
    throw new Error(`${SUPERSEDE_OBSERVATIONS_SCRIPT} --apply requires ${CONFIRM_FLAG}`);
  }
  if (env.ALLOW_NON_PROD_SCRAPER_WRITES !== 'true') {
    throw new Error(
      `${SUPERSEDE_OBSERVATIONS_SCRIPT} --apply requires ALLOW_NON_PROD_SCRAPER_WRITES=true`,
    );
  }
}

export interface SupersedeObservationsResult {
  entries: SupersedePlanEntry[];
  refused: boolean;
  superseded: number;
  auditIds: string[];
}

export async function supersedeObservations(
  args: Pick<SupersedeObservationsArgs, 'ids' | 'reason' | 'actor' | 'apply'>,
  now: () => Date = () => new Date(),
): Promise<SupersedeObservationsResult> {
  const objectIds = args.ids.map((id) => new mongoose.Types.ObjectId(id));
  const [observations, lockedRows] = (await Promise.all([
    Observation.find({ _id: { $in: objectIds } }).lean(),
    ResearchEntity.find({ 'manuallyLockedFields.0': { $exists: true } })
      .select('manuallyLockedFields fieldProvenance')
      .lean(),
  ])) as [any[], any[]];
  const plan = planObservationSupersede({
    ids: args.ids,
    observations,
    lockedBackingIds: observationIdsBackingLockedFields(lockedRows),
  });
  const result = { ...plan, superseded: 0, auditIds: [] as string[] };
  if (plan.refused || !args.apply) return result;
  if (!args.actor) throw new Error(`${SUPERSEDE_OBSERVATIONS_SCRIPT} apply needs an actor`);

  const runId = randomUUID();
  const byId = new Map(observations.map((observation) => [String(observation._id), observation]));
  for (const entry of plan.entries) {
    if (entry.status !== 'supersede') continue;
    const rolledBackAt = now();
    const write = await Observation.updateOne(
      { _id: new mongoose.Types.ObjectId(entry.id), superseded: { $ne: true } },
      { $set: { superseded: true, rollback: { rolledBackAt, reason: args.reason } } },
    );
    if ((write.modifiedCount ?? 0) !== 1) continue;
    const before = byId.get(entry.id);
    const audit = await AdminAuditEvent.create({
      actorNetid: args.actor,
      action: SUPERSEDE_OBSERVATIONS_AUDIT_ACTION,
      targetType: SUPERSEDE_OBSERVATIONS_AUDIT_TARGET_TYPE,
      targetId: entry.id,
      summary: { fields: ['superseded', 'rollback'], note: args.reason, status: 'applied' },
      metadata: {
        script: SUPERSEDE_OBSERVATIONS_SCRIPT,
        runId,
        runObservationIds: args.ids,
        before,
      },
      timestamp: rolledBackAt,
    }).catch(async (error: unknown) => {
      await Observation.updateOne(
        {
          _id: new mongoose.Types.ObjectId(entry.id),
          superseded: true,
          'rollback.rolledBackAt': rolledBackAt,
        },
        restoreSupersedeFieldsUpdate(before),
      );
      throw error;
    });
    result.superseded += 1;
    result.auditIds.push(String(audit._id));
  }
  return result;
}

function restoreSupersedeFieldsUpdate(before: any) {
  const set: Record<string, unknown> = {};
  const unset: Record<string, 1> = {};
  for (const field of ['superseded', 'rollback'] as const) {
    if (before?.[field] === undefined) unset[field] = 1;
    else set[field] = before[field];
  }
  return {
    ...(Object.keys(set).length ? { $set: set } : {}),
    ...(Object.keys(unset).length ? { $unset: unset } : {}),
  };
}

export async function runSupersedeObservationsCommand(
  argv: string[],
  options: { log?: (line: string) => void } = {},
): Promise<SupersedeObservationsResult> {
  const args = parseSupersedeObservationsArgs(argv);
  assertSupersedeObservationsWriteAllowed(args);
  assertScriptApplyAllowed({
    apply: args.apply,
    scriptName: SUPERSEDE_OBSERVATIONS_SCRIPT,
    mongoUrl: process.env.MONGODBURL,
  });
  await initializeConnections();
  try {
    const result = await supersedeObservations(args);
    (options.log ?? console.log)(
      JSON.stringify({ mode: args.apply ? 'apply' : 'dry-run', ...result }),
    );
    if (result.refused) throw new Error('Refused: see entries. Nothing was written.');
    return result;
  } finally {
    await mongoose.disconnect();
  }
}

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  void runScriptMain(() => runSupersedeObservationsCommand(process.argv.slice(2)), {
    logFailure: (error) => console.error(sanitizeLogValue(error)),
  });
}

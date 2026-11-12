import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections, runScriptMain } from '../db/connections';
import { AdminAuditEvent } from '../models/adminAuditEvent';
import { Researcher } from '../models/researcher';
import { RoleAssignment } from '../models/roleAssignment';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertScriptApplyAllowed } from './scriptWriteGuards';
import {
  resolveAuditActor,
  foldArchivedShellEdgeIds,
  planResearcherShellUnfold,
  UNFOLD_SHELL_AUDIT_ACTION,
  UNFOLD_SHELL_AUDIT_TARGET_TYPE,
  UNFOLD_SHELL_SCRIPT,
  type ResearcherShellUnfoldRefusal,
} from './unfoldResearcherShellCore';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../../.env'), quiet: true });

const CONFIRM_FLAG = '--confirm-unfold-shell';
const MAX_NOTE_LENGTH = 500;
const OBJECT_ID_PATTERN = /^[0-9a-f]{24}$/i;
const VALUE_FLAGS = ['shell', 'expect-survivor', 'note', 'actor'];

export const UNFOLD_SHELL_HELP = `${UNFOLD_SHELL_SCRIPT}: an operator tool for one-row judgements, not a bulk repair path.
Reverses one researcher fold: the shell is un-archived, its dedupedIntoResearcherId and dedupedAt are
cleared, and the shell and survivor are recorded as distinct people so no fold re-joins them.
Dry run by default. An apply needs --expect-survivor, --note, an actor (--actor or DEV_WRITE_OWNER),
${CONFIRM_FLAG} and ALLOW_NON_PROD_SCRAPER_WRITES=true, takes the Development write lease, and writes
an admin_audit_events record holding the pre-image. Edges the fold archived come back one at a time
through role-assignments:restore-detached-edge --unfold-audit=<audit id>.`;

export interface UnfoldResearcherShellArgs {
  shellId: string;
  expectedSurvivorId?: string;
  note: string;
  actor?: string;
  apply: boolean;
  confirmed: boolean;
}

const objectIdArg = (flag: string, raw: string | undefined): string | undefined => {
  if (raw === undefined) return undefined;
  const id = raw.trim();
  if (!OBJECT_ID_PATTERN.test(id)) throw new Error(`--${flag} must be a 24-character id`);
  return id.toLowerCase();
};

export function parseUnfoldResearcherShellArgs(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
): UnfoldResearcherShellArgs {
  if (argv.includes('--help')) throw new Error(UNFOLD_SHELL_HELP);
  const valueFlag = new RegExp(`^--(${VALUE_FLAGS.join('|')})=`);
  for (const arg of argv) {
    if (!valueFlag.test(arg) && arg !== '--apply' && arg !== CONFIRM_FLAG) {
      throw new Error(`Unknown ${UNFOLD_SHELL_SCRIPT} argument: ${arg.split('=')[0]}`);
    }
  }
  for (const flag of VALUE_FLAGS) {
    if (argv.filter((arg) => arg.startsWith(`--${flag}=`)).length > 1) {
      throw new Error(`${UNFOLD_SHELL_SCRIPT} takes --${flag} at most once`);
    }
  }
  const value = (name: string) =>
    argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
  const shellId = objectIdArg('shell', value('shell'));
  if (!shellId)
    throw new Error(`${UNFOLD_SHELL_SCRIPT} reverses exactly one fold: pass --shell=<id>`);
  const note = String(value('note') ?? '').trim();
  if (!note) throw new Error('--note is required: record why the fold joined two people');
  if (note.length > MAX_NOTE_LENGTH) {
    throw new Error(`--note must be at most ${MAX_NOTE_LENGTH} characters`);
  }
  const expectedSurvivorId = objectIdArg('expect-survivor', value('expect-survivor'));
  const apply = argv.includes('--apply');
  const actor = resolveAuditActor(value('actor'), env.DEV_WRITE_OWNER, apply);
  if (apply) {
    if (!expectedSurvivorId) {
      throw new Error(`${UNFOLD_SHELL_SCRIPT} --apply requires --expect-survivor=<id>`);
    }
    if (!actor) {
      throw new Error(
        `${UNFOLD_SHELL_SCRIPT} --apply requires an actor: set DEV_WRITE_OWNER or --actor`,
      );
    }
  }
  return {
    shellId,
    ...(expectedSurvivorId ? { expectedSurvivorId } : {}),
    note,
    ...(actor ? { actor } : {}),
    apply,
    confirmed: argv.includes(CONFIRM_FLAG),
  };
}

export function assertUnfoldResearcherShellWriteAllowed(
  args: UnfoldResearcherShellArgs,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (!args.apply) return;
  if (!args.confirmed) throw new Error(`${UNFOLD_SHELL_SCRIPT} --apply requires ${CONFIRM_FLAG}`);
  if (env.ALLOW_NON_PROD_SCRAPER_WRITES !== 'true') {
    throw new Error(`${UNFOLD_SHELL_SCRIPT} --apply requires ALLOW_NON_PROD_SCRAPER_WRITES=true`);
  }
}

export interface UnfoldResearcherShellResult {
  found: boolean;
  refusal: ResearcherShellUnfoldRefusal | 'shell-changed-since-read' | null;
  alreadyUnfolded: boolean;
  unfolded: boolean;
  survivorId?: string;
  foldArchivedEdgeIds: string[];
  auditId?: string;
}

const RESEARCHER_PRE_IMAGE_FIELDS =
  '_id displayName archived dedupedIntoResearcherId dedupedAt identifiers profileLinks profile distinctFromResearcherIds fieldValueRefusals updatedAt';

async function priorUnfoldsOf(shellId: string) {
  const audits = (await AdminAuditEvent.find({
    action: UNFOLD_SHELL_AUDIT_ACTION,
    targetType: UNFOLD_SHELL_AUDIT_TARGET_TYPE,
    targetId: shellId,
  })
    .select('_id timestamp')
    .lean()) as any[];
  return audits.map((audit) => ({ id: String(audit._id), timestamp: new Date(audit.timestamp) }));
}

export async function unfoldResearcherShell(
  args: Pick<
    UnfoldResearcherShellArgs,
    'shellId' | 'expectedSurvivorId' | 'note' | 'actor' | 'apply'
  >,
  now: () => Date = () => new Date(),
): Promise<UnfoldResearcherShellResult> {
  const shellObjectId = new mongoose.Types.ObjectId(args.shellId);
  const shell = (await Researcher.findOne({ _id: shellObjectId })
    .select(RESEARCHER_PRE_IMAGE_FIELDS)
    .lean()) as any;
  const survivor = shell?.dedupedIntoResearcherId
    ? ((await Researcher.findOne({ _id: shell.dedupedIntoResearcherId })
        .select(RESEARCHER_PRE_IMAGE_FIELDS)
        .lean()) as any)
    : null;
  const plan = planResearcherShellUnfold({
    shell,
    survivor,
    priorUnfolds: shell ? await priorUnfoldsOf(args.shellId) : [],
    expectedSurvivorId: args.expectedSurvivorId,
  });
  const base = { found: Boolean(shell), alreadyUnfolded: false, unfolded: false };
  if (plan.kind === 'refuse') return { ...base, refusal: plan.refusal, foldArchivedEdgeIds: [] };
  if (plan.kind === 'already-unfolded') {
    return {
      ...base,
      refusal: null,
      alreadyUnfolded: true,
      auditId: plan.auditId,
      foldArchivedEdgeIds: [],
    };
  }
  const survivorObjectId = new mongoose.Types.ObjectId(plan.survivorId);
  const [shellEdges, survivorEdges] = (await Promise.all([
    RoleAssignment.find({ personId: shellObjectId }).lean(),
    RoleAssignment.find({ personId: survivorObjectId }).select('_id target role').lean(),
  ])) as [any[], any[]];
  const foldArchivedEdgeIds = foldArchivedShellEdgeIds(shellEdges, survivorEdges);
  const planned = { ...base, refusal: null, survivorId: plan.survivorId, foldArchivedEdgeIds };
  if (!args.apply) return planned;
  if (!args.actor || !args.expectedSurvivorId) {
    throw new Error(`${UNFOLD_SHELL_SCRIPT} apply needs an actor and the expected survivor`);
  }

  const shellWrite = await Researcher.updateOne(
    {
      _id: shellObjectId,
      archived: true,
      dedupedIntoResearcherId: survivorObjectId,
      dedupedAt: shell.dedupedAt ?? null,
    },
    {
      $set: { archived: false },
      $unset: { dedupedIntoResearcherId: '', dedupedAt: '' },
      $addToSet: { distinctFromResearcherIds: survivorObjectId },
    },
  );
  if ((shellWrite.modifiedCount ?? 0) !== 1) {
    return { ...planned, refusal: 'shell-changed-since-read' };
  }
  const holdsVerdict = (record: any, otherId: string) =>
    (record?.distinctFromResearcherIds ?? []).some((id: unknown) => String(id) === otherId);
  const shellHeldVerdict = holdsVerdict(shell, plan.survivorId);
  const survivorHeldVerdict = holdsVerdict(survivor, args.shellId);
  try {
    await Researcher.updateOne(
      { _id: survivorObjectId },
      { $addToSet: { distinctFromResearcherIds: shellObjectId } },
    );
    const audit = await AdminAuditEvent.create({
      actorNetid: args.actor,
      action: UNFOLD_SHELL_AUDIT_ACTION,
      targetType: UNFOLD_SHELL_AUDIT_TARGET_TYPE,
      targetId: args.shellId,
      summary: {
        fields: ['archived', 'dedupedIntoResearcherId', 'dedupedAt', 'distinctFromResearcherIds'],
        note: args.note,
        status: 'applied',
      },
      metadata: {
        script: UNFOLD_SHELL_SCRIPT,
        survivorId: plan.survivorId,
        foldArchivedEdgeIds,
        before: { shell, survivor, shellEdges },
      },
      timestamp: now(),
    });
    return { ...planned, unfolded: true, auditId: String(audit._id) };
  } catch (error) {
    await restoreFoldAfterFailedAudit({
      shellObjectId,
      survivorObjectId,
      dedupedAt: shell.dedupedAt,
      shellHeldVerdict,
      survivorHeldVerdict,
    });
    throw error;
  }
}

async function restoreFoldAfterFailedAudit(input: {
  shellObjectId: mongoose.Types.ObjectId;
  survivorObjectId: mongoose.Types.ObjectId;
  dedupedAt: unknown;
  shellHeldVerdict: boolean;
  survivorHeldVerdict: boolean;
}): Promise<void> {
  await Researcher.updateOne(
    { _id: input.shellObjectId, archived: false },
    {
      $set: {
        archived: true,
        dedupedIntoResearcherId: input.survivorObjectId,
        dedupedAt: input.dedupedAt,
      },
      ...(input.shellHeldVerdict
        ? {}
        : { $pull: { distinctFromResearcherIds: input.survivorObjectId } }),
    },
  );
  if (!input.survivorHeldVerdict) {
    await Researcher.updateOne(
      { _id: input.survivorObjectId },
      { $pull: { distinctFromResearcherIds: input.shellObjectId } },
    );
  }
}

export async function runUnfoldResearcherShellCommand(
  argv: string[],
  options: { log?: (line: string) => void } = {},
): Promise<UnfoldResearcherShellResult> {
  const args = parseUnfoldResearcherShellArgs(argv);
  assertUnfoldResearcherShellWriteAllowed(args);
  assertScriptApplyAllowed({
    apply: args.apply,
    scriptName: UNFOLD_SHELL_SCRIPT,
    mongoUrl: process.env.MONGODBURL,
  });
  await initializeConnections();
  try {
    const result = await unfoldResearcherShell(args);
    (options.log ?? console.log)(
      JSON.stringify({ mode: args.apply ? 'apply' : 'dry-run', ...result }),
    );
    if (result.refusal) throw new Error(`Refused: ${result.refusal}. Nothing was written.`);
    return result;
  } finally {
    await mongoose.disconnect();
  }
}

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  void runScriptMain(() => runUnfoldResearcherShellCommand(process.argv.slice(2)), {
    logFailure: (error) => console.error(sanitizeLogValue(error)),
  });
}

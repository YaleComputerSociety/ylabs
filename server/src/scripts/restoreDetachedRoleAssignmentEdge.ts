import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections, runScriptMain } from '../db/connections';
import { AdminAuditEvent } from '../models/adminAuditEvent';
import { OrgUnit } from '../models/orgUnit';
import { ResearchEntity } from '../models/researchEntity';
import { Researcher } from '../models/researcher';
import { DETACHED_ROLE_ASSIGNMENT_REVIEW_STATUS, RoleAssignment } from '../models/roleAssignment';
import { LIVE_ROLE_EDGE_FILTER } from '../services/archivedResearchEntityRoleEdges';
import { runStudentVisibilityGate } from '../services/studentVisibilityGateService';
import { sanitizeLogValue } from '../utils/logSanitizer';
import {
  isOperatorEnded,
  planDetachedRoleEdgeRestore,
  type DetachedRoleEdgeRestoreRefusal,
  type DetachmentDecider,
  type UnfoldAuditTie,
} from './restoreDetachedRoleAssignmentEdgeCore';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  UNFOLD_SHELL_AUDIT_ACTION,
  UNFOLD_SHELL_AUDIT_TARGET_TYPE,
} from './unfoldResearcherShellCore';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../../.env'), quiet: true });

const SCRIPT_NAME = 'role-assignments:restore-detached-edge';
const CONFIRM_FLAG = '--confirm-restore-role-edge';
const MAX_NOTE_LENGTH = 500;
const MAX_ACTOR_LENGTH = 120;
const OBJECT_ID_PATTERN = /^[0-9a-f]{24}$/i;
const VALUE_FLAGS = [
  'edge',
  'note',
  'snapshot',
  'actor',
  'expect-person',
  'expect-target',
  'unfold-audit',
];
const RESTORED_REVIEW_STATUS = 'UNREVIEWED';

export interface RestoreDetachedRoleAssignmentEdgeArgs {
  edgeId: string;
  note: string;
  actor?: string;
  expectedPersonId?: string;
  expectedTargetId?: string;
  unfoldAuditId?: string;
  snapshot?: string;
  apply: boolean;
  confirmed: boolean;
}

const objectIdArg = (flag: string, raw: string | undefined): string | undefined => {
  if (raw === undefined) return undefined;
  const id = raw.trim();
  if (!OBJECT_ID_PATTERN.test(id)) throw new Error(`--${flag} must be a 24-character id`);
  return id.toLowerCase();
};

export function parseRestoreDetachedRoleAssignmentEdgeArgs(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
): RestoreDetachedRoleAssignmentEdgeArgs {
  const valueFlag = new RegExp(`^--(${VALUE_FLAGS.join('|')})=`);
  for (const arg of argv) {
    if (!valueFlag.test(arg) && arg !== '--apply' && arg !== CONFIRM_FLAG) {
      throw new Error(`Unknown ${SCRIPT_NAME} argument: ${arg}`);
    }
  }
  if (argv.filter((arg) => arg.startsWith('--edge=')).length !== 1) {
    throw new Error(`${SCRIPT_NAME} restores exactly one edge: pass --edge=<id> once`);
  }
  for (const flag of VALUE_FLAGS) {
    if (argv.filter((arg) => arg.startsWith(`--${flag}=`)).length > 1) {
      throw new Error(`${SCRIPT_NAME} takes --${flag} at most once`);
    }
  }
  const value = (name: string) =>
    argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
  const edgeId = objectIdArg('edge', value('edge'));
  if (!edgeId) throw new Error('--edge must be a 24-character role edge id');
  const note = String(value('note') ?? '').trim();
  if (!note) throw new Error('--note is required: record why the detachment was wrong');
  if (note.length > MAX_NOTE_LENGTH) {
    throw new Error(`--note must be at most ${MAX_NOTE_LENGTH} characters`);
  }
  const actor = String(value('actor') ?? env.DEV_WRITE_OWNER ?? '').trim() || undefined;
  if (actor && actor.length > MAX_ACTOR_LENGTH) {
    throw new Error(`--actor must be at most ${MAX_ACTOR_LENGTH} characters`);
  }
  const expectedPersonId = objectIdArg('expect-person', value('expect-person'));
  const expectedTargetId = objectIdArg('expect-target', value('expect-target'));
  const unfoldAuditId = objectIdArg('unfold-audit', value('unfold-audit'));
  const apply = argv.includes('--apply');
  const snapshot = value('snapshot');
  if (apply) {
    if (!snapshot) throw new Error(`${SCRIPT_NAME} --apply requires --snapshot=<path>`);
    if (!expectedPersonId || !expectedTargetId) {
      throw new Error(
        `${SCRIPT_NAME} --apply requires --expect-person=<id> and --expect-target=<id>`,
      );
    }
    if (!actor) {
      throw new Error(`${SCRIPT_NAME} --apply requires an actor: set DEV_WRITE_OWNER or --actor`);
    }
  }
  return {
    edgeId,
    note,
    ...(actor ? { actor } : {}),
    ...(expectedPersonId ? { expectedPersonId } : {}),
    ...(expectedTargetId ? { expectedTargetId } : {}),
    ...(unfoldAuditId ? { unfoldAuditId } : {}),
    ...(snapshot ? { snapshot: resolveSafeJsonReportOutputPath(snapshot, '--snapshot') } : {}),
    apply,
    confirmed: argv.includes(CONFIRM_FLAG),
  };
}

export interface RestoreDetachedRoleAssignmentEdgeResult {
  found: boolean;
  role?: string;
  state?: string;
  targetKind?: string;
  decider?: DetachmentDecider;
  refusal: DetachedRoleEdgeRestoreRefusal | 'edge-changed-since-read' | null;
  restored: boolean;
  regatedRow: boolean;
}

async function loadUnfoldAuditTie(auditId: string): Promise<UnfoldAuditTie> {
  const audit = (await AdminAuditEvent.findOne({
    _id: new mongoose.Types.ObjectId(auditId),
    action: UNFOLD_SHELL_AUDIT_ACTION,
    targetType: UNFOLD_SHELL_AUDIT_TARGET_TYPE,
  }).lean()) as any;
  if (!audit) {
    return {
      auditFound: false,
      auditShellId: '',
      foldArchivedEdgeIds: [],
      shellStillUnfolded: false,
      isLatestUnfoldOfShell: false,
    };
  }
  const shellId = String(audit.targetId ?? '');
  const shell = mongoose.isValidObjectId(shellId)
    ? ((await Researcher.findOne({ _id: shellId })
        .select('archived dedupedIntoResearcherId')
        .lean()) as any)
    : null;
  const laterUnfold = await AdminAuditEvent.exists({
    _id: { $ne: audit._id },
    action: UNFOLD_SHELL_AUDIT_ACTION,
    targetType: UNFOLD_SHELL_AUDIT_TARGET_TYPE,
    targetId: shellId,
    timestamp: { $gt: audit.timestamp },
  });
  return {
    auditFound: true,
    auditShellId: shellId,
    foldArchivedEdgeIds: (audit.metadata?.foldArchivedEdgeIds ?? []).map(String),
    shellStillUnfolded: Boolean(shell) && shell.archived !== true && !shell.dedupedIntoResearcherId,
    isLatestUnfoldOfShell: !laterUnfold,
  };
}

async function targetResolves(target: { kind?: string; id?: unknown } | undefined) {
  if (!target?.id) return false;
  if (target.kind === 'RESEARCH_ENTITY') {
    return Boolean(await ResearchEntity.exists({ _id: target.id }));
  }
  if (target.kind === 'ORG_UNIT') return Boolean(await OrgUnit.exists({ _id: target.id }));
  return false;
}

export async function restoreDetachedRoleAssignmentEdge(
  args: Pick<
    RestoreDetachedRoleAssignmentEdgeArgs,
    | 'edgeId'
    | 'note'
    | 'actor'
    | 'expectedPersonId'
    | 'expectedTargetId'
    | 'unfoldAuditId'
    | 'snapshot'
    | 'apply'
  >,
  regate: (rowId: string) => Promise<unknown> = (rowId) =>
    runStudentVisibilityGate({ collection: 'research', mode: 'apply', recordIds: [rowId] }),
  now: () => Date = () => new Date(),
): Promise<RestoreDetachedRoleAssignmentEdgeResult> {
  const _id = new mongoose.Types.ObjectId(args.edgeId);
  const edge = (await RoleAssignment.findOne({ _id }).lean()) as any;
  const unrestored = { restored: false, regatedRow: false };
  if (!edge) return { found: false, refusal: 'edge-not-found', ...unrestored };
  const person = edge.personId
    ? ((await Researcher.findOne({ _id: edge.personId }).select('_id archived').lean()) as any)
    : null;
  const liveTwinEdgeExists = Boolean(
    await RoleAssignment.exists({
      _id: { $ne: _id },
      personId: edge.personId,
      'target.kind': edge.target?.kind,
      'target.id': edge.target?.id,
      role: edge.role,
      ...LIVE_ROLE_EDGE_FILTER,
    }),
  );
  const plan = planDetachedRoleEdgeRestore({
    edge,
    person,
    targetResolves: await targetResolves(edge.target),
    liveTwinEdgeExists,
    expectedPersonId: args.expectedPersonId,
    expectedTargetId: args.expectedTargetId,
    edgeId: args.edgeId,
    ...(args.unfoldAuditId ? { unfoldTie: await loadUnfoldAuditTie(args.unfoldAuditId) } : {}),
  });
  const shape = {
    found: true,
    role: edge.role,
    state: edge.state,
    targetKind: edge.target?.kind,
    ...(plan.decider ? { decider: plan.decider } : {}),
  };
  if (plan.refusal || !args.apply) return { ...shape, refusal: plan.refusal, ...unrestored };
  if (!args.snapshot || !args.actor || !args.expectedPersonId || !args.expectedTargetId) {
    throw new Error(`${SCRIPT_NAME} apply needs a snapshot, an actor and both expected ids`);
  }
  fs.mkdirSync(path.dirname(args.snapshot), { recursive: true });
  fs.writeFileSync(args.snapshot, `${JSON.stringify({ takenAt: now(), edge }, null, 2)}\n`, {
    mode: 0o600,
  });
  if (isOperatorEnded(edge)) {
    const undone = await RoleAssignment.updateOne(
      {
        _id,
        personId: new mongoose.Types.ObjectId(args.expectedPersonId),
        'target.id': new mongoose.Types.ObjectId(args.expectedTargetId),
        'operatorEnd.recordedAt': edge.operatorEnd.recordedAt,
      },
      {
        $set: {
          state: edge.operatorEnd.previousState,
          reviewNotes: args.note,
          reviewedBy: args.actor,
          reviewedAt: now(),
          ...(edge.operatorEnd.previousEndedAt
            ? { endedAt: edge.operatorEnd.previousEndedAt }
            : {}),
        },
        $unset: {
          operatorEnd: '',
          reviewedByAgent: '',
          ...(edge.operatorEnd.previousEndedAt ? {} : { endedAt: '' }),
        },
      },
    );
    if ((undone.modifiedCount ?? 0) !== 1) {
      return { ...shape, refusal: 'edge-changed-since-read', ...unrestored };
    }
    const undoneRowId = edge.target?.kind === 'RESEARCH_ENTITY' ? String(edge.target.id) : '';
    if (undoneRowId) await regate(undoneRowId);
    return { ...shape, refusal: null, restored: true, regatedRow: Boolean(undoneRowId) };
  }
  const result = await RoleAssignment.updateOne(
    {
      _id,
      archived: true,
      reviewStatus: args.unfoldAuditId
        ? (edge.reviewStatus ?? null)
        : DETACHED_ROLE_ASSIGNMENT_REVIEW_STATUS,
      personId: new mongoose.Types.ObjectId(args.expectedPersonId),
      'target.id': new mongoose.Types.ObjectId(args.expectedTargetId),
      reviewNotes: edge.reviewNotes ?? null,
      reviewedBy: edge.reviewedBy ?? null,
      reviewedByAgent: edge.reviewedByAgent ?? null,
    },
    {
      $set: {
        archived: false,
        reviewStatus: RESTORED_REVIEW_STATUS,
        reviewNotes: args.note,
        reviewedBy: args.actor,
        reviewedAt: now(),
      },
      $unset: { reviewedByAgent: '' },
    },
  );
  const restored = (result.modifiedCount ?? 0) === 1;
  if (!restored) return { ...shape, refusal: 'edge-changed-since-read', ...unrestored };
  const rowId = edge.target?.kind === 'RESEARCH_ENTITY' ? String(edge.target.id) : '';
  if (rowId) await regate(rowId);
  return { ...shape, refusal: null, restored, regatedRow: Boolean(rowId) };
}

export async function runRestoreDetachedRoleAssignmentEdgeCommand(
  argv: string[],
  options: {
    regate?: (rowId: string) => Promise<unknown>;
    log?: (line: string) => void;
  } = {},
): Promise<RestoreDetachedRoleAssignmentEdgeResult> {
  const args = parseRestoreDetachedRoleAssignmentEdgeArgs(argv);
  if (args.apply && !args.confirmed) {
    throw new Error(`${SCRIPT_NAME} --apply requires ${CONFIRM_FLAG}`);
  }
  assertScriptApplyAllowed({
    apply: args.apply,
    scriptName: SCRIPT_NAME,
    mongoUrl: process.env.MONGODBURL,
  });
  await initializeConnections();
  try {
    const result = await restoreDetachedRoleAssignmentEdge(args, options.regate);
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
  void runScriptMain(() => runRestoreDetachedRoleAssignmentEdgeCommand(process.argv.slice(2)), {
    logFailure: (error) => console.error(sanitizeLogValue(error)),
  });
}

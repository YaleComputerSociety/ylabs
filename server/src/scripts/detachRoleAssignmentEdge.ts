/**
 * Detaches ONE role edge an operator judged wrong after reading the pages: archives it with the
 * `DISPUTED` verdict that `roleAssignmentReattachWrite` refuses to clear, so no lane re-attaches
 * it, then re-gates the one row it sat on. Single edge only, dry-run by default, and the apply
 * writes the edge's pre-image to a snapshot first (#5614). Prints shape, never names.
 *
 *   yarn --cwd server role-assignments:detach-edge --edge=<id> --note='<why>'
 *   yarn --cwd server role-assignments:detach-edge --edge=<id> --note='<why>' \
 *     --snapshot=./tmp/<file>.json --apply --confirm-detach-role-edge
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { DETACHED_ROLE_ASSIGNMENT_REVIEW_STATUS, RoleAssignment } from '../models/roleAssignment';
import { LIVE_ROLE_EDGE_FILTER } from '../services/archivedResearchEntityRoleEdges';
import { runStudentVisibilityGate } from '../services/studentVisibilityGateService';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../../.env'), quiet: true });

const SCRIPT_NAME = 'role-assignments:detach-edge';
const CONFIRM_FLAG = '--confirm-detach-role-edge';
const MAX_NOTE_LENGTH = 500;

export interface DetachRoleAssignmentEdgeArgs {
  edgeId: string;
  note: string;
  snapshot?: string;
  apply: boolean;
  confirmed: boolean;
}

export function parseDetachRoleAssignmentEdgeArgs(argv: string[]): DetachRoleAssignmentEdgeArgs {
  const value = (name: string) =>
    argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
  for (const arg of argv) {
    if (!/^--(edge|note|snapshot)=/.test(arg) && arg !== '--apply' && arg !== CONFIRM_FLAG) {
      throw new Error(`Unknown ${SCRIPT_NAME} argument: ${arg}`);
    }
  }
  if (argv.filter((arg) => arg.startsWith('--edge=')).length !== 1) {
    throw new Error(`${SCRIPT_NAME} detaches exactly one edge: pass --edge=<id> once`);
  }
  const edgeId = String(value('edge') ?? '').trim();
  if (!/^[0-9a-f]{24}$/i.test(edgeId))
    throw new Error('--edge must be a 24-character role edge id');
  const note = String(value('note') ?? '').trim();
  if (!note) throw new Error('--note is required: record why the edge is wrong');
  if (note.length > MAX_NOTE_LENGTH)
    throw new Error(`--note must be at most ${MAX_NOTE_LENGTH} characters`);
  const apply = argv.includes('--apply');
  const snapshot = value('snapshot');
  if (apply && !snapshot) throw new Error(`${SCRIPT_NAME} --apply requires --snapshot=<path>`);
  return {
    edgeId: edgeId.toLowerCase(),
    note,
    ...(snapshot ? { snapshot: resolveSafeJsonReportOutputPath(snapshot) } : {}),
    apply,
    confirmed: argv.includes(CONFIRM_FLAG),
  };
}

export interface DetachRoleAssignmentEdgeResult {
  found: boolean;
  live: boolean;
  role?: string;
  state?: string;
  targetKind?: string;
  detached: boolean;
  regatedRow: boolean;
}

/** Detaches one live edge; a missing, archived or already disputed edge is left untouched. */
export async function detachRoleAssignmentEdge(
  args: Pick<DetachRoleAssignmentEdgeArgs, 'edgeId' | 'note' | 'snapshot' | 'apply'>,
  regate: (rowId: string) => Promise<unknown> = (rowId) =>
    runStudentVisibilityGate({ collection: 'research', mode: 'apply', recordIds: [rowId] }),
): Promise<DetachRoleAssignmentEdgeResult> {
  const _id = new mongoose.Types.ObjectId(args.edgeId);
  const edge = (await RoleAssignment.findOne({ _id }).lean()) as any;
  if (!edge) return { found: false, live: false, detached: false, regatedRow: false };
  const live = Boolean(await RoleAssignment.exists({ _id, ...LIVE_ROLE_EDGE_FILTER }));
  const shape = {
    found: true,
    live,
    role: edge.role,
    state: edge.state,
    targetKind: edge.target?.kind,
  };
  if (!args.apply || !live) return { ...shape, detached: false, regatedRow: false };
  if (args.snapshot) {
    fs.mkdirSync(path.dirname(args.snapshot), { recursive: true });
    fs.writeFileSync(args.snapshot, `${JSON.stringify({ takenAt: new Date(), edge }, null, 2)}\n`, {
      mode: 0o600,
    });
  }
  const result = await RoleAssignment.updateOne(
    { _id, ...LIVE_ROLE_EDGE_FILTER },
    {
      $set: {
        archived: true,
        reviewStatus: DETACHED_ROLE_ASSIGNMENT_REVIEW_STATUS,
        reviewNotes: args.note,
      },
    },
  );
  const detached = (result.modifiedCount ?? 0) === 1;
  const rowId = edge.target?.kind === 'RESEARCH_ENTITY' ? String(edge.target.id) : '';
  if (detached && rowId) await regate(rowId);
  return { ...shape, detached, regatedRow: detached && Boolean(rowId) };
}

async function main(): Promise<void> {
  const args = parseDetachRoleAssignmentEdgeArgs(process.argv.slice(2));
  if (args.apply && !args.confirmed)
    throw new Error(`${SCRIPT_NAME} --apply requires ${CONFIRM_FLAG}`);
  assertScriptApplyAllowed({
    apply: args.apply,
    scriptName: SCRIPT_NAME,
    mongoUrl: process.env.MONGODBURL,
  });
  await initializeConnections();
  try {
    const result = await detachRoleAssignmentEdge(args);
    console.log(JSON.stringify({ mode: args.apply ? 'apply' : 'dry-run', ...result }));
    if (!result.found) throw new Error('No role edge has that id');
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

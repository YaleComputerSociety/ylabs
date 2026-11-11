import {
  directoryRemovalDigest,
  directoryRemovalKinds,
  type DirectoryRemovalKind,
} from '../utils/directoryRemovalDigest';
import {
  directoryRemovalWithdrawalReasons,
  type DirectoryRemovalWithdrawalReason,
} from '../models/directoryRemoval';
import {
  buildDirectoryRemovalMatcher,
  type DirectoryRemovalPerson,
} from '../services/directoryRemovalMatcher';

export interface DirectoryRemovalArgs {
  kind: DirectoryRemovalKind;
  apply: boolean;
  withdrawReason?: DirectoryRemovalWithdrawalReason;
}

const isKind = (value: string): value is DirectoryRemovalKind =>
  (directoryRemovalKinds as readonly string[]).includes(value);

const isWithdrawalReason = (value: string): value is DirectoryRemovalWithdrawalReason =>
  (directoryRemovalWithdrawalReasons as readonly string[]).includes(value);

export function parseDirectoryRemovalArgs(argv: string[]): DirectoryRemovalArgs {
  let kind: DirectoryRemovalKind | undefined;
  let apply = false;
  let withdrawReason: DirectoryRemovalWithdrawalReason | undefined;
  for (const arg of argv) {
    if (arg === '--') continue;
    if (arg === '--apply') apply = true;
    else if (arg === '--dry-run') apply = false;
    else if (arg.startsWith('--kind=')) {
      const value = arg.slice('--kind='.length);
      if (!isKind(value)) {
        throw new Error(`--kind must be one of ${directoryRemovalKinds.join(', ')}`);
      }
      kind = value;
    } else if (arg.startsWith('--withdraw=')) {
      const value = arg.slice('--withdraw='.length);
      if (!isWithdrawalReason(value)) {
        throw new Error(
          `--withdraw must name a reason: ${directoryRemovalWithdrawalReasons.join(', ')}`,
        );
      }
      withdrawReason = value;
    } else if (arg.startsWith('--value')) {
      throw new Error(
        'The identifier is read from standard input only, so it never reaches shell history or a process listing.',
      );
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!kind) throw new Error('--kind is required');
  return { kind, apply, withdrawReason };
}

export interface DirectoryRemovalReach {
  liveResearchersMatched: number;
  liveRoleEdgesByRole: Record<string, number>;
  rowsNamingUndergraduate: number;
}

export function countDirectoryRemovalReach(args: {
  key: string;
  digest: string;
  researchers: ReadonlyArray<DirectoryRemovalPerson & { _id: unknown }>;
  liveRoleEdges: ReadonlyArray<{ personId: unknown; role: string }>;
  undergraduateRosters: ReadonlyArray<{ names: readonly string[] }>;
}): DirectoryRemovalReach {
  const matcher = buildDirectoryRemovalMatcher({ key: args.key, activeDigests: [args.digest] });
  const matchedIds = new Set(
    args.researchers
      .filter((researcher) => matcher.isRemovedPerson(researcher))
      .map((researcher) => String(researcher._id)),
  );
  const liveRoleEdgesByRole: Record<string, number> = {};
  for (const edge of args.liveRoleEdges) {
    if (!matchedIds.has(String(edge.personId))) continue;
    liveRoleEdgesByRole[edge.role] = (liveRoleEdgesByRole[edge.role] ?? 0) + 1;
  }
  return {
    liveResearchersMatched: matchedIds.size,
    liveRoleEdgesByRole,
    rowsNamingUndergraduate: args.undergraduateRosters.filter((roster) =>
      roster.names.some((name) => matcher.isRemovedName(name)),
    ).length,
  };
}

export function digestForRemoval(key: string, kind: DirectoryRemovalKind, value: string): string {
  const digest = directoryRemovalDigest(key, kind, value);
  if (!digest) throw new Error(`The ${kind} read from standard input normalizes to nothing.`);
  return digest;
}

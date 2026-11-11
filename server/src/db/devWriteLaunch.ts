import { hostname } from 'os';
import type { Db } from 'mongodb';

import { PROCESS_REPO_ROOT, currentProcessCodeSha } from '../utils/processCodeIdentity';

export const DEV_WRITE_LAUNCH_COLLECTION = 'dev_write_launches';
export const DEV_WRITE_OWNER_LABEL_ENV = 'DEV_WRITE_OWNER';
export const REDACTED_ARG = '<redacted>';

const SECRET_NAME = /key|token|secret|password|credential/i;
const FLAG = /^(--?[^=\s]+)(?:=(.*))?$/s;
const ASSIGNMENT = /^([A-Za-z_][A-Za-z0-9_.-]*)=(.*)$/s;

export function redactLaunchArgv(argv: readonly string[]): string[] {
  const redacted: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg.includes('://')) {
      redacted.push(REDACTED_ARG);
      continue;
    }
    const flag = FLAG.exec(arg);
    if (flag && SECRET_NAME.test(flag[1])) {
      if (flag[2] !== undefined) {
        redacted.push(`${flag[1]}=${REDACTED_ARG}`);
        continue;
      }
      redacted.push(arg);
      const value = argv[index + 1];
      if (value !== undefined && !value.startsWith('-')) {
        redacted.push(REDACTED_ARG);
        index += 1;
      }
      continue;
    }
    const assignment = flag ? null : ASSIGNMENT.exec(arg);
    if (assignment && SECRET_NAME.test(assignment[1])) {
      redacted.push(`${assignment[1]}=${REDACTED_ARG}`);
      continue;
    }
    redacted.push(arg);
  }
  return redacted;
}

export interface DevWriteLaunch {
  ownerLabel?: string;
  worktree: string;
  cwd: string;
  gitSha?: string;
  entry?: string;
  argv: string[];
  host: string;
  pid: number;
}

export function describeDevWriteLaunch(
  input: {
    env?: NodeJS.ProcessEnv;
    argv?: readonly string[];
    cwd?: string;
    worktree?: string;
    gitSha?: string;
  } = {},
): DevWriteLaunch {
  const env = input.env ?? process.env;
  const argv = input.argv ?? process.argv;
  const ownerLabel = env[DEV_WRITE_OWNER_LABEL_ENV]?.trim();
  const gitSha = 'gitSha' in input ? input.gitSha : currentProcessCodeSha();
  return {
    ...(ownerLabel ? { ownerLabel } : {}),
    worktree: input.worktree ?? PROCESS_REPO_ROOT,
    cwd: input.cwd ?? process.cwd(),
    ...(gitSha ? { gitSha } : {}),
    ...(argv[1] ? { entry: argv[1] } : {}),
    argv: redactLaunchArgv(argv.slice(2)),
    host: hostname(),
    pid: process.pid,
  };
}

export interface DevWriteLaunchRecord {
  kind: 'apply';
  scriptName: string;
  leaseOwnerId: string;
  joinedParentLease: boolean;
  launchedAt: Date;
  launch: DevWriteLaunch;
}

export async function recordDevWriteLaunch(db: Db, record: DevWriteLaunchRecord): Promise<void> {
  await db.collection<DevWriteLaunchRecord>(DEV_WRITE_LAUNCH_COLLECTION).insertOne(record);
}

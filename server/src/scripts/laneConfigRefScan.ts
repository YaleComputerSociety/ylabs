import { execFileSync } from 'child_process';
import {
  laneConfigDefinitionPattern,
  laneConfigIdLiterals,
  type LaneConfigRefPresence,
  type RequestedLaneConfig,
} from './retireOrphanedLaneConfigsCore';

export type GitRunner = (gitDir: string, args: string[]) => { status: number; stdout: string };

export const defaultGitRunner: GitRunner = (gitDir, args) => {
  try {
    const stdout = execFileSync('git', ['--git-dir', gitDir, ...args], {
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stdout };
  } catch (error) {
    const failure = error as { status?: number | null; stdout?: string };
    return { status: failure.status ?? -1, stdout: String(failure.stdout ?? '') };
  }
};

export function currentGitCommonDir(cwd: string): string {
  return execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
    cwd,
    encoding: 'utf8',
  }).trim();
}

export const LANE_CONFIG_ROOT = 'server/src/scrapers';

export const CONFIG_DEFINITION_PATHSPEC = [
  '--',
  `${LANE_CONFIG_ROOT}/**/*.ts`,
  `${LANE_CONFIG_ROOT}/**/*.js`,
  `${LANE_CONFIG_ROOT}/**/*.mjs`,
  `${LANE_CONFIG_ROOT}/**/*.json`,
  ':(exclude)**/__tests__/**',
  ':(exclude)**/*.test.ts',
  ':(exclude)**/*.test.mjs',
];

const TIP_BATCH_SIZE = 200;

export interface RefTips {
  gitDir: string;
  refCount: number;
  refsByCommit: Map<string, string[]>;
}

export function readRefTips(gitDir: string, git: GitRunner = defaultGitRunner): RefTips {
  const listed = git(gitDir, [
    'for-each-ref',
    '--format=%(objecttype)%09%(objectname)%09%(*objecttype)%09%(*objectname)%09%(refname)',
  ]);
  if (listed.status !== 0) throw new Error(`git for-each-ref failed in ${gitDir}`);
  const head = git(gitDir, ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}']);
  const refsByCommit = new Map<string, string[]>();
  const add = (commit: string, ref: string) => {
    const refs = refsByCommit.get(commit) ?? [];
    refs.push(ref);
    refsByCommit.set(commit, refs);
  };
  let refCount = 0;
  for (const line of listed.stdout.split('\n')) {
    const [type, object, peeledType, peeledObject, ref] = line.split('\t');
    if (!ref) continue;
    refCount += 1;
    if (type === 'commit') add(object, ref);
    else if (type === 'tag' && peeledType === 'commit' && peeledObject) add(peeledObject, ref);
  }
  if (head.status === 0 && head.stdout.trim()) add(head.stdout.trim(), 'HEAD');
  if (refsByCommit.size === 0) throw new Error(`no commit refs found in ${gitDir}`);
  return { gitDir, refCount, refsByCommit };
}

/**
 * Every ref tip whose tree defines each config, test files excluded. The grep is a fixed-string
 * prefilter on the quoted id, and each hit line is then judged by the definition pattern. A git
 * failure throws rather than reading as "not found", because an unreadable ref is not evidence
 * of absence.
 */
export function scanRefTipsForLaneConfigs(
  tips: RefTips,
  configs: readonly RequestedLaneConfig[],
  git: GitRunner = defaultGitRunner,
): LaneConfigRefPresence[] {
  const ids = [...new Set(configs.map((config) => config.configId))];
  const patterns = new Map(ids.map((id) => [id, laneConfigDefinitionPattern(id)]));
  const literals = ids.flatMap(laneConfigIdLiterals).flatMap((literal) => ['-e', literal]);
  const commitsById = new Map(ids.map((id) => [id, new Set<string>()]));
  const commits = [...tips.refsByCommit.keys()];
  for (let start = 0; start < commits.length; start += TIP_BATCH_SIZE) {
    const batch = commits.slice(start, start + TIP_BATCH_SIZE);
    const result = git(tips.gitDir, [
      'grep',
      '-n',
      '-I',
      '-F',
      ...literals,
      ...batch,
      ...CONFIG_DEFINITION_PATHSPEC,
    ]);
    if (result.status === 1) continue;
    if (result.status !== 0) throw new Error(`git grep failed in ${tips.gitDir}`);
    for (const line of result.stdout.split('\n')) {
      const match = /^([0-9a-f]{40,64}):[^:]*:\d+:(.*)$/.exec(line);
      if (!match) continue;
      for (const [id, pattern] of patterns) {
        if (pattern.test(match[2])) commitsById.get(id)!.add(match[1]);
      }
    }
  }
  return configs.map((config) => ({
    ...config,
    refs: [...(commitsById.get(config.configId) ?? [])].flatMap((commit) =>
      (tips.refsByCommit.get(commit) ?? [commit]).map((ref) => `${tips.gitDir}#${ref}`),
    ),
  }));
}

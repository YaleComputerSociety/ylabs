import { spawnSync } from 'child_process';

export const SWEEP_TARGET_BRANCH = 'beta';

export const SWEEP_TARGET_SHA_VARIABLE = 'SWEEP_TARGET_SHA';

export const SWEEP_LANE_CODE_PATHSPECS = [
  'server/src/scrapers/',
  ':(glob)server/src/scripts/**/*aterializ*',
  ':(glob)server/src/services/**/*aterializ*',
] as const;

export interface GitResult {
  status: number | null;
  stdout: string;
}

export type GitRunner = (args: string[]) => GitResult;

export function gitRunnerIn(repoRoot: string): GitRunner {
  return (args) => {
    const result = spawnSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8' });
    return { status: result.status, stdout: String(result.stdout ?? '').trim() };
  };
}

export interface SweepCodeFreshness {
  ok: boolean;
  codeSha: string | null;
  targetSha: string | null;
  newestLaneCommitSha: string | null;
  refusal?: string;
}

const remoteBranchRef = (remote: string): string => `refs/remotes/${remote}/${SWEEP_TARGET_BRANCH}`;

export function readSweepCodeFreshness(input: {
  git: GitRunner;
  targetSha?: string;
  remote?: string;
}): SweepCodeFreshness {
  const { git } = input;
  const remote = input.remote ?? 'origin';
  const head = git(['rev-parse', 'HEAD']);
  const codeSha = head.status === 0 && head.stdout ? head.stdout : null;
  const targetSha = input.targetSha?.trim() || null;
  const refuse = (refusal: string, newestLaneCommitSha: string | null = null) => ({
    ok: false,
    codeSha,
    targetSha,
    newestLaneCommitSha,
    refusal,
  });

  if (!codeSha) {
    return refuse(
      'the sweep code has no git history, so it cannot prove it runs current beta; start it through deploy/sweep-runner/entrypoint.sh or from a git checkout',
    );
  }
  if (targetSha && codeSha !== targetSha) {
    return refuse(
      `the sweep code is at ${codeSha} but the runner resolved ${remote}/${SWEEP_TARGET_BRANCH} to ${targetSha}`,
    );
  }
  const fetched = git([
    'fetch',
    '--quiet',
    remote,
    `+refs/heads/${SWEEP_TARGET_BRANCH}:${remoteBranchRef(remote)}`,
  ]);
  if (fetched.status !== 0) {
    return refuse(
      `could not fetch ${remote}/${SWEEP_TARGET_BRANCH}, so the sweep cannot prove ${codeSha} is current`,
    );
  }
  const newest = git([
    'log',
    '-1',
    '--format=%H',
    remoteBranchRef(remote),
    '--',
    ...SWEEP_LANE_CODE_PATHSPECS,
  ]);
  const newestLaneCommitSha = newest.status === 0 && newest.stdout ? newest.stdout : null;
  if (!newestLaneCommitSha) {
    return refuse(
      `could not read the newest ${remote}/${SWEEP_TARGET_BRANCH} commit touching the scrapers or the materializer`,
    );
  }
  const contains = git(['merge-base', '--is-ancestor', newestLaneCommitSha, codeSha]);
  if (contains.status === 0) {
    return { ok: true, codeSha, targetSha, newestLaneCommitSha };
  }
  return refuse(
    `the sweep would run ${codeSha}, which does not contain ${newestLaneCommitSha}, the newest ${remote}/${SWEEP_TARGET_BRANCH} commit touching the scrapers or the materializer; a sweep on older lane code rewrites the rows merged fixes corrected (#4743)`,
    newestLaneCommitSha,
  );
}

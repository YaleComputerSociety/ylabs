/**
 * A sweep runs the code in its checkout's working tree, not the code on `beta`.
 *
 * Every stage is spawned with `cwd: repoRoot`, so whatever `HEAD` happens to be at the moment a
 * stage launches is what that stage executes. Nothing pins it, so a `git pull` in that checkout
 * during a run silently changes the code mid-sweep.
 *
 * Measured on the Development full sweep of 2026-09-28, which ran 00:38Z to past 06:40Z: `HEAD`
 * fast-forwarded six times during the run, and the 24 source stages split across two different
 * commits, 11 under the commit in force at 00:40Z and 13 under a commit that landed at 05:07Z.
 * A fix merged at 05:16Z reached none of them, while the sweep's own summary recorded no code
 * identity at all, so nothing in the artifacts could have revealed either fact (#3476 follow-up).
 *
 * Two consequences, and the second is why this fails closed rather than only recording. Stage
 * results are not attributable after the fact, because a stage's behaviour depends on a commit
 * nobody wrote down. And a stage can apply a defect the checkout predates, which for a data
 * sweep means writing values a merged fix had already removed.
 */
export interface SweepCodeIdentity {
  sha: string | null;
  /** Absent rather than false: a checkout with no git metadata cannot answer the question. */
  readable: boolean;
}

export type SweepCodeDriftRefusal = {
  stage: string;
  startedSha: string;
  currentSha: string;
  message: string;
};

export function sweepCodeIdentityFrom(rawSha: unknown): SweepCodeIdentity {
  const sha = typeof rawSha === 'string' ? rawSha.trim() : '';
  return /^[0-9a-f]{7,40}$/i.test(sha) ? { sha, readable: true } : { sha: null, readable: false };
}

/**
 * The refusal, or `null` to proceed.
 *
 * Proceeds when either side is unreadable, because a checkout that cannot report a commit is not
 * evidence that the code moved, and refusing there would make the sweep unrunnable anywhere git
 * metadata is absent. This narrows what may run and never widens it.
 */
export function planSweepCodeDriftRefusal(input: {
  stage: string;
  startedSha: string | null;
  currentSha: string | null;
}): SweepCodeDriftRefusal | null {
  const { stage, startedSha, currentSha } = input;
  if (!startedSha || !currentSha || startedSha === currentSha) return null;
  return {
    stage,
    startedSha,
    currentSha,
    message:
      `refusing to spawn ${stage}: the checkout moved from ${startedSha} to ${currentSha} since ` +
      `this sweep started, so this stage would run different code from the stages before it. ` +
      `Reset the checkout to ${startedSha} and resume, or restart the sweep to adopt ${currentSha}.`,
  };
}

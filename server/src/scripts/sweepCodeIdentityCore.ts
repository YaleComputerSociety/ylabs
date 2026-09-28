/**
 * A sweep runs the code in its checkout's working tree, not the code on `beta`.
 *
 * Every stage is spawned with `cwd: repoRoot`, so whatever `HEAD` happens to be at the moment a
 * stage launches is what that stage executes, and a `git pull` in that checkout during a run
 * changes the code mid-sweep.
 *
 * Stage results are therefore not attributable unless the commit is recorded, and a stage can
 * re-apply a defect the checkout predates, which is why a moved checkout fails closed rather than
 * only being recorded. The measured incident and the operator contract live in
 * docs/research-data-pipeline.md ("The commit a sweep runs").
 *
 * `null` where a checkout with no git metadata cannot answer the question.
 */
export function sweepCodeIdentityFrom(rawSha: unknown): string | null {
  const sha = typeof rawSha === 'string' ? rawSha.trim() : '';
  return /^[0-9a-f]{7,40}$/i.test(sha) ? sha : null;
}

export type SweepCodeDriftRefusal = {
  stage: string;
  startedSha: string;
  currentSha: string;
  message: string;
};

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

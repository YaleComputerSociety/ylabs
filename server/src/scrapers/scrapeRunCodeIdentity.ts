/**
 * Which code a scrape run executed, recorded on the run so a later reader can ask
 * whether a given fix was in it (#3824).
 *
 * A run's start time cannot answer that. A checkout can be behind `beta` when a run
 * starts, and a long sweep can move its checkout mid-run (#3814), so a run started
 * after a fix merged may still execute the code the fix replaced. The commit the
 * process loaded answers it exactly, by ancestry.
 */
import { spawnSync } from 'child_process';
import {
  PROCESS_REPO_ROOT as REPO_ROOT,
  currentProcessCodeSha,
  isFullCommitSha,
  readCodeSha,
} from '../utils/processCodeIdentity';

export { currentProcessCodeSha, isFullCommitSha, readCodeSha };

const ancestryCache = new Map<string, boolean | undefined>();

/**
 * `undefined` when git cannot answer: a commit the local object store does not hold
 * (a shallow clone, a deploy image without history) or a value that is not a
 * commit. The caller decides what an unanswerable question means.
 */
export function gitCommitIsAncestor(
  ancestor: string,
  descendant: string,
  repoRoot: string = REPO_ROOT,
): boolean | undefined {
  if (!isFullCommitSha(ancestor) || !isFullCommitSha(descendant)) return undefined;
  const cacheKey = `${repoRoot}\u0000${ancestor}\u0000${descendant}`;
  if (ancestryCache.has(cacheKey)) return ancestryCache.get(cacheKey);
  const result = spawnSync(
    'git',
    ['-C', repoRoot, 'merge-base', '--is-ancestor', ancestor, descendant],
    { stdio: 'ignore' },
  );
  const answer = result.status === 0 ? true : result.status === 1 ? false : undefined;
  ancestryCache.set(cacheKey, answer);
  return answer;
}

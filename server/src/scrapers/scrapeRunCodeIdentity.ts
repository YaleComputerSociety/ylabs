/**
 * Which code a scrape run executed, recorded on the run so a later reader can ask
 * whether a given fix was in it (#3824).
 *
 * A run's start time cannot answer that. A checkout can be behind `beta` when a run
 * starts, and a long sweep can move its checkout mid-run (#3814), so a run started
 * after a fix merged may still execute the code the fix replaced. The commit the
 * process loaded answers it exactly, by ancestry.
 */
import { execFileSync, spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

const COMMIT_SHA = /^[0-9a-f]{40}$/;

const DECLARED_COMMIT_ENV_KEYS = ['SOURCE_COMMIT', 'RENDER_GIT_COMMIT', 'GIT_COMMIT'] as const;

export function isFullCommitSha(value: unknown): value is string {
  return typeof value === 'string' && COMMIT_SHA.test(value);
}

export function readCodeSha(
  env: Readonly<Record<string, string | undefined>> = process.env,
  repoRoot: string = REPO_ROOT,
): string | undefined {
  for (const key of DECLARED_COMMIT_ENV_KEYS) {
    const declared = env[key]?.trim().toLowerCase();
    if (declared) return isFullCommitSha(declared) ? declared : undefined;
  }
  try {
    const head = execFileSync('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .trim()
      .toLowerCase();
    return isFullCommitSha(head) ? head : undefined;
  } catch {
    return undefined;
  }
}

// Read once, when the module loads, because that is when the process loaded its
// code: HEAD moving later does not change what this process runs.
const PROCESS_CODE_SHA = readCodeSha();

export function currentProcessCodeSha(): string | undefined {
  return PROCESS_CODE_SHA;
}

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

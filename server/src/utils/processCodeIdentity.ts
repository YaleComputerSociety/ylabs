import { execFileSync } from 'child_process';
import path from 'path';
import { resolveServerPackageRoot } from './serverPackageRoot';

export const PROCESS_REPO_ROOT = path.dirname(resolveServerPackageRoot(import.meta.url));

const COMMIT_SHA = /^[0-9a-f]{40}$/;

const DECLARED_COMMIT_ENV_KEYS = ['SOURCE_COMMIT', 'RENDER_GIT_COMMIT', 'GIT_COMMIT'] as const;

export function isFullCommitSha(value: unknown): value is string {
  return typeof value === 'string' && COMMIT_SHA.test(value);
}

export function readCodeSha(
  env: Readonly<Record<string, string | undefined>> = process.env,
  repoRoot: string = PROCESS_REPO_ROOT,
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

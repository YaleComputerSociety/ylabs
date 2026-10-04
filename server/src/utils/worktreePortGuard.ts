import fs from 'node:fs';
import path from 'node:path';

import { isDevelopment } from './environment';

export const PRIMARY_CHECKOUT_API_PORT = 4000;

export const isLinkedGitWorktree = (repoRoot: string): boolean => {
  try {
    return fs.statSync(path.join(repoRoot, '.git')).isFile();
  } catch {
    return false;
  }
};

interface WorktreePortCheck {
  port: number;
  repoRoot: string;
  env?: NodeJS.ProcessEnv;
}

export const worktreePortConflict = ({
  port,
  repoRoot,
  env = process.env,
}: WorktreePortCheck): string | null => {
  if (!isDevelopment(env) || port !== PRIMARY_CHECKOUT_API_PORT) return null;
  if (!isLinkedGitWorktree(repoRoot)) return null;
  return [
    `This is a linked git worktree (${repoRoot}), but its API port is ${PRIMARY_CHECKOUT_API_PORT}, the primary checkout's port,`,
    'so it would collide with the primary server or serve its client the wrong code (#4666).',
    'Give this worktree its own port, then start the server again:',
    `  node scripts/prepare-worktree-env.mjs --primary <primary checkout> --worktree ${repoRoot} --server-port <free port>`,
    'scripts/new-agent-worktree.sh does this for you when it creates a worktree.',
  ].join('\n');
};

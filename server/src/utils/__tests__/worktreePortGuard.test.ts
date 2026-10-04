import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { isLinkedGitWorktree, worktreePortConflict } from '../worktreePortGuard';

const development = { NODE_ENV: 'development' };

describe('worktreePortConflict', () => {
  let linkedWorktree: string;
  let primaryCheckout: string;
  let notARepository: string;

  beforeEach(() => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'worktree-port-guard-'));
    linkedWorktree = path.join(root, 'linked');
    primaryCheckout = path.join(root, 'primary');
    notARepository = path.join(root, 'plain');
    fs.mkdirSync(linkedWorktree);
    fs.writeFileSync(
      path.join(linkedWorktree, '.git'),
      'gitdir: /tmp/primary/.git/worktrees/linked\n',
    );
    fs.mkdirSync(path.join(primaryCheckout, '.git'), { recursive: true });
    fs.mkdirSync(notARepository);
  });

  afterEach(() => {
    fs.rmSync(path.dirname(linkedWorktree), { recursive: true, force: true });
  });

  it('tells a linked worktree on the primary port how to get its own port', () => {
    const message = worktreePortConflict({
      port: 4000,
      repoRoot: linkedWorktree,
      env: development,
    });
    expect(message).toContain('linked git worktree');
    expect(message).toContain(`--worktree ${linkedWorktree}`);
    expect(message).toContain('prepare-worktree-env.mjs');
  });

  it('lets a linked worktree start on a port of its own', () => {
    expect(
      worktreePortConflict({ port: 4012, repoRoot: linkedWorktree, env: development }),
    ).toBeNull();
  });

  it('lets the primary checkout and a directory outside git use the primary port', () => {
    expect(
      worktreePortConflict({ port: 4000, repoRoot: primaryCheckout, env: development }),
    ).toBeNull();
    expect(
      worktreePortConflict({ port: 4000, repoRoot: notARepository, env: development }),
    ).toBeNull();
  });

  it('never refuses outside development, so a deployed or test server is unaffected', () => {
    for (const NODE_ENV of ['production', 'test', 'ci', '']) {
      expect(
        worktreePortConflict({ port: 4000, repoRoot: linkedWorktree, env: { NODE_ENV } }),
      ).toBeNull();
    }
  });

  it('tells a linked worktree from a primary checkout by the shape of .git', () => {
    expect(isLinkedGitWorktree(linkedWorktree)).toBe(true);
    expect(isLinkedGitWorktree(primaryCheckout)).toBe(false);
    expect(isLinkedGitWorktree(notARepository)).toBe(false);
  });
});

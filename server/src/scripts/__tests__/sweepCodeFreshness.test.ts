import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { gitRunnerIn, readSweepCodeFreshness } from '../sweepCodeFreshness';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): string {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Synthetic',
      GIT_AUTHOR_EMAIL: 'synthetic@example.test',
      GIT_COMMITTER_NAME: 'Synthetic',
      GIT_COMMITTER_EMAIL: 'synthetic@example.test',
    },
  });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout.trim();
}

function commitFile(repo: string, file: string, content: string): string {
  const target = path.join(repo, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  git(repo, 'add', '-A');
  git(repo, 'commit', '--quiet', '-m', `change ${file}`);
  return git(repo, 'rev-parse', 'HEAD');
}

function makeOrigin() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sweep-code-freshness-'));
  tempDirs.push(root);
  const authoring = path.join(root, 'authoring');
  fs.mkdirSync(authoring);
  git(authoring, 'init', '--quiet', '--initial-branch=beta');
  const base = commitFile(authoring, 'server/src/scrapers/lane.ts', 'export const v = 1;\n');
  const laneFix = commitFile(authoring, 'server/src/scrapers/lane.ts', 'export const v = 2;\n');
  const clientOnly = commitFile(authoring, 'client/src/page.tsx', 'export {};\n');
  const origin = path.join(root, 'origin.git');
  git(root, 'clone', '--quiet', '--bare', authoring, origin);
  const checkoutAt = (sha: string): string => {
    const checkout = fs.mkdtempSync(path.join(root, 'checkout-'));
    git(root, 'clone', '--quiet', origin, checkout);
    git(checkout, 'checkout', '--quiet', '--detach', sha);
    return checkout;
  };
  return { root, authoring, origin, base, laneFix, clientOnly, checkoutAt };
}

describe('readSweepCodeFreshness', () => {
  it('refuses code older than the newest beta commit touching the scrapers', () => {
    const repo = makeOrigin();
    const freshness = readSweepCodeFreshness({ git: gitRunnerIn(repo.checkoutAt(repo.base)) });

    expect(freshness.ok).toBe(false);
    expect(freshness.codeSha).toBe(repo.base);
    expect(freshness.newestLaneCommitSha).toBe(repo.laneFix);
    expect(freshness.refusal).toContain(repo.laneFix);
    expect(freshness.refusal).toContain('#4743');
  });

  it('runs code that contains the newest lane commit even when beta has later non-lane commits', () => {
    const repo = makeOrigin();
    const freshness = readSweepCodeFreshness({ git: gitRunnerIn(repo.checkoutAt(repo.laneFix)) });

    expect(freshness).toEqual({
      ok: true,
      codeSha: repo.laneFix,
      targetSha: null,
      newestLaneCommitSha: repo.laneFix,
    });
  });

  it('sees a lane commit merged after the checkout was made, because it fetches beta itself', () => {
    const repo = makeOrigin();
    const checkout = repo.checkoutAt(repo.clientOnly);
    const later = commitFile(repo.authoring, 'server/src/scrapers/lane.ts', 'export const v = 3;\n');
    git(repo.authoring, 'push', '--quiet', repo.origin, 'beta');

    const freshness = readSweepCodeFreshness({ git: gitRunnerIn(checkout) });

    expect(freshness.ok).toBe(false);
    expect(freshness.newestLaneCommitSha).toBe(later);
  });

  it('counts a materializer script outside the scrapers directory as lane code', () => {
    const repo = makeOrigin();
    const checkout = repo.checkoutAt(repo.clientOnly);
    const materializerFix = commitFile(
      repo.authoring,
      'server/src/scripts/materializeSomethingCore.ts',
      'export {};\n',
    );
    git(repo.authoring, 'push', '--quiet', repo.origin, 'beta');

    const freshness = readSweepCodeFreshness({ git: gitRunnerIn(checkout) });

    expect(freshness.ok).toBe(false);
    expect(freshness.newestLaneCommitSha).toBe(materializerFix);
  });

  it('refuses when the checkout is not the commit the runner resolved', () => {
    const repo = makeOrigin();
    const freshness = readSweepCodeFreshness({
      git: gitRunnerIn(repo.checkoutAt(repo.laneFix)),
      targetSha: repo.clientOnly,
    });

    expect(freshness.ok).toBe(false);
    expect(freshness.targetSha).toBe(repo.clientOnly);
    expect(freshness.refusal).toContain(repo.clientOnly);
  });

  it('refuses code with no git history rather than trusting an image label', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sweep-code-freshness-nogit-'));
    tempDirs.push(dir);
    const freshness = readSweepCodeFreshness({ git: gitRunnerIn(dir) });

    expect(freshness.ok).toBe(false);
    expect(freshness.codeSha).toBeNull();
    expect(freshness.refusal).toMatch(/no git history/);
  });

  it('refuses when beta cannot be fetched', () => {
    const repo = makeOrigin();
    const checkout = repo.checkoutAt(repo.clientOnly);
    fs.rmSync(repo.origin, { recursive: true, force: true });

    const freshness = readSweepCodeFreshness({ git: gitRunnerIn(checkout) });

    expect(freshness.ok).toBe(false);
    expect(freshness.refusal).toMatch(/could not fetch/);
  });
});

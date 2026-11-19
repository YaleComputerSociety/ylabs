import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { gitRunnerIn, readSweepCodeFreshness } from '../sweepCodeFreshness';

const tempDirs: string[] = [];
const testDirs: string[] = [];

afterEach(() => {
  for (const dir of testDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
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

interface OriginTemplate {
  root: string;
  emptyTemplateDir: string;
  base: string;
  laneFix: string;
  clientOnly: string;
}

let template: OriginTemplate;

// This test's cost is the number of files its git fixture creates, and file creation is
// what slows under load: on a contended developer machine one file took about 25 ms, so
// rebuilding three repositories (each with git's sample hooks) for every test spent most
// of the 30 s budget before an assertion ran (#5656). The history is built once, with an
// empty init template so no sample hooks are written, and each test copies only the
// repositories it uses. Tests in a file run one at a time, so they share one checkout,
// which each test re-points at its own copy of the origin; the code under test
// force-fetches that remote, so a ref left by an earlier test is overwritten before it is read.
beforeAll(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sweep-code-freshness-template-'));
  tempDirs.push(root);
  const emptyTemplateDir = path.join(root, 'empty-git-template');
  fs.mkdirSync(emptyTemplateDir);
  const authoring = path.join(root, 'authoring');
  git(
    root,
    'init',
    '--quiet',
    `--template=${emptyTemplateDir}`,
    '--initial-branch=beta',
    authoring,
  );
  const base = commitFile(authoring, 'server/src/scrapers/lane.ts', 'export const v = 1;\n');
  const laneFix = commitFile(authoring, 'server/src/scrapers/lane.ts', 'export const v = 2;\n');
  const clientOnly = commitFile(authoring, 'client/src/page.tsx', 'export {};\n');
  const origin = path.join(root, 'origin.git');
  git(root, 'clone', '--quiet', '--bare', `--template=${emptyTemplateDir}`, authoring, origin);
  git(
    root,
    'clone',
    '--quiet',
    `--template=${emptyTemplateDir}`,
    origin,
    path.join(root, 'checkout'),
  );
  template = { root, emptyTemplateDir, base, laneFix, clientOnly };
});

afterAll(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function makeOrigin() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sweep-code-freshness-'));
  testDirs.push(root);
  const copyOf = (name: string): string => {
    const target = path.join(root, name);
    if (!fs.existsSync(target)) {
      fs.cpSync(path.join(template.root, name), target, { recursive: true });
    }
    return target;
  };
  const origin = copyOf('origin.git');
  const checkoutAt = (sha: string): string => {
    const checkout = path.join(template.root, 'checkout');
    git(checkout, 'remote', 'set-url', 'origin', origin);
    git(checkout, 'checkout', '--quiet', '--detach', sha);
    return checkout;
  };
  return {
    base: template.base,
    laneFix: template.laneFix,
    clientOnly: template.clientOnly,
    root,
    origin,
    checkoutAt,
    publishToBeta(file: string, content: string): string {
      const checkout = path.join(template.root, 'checkout');
      const restoreTo = git(checkout, 'rev-parse', 'HEAD');
      git(checkout, 'checkout', '--quiet', '--detach', template.clientOnly);
      const sha = commitFile(checkout, file, content);
      git(checkout, 'push', '--quiet', origin, 'HEAD:refs/heads/beta');
      git(checkout, 'checkout', '--quiet', '--detach', restoreTo);
      return sha;
    },
  };
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
    const later = repo.publishToBeta('server/src/scrapers/lane.ts', 'export const v = 3;\n');

    const freshness = readSweepCodeFreshness({ git: gitRunnerIn(checkout) });

    expect(freshness.ok).toBe(false);
    expect(freshness.newestLaneCommitSha).toBe(later);
  });

  it('counts a materializer script outside the scrapers directory as lane code', () => {
    const repo = makeOrigin();
    const checkout = repo.checkoutAt(repo.clientOnly);
    const materializerFix = repo.publishToBeta(
      'server/src/scripts/materializeSomethingCore.ts',
      'export {};\n',
    );

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

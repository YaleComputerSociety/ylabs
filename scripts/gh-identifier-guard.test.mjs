import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';

import { classifyCommand, isGuardedRepo, planGuard } from './gh-identifier-guard-core.mjs';

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const GUARDED = 'YaleComputerSociety/does-not-exist-guard-test';
// The body scan allows the synthetic zz?99 netid shape, so a fixture that must be
// refused end to end has to sit just outside it.
const FLAGGED_NETID = 'zzq1111';
const FLAGGED = `The row keyed netid: ${FLAGGED_NETID} is stale.`;
const FLAGGED_COMMENT = `Closing because netid ${FLAGGED_NETID} departed.`;
const CLEAN = 'The 12 rows where manuallyLockedFields contains activeAtYaleCache are stale.';

const context = (overrides = {}) => ({
  envRepo: undefined,
  originUrl: `git@github.com:${GUARDED}.git`,
  readBodyFile: () => {
    throw new Error('unexpected body file read');
  },
  branchCommitMessages: () => '',
  ...overrides,
});

test('scans the title and inline body of a publishing command', () => {
  const plan = planGuard(['issue', 'create', '-t', 'fix: x', '--body', FLAGGED], context());

  assert.equal(plan.action, 'scan');
  assert.equal(plan.label, 'issue create body');
  assert.match(plan.text, /fix: x/);
  assert.match(plan.text, new RegExp(FLAGGED_NETID));
});

test('reads --body-file and a stdin body through the injected reader', () => {
  const reads = [];
  const readBodyFile = (file) => {
    reads.push(file);
    return FLAGGED_COMMENT;
  };

  assert.equal(
    planGuard(['pr', 'create', '-F', '/tmp/body.md'], context({ readBodyFile })).action,
    'scan',
  );
  assert.equal(
    planGuard(['issue', 'comment', '1', '--body-file=-'], context({ readBodyFile })).action,
    'scan',
  );
  assert.deepEqual(reads, ['/tmp/body.md', '-']);
});

test('scans the text fields of a gh api call and ignores the rest', () => {
  const plan = planGuard(
    ['api', 'repos/x/y/issues/1/comments', '-f', `body=${FLAGGED}`, '-f', 'state=open'],
    context(),
  );

  assert.equal(plan.action, 'scan');
  assert.equal(plan.label, 'API body');
  assert.equal(plan.text, FLAGGED);
  assert.deepEqual(planGuard(['api', 'repos/x/y/pulls', '-f', 'state=open'], context()), {
    action: 'passthrough',
  });
});

test('scans the branch commit messages that pr create --fill would publish', () => {
  const plan = planGuard(
    ['pr', 'create', '--fill', '--base', 'beta'],
    context({ branchCommitMessages: (base) => `${base}: ${FLAGGED_COMMENT}` }),
  );

  assert.equal(plan.action, 'scan');
  assert.equal(plan.text, `beta: ${FLAGGED_COMMENT}`);
});

test('passes through a repository outside the guarded organisation', () => {
  const args = ['issue', 'create', '-R', 'cli/cli', '-b', FLAGGED];

  assert.equal(isGuardedRepo('cli/cli'), false);
  assert.deepEqual(planGuard(args, context()), { action: 'passthrough' });
  assert.deepEqual(
    planGuard(
      ['issue', 'create', '-b', FLAGGED],
      context({ originUrl: 'git@github.com:cli/cli.git' }),
    ),
    { action: 'passthrough' },
  );
});

test('scans a pr create from a fork checkout whose upstream is the guarded repository', () => {
  const fork = context({
    originUrl: 'git@github.com:contributor/ylabs.git',
    remoteUrls: ['git@github.com:contributor/ylabs.git', `https://github.com/${GUARDED}.git`],
  });

  assert.equal(planGuard(['pr', 'create', '--title', 't', '--body', FLAGGED], fork).action, 'scan');
  assert.equal(planGuard(['issue', 'comment', '1', '--body', FLAGGED], fork).action, 'scan');
  assert.deepEqual(
    planGuard(
      ['pr', 'create', '--title', 't', '--body', FLAGGED],
      context({
        originUrl: 'git@github.com:contributor/other.git',
        remoteUrls: ['git@github.com:contributor/other.git'],
      }),
    ),
    { action: 'passthrough' },
  );
});

test('an explicit -R or GH_REPO outranks the checkout remote', () => {
  const outside = context({ originUrl: 'git@github.com:cli/cli.git' });

  assert.equal(
    planGuard(['issue', 'create', '-R', GUARDED, '-b', FLAGGED], outside).action,
    'scan',
  );
  assert.equal(
    planGuard(['issue', 'create', '-b', FLAGGED], { ...outside, envRepo: GUARDED }).action,
    'scan',
  );
});

test('scans the comment that close and reopen post', () => {
  for (const args of [
    ['pr', 'close', '12', '-c', FLAGGED_COMMENT],
    ['issue', 'reopen', '3', `--comment=${FLAGGED_COMMENT}`],
  ]) {
    const plan = planGuard(args, context());
    assert.equal(plan.action, 'scan', args.join(' '));
    assert.equal(plan.text, FLAGGED_COMMENT);
  }
});

test('treats pr create -f as --fill and scans the commit messages', () => {
  const plan = planGuard(
    ['pr', 'create', '-f'],
    context({ branchCommitMessages: () => FLAGGED_COMMENT }),
  );

  assert.equal(plan.action, 'scan');
  assert.equal(plan.text, FLAGGED_COMMENT);
});

test('reads attached short-flag values', () => {
  assert.equal(
    planGuard(['issue', 'create', '-t', 'x', `-b${FLAGGED}`], context()).text,
    `x\n\n${FLAGGED}`,
  );
  assert.equal(planGuard(['issue', 'create', `-b=${FLAGGED}`], context()).text, FLAGGED);
  assert.equal(
    planGuard(['api', 'repos/x/y/issues', `-fbody=${FLAGGED}`], context()).text,
    FLAGGED,
  );
});

test('guards a repository named by an API endpoint or URL outside the checkout', () => {
  const outside = context({ originUrl: '' });

  assert.equal(
    planGuard(['api', `repos/${GUARDED}/issues/1/comments`, '-f', `body=${FLAGGED}`], outside)
      .action,
    'scan',
  );
  assert.equal(
    planGuard(['pr', 'comment', `https://github.com/${GUARDED}/pull/12`, '-b', FLAGGED], outside)
      .action,
    'scan',
  );
});

test('scans a GraphQL mutation wherever it runs, and passes a read query through', () => {
  const outside = context({ originUrl: 'git@github.com:cli/cli.git' });
  const mutation = `mutation{addComment(input:{subjectId:"x",body:"${FLAGGED_COMMENT}"}){clientMutationId}}`;

  const plan = planGuard(['api', 'graphql', '-f', `query=${mutation}`], outside);
  assert.equal(plan.action, 'scan');
  assert.equal(plan.text, mutation);
  assert.deepEqual(planGuard(['api', 'graphql', '-f', 'query={viewer{login}}'], outside), {
    action: 'passthrough',
  });
});

test('passes through commands that publish nothing', () => {
  for (const args of [['auth', 'status'], ['pr', 'view', '1'], ['issue', 'list'], ['--version']]) {
    assert.equal(classifyCommand(args).kind, 'other', args.join(' '));
    assert.deepEqual(planGuard(args, context()), { action: 'passthrough' }, args.join(' '));
  }
});

const createdTempDirectories = [];

const makeTempDirectory = (prefix) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  createdTempDirectories.push(directory);
  return directory;
};

after(() => {
  for (const directory of createdTempDirectories) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

const makeFakeGh = () => {
  const dir = makeTempDirectory('gh-guard-test-');
  const log = path.join(dir, 'calls.log');
  const gh = path.join(dir, 'gh');
  fs.writeFileSync(gh, `#!/bin/sh\nprintf '%s\\n' "$*" >> "${log}"\ncat >> "${log}"\n`);
  fs.chmodSync(gh, 0o755);
  return { dir, log };
};

const runGuard = (guardPath, args, { input = '', binDir }) =>
  spawnSync(process.execPath, [guardPath, ...args], {
    cwd: os.tmpdir(),
    input,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${binDir}${path.delimiter}/usr/bin${path.delimiter}/bin`,
      GH_REPO: '',
      TMPDIR: makeTempDirectory('gh-guard-drafts-'),
    },
  });

test('refuses a flagged body end to end, so the real gh never runs', () => {
  const { dir, log } = makeFakeGh();
  const guard = path.join(scriptsDir, 'gh-identifier-guard.mjs');

  const inline = runGuard(guard, ['issue', 'create', '-R', GUARDED, '-t', 't', '-b', FLAGGED], {
    binDir: dir,
  });
  const stdin = runGuard(guard, ['issue', 'comment', '1', '-R', GUARDED, '-F', '-'], {
    binDir: dir,
    input: FLAGGED_COMMENT,
  });

  for (const result of [inline, stdin]) {
    assert.equal(result.status, 1);
    assert.match(result.stderr, /gh guard: NOT posted/);
    assert.doesNotMatch(result.stderr, new RegExp(FLAGGED_NETID));
  }
  assert.equal(fs.existsSync(log), false);
});

test('keeps a refused draft locally so the author can see what to rewrite', () => {
  const { dir } = makeFakeGh();
  const guard = path.join(scriptsDir, 'gh-identifier-guard.mjs');

  const result = runGuard(
    guard,
    ['issue', 'create', '-R', GUARDED, '-t', 'fix: x', '-b', FLAGGED],
    {
      binDir: dir,
    },
  );
  const kept = result.stderr.match(/Rejected draft kept locally at (\S+)/)?.[1];

  assert.equal(result.status, 1);
  assert.ok(kept, result.stderr);
  assert.equal(fs.statSync(kept).mode & 0o077, 0);
  assert.equal(fs.statSync(path.dirname(kept)).mode & 0o077, 0);
  assert.equal(fs.readFileSync(kept, 'utf8'), `fix: x\n\n${FLAGGED}`);
  fs.rmSync(path.dirname(kept), { recursive: true });
});

test('forwards a clean body and its stdin to the real gh unchanged', () => {
  const { dir, log } = makeFakeGh();
  const guard = path.join(scriptsDir, 'gh-identifier-guard.mjs');

  const result = runGuard(guard, ['issue', 'comment', '1', '-R', GUARDED, '-F', '-'], {
    binDir: dir,
    input: CLEAN,
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(log, 'utf8'), `issue comment 1 -R ${GUARDED} -F -\n${CLEAN}`);
});

test('fails closed when the scanner is missing, instead of posting unchecked', () => {
  const { dir, log } = makeFakeGh();
  const isolated = makeTempDirectory('gh-guard-no-scanner-');
  for (const file of ['gh-identifier-guard.mjs', 'gh-identifier-guard-core.mjs']) {
    fs.copyFileSync(path.join(scriptsDir, file), path.join(isolated, file));
  }

  const result = runGuard(
    path.join(isolated, 'gh-identifier-guard.mjs'),
    ['issue', 'create', '-R', GUARDED, '-b', CLEAN],
    { binDir: dir },
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /scanner is missing/);
  assert.equal(fs.existsSync(log), false);
});

const GUARD_FILES = [
  'gh-identifier-guard.mjs',
  'gh-identifier-guard-core.mjs',
  'check-no-person-identifiers.mjs',
  'check-no-person-identifiers-core.mjs',
];

const nodeDir = path.dirname(process.execPath);

const runInstaller = (binDir, { checkout = path.dirname(scriptsDir), guardHome, pathDirs } = {}) =>
  spawnSync('bash', [path.join(scriptsDir, 'install-gh-identifier-guard.sh'), checkout], {
    encoding: 'utf8',
    env: {
      ...process.env,
      GH_GUARD_BIN_DIR: binDir,
      GH_GUARD_HOME: guardHome ?? makeTempDirectory('gh-guard-home-'),
      PATH: [...(pathDirs ?? [binDir]), nodeDir, '/usr/bin', '/bin'].join(path.delimiter),
    },
  });

const makeThrowawayCheckout = () => {
  const checkout = makeTempDirectory('gh-guard-checkout-');
  fs.mkdirSync(path.join(checkout, 'scripts'));
  for (const file of GUARD_FILES) {
    fs.copyFileSync(path.join(scriptsDir, file), path.join(checkout, 'scripts', file));
  }
  return checkout;
};

const runShim = (shimDir, realGhDir, args, input = '') =>
  spawnSync(path.join(shimDir, 'gh'), args, {
    cwd: os.tmpdir(),
    input,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: [shimDir, realGhDir, nodeDir, '/usr/bin', '/bin'].join(path.delimiter),
      GH_REPO: '',
      TMPDIR: makeTempDirectory('gh-guard-drafts-'),
    },
  });

test('the installer refuses to overwrite a gh that is not a guard shim', () => {
  const { dir } = makeFakeGh();
  const realGh = fs.readFileSync(path.join(dir, 'gh'), 'utf8');

  const result = runInstaller(dir);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /not a guard shim/);
  assert.equal(fs.readFileSync(path.join(dir, 'gh'), 'utf8'), realGh);
  assert.deepEqual(fs.readdirSync(dir), ['gh']);
});

test('the installer writes the shim into an empty directory and is idempotent', () => {
  const dir = makeTempDirectory('gh-guard-install-');
  const guardHome = makeTempDirectory('gh-guard-home-');

  const first = runInstaller(dir, { guardHome });
  assert.equal(first.status, 0, first.stderr);
  const again = runInstaller(dir, { guardHome });
  assert.equal(again.status, 0, again.stderr);
  assert.match(again.stdout, /already current/);
  assert.deepEqual(fs.readdirSync(guardHome).sort(), [...GUARD_FILES].sort());
});

test('the installer fails loudly when the shim is not the first gh on PATH', () => {
  const shimDir = makeTempDirectory('gh-guard-install-');
  const { dir: realGhDir } = makeFakeGh();

  const shadowed = runInstaller(shimDir, { pathDirs: [realGhDir, shimDir] });
  assert.equal(shadowed.status, 1);
  assert.match(shadowed.stderr, /is not ahead of .* on PATH/);

  const absent = runInstaller(shimDir, { pathDirs: [] });
  assert.equal(absent.status, 1);
  assert.match(absent.stderr, /is not ahead of the real gh on PATH/);
});

test('the shim keeps guarding after the checkout it was installed from is deleted', () => {
  const shimDir = makeTempDirectory('gh-guard-install-');
  const { dir: realGhDir, log } = makeFakeGh();
  const checkout = makeThrowawayCheckout();
  assert.equal(runInstaller(shimDir, { checkout }).status, 0);
  fs.rmSync(checkout, { recursive: true, force: true });

  const refused = runShim(shimDir, realGhDir, ['issue', 'create', '-R', GUARDED, '-b', FLAGGED]);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /gh guard: NOT posted/);
  assert.equal(fs.existsSync(log), false);

  const outside = runShim(shimDir, realGhDir, ['issue', 'create', '-R', 'cli/cli', '-b', FLAGGED]);
  assert.equal(outside.status, 0, outside.stderr);
  const clean = runShim(shimDir, realGhDir, ['issue', 'create', '-R', GUARDED, '-b', CLEAN]);
  assert.equal(clean.status, 0, clean.stderr);
  assert.equal(
    fs.readFileSync(log, 'utf8'),
    `issue create -R cli/cli -b ${FLAGGED}\nissue create -R ${GUARDED} -b ${CLEAN}\n`,
  );
});

test('the shim names the missing guard, refuses posts, and passes other commands through', () => {
  const shimDir = makeTempDirectory('gh-guard-install-');
  const guardHome = makeTempDirectory('gh-guard-home-');
  const { dir: realGhDir, log } = makeFakeGh();
  const checkout = makeThrowawayCheckout();
  assert.equal(runInstaller(shimDir, { checkout, guardHome }).status, 0);
  fs.rmSync(checkout, { recursive: true, force: true });
  fs.rmSync(guardHome, { recursive: true, force: true });

  for (const args of [
    ['issue', 'create', '-R', GUARDED, '-b', CLEAN],
    ['pr', 'comment', '1', '-b', CLEAN],
    ['api', 'repos/x/y/issues', '-f', `body=${CLEAN}`],
  ]) {
    const result = runShim(shimDir, realGhDir, args);
    assert.equal(result.status, 1, args.join(' '));
    assert.match(result.stderr, /is missing; re-run scripts\/install-gh-identifier-guard\.sh/);
  }
  assert.equal(fs.existsSync(log), false);

  const read = runShim(shimDir, realGhDir, ['pr', 'view', '1']);
  assert.equal(read.status, 0, read.stderr);
  assert.equal(fs.readFileSync(log, 'utf8'), 'pr view 1\n');
});

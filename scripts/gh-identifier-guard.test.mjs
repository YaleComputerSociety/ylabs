import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { classifyCommand, isGuardedRepo, planGuard } from './gh-identifier-guard-core.mjs';

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const GUARDED = 'YaleComputerSociety/does-not-exist-guard-test';
const FLAGGED_SLUG = 'The entity nih-pi-quilla-marrowbane serves a stale description.';
const FLAGGED_PROSE = 'Quilla Marrowbane has departed and the row is wrong.';
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
  const plan = planGuard(['issue', 'create', '-t', 'fix: x', '--body', FLAGGED_SLUG], context());

  assert.equal(plan.action, 'scan');
  assert.equal(plan.label, 'issue create body');
  assert.match(plan.text, /fix: x/);
  assert.match(plan.text, /nih-pi-quilla-marrowbane/);
});

test('reads --body-file and a stdin body through the injected reader', () => {
  const reads = [];
  const readBodyFile = (file) => {
    reads.push(file);
    return FLAGGED_PROSE;
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
    ['api', 'repos/x/y/issues/1/comments', '-f', `body=${FLAGGED_SLUG}`, '-f', 'state=open'],
    context(),
  );

  assert.equal(plan.action, 'scan');
  assert.equal(plan.label, 'API body');
  assert.equal(plan.text, FLAGGED_SLUG);
  assert.deepEqual(planGuard(['api', 'repos/x/y/pulls', '-f', 'state=open'], context()), {
    action: 'passthrough',
  });
});

test('scans the branch commit messages that pr create --fill would publish', () => {
  const plan = planGuard(
    ['pr', 'create', '--fill', '--base', 'beta'],
    context({ branchCommitMessages: (base) => `${base}: ${FLAGGED_PROSE}` }),
  );

  assert.equal(plan.action, 'scan');
  assert.equal(plan.text, `beta: ${FLAGGED_PROSE}`);
});

test('passes through a repository outside the guarded organisation', () => {
  const args = ['issue', 'create', '-R', 'cli/cli', '-b', FLAGGED_SLUG];

  assert.equal(isGuardedRepo('cli/cli'), false);
  assert.deepEqual(planGuard(args, context()), { action: 'passthrough' });
  assert.deepEqual(
    planGuard(
      ['issue', 'create', '-b', FLAGGED_SLUG],
      context({ originUrl: 'git@github.com:cli/cli.git' }),
    ),
    { action: 'passthrough' },
  );
});

test('an explicit -R or GH_REPO outranks the checkout remote', () => {
  const outside = context({ originUrl: 'git@github.com:cli/cli.git' });

  assert.equal(
    planGuard(['issue', 'create', '-R', GUARDED, '-b', FLAGGED_SLUG], outside).action,
    'scan',
  );
  assert.equal(
    planGuard(['issue', 'create', '-b', FLAGGED_SLUG], { ...outside, envRepo: GUARDED }).action,
    'scan',
  );
});

test('scans the comment that close and reopen post', () => {
  for (const args of [
    ['pr', 'close', '12', '-c', FLAGGED_PROSE],
    ['issue', 'reopen', '3', `--comment=${FLAGGED_PROSE}`],
  ]) {
    const plan = planGuard(args, context());
    assert.equal(plan.action, 'scan', args.join(' '));
    assert.equal(plan.text, FLAGGED_PROSE);
  }
});

test('treats pr create -f as --fill and scans the commit messages', () => {
  const plan = planGuard(
    ['pr', 'create', '-f'],
    context({ branchCommitMessages: () => FLAGGED_PROSE }),
  );

  assert.equal(plan.action, 'scan');
  assert.equal(plan.text, FLAGGED_PROSE);
});

test('reads attached short-flag values', () => {
  assert.equal(
    planGuard(['issue', 'create', '-t', 'x', `-b${FLAGGED_SLUG}`], context()).text,
    `x\n\n${FLAGGED_SLUG}`,
  );
  assert.equal(planGuard(['issue', 'create', `-b=${FLAGGED_SLUG}`], context()).text, FLAGGED_SLUG);
  assert.equal(
    planGuard(['api', 'repos/x/y/issues', `-fbody=${FLAGGED_SLUG}`], context()).text,
    FLAGGED_SLUG,
  );
});

test('guards a repository named by an API endpoint or URL outside the checkout', () => {
  const outside = context({ originUrl: '' });

  assert.equal(
    planGuard(['api', `repos/${GUARDED}/issues/1/comments`, '-f', `body=${FLAGGED_SLUG}`], outside)
      .action,
    'scan',
  );
  assert.equal(
    planGuard(
      ['pr', 'comment', `https://github.com/${GUARDED}/pull/12`, '-b', FLAGGED_SLUG],
      outside,
    ).action,
    'scan',
  );
});

test('scans a GraphQL mutation wherever it runs, and passes a read query through', () => {
  const outside = context({ originUrl: 'git@github.com:cli/cli.git' });
  const mutation = `mutation{addComment(input:{subjectId:"x",body:"${FLAGGED_PROSE}"}){clientMutationId}}`;

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

const makeFakeGh = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-guard-test-'));
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
    },
  });

test('refuses a flagged body end to end, so the real gh never runs', () => {
  const { dir, log } = makeFakeGh();
  const guard = path.join(scriptsDir, 'gh-identifier-guard.mjs');

  const inline = runGuard(
    guard,
    ['issue', 'create', '-R', GUARDED, '-t', 't', '-b', FLAGGED_SLUG],
    { binDir: dir },
  );
  const stdin = runGuard(guard, ['issue', 'comment', '1', '-R', GUARDED, '-F', '-'], {
    binDir: dir,
    input: FLAGGED_PROSE,
  });

  for (const result of [inline, stdin]) {
    assert.equal(result.status, 1);
    assert.match(result.stderr, /gh guard: NOT posted/);
    assert.doesNotMatch(result.stderr, /quilla/i);
  }
  assert.equal(fs.existsSync(log), false);
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
  const isolated = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-guard-no-scanner-'));
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

const runInstaller = (binDir) =>
  spawnSync(
    'bash',
    [path.join(scriptsDir, 'install-gh-identifier-guard.sh'), path.dirname(scriptsDir)],
    {
      encoding: 'utf8',
      env: { ...process.env, GH_GUARD_BIN_DIR: binDir },
    },
  );

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-guard-install-'));

  assert.equal(runInstaller(dir).status, 0);
  const again = runInstaller(dir);
  assert.equal(again.status, 0, again.stderr);
  assert.match(again.stdout, /already current/);
  assert.match(fs.readFileSync(path.join(dir, 'gh'), 'utf8'), /gh-identifier-guard\.mjs/);
});

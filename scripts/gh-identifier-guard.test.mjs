import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  classifyCommand,
  isGuardedRepo,
  planClosingKeywordRewrite,
  planGuard,
  rewriteBacktickedClosingKeywords,
} from './gh-identifier-guard-core.mjs';

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

const runGuard = (guardPath, args, { input = '', binDir, cwd = os.tmpdir() }) =>
  spawnSync(process.execPath, [guardPath, ...args], {
    cwd,
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

const ESCAPE_REPRO_MARKDOWN = [
  '## What Changed',
  '- `redactWithheldNamesDeep` now drops every prose sentence that names a withheld person. It splits text with `Intl.Segmenter` and does not treat an honorific or initial before a name as a sentence break. Title fields in `TITLE_KEYS` (`name`, `displayName`, `title` and the like) still swap the name for `WITHHELD_PERSON_PHRASE`, because a title has no sentence to drop. The namesake-own-row exemption still applies.',
  '',
].join('\n');

const apiInput = (contents) => {
  const file = path.join(makeTempDirectory('gh-guard-input-'), 'body.json');
  fs.writeFileSync(file, contents);
  return file;
};

const apiPatch = (dir, contents) =>
  runGuard(
    path.join(scriptsDir, 'gh-identifier-guard.mjs'),
    ['api', `repos/${GUARDED}/pulls/1`, '-X', 'PATCH', '--input', apiInput(contents)],
    { binDir: dir },
  );

test('forwards a clean gh api JSON body the markdown scan would pass (#5622)', () => {
  for (const contents of [
    JSON.stringify({ body: ESCAPE_REPRO_MARKDOWN }),
    ESCAPE_REPRO_MARKDOWN.replaceAll('\n', '\\n'),
  ]) {
    const { dir, log } = makeFakeGh();
    const result = apiPatch(dir, contents);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(fs.existsSync(log));
  }
});

test('still refuses a real claim in a JSON-escaped body, including after a leading heading', () => {
  const markdown = `## Status\n${FLAGGED_COMMENT}\n`;
  for (const contents of [JSON.stringify({ body: markdown }), markdown.replaceAll('\n', '\\n')]) {
    const { dir, log } = makeFakeGh();
    const result = apiPatch(dir, contents);
    assert.equal(result.status, 1, result.stdout);
    assert.match(result.stderr, /gh guard: NOT posted/);
    assert.equal(fs.existsSync(log), false);
  }
});

const makeForkCheckout = () => {
  const repo = makeTempDirectory('gh-guard-fork-');
  const run = (gitArgs) =>
    spawnSync('git', gitArgs, {
      cwd: repo,
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'Test',
        GIT_AUTHOR_EMAIL: 'test@example.invalid',
        GIT_COMMITTER_NAME: 'Test',
        GIT_COMMITTER_EMAIL: 'test@example.invalid',
      },
    });
  const commit = (message) => {
    run(['commit', '--allow-empty', '-q', '-m', message]);
    return run(['rev-parse', 'HEAD']).stdout.trim();
  };
  run(['init', '-q']);
  run(['remote', 'add', 'origin', 'git@github.com:example-contributor/ylabs.git']);
  run(['remote', 'add', 'upstream', `git@github.com:${GUARDED}.git`]);
  return { repo, run, commit };
};

test('pr create --fill from a fork scans only the commits ahead of upstream', () => {
  const { dir, log } = makeFakeGh();
  const { repo, run, commit } = makeForkCheckout();
  run(['update-ref', 'refs/remotes/origin/beta', commit('chore: initial')]);
  run(['update-ref', 'refs/remotes/upstream/beta', commit(FLAGGED_COMMENT)]);
  commit('fix: contributor change');

  const result = runGuard(
    path.join(scriptsDir, 'gh-identifier-guard.mjs'),
    ['pr', 'create', '--fill', '--base', 'beta'],
    { binDir: dir, cwd: repo },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(log, 'utf8'), 'pr create --fill --base beta\n');
});

test('pr create --fill fails closed when the base branch cannot be read', () => {
  const { dir, log } = makeFakeGh();
  const { repo, commit } = makeForkCheckout();
  commit('fix: contributor change');

  const result = runGuard(
    path.join(scriptsDir, 'gh-identifier-guard.mjs'),
    ['pr', 'create', '--fill', '--base', 'beta'],
    { binDir: dir, cwd: repo },
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /upstream\/beta\.\.HEAD and git could not read them/);
  assert.equal(fs.existsSync(log), false);
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
  assert.match(absent.stderr, /is not ahead of .* on PATH/);
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
    assert.match(
      result.stderr,
      /are both missing; re-run scripts\/install-gh-identifier-guard\.sh/,
    );
    assert.ok(
      result.stderr.includes(path.join(guardHome, 'gh-identifier-guard.mjs')),
      result.stderr,
    );
    assert.ok(
      result.stderr.includes(path.join(checkout, 'scripts', 'gh-identifier-guard.mjs')),
      result.stderr,
    );
  }
  assert.equal(fs.existsSync(log), false);

  const read = runShim(shimDir, realGhDir, ['pr', 'view', '1']);
  assert.equal(read.status, 0, read.stderr);
  assert.equal(fs.readFileSync(log, 'utf8'), 'pr view 1\n');
});

test('restores a line-leading closing keyword written inside a code span, and nothing else (#5664)', () => {
  const { text, count } = rewriteBacktickedClosingKeywords(
    [
      'Closes `#5622`',
      'fixes: `YaleComputerSociety/ylabs#12`',
      '  Resolved `#7`',
      'Does not close `#8`; that stays open.',
      'The bug fixed `#9` came back.',
      'see `#10`',
      'Closes #3',
      '```',
      'Closes `#11`',
      '```',
      'Fixes `#12`',
    ].join('\n'),
  );
  assert.equal(
    text,
    [
      'Closes #5622',
      'fixes: YaleComputerSociety/ylabs#12',
      '  Resolved #7',
      'Does not close `#8`; that stays open.',
      'The bug fixed `#9` came back.',
      'see `#10`',
      'Closes #3',
      '```',
      'Closes `#11`',
      '```',
      'Fixes #12',
    ].join('\n'),
  );
  assert.equal(count, 4);
  assert.deepEqual(rewriteBacktickedClosingKeywords('No keyword here: `#9`.'), {
    text: 'No keyword here: `#9`.',
    count: 0,
  });
});

test('rewrites every way a body reaches gh, and never edits the author file in place', () => {
  const files = {
    '/drafts/body.md': 'Body\n\nCloses `#41`\n',
    '/drafts/input.json': '{"title":"Closes `#2` in a title","body":"Body\\n\\nCloses `#42`"}',
    '/drafts/not-json.txt': 'Closes `#45`',
  };
  const written = [];
  const deps = {
    readBodyFile: (file) => files[file],
    readStdin: () => 'From stdin.\nFixes `#43`',
    writeTempFile: (text) => {
      written.push(text);
      return `/tmp/rewritten-${written.length}`;
    },
  };

  assert.deepEqual(
    planClosingKeywordRewrite(
      ['pr', 'create', '-t', 'Closes `#1` in a title', '-b', 'Closes `#40`'],
      deps,
    ),
    { args: ['pr', 'create', '-t', 'Closes `#1` in a title', '-b', 'Closes #40'], count: 1 },
  );
  assert.deepEqual(
    planClosingKeywordRewrite(['pr', 'edit', '1', '--body=Closes `#40`'], deps).args,
    ['pr', 'edit', '1', '--body=Closes #40'],
  );
  const fromFile = planClosingKeywordRewrite(
    ['pr', 'create', '--body-file', '/drafts/body.md'],
    deps,
  );
  assert.deepEqual(fromFile.args, ['pr', 'create', '--body-file', '/tmp/rewritten-1']);
  assert.equal(written[0], 'Body\n\nCloses #41\n');
  assert.equal(files['/drafts/body.md'], 'Body\n\nCloses `#41`\n');
  assert.deepEqual(planClosingKeywordRewrite(['issue', 'comment', '1', '-F', '-'], deps), {
    args: ['issue', 'comment', '1', '-F', '-'],
    stdin: 'From stdin.\nFixes #43',
    count: 1,
  });
  assert.deepEqual(
    planClosingKeywordRewrite(
      [
        'api',
        'repos/x/y/pulls/1',
        '-X',
        'PATCH',
        '-f',
        'body=Closes `#44`',
        '-f',
        'title=Closes `#2`',
      ],
      deps,
    ).args,
    ['api', 'repos/x/y/pulls/1', '-X', 'PATCH', '-f', 'body=Closes #44', '-f', 'title=Closes `#2`'],
  );
  assert.deepEqual(
    planClosingKeywordRewrite(['api', 'repos/x/y/pulls/1', '--input', '/drafts/input.json'], deps)
      .args,
    ['api', 'repos/x/y/pulls/1', '--input', '/tmp/rewritten-2'],
  );
  assert.deepEqual(JSON.parse(written[1]), {
    title: 'Closes `#2` in a title',
    body: 'Body\n\nCloses #42',
  });
  assert.deepEqual(
    planClosingKeywordRewrite(
      ['api', 'repos/x/y/pulls/1', '--input', '/drafts/not-json.txt'],
      deps,
    ),
    { args: ['api', 'repos/x/y/pulls/1', '--input', '/drafts/not-json.txt'], count: 0 },
  );
  assert.deepEqual(planClosingKeywordRewrite(['pr', 'create', '-b', 'Closes #40'], deps), {
    args: ['pr', 'create', '-b', 'Closes #40'],
    count: 0,
  });
});

test('posts a backticked closing keyword as plain text end to end, and says so', () => {
  const { dir, log } = makeFakeGh();
  const result = runGuard(
    path.join(scriptsDir, 'gh-identifier-guard.mjs'),
    ['pr', 'create', '-R', GUARDED, '-t', 'fix: x', '-b', `${CLEAN}\n\nCloses \`#5664\``],
    { binDir: dir },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /rewrote 1 closing keyword out of a code span/);
  assert.match(fs.readFileSync(log, 'utf8'), /Closes #5664/);
  assert.doesNotMatch(fs.readFileSync(log, 'utf8'), /Closes `#5664`/);
});

test('leaves a body with no backticked closing keyword exactly as written', () => {
  const { dir, log } = makeFakeGh();
  const body = `${CLEAN}\n\nSee \`#5664\`; Closes #5664`;
  const result = runGuard(
    path.join(scriptsDir, 'gh-identifier-guard.mjs'),
    ['issue', 'comment', '1', '-R', GUARDED, '-F', '-'],
    { binDir: dir, input: body },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stderr, /rewrote/);
  assert.equal(fs.readFileSync(log, 'utf8'), `issue comment 1 -R ${GUARDED} -F -\n${body}`);
});

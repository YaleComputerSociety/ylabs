import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  describePreparedEnv,
  prepareWorktreeEnv,
  upsertEnvValues,
} from './prepare-worktree-env.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SYNTHETIC_SECRET = 'synthetic-secret-value-for-worktree-env-test';

const makeTempDir = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

const writeFile = (file, contents) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
};

const fileMode = (file) => fs.statSync(file).mode & 0o777;

test('upsertEnvValues replaces existing keys once and appends missing ones', () => {
  const input = 'A=1\nPORT=4000\n# PORT=1\nexport PORT=5000\nB=2\n';
  assert.equal(
    upsertEnvValues(input, { PORT: '4011', SERVER_BASE_URL: 'http://localhost:4011' }),
    'A=1\nPORT=4011\n# PORT=1\nB=2\nSERVER_BASE_URL=http://localhost:4011\n',
  );
  assert.equal(upsertEnvValues('', { PORT: '4011' }), 'PORT=4011\n');
});

test('copies the primary env files privately and points them at the reserved ports', () => {
  const primaryRoot = makeTempDir('ylabs-primary-');
  const worktreeRoot = makeTempDir('ylabs-worktree-');
  writeFile(
    path.join(primaryRoot, 'server', '.env'),
    `MONGODBURL=${SYNTHETIC_SECRET}\nPORT=4000\nSERVER_BASE_URL=http://localhost:4000\n`,
  );
  writeFile(path.join(primaryRoot, 'client', '.env'), 'VITE_APP_SERVER=http://localhost:4000\n');
  fs.mkdirSync(path.join(worktreeRoot, 'server'), { recursive: true });
  fs.mkdirSync(path.join(worktreeRoot, 'client'), { recursive: true });

  const result = prepareWorktreeEnv({
    primaryRoot,
    worktreeRoot,
    serverPort: 4011,
  });

  assert.deepEqual([result.server.ready, result.client.ready], [true, true]);
  const serverEnv = fs.readFileSync(path.join(worktreeRoot, 'server', '.env'), 'utf8');
  assert.match(serverEnv, new RegExp(`MONGODBURL=${SYNTHETIC_SECRET}`));
  assert.match(serverEnv, /^PORT=4011$/m);
  assert.match(serverEnv, /^SERVER_BASE_URL=http:\/\/localhost:4011$/m);
  assert.equal(
    fs.readFileSync(path.join(worktreeRoot, 'client', '.env'), 'utf8'),
    'VITE_APP_SERVER=http://localhost:4011\n',
  );
  assert.equal(fileMode(path.join(worktreeRoot, 'server', '.env')), 0o600);
  assert.equal(fileMode(path.join(worktreeRoot, 'client', '.env')), 0o600);
  assert.match(fs.readFileSync(path.join(primaryRoot, 'server', '.env'), 'utf8'), /^PORT=4000$/m);
});

test('reports a missing primary server env and still points the client at the reserved API port', () => {
  const primaryRoot = makeTempDir('ylabs-primary-');
  const worktreeRoot = makeTempDir('ylabs-worktree-');
  writeFile(
    path.join(worktreeRoot, 'client', '.env.example'),
    'VITE_APP_SERVER=http://localhost:4000\n',
  );
  fs.mkdirSync(path.join(worktreeRoot, 'server'), { recursive: true });

  const result = prepareWorktreeEnv({
    primaryRoot,
    worktreeRoot,
    serverPort: 4012,
  });

  assert.equal(result.server.ready, false);
  assert.equal(fs.existsSync(path.join(worktreeRoot, 'server', '.env')), false);
  const [serverLine, clientLine] = describePreparedEnv(result, primaryRoot);
  assert.match(serverLine, /set PORT and SERVER_BASE_URL to the ports above/);
  assert.equal(result.client.source, 'generated');
  assert.equal(
    fs.readFileSync(path.join(worktreeRoot, 'client', '.env'), 'utf8'),
    'VITE_APP_SERVER=http://localhost:4012\n',
  );
  assert.equal(fileMode(path.join(worktreeRoot, 'client', '.env')), 0o600);
  assert.match(clientLine, /created holding only VITE_APP_SERVER/);
});

const git = (cwd, ...args) => {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
};

test('new-agent-worktree.sh produces a worktree with private env files and its own ports', () => {
  const primaryRoot = makeTempDir('ylabs-helper-primary-');
  const worktreeParent = makeTempDir('ylabs-helper-worktrees-');
  for (const file of ['scripts/new-agent-worktree.sh', 'scripts/prepare-worktree-env.mjs']) {
    writeFile(path.join(primaryRoot, file), fs.readFileSync(path.join(repoRoot, file), 'utf8'));
  }
  writeFile(
    path.join(primaryRoot, 'scripts', 'install-gh-identifier-guard.sh'),
    '#!/bin/sh\nexit 0\n',
  );
  fs.chmodSync(path.join(primaryRoot, 'scripts', 'install-gh-identifier-guard.sh'), 0o755);
  fs.mkdirSync(path.join(primaryRoot, 'server'), { recursive: true });
  writeFile(path.join(primaryRoot, '.gitignore'), '.env\n**/.env\n');
  git(primaryRoot, 'init', '--quiet', '--initial-branch=beta');
  git(primaryRoot, 'add', '.');
  git(
    primaryRoot,
    '-c',
    'user.name=Synthetic',
    '-c',
    'user.email=synthetic@example.invalid',
    'commit',
    '--quiet',
    '-m',
    'init',
  );
  writeFile(
    path.join(primaryRoot, 'server', '.env'),
    `MONGODBURL=${SYNTHETIC_SECRET}\nPORT=4000\n`,
  );
  writeFile(path.join(primaryRoot, 'client', '.env'), 'VITE_APP_SERVER=http://localhost:4000\n');

  const result = spawnSync('bash', ['scripts/new-agent-worktree.sh', 'feat/synthetic-branch'], {
    cwd: primaryRoot,
    encoding: 'utf8',
    env: { ...process.env, SKIP_INSTALL: '1', YLABS_WORKTREE_ROOT: worktreeParent },
  });

  assert.equal(result.status, 0, result.stderr);
  const worktreeRoot = path.join(worktreeParent, 'feat-synthetic-branch');
  const serverPort = result.stdout.match(/api port:\s+(\d+)/)?.[1];
  const clientPort = result.stdout.match(/dev port:\s+(\d+)/)?.[1];
  assert.ok(serverPort && clientPort, result.stdout);
  assert.notEqual(serverPort, clientPort);
  assert.ok(
    result.stdout.includes(
      `http://localhost:${serverPort}/api/dev-login?redirect=http://localhost:${clientPort}/`,
    ),
    result.stdout,
  );
  assert.ok(!result.stdout.includes(SYNTHETIC_SECRET));
  assert.ok(!result.stderr.includes(SYNTHETIC_SECRET));
  const serverEnvFile = path.join(worktreeRoot, 'server', '.env');
  assert.equal(fileMode(serverEnvFile), 0o600);
  assert.equal(fileMode(path.join(worktreeRoot, 'client', '.env')), 0o600);
  assert.match(fs.readFileSync(serverEnvFile, 'utf8'), new RegExp(`^PORT=${serverPort}$`, 'm'));
  assert.match(
    fs.readFileSync(path.join(worktreeRoot, 'client', '.env'), 'utf8'),
    new RegExp(`^VITE_APP_SERVER=http://localhost:${serverPort}$`, 'm'),
  );
  assert.equal(git(worktreeRoot, 'status', '--porcelain'), '');
});

test('new-agent-worktree.sh never reuses an API port another worktree already holds', () => {
  const primaryRoot = makeTempDir('ylabs-helper-primary-');
  const worktreeParent = makeTempDir('ylabs-helper-worktrees-');
  for (const file of ['scripts/new-agent-worktree.sh', 'scripts/prepare-worktree-env.mjs']) {
    writeFile(path.join(primaryRoot, file), fs.readFileSync(path.join(repoRoot, file), 'utf8'));
  }
  const guardInstaller = path.join(primaryRoot, 'scripts', 'install-gh-identifier-guard.sh');
  writeFile(guardInstaller, '#!/bin/sh\nexit 0\n');
  fs.chmodSync(guardInstaller, 0o755);
  writeFile(path.join(primaryRoot, '.gitignore'), '.env\n**/.env\n');
  git(primaryRoot, 'init', '--quiet', '--initial-branch=beta');
  git(primaryRoot, 'add', '.');
  git(
    primaryRoot,
    '-c',
    'user.name=Synthetic',
    '-c',
    'user.email=synthetic@example.invalid',
    'commit',
    '--quiet',
    '-m',
    'init',
  );
  writeFile(path.join(primaryRoot, 'server', '.env'), 'PORT=4000\n');

  const createWorktree = (branch) => {
    const result = spawnSync('bash', ['scripts/new-agent-worktree.sh', branch], {
      cwd: primaryRoot,
      encoding: 'utf8',
      env: { ...process.env, SKIP_INSTALL: '1', YLABS_WORKTREE_ROOT: worktreeParent },
    });
    assert.equal(result.status, 0, result.stderr);
    return {
      apiPort: result.stdout.match(/api port:\s+(\d+)/)?.[1],
      clientPort: result.stdout.match(/dev port:\s+(\d+)/)?.[1],
    };
  };

  createWorktree('feat/first');
  const second = createWorktree('feat/second');
  git(primaryRoot, 'worktree', 'remove', '--force', path.join(worktreeParent, 'feat-first'));
  const third = createWorktree('feat/third');

  assert.notEqual(third.apiPort, second.apiPort);
  assert.notEqual(third.clientPort, second.clientPort);
  assert.notEqual(third.apiPort, '4000');
});

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function sandbox(platform) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ylabs-playwright-shim-'));
  fs.mkdirSync(path.join(root, 'scripts'));
  fs.copyFileSync(
    path.join(repoRoot, 'scripts', 'with-playwright-libs.sh'),
    path.join(root, 'scripts', 'with-playwright-libs.sh'),
  );
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  const stub = (name, body) => {
    fs.writeFileSync(path.join(bin, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  };
  stub('uname', `echo ${platform}`);
  stub('apt-get', 'echo "E: synthetic apt-get failure" >&2; exit 100');
  stub('dpkg-deb', 'exit 0');
  return { root, env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } };
}

const runShim = ({ root, env }, ...command) =>
  spawnSync('bash', [path.join(root, 'scripts', 'with-playwright-libs.sh'), ...command], {
    encoding: 'utf8',
    env: { ...env, LD_LIBRARY_PATH: '' },
  });

test('runs the wrapped command untouched off Linux', () => {
  const box = sandbox('Darwin');
  const result = runShim(box, 'sh', '-c', 'echo "ran:${LD_LIBRARY_PATH}"');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'ran:\n');
  assert.equal(fs.existsSync(path.join(box.root, '.playwright-libs')), false);
});

test('surfaces the apt-get error on Linux when the libraries are missing', () => {
  const box = sandbox('Linux');
  const result = runShim(box, 'echo', 'ran');
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /apt-get download failed/);
  assert.match(result.stderr, /synthetic apt-get failure/);
});

test('keeps adding the MCP isolation flags on every platform', () => {
  const box = sandbox('Darwin');
  const result = runShim(box, 'echo', '@playwright/mcp');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '@playwright/mcp --isolated --headless\n');
});

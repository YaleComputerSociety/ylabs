import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { validateProfileValues } from './run-data-profile.mjs';
import { createLocalServerEnv } from './setup-local-env.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function sandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ylabs-local-env-'));
  fs.mkdirSync(path.join(root, 'server'));
  fs.copyFileSync(
    path.join(repoRoot, 'server', '.env.local.example'),
    path.join(root, 'server', '.env.local.example'),
  );
  return root;
}

test('creates a private local env that the local profile accepts', () => {
  const root = sandbox();
  const { file, created } = createLocalServerEnv({ repoRoot: root });
  assert.equal(created, true);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  const values = dotenv.parse(fs.readFileSync(file));
  assert.ok(values.SESSION_SECRET.length >= 32);
  assert.equal(values.MEILISEARCH_INDEX_PREFIX, 'ylabs_local');
  assert.doesNotThrow(() => validateProfileValues('local', values));
});

test('takes only the worktree ports from server/.env and keeps an existing local env', () => {
  const root = sandbox();
  fs.writeFileSync(
    path.join(root, 'server', '.env'),
    'MONGODBURL=mongodb+srv://example.mongodb.net/Development\nPORT=4011\nSERVER_BASE_URL=http://localhost:4011\n',
  );
  const { file } = createLocalServerEnv({ repoRoot: root, sessionSecret: 'fixed' });
  const values = dotenv.parse(fs.readFileSync(file));
  assert.equal(values.MONGODBURL, 'mongodb://127.0.0.1:27017/ylabs_local');
  assert.equal(values.PORT, '4011');
  assert.equal(values.SERVER_BASE_URL, 'http://localhost:4011');

  fs.writeFileSync(file, 'MONGODBURL=mongodb://127.0.0.1:27017/ylabs_local\n');
  assert.equal(createLocalServerEnv({ repoRoot: root }).created, false);
  assert.equal(fs.readFileSync(file, 'utf8'), 'MONGODBURL=mongodb://127.0.0.1:27017/ylabs_local\n');
});

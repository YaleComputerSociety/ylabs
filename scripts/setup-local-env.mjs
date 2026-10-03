#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { upsertEnvValues } from './prepare-worktree-env.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PRIVATE_FILE_MODE = 0o600;
const PORT_KEYS = ['PORT', 'SERVER_BASE_URL'];

export function createLocalServerEnv({ repoRoot = REPO_ROOT, sessionSecret } = {}) {
  const target = path.join(repoRoot, 'server', '.env.local');
  if (fs.existsSync(target)) return { file: target, created: false };

  const example = fs.readFileSync(path.join(repoRoot, 'server', '.env.local.example'), 'utf8');
  const credentialedEnv = path.join(repoRoot, 'server', '.env');
  const worktreePorts = fs.existsSync(credentialedEnv)
    ? Object.fromEntries(
        Object.entries(dotenv.parse(fs.readFileSync(credentialedEnv))).filter(([key]) =>
          PORT_KEYS.includes(key),
        ),
      )
    : {};
  const contents = upsertEnvValues(example, {
    ...worktreePorts,
    SESSION_SECRET: sessionSecret ?? crypto.randomBytes(48).toString('base64'),
  });
  fs.writeFileSync(target, contents, { mode: PRIVATE_FILE_MODE });
  fs.chmodSync(target, PRIVATE_FILE_MODE);
  return { file: target, created: true };
}

const isDirectRun = process.argv[1]
  ? fs.realpathSync(fileURLToPath(import.meta.url)) === fs.realpathSync(process.argv[1])
  : false;

if (isDirectRun) {
  try {
    const { file, created } = createLocalServerEnv();
    const relative = path.relative(REPO_ROOT, file);
    console.log(
      created
        ? `Created ${relative} (mode 0600) for the local MongoDB profile.`
        : `Kept the existing ${relative}.`,
    );
  } catch (error) {
    console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

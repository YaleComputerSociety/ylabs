#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import {
  buildInventoryChildEnvironment,
  inventoryChildCommand,
  parseInventoryProfileInvocation,
  resolveSecureInventoryOutputPath,
  resolveSecureInventoryProfile,
  validateInventoryProfileValues,
} from './model-inventory-operator-core.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function sourceCommit() {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const commit = result.stdout?.trim();
  if (result.status !== 0 || !/^[a-f0-9]{40}$/.test(commit ?? '')) {
    throw new Error('Unable to resolve the exact source commit for inventory evidence.');
  }
  return commit;
}

export function run(argv = process.argv.slice(2), parentEnvironment = process.env) {
  const invocation = parseInventoryProfileInvocation(argv);
  const output = resolveSecureInventoryOutputPath(invocation.output);
  const { profile, profilePath } = resolveSecureInventoryProfile({
    repoRoot: REPO_ROOT,
    profileDirectory: invocation.profileDirectory,
    profileName: invocation.profileName,
  });
  const values = dotenv.parse(fs.readFileSync(profilePath));
  const validated = validateInventoryProfileValues(invocation.profileName, values);
  const commit = sourceCommit();
  const childEnvironment = buildInventoryChildEnvironment({
    parentEnvironment,
    mongoUrl: validated.mongoUrl,
    sourceCommit: commit,
  });

  console.log(
    `Inventory profile: ${invocation.profileName}; Mongo target: ${validated.target}; source commit: ${commit}; sample limit: 0`,
  );

  const executable = process.platform === 'win32' ? 'yarn.cmd' : 'yarn';
  const result = spawnSync(executable, inventoryChildCommand(invocation.profileName, output), {
    cwd: REPO_ROOT,
    env: childEnvironment,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `The read-only ${profile.environment} inventory exited with status ${result.status ?? 'unknown'}.`,
    );
  }
  return 0;
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isDirectRun) {
  try {
    process.exitCode = run();
  } catch (error) {
    console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

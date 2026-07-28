#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import {
  INVENTORY_PROFILES,
  buildInventoryChildEnvironment,
  parseInventoryProfileInvocation,
  resolveSecureInventoryOutputPath,
  resolveSecureInventoryProfile,
  validateInventoryProfileValues,
} from './model-inventory-operator-core.mjs';
import { sourceCommit } from './run-model-inventory-profile.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAX_TIME_MS = 5_000;

export function queryCostChildCommand(profileName, output) {
  const profile = INVENTORY_PROFILES[profileName];
  if (!profile) throw new Error(`Unknown inventory profile: ${profileName}`);
  return [
    '--cwd',
    'server',
    'model-refactor:query-cost',
    '--environment',
    profile.environment,
    '--max-time-ms',
    String(MAX_TIME_MS),
    '--strict',
    '--output',
    output,
  ];
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
  childEnvironment.YLABS_INVENTORY_PROFILE_NAME = invocation.profileName;
  childEnvironment.YLABS_INVENTORY_PROFILE_PATH = profilePath;

  console.log(
    `Query-cost profile: ${invocation.profileName}; Mongo target: ${validated.target}; source commit: ${commit}; max time: ${MAX_TIME_MS}ms`,
  );

  const executable = process.platform === 'win32' ? 'yarn.cmd' : 'yarn';
  const result = spawnSync(executable, queryCostChildCommand(invocation.profileName, output), {
    cwd: REPO_ROOT,
    env: childEnvironment,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `The read-only ${profile.environment} query-cost audit exited with status ${result.status ?? 'unknown'}.`,
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

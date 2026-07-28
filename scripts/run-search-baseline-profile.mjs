#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import {
  buildInventoryChildEnvironment,
  parseInventoryProfileInvocation,
  resolveSecureInventoryOutputPath,
  resolveSecureInventoryProfile,
  validateInventoryProfileValues,
} from './model-inventory-operator-core.mjs';
import {
  buildSearchBaselineChildEnvironment,
  resolveSecureSearchBaselineProfile,
  searchBaselineChildCommand,
  validateSearchBaselineProfileValues,
} from './search-baseline-operator-core.mjs';
import { sourceCommit } from './run-model-inventory-profile.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function run(argv = process.argv.slice(2), parentEnvironment = process.env) {
  const invocation = parseInventoryProfileInvocation(argv);
  const output = resolveSecureInventoryOutputPath(invocation.output);
  const { profilePath } = resolveSecureInventoryProfile({
    repoRoot: REPO_ROOT,
    profileDirectory: invocation.profileDirectory,
    profileName: invocation.profileName,
  });
  const inventoryValues = dotenv.parse(fs.readFileSync(profilePath));
  const inventory = validateInventoryProfileValues(invocation.profileName, inventoryValues);
  const searchProfilePath = resolveSecureSearchBaselineProfile({
    profileDirectory: invocation.profileDirectory,
    profileName: invocation.profileName,
  });
  const searchValues = dotenv.parse(fs.readFileSync(searchProfilePath));
  const search = validateSearchBaselineProfileValues(invocation.profileName, searchValues);
  const commit = sourceCommit();
  const baseEnvironment = buildInventoryChildEnvironment({
    parentEnvironment,
    mongoUrl: inventory.mongoUrl,
    sourceCommit: commit,
  });
  const childEnvironment = buildSearchBaselineChildEnvironment({
    baseEnvironment,
    sourceCommit: commit,
    validated: search,
  });
  childEnvironment.YLABS_INVENTORY_PROFILE_NAME = invocation.profileName;
  childEnvironment.YLABS_INVENTORY_PROFILE_PATH = profilePath;
  childEnvironment.YLABS_SEARCH_BASELINE_PROFILE_PATH = searchProfilePath;

  console.log(
    `Protected search baseline profile validated for ${search.profile.environment}; source commit: ${commit}.`,
  );

  const executable = process.platform === 'win32' ? 'yarn.cmd' : 'yarn';
  const result = spawnSync(executable, searchBaselineChildCommand(invocation.profileName, output), {
    cwd: REPO_ROOT,
    env: childEnvironment,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `The protected ${search.profile.environment} search baseline exited with status ${result.status ?? 'unknown'}.`,
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

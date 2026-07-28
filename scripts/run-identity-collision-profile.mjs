#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import {
  buildIdentityCollisionChildEnvironment,
  identityCollisionChildCommand,
} from './identity-collision-operator-core.mjs';
import {
  buildInventoryChildEnvironment,
  parseInventoryProfileInvocation,
  resolveSecureInventoryOutputPath,
  resolveSecureInventoryProfile,
  validateInventoryProfileValues,
} from './model-inventory-operator-core.mjs';
import { sourceCommit } from './run-model-inventory-profile.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILESYSTEM_ERROR_CODES = new Set([
  'EACCES',
  'EEXIST',
  'EISDIR',
  'ELOOP',
  'EMFILE',
  'ENAMETOOLONG',
  'ENFILE',
  'ENOENT',
  'ENOSPC',
  'ENOTDIR',
  'EPERM',
  'EROFS',
]);

export function readIdentityCollisionInventoryProfile(profilePath, readFile = fs.readFileSync) {
  try {
    return readFile(profilePath);
  } catch {
    throw new Error('Unable to read the protected identity-collision inventory profile.');
  }
}

export function serializeIdentityCollisionLauncherError(error) {
  const code =
    error && typeof error === 'object' && 'code' in error ? String(error.code) : undefined;
  if (code && FILESYSTEM_ERROR_CODES.has(code)) {
    return 'ERROR: Protected identity-collision filesystem operation failed.';
  }
  const message = error instanceof Error ? error.message : String(error);
  return `ERROR: ${message}`;
}

export function run(argv = process.argv.slice(2), parentEnvironment = process.env) {
  const invocation = parseInventoryProfileInvocation(argv);
  const output = resolveSecureInventoryOutputPath(invocation.output);
  const { profile, profilePath: inventoryProfilePath } = resolveSecureInventoryProfile({
    repoRoot: REPO_ROOT,
    profileDirectory: invocation.profileDirectory,
    profileName: invocation.profileName,
  });
  const inventory = validateInventoryProfileValues(
    invocation.profileName,
    dotenv.parse(readIdentityCollisionInventoryProfile(inventoryProfilePath)),
  );
  const commit = sourceCommit();
  const baseEnvironment = buildInventoryChildEnvironment({
    parentEnvironment,
    mongoUrl: inventory.mongoUrl,
    sourceCommit: commit,
  });
  const childEnvironment = buildIdentityCollisionChildEnvironment({
    baseEnvironment,
    profileName: invocation.profileName,
    inventoryProfilePath,
  });

  console.log(
    `Protected identity-collision profile validated for ${profile.environment}; source commit: ${commit}.`,
  );

  const executable = process.platform === 'win32' ? 'yarn.cmd' : 'yarn';
  const result = spawnSync(
    executable,
    identityCollisionChildCommand(invocation.profileName, output),
    {
      cwd: REPO_ROOT,
      env: childEnvironment,
      stdio: 'inherit',
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `The protected ${profile.environment} identity-collision audit exited with status ${result.status ?? 'unknown'}.`,
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
    console.error(serializeIdentityCollisionLauncherError(error));
    process.exitCode = 1;
  }
}

#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  sha256AndBytes,
  validateModelInventoryRecoveryManifest,
} from './model-inventory-evidence-core.mjs';

const hasPathPrefix = (target, root) => {
  const relative = path.relative(root, target);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  );
};

function consumePath(argv, index, flag) {
  const value = argv[index + 1]?.trim();
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires an absolute .json path.`);
  }
  return value;
}

export function parseEvidenceValidationArgs(argv) {
  let manifest;
  let inventory;
  let receiptOutput;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--manifest') {
      manifest = consumePath(argv, index, '--manifest');
      index += 1;
    } else if (arg.startsWith('--manifest=')) {
      manifest = arg.slice('--manifest='.length).trim();
    } else if (arg === '--inventory') {
      inventory = consumePath(argv, index, '--inventory');
      index += 1;
    } else if (arg.startsWith('--inventory=')) {
      inventory = arg.slice('--inventory='.length).trim();
    } else if (arg === '--receipt-output') {
      receiptOutput = consumePath(argv, index, '--receipt-output');
      index += 1;
    } else if (arg.startsWith('--receipt-output=')) {
      receiptOutput = arg.slice('--receipt-output='.length).trim();
    } else {
      throw new Error(`Unknown evidence-validation argument: ${arg}`);
    }
  }
  if (!manifest || !inventory) {
    throw new Error('--manifest and --inventory are required.');
  }
  return { manifest, inventory, receiptOutput };
}

function resolvePrivateJsonPath(value, label, mustExist) {
  if (!path.isAbsolute(value) || path.extname(value).toLowerCase() !== '.json') {
    throw new Error(`${label} must be an absolute .json path.`);
  }
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`${label} contains invalid characters.`);
  }
  const resolved = path.resolve(value);
  const parent = path.dirname(resolved);
  const realParent = fs.realpathSync.native(parent);
  if (realParent !== parent) {
    throw new Error(`${label} must not contain symlink path components.`);
  }
  const tempRoot = fs.realpathSync.native(path.resolve(os.tmpdir()));
  if (!hasPathPrefix(realParent, tempRoot)) {
    throw new Error(`${label} must be under the system temp directory ${tempRoot}.`);
  }

  if (!mustExist) {
    if (fs.existsSync(resolved)) {
      throw new Error(`${label} already exists and will not be overwritten.`);
    }
    return resolved;
  }

  const stat = fs.lstatSync(resolved);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`${label} must be a regular non-symlink file.`);
  }
  if ((stat.mode & 0o777) !== 0o600) {
    throw new Error(`${label} must have mode 0600.`);
  }
  if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) {
    throw new Error(`${label} must be owned by the current operating-system user.`);
  }
  return resolved;
}

export function validateEvidenceFiles(args) {
  const manifestPath = resolvePrivateJsonPath(args.manifest, '--manifest', true);
  const inventoryPath = resolvePrivateJsonPath(args.inventory, '--inventory', true);
  const manifestBuffer = fs.readFileSync(manifestPath);
  const inventoryBuffer = fs.readFileSync(inventoryPath);
  let manifest;
  try {
    manifest = JSON.parse(manifestBuffer.toString('utf8'));
  } catch {
    throw new Error('The recovery manifest must contain valid JSON.');
  }

  const result = validateModelInventoryRecoveryManifest(manifest, inventoryBuffer);
  const receipt = {
    ...result,
    manifest: sha256AndBytes(manifestBuffer),
    validatedAt: new Date().toISOString(),
  };
  if (args.receiptOutput) {
    const receiptPath = resolvePrivateJsonPath(args.receiptOutput, '--receipt-output', false);
    fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
  }
  return receipt;
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isDirectRun) {
  try {
    const receipt = validateEvidenceFiles(parseEvidenceValidationArgs(process.argv.slice(2)));
    console.log(JSON.stringify(receipt, null, 2));
  } catch (error) {
    console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

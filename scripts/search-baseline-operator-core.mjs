import fs from 'node:fs';
import path from 'node:path';

import { INVENTORY_PROFILES } from './model-inventory-operator-core.mjs';

export const SEARCH_BASELINE_PROFILE_FILES = Object.freeze({
  'beta-inventory': 'beta-search.env',
  'production-copy-inventory': 'production-copy-search.env',
});

const SEARCH_PROFILE_KEYS = Object.freeze([
  'MEILISEARCH_API_KEY',
  'MEILISEARCH_HOST',
  'MEILISEARCH_INDEX_PREFIX',
  'PHASE0_SEARCH_BASELINE_SALT',
]);
const SEARCH_PROFILE_KEY_SET = new Set(SEARCH_PROFILE_KEYS);
const PLACEHOLDER_PATTERN =
  /[<>]|\b(?:change[-_ ]?me|placeholder|replace[-_ ]?me|todo)\b|your[-_ ]|example\.(?:com|net|org)/i;
const PRODUCTION_COPY_PREFIX_RE = /^(?:production[-_]?copy|prod[-_]?copy)(?:[-_][a-z0-9-]+)?$/i;

const octalMode = (stat) => stat.mode & 0o777;

function assertOwnedByCurrentUser(stat, label) {
  if (typeof process.getuid !== 'function') return;
  if (stat.uid !== process.getuid()) {
    throw new Error(`${label} must be owned by the current operating-system user.`);
  }
}

function assertPathHasNoSymlinkComponents(target, label) {
  const resolved = path.resolve(target);
  let real;
  try {
    real = fs.realpathSync.native(resolved);
  } catch {
    throw new Error(`${label} does not exist.`);
  }
  if (real !== resolved) {
    throw new Error(`${label} must not contain symlink path components.`);
  }
}

export function resolveSecureSearchBaselineProfile(args) {
  const fileName = SEARCH_BASELINE_PROFILE_FILES[args.profileName];
  if (!fileName) {
    throw new Error(
      'The search baseline profile must be beta-inventory or production-copy-inventory.',
    );
  }

  const profilePath = path.join(path.resolve(args.profileDirectory), fileName);
  assertPathHasNoSymlinkComponents(profilePath, `Search baseline profile ${args.profileName}`);
  const stat = fs.lstatSync(profilePath);
  if (!stat.isFile()) {
    throw new Error(`Search baseline profile ${args.profileName} must be a regular file.`);
  }
  assertOwnedByCurrentUser(stat, `Search baseline profile ${args.profileName}`);
  if (octalMode(stat) !== 0o600) {
    throw new Error(`Search baseline profile ${args.profileName} must have mode 0600.`);
  }
  return profilePath;
}

function requiredValue(values, key) {
  const value = values[key]?.trim() || '';
  if (!value) throw new Error(`${key} is required by the protected search baseline profile.`);
  if (PLACEHOLDER_PATTERN.test(value)) {
    throw new Error(`${key} still contains a placeholder value.`);
  }
  return value;
}

export function validateSearchBaselineProfileValues(profileName, values) {
  const profile = INVENTORY_PROFILES[profileName];
  if (!profile || !SEARCH_BASELINE_PROFILE_FILES[profileName]) {
    throw new Error(`Unknown protected search baseline profile: ${profileName}`);
  }
  const keys = Object.keys(values).sort();
  if (
    keys.length !== SEARCH_PROFILE_KEYS.length ||
    keys.some((key) => !SEARCH_PROFILE_KEY_SET.has(key))
  ) {
    throw new Error(
      `Search baseline profiles must contain exactly ${SEARCH_PROFILE_KEYS.join(', ')}.`,
    );
  }

  const hostValue = requiredValue(values, 'MEILISEARCH_HOST');
  const apiKey = requiredValue(values, 'MEILISEARCH_API_KEY');
  const indexPrefix = requiredValue(values, 'MEILISEARCH_INDEX_PREFIX');
  const salt = requiredValue(values, 'PHASE0_SEARCH_BASELINE_SALT');
  if (salt.length < 32) {
    throw new Error('PHASE0_SEARCH_BASELINE_SALT must contain at least 32 characters.');
  }

  let host;
  try {
    host = new URL(hostValue);
  } catch {
    throw new Error('MEILISEARCH_HOST must be a valid HTTPS URL.');
  }
  if (host.protocol !== 'https:') {
    throw new Error('Protected Beta and ProductionCopy Meilisearch profiles require HTTPS.');
  }
  if (host.username || host.password) {
    throw new Error('MEILISEARCH_HOST must not contain credentials.');
  }
  const hostname = host.hostname.toLowerCase();
  if (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    PLACEHOLDER_PATTERN.test(hostname)
  ) {
    throw new Error('Protected search baseline profiles require an approved remote host.');
  }

  if (profile.environment === 'beta') {
    if (indexPrefix.toLowerCase() !== 'beta') {
      throw new Error('The Beta search baseline profile requires MEILISEARCH_INDEX_PREFIX=beta.');
    }
  } else if (!PRODUCTION_COPY_PREFIX_RE.test(indexPrefix)) {
    throw new Error(
      'The ProductionCopy search baseline profile requires a dedicated production-copy prefix.',
    );
  }

  return {
    profile,
    host: hostValue,
    apiKey,
    indexPrefix,
    salt,
    target: `${hostname}/${indexPrefix}_researchentities`,
  };
}

export function buildSearchBaselineChildEnvironment(args) {
  return {
    ...args.baseEnvironment,
    SOURCE_COMMIT: args.sourceCommit,
    MEILISEARCH_HOST: args.validated.host,
    MEILISEARCH_API_KEY: args.validated.apiKey,
    MEILISEARCH_INDEX_PREFIX: args.validated.indexPrefix,
    PHASE0_SEARCH_BASELINE_SALT: args.validated.salt,
    YLABS_SKIP_LOCAL_DOTENV: 'true',
    YLABS_SEARCH_BASELINE_PROFILE_ACTIVE: 'true',
  };
}

export function searchBaselineChildCommand(profileName, output) {
  const profile = INVENTORY_PROFILES[profileName];
  if (!profile || !SEARCH_BASELINE_PROFILE_FILES[profileName]) {
    throw new Error(`Unknown protected search baseline profile: ${profileName}`);
  }
  return [
    'model-refactor:search-baseline',
    '--environment',
    profile.environment,
    '--iterations',
    '3',
    '--top-k',
    '10',
    '--strict',
    '--output',
    output,
  ];
}

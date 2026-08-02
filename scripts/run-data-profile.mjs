#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const PROFILES = {
  development: {
    file: path.join(REPO_ROOT, 'server', '.env'),
    environment: 'development',
    database: 'Development',
    requireRemoteMongo: true,
  },
  'beta-operator': {
    file: path.join(REPO_ROOT, 'server', '.env.beta-operator'),
    environment: 'beta',
    database: 'Beta',
    requireRemoteMongo: true,
  },
};

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

export function parseMongoTarget(value) {
  if (!value) throw new Error('MONGODBURL is required by the selected data profile.');

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('MONGODBURL must be a valid MongoDB connection URL.');
  }

  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (!database) {
    throw new Error('MONGODBURL must include an explicit database name.');
  }

  return {
    host: parsed.hostname,
    database,
    local: LOCAL_HOSTS.has(parsed.hostname),
  };
}

export function validateProfileValues(profileName, values) {
  const profile = PROFILES[profileName];
  if (!profile) {
    throw new Error(`Unknown data profile "${profileName}". Use development or beta-operator.`);
  }

  const target = parseMongoTarget(values.MONGODBURL);
  if (target.database !== profile.database) {
    throw new Error(
      `Profile ${profileName} requires Mongo database ${profile.database}; resolved ${target.database}.`,
    );
  }
  if (profile.requireRemoteMongo && target.local) {
    throw new Error(`The ${profileName} profile requires a remote MongoDB database.`);
  }
  if (values.SCRAPER_ENV && values.SCRAPER_ENV !== profile.environment) {
    throw new Error(
      `Profile ${profileName} requires SCRAPER_ENV=${profile.environment}; found ${values.SCRAPER_ENV}.`,
    );
  }

  return { profile, target };
}

export function parseInvocation(argv) {
  const separator = argv.indexOf('--');
  if (separator < 0) {
    throw new Error(
      'Usage: run-data-profile.mjs <development|beta-operator> [--write] -- <command> [args...]',
    );
  }

  const options = argv.slice(0, separator);
  const command = argv.slice(separator + 1);
  const profileName = options[0];
  const unknown = options.slice(1).filter((option) => option !== '--write');
  if (!profileName || unknown.length > 0 || command.length === 0) {
    throw new Error(
      'Usage: run-data-profile.mjs <development|beta-operator> [--write] -- <command> [args...]',
    );
  }

  return {
    profileName,
    writesEnabled: options.includes('--write'),
    command,
  };
}

export function assertCommandAllowed(profileName, command) {
  if (
    profileName === 'beta-operator' &&
    (command.includes('--auto-materialize') || command.includes('materialize'))
  ) {
    throw new Error(
      'The local Beta operator may fetch observations only. Materialize the run from the Beta Render shell so it updates Beta Meilisearch.',
    );
  }
}

export function run(argv = process.argv.slice(2)) {
  const invocation = parseInvocation(argv);
  const profile = PROFILES[invocation.profileName];
  if (!profile) {
    throw new Error(
      `Unknown data profile "${invocation.profileName}". Use development or beta-operator.`,
    );
  }
  if (!fs.existsSync(profile.file)) {
    const example = `${profile.file}.example`;
    throw new Error(
      `Missing ${path.relative(REPO_ROOT, profile.file)}. Copy ${path.relative(REPO_ROOT, example)} and fill in its placeholders.`,
    );
  }

  const values = dotenv.parse(fs.readFileSync(profile.file));
  const { target } = validateProfileValues(invocation.profileName, values);
  assertCommandAllowed(invocation.profileName, invocation.command);

  const childEnv = {
    ...process.env,
    ...values,
    SCRAPER_ENV: profile.environment,
    CONFIRM_PROD_SCRAPE: 'false',
  };
  if (invocation.writesEnabled) {
    childEnv.ALLOW_NON_PROD_SCRAPER_WRITES = 'true';
  } else {
    delete childEnv.ALLOW_NON_PROD_SCRAPER_WRITES;
  }
  if (invocation.profileName === 'beta-operator') {
    childEnv.MEILISEARCH_HOST = 'http://127.0.0.1:7700';
    childEnv.MEILISEARCH_API_KEY = 'local_development_master_key';
    childEnv.MEILISEARCH_INDEX_PREFIX = 'beta_operator';
  }
  delete childEnv.MONGODBURL_MIGRATION;
  delete childEnv.PRODUCTION_MONGODBURL;
  delete childEnv.PROD_MONGODBURL;
  delete childEnv.ATLAS_RESTORE_POINT;
  delete childEnv.CONFIRM_LANE_A_COPY;

  console.log(
    `Data profile: ${invocation.profileName}; Mongo target: ${target.host}/${target.database}; writes: ${invocation.writesEnabled ? 'enabled' : 'guarded dry-run'}`,
  );

  const result = spawnSync(invocation.command[0], invocation.command.slice(1), {
    cwd: REPO_ROOT,
    env: childEnv,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
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

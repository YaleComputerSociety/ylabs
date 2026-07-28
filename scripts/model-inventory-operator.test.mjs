import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  buildInventoryChildEnvironment,
  inventoryChildCommand,
  parseInventoryProfileInvocation,
  resolveSecureInventoryOutputPath,
  resolveSecureInventoryProfile,
  validateInventoryProfileValues,
} from './model-inventory-operator-core.mjs';

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

function atlasUrl(database, hostname = 'cluster.unit-test.mongodb.net') {
  const credentials = ['inventory-reader', 'unit-test-password'].join(':');
  return `mongodb+srv://${credentials}@${hostname}/${database}`;
}

function withSecureProfile(profileName, body, callback) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ylabs-inventory-profile-'));
  fs.chmodSync(directory, 0o700);
  const fileName =
    profileName === 'beta-inventory' ? 'beta-inventory.env' : 'production-copy-inventory.env';
  const profilePath = path.join(directory, fileName);
  fs.writeFileSync(profilePath, body, { mode: 0o600 });
  fs.chmodSync(profilePath, 0o600);
  try {
    return callback({ directory, profilePath });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test('requires a fixed profile, external absolute directory, and new output path', () => {
  assert.deepEqual(
    parseInventoryProfileInvocation([
      'beta-inventory',
      '--profile-dir',
      '/secure/operator-profiles',
      '--output=/tmp/beta-inventory.json',
    ]),
    {
      profileName: 'beta-inventory',
      profileDirectory: '/secure/operator-profiles',
      output: '/tmp/beta-inventory.json',
    },
  );
  assert.throws(
    () =>
      parseInventoryProfileInvocation([
        'beta-inventory',
        '--profile-dir',
        '/secure/operator-profiles',
        '--output',
        '/tmp/beta.json',
        '--',
        'sh',
      ]),
    /Arbitrary child commands are not allowed/,
  );
  assert.throws(
    () =>
      parseInventoryProfileInvocation([
        'production',
        '--profile-dir',
        '/secure/operator-profiles',
        '--output',
        '/tmp/production.json',
      ]),
    /beta-inventory or production-copy-inventory/,
  );
});

test('resolves only current-user mode-0600 profiles outside the repository', () => {
  withSecureProfile(
    'beta-inventory',
    `MONGODBURL=${atlasUrl('Beta')}\n`,
    ({ directory, profilePath }) => {
      assert.deepEqual(
        resolveSecureInventoryProfile({
          repoRoot: REPO_ROOT,
          profileDirectory: directory,
          profileName: 'beta-inventory',
        }).profilePath,
        profilePath,
      );
      fs.chmodSync(profilePath, 0o640);
      assert.throws(
        () =>
          resolveSecureInventoryProfile({
            repoRoot: REPO_ROOT,
            profileDirectory: directory,
            profileName: 'beta-inventory',
          }),
        /mode 0600/,
      );
    },
  );
});

test('rejects missing profiles, repository directories, and symlinks', () => {
  const missingDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'ylabs-missing-profile-'));
  fs.chmodSync(missingDirectory, 0o700);
  try {
    assert.throws(
      () =>
        resolveSecureInventoryProfile({
          repoRoot: REPO_ROOT,
          profileDirectory: missingDirectory,
          profileName: 'beta-inventory',
        }),
      /does not exist/,
    );
    assert.throws(
      () =>
        resolveSecureInventoryProfile({
          repoRoot: REPO_ROOT,
          profileDirectory: path.join(REPO_ROOT, 'server'),
          profileName: 'beta-inventory',
        }),
      /outside the repository/,
    );
  } finally {
    fs.rmSync(missingDirectory, { recursive: true, force: true });
  }

  withSecureProfile(
    'beta-inventory',
    `MONGODBURL=${atlasUrl('Beta')}\n`,
    ({ directory, profilePath }) => {
      const linkDirectory = `${directory}-link`;
      fs.symlinkSync(directory, linkDirectory);
      try {
        assert.throws(
          () =>
            resolveSecureInventoryProfile({
              repoRoot: REPO_ROOT,
              profileDirectory: linkDirectory,
              profileName: 'beta-inventory',
            }),
          /symlink path components/,
        );
      } finally {
        fs.unlinkSync(linkDirectory);
      }

      fs.unlinkSync(profilePath);
      const target = path.join(directory, 'target.env');
      fs.writeFileSync(target, `MONGODBURL=${atlasUrl('Beta')}\n`, { mode: 0o600 });
      fs.symlinkSync(target, profilePath);
      assert.throws(
        () =>
          resolveSecureInventoryProfile({
            repoRoot: REPO_ROOT,
            profileDirectory: directory,
            profileName: 'beta-inventory',
          }),
        /symlink path components/,
      );
    },
  );
});

test('rejects placeholders, local hosts, extra values, wrong databases, and Production', () => {
  assert.throws(
    () =>
      validateInventoryProfileValues('beta-inventory', {
        MONGODBURL: '<mongodb-srv-url-for-read-only-beta-user>',
      }),
    /placeholder/,
  );
  assert.throws(
    () =>
      validateInventoryProfileValues('beta-inventory', {
        MONGODBURL: atlasUrl('Beta', 'localhost'),
      }),
    /remote MongoDB Atlas hostname/,
  );
  assert.throws(
    () =>
      validateInventoryProfileValues('beta-inventory', {
        MONGODBURL: atlasUrl('Beta'),
        MEILISEARCH_API_KEY: 'must-not-be-here',
      }),
    /only MONGODBURL/,
  );
  assert.throws(
    () =>
      validateInventoryProfileValues('beta-inventory', {
        MONGODBURL: atlasUrl('ProductionCopy'),
      }),
    /requires MongoDB database Beta/,
  );
  assert.throws(
    () =>
      validateInventoryProfileValues('production-copy-inventory', {
        MONGODBURL: atlasUrl('Production'),
      }),
    /never select the primary Production/,
  );

  const encodedPlaceholderUrl = [
    'mongodb+srv://',
    '%3Cread-only-user%3E',
    ':',
    '%3Cpassword%3E',
    '@cluster.unit-test.mongodb.net/Beta',
  ].join('');
  assert.throws(
    () =>
      validateInventoryProfileValues('beta-inventory', {
        MONGODBURL: encodedPlaceholderUrl,
      }),
    /placeholder Atlas credentials/,
  );

  assert.throws(
    () =>
      validateInventoryProfileValues('beta-inventory', {
        MONGODBURL: `${atlasUrl('Beta')}?TLS=False`,
      }),
    /may not disable TLS/,
  );
  assert.throws(
    () =>
      validateInventoryProfileValues('beta-inventory', {
        MONGODBURL: `${atlasUrl('Beta')}?directConnection=True`,
      }),
    /force a direct connection/,
  );
});

test('builds a minimal child environment without inherited sensitive variables', () => {
  const child = buildInventoryChildEnvironment({
    parentEnvironment: {
      PATH: '/usr/bin',
      HOME: '/operator',
      MONGODBURL_MIGRATION: 'sensitive',
      PRODUCTION_MONGODBURL: 'sensitive',
      BETA_MONGODBURL: 'sensitive',
      ATLAS_RESTORE_POINT: 'sensitive',
      CONFIRM_PROD_SCRAPE: 'true',
      CONFIRM_PROD_MONGO_VALIDATORS: 'true',
      ALLOW_NON_PROD_SCRAPER_WRITES: 'true',
      SCRAPER_ENV: 'production',
      MEILISEARCH_HOST: 'sensitive',
      MEILISEARCH_API_KEY: 'sensitive',
      MEILISEARCH_INDEX_PREFIX: 'prod',
      OPENAI_API_KEY: 'sensitive',
      NODE_OPTIONS: '--require=unexpected',
    },
    mongoUrl: atlasUrl('Beta'),
    sourceCommit: 'a'.repeat(40),
  });
  assert.deepEqual(child, {
    HOME: '/operator',
    PATH: '/usr/bin',
    MONGODBURL: atlasUrl('Beta'),
    YLABS_INVENTORY_PROFILE_ACTIVE: 'true',
    YLABS_INVENTORY_SOURCE_COMMIT: 'a'.repeat(40),
  });
});

test('the child command is fixed and always suppresses identifier samples', () => {
  assert.deepEqual(inventoryChildCommand('production-copy-inventory', '/tmp/output.json'), [
    '--cwd',
    'server',
    'model-refactor:inventory',
    '--environment',
    'production-copy',
    '--sample-limit',
    '0',
    '--output',
    '/tmp/output.json',
  ]);
});

test('inventory output must be a new non-symlinked JSON path under the system temp root', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ylabs-inventory-output-'));
  const output = path.join(directory, 'inventory.json');
  try {
    assert.equal(resolveSecureInventoryOutputPath(output), output);
    fs.writeFileSync(output, '{}\n', { mode: 0o600 });
    assert.throws(() => resolveSecureInventoryOutputPath(output), /never overwritten/);
    assert.throws(() => resolveSecureInventoryOutputPath('/etc/ylabs-inventory.json'));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

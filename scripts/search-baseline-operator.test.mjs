import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildSearchBaselineChildEnvironment,
  resolveSecureSearchBaselineProfile,
  searchBaselineChildCommand,
  validateSearchBaselineProfileValues,
} from './search-baseline-operator-core.mjs';

function validValues(overrides = {}) {
  return {
    MEILISEARCH_HOST: 'https://private-search.internal.test',
    MEILISEARCH_API_KEY: 'private-search-key-value',
    MEILISEARCH_INDEX_PREFIX: 'beta',
    PHASE0_SEARCH_BASELINE_SALT: '7decbd7cf96d4edca5e46dbe1d06f4a1b64b5846209f2bce',
    ...overrides,
  };
}

function withSearchProfile(profileName, body, callback) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ylabs-search-profile-'));
  fs.chmodSync(directory, 0o700);
  const fileName =
    profileName === 'beta-inventory' ? 'beta-search.env' : 'production-copy-search.env';
  const profilePath = path.join(directory, fileName);
  fs.writeFileSync(profilePath, body, { mode: 0o600 });
  fs.chmodSync(profilePath, 0o600);
  try {
    return callback({ directory, profilePath });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test('requires a current-user mode-0600 non-symlink search profile', () => {
  withSearchProfile(
    'beta-inventory',
    'MEILISEARCH_HOST=https://private.invalid\n',
    ({ directory, profilePath }) => {
      assert.equal(
        resolveSecureSearchBaselineProfile({
          profileDirectory: directory,
          profileName: 'beta-inventory',
        }),
        profilePath,
      );

      fs.chmodSync(profilePath, 0o640);
      assert.throws(
        () =>
          resolveSecureSearchBaselineProfile({
            profileDirectory: directory,
            profileName: 'beta-inventory',
          }),
        /mode 0600/,
      );
    },
  );

  withSearchProfile(
    'beta-inventory',
    'MEILISEARCH_HOST=https://private.invalid\n',
    ({ directory, profilePath }) => {
      fs.unlinkSync(profilePath);
      const target = path.join(directory, 'target.env');
      fs.writeFileSync(target, 'MEILISEARCH_HOST=https://private.invalid\n', { mode: 0o600 });
      fs.symlinkSync(target, profilePath);
      assert.throws(
        () =>
          resolveSecureSearchBaselineProfile({
            profileDirectory: directory,
            profileName: 'beta-inventory',
          }),
        /symlink path components/,
      );
    },
  );
});

test('validates exact Beta and ProductionCopy search target contracts', () => {
  assert.deepEqual(validateSearchBaselineProfileValues('beta-inventory', validValues()), {
    profile: {
      environment: 'beta',
      databaseName: 'Beta',
      fileName: 'beta-inventory.env',
    },
    host: 'https://private-search.internal.test',
    apiKey: 'private-search-key-value',
    indexPrefix: 'beta',
    salt: '7decbd7cf96d4edca5e46dbe1d06f4a1b64b5846209f2bce',
    target: 'private-search.internal.test/beta_researchentities',
  });

  assert.equal(
    validateSearchBaselineProfileValues(
      'production-copy-inventory',
      validValues({ MEILISEARCH_INDEX_PREFIX: 'production-copy-july' }),
    ).profile.environment,
    'production-copy',
  );
  assert.throws(
    () =>
      validateSearchBaselineProfileValues('beta-inventory', {
        ...validValues(),
        EXTRA_SECRET: 'not-allowed',
      }),
    /must contain exactly/,
  );
  assert.throws(
    () =>
      validateSearchBaselineProfileValues(
        'beta-inventory',
        validValues({ MEILISEARCH_HOST: 'http://private-search.internal.test' }),
      ),
    /require HTTPS/,
  );
  assert.throws(
    () =>
      validateSearchBaselineProfileValues(
        'beta-inventory',
        validValues({ MEILISEARCH_HOST: 'https://localhost:7700' }),
      ),
    /approved remote host/,
  );
  assert.throws(
    () =>
      validateSearchBaselineProfileValues(
        'beta-inventory',
        validValues({ MEILISEARCH_INDEX_PREFIX: 'prod' }),
      ),
    /requires MEILISEARCH_INDEX_PREFIX=beta/,
  );
  assert.throws(
    () =>
      validateSearchBaselineProfileValues(
        'production-copy-inventory',
        validValues({ MEILISEARCH_INDEX_PREFIX: 'beta' }),
      ),
    /dedicated production-copy prefix/,
  );
  assert.throws(
    () =>
      validateSearchBaselineProfileValues(
        'beta-inventory',
        validValues({ PHASE0_SEARCH_BASELINE_SALT: 'too-short' }),
      ),
    /at least 32 characters/,
  );
});

test('builds a minimal child environment and fixed bounded command', () => {
  const validated = validateSearchBaselineProfileValues('beta-inventory', validValues());
  const child = buildSearchBaselineChildEnvironment({
    baseEnvironment: {
      HOME: '/operator',
      PATH: '/usr/bin',
      MONGODBURL: 'mongodb+srv://reader:secret@cluster.mongodb.net/Beta',
      YLABS_INVENTORY_PROFILE_ACTIVE: 'true',
      YLABS_INVENTORY_SOURCE_COMMIT: 'a'.repeat(40),
    },
    sourceCommit: 'a'.repeat(40),
    validated,
  });
  assert.deepEqual(child, {
    HOME: '/operator',
    PATH: '/usr/bin',
    MONGODBURL: 'mongodb+srv://reader:secret@cluster.mongodb.net/Beta',
    SOURCE_COMMIT: 'a'.repeat(40),
    YLABS_INVENTORY_PROFILE_ACTIVE: 'true',
    YLABS_INVENTORY_SOURCE_COMMIT: 'a'.repeat(40),
    MEILISEARCH_HOST: 'https://private-search.internal.test',
    MEILISEARCH_API_KEY: 'private-search-key-value',
    MEILISEARCH_INDEX_PREFIX: 'beta',
    PHASE0_SEARCH_BASELINE_SALT: '7decbd7cf96d4edca5e46dbe1d06f4a1b64b5846209f2bce',
    YLABS_SKIP_LOCAL_DOTENV: 'true',
    YLABS_SEARCH_BASELINE_PROFILE_ACTIVE: 'true',
  });
  assert.deepEqual(searchBaselineChildCommand('beta-inventory', '/tmp/search.json'), [
    'model-refactor:search-baseline',
    '--environment',
    'beta',
    '--iterations',
    '3',
    '--top-k',
    '10',
    '--strict',
    '--output',
    '/tmp/search.json',
  ]);
  assert.throws(() => searchBaselineChildCommand('production', '/tmp/search.json'));
});

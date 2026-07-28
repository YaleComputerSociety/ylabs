import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildIdentityCollisionChildEnvironment,
  identityCollisionChildCommand,
} from './identity-collision-operator-core.mjs';
import {
  readIdentityCollisionInventoryProfile,
  serializeIdentityCollisionLauncherError,
} from './run-identity-collision-profile.mjs';

test('builds a fixed strict read-only identity command with no arbitrary child arguments', () => {
  assert.deepEqual(
    identityCollisionChildCommand('production-copy-inventory', '/tmp/identity.json'),
    [
      '--cwd',
      'server',
      'model-refactor:identity-collisions',
      '--environment',
      'production-copy',
      '--document-limit',
      '100000',
      '--group-limit',
      '10000',
      '--group-member-limit',
      '100',
      '--max-time-ms',
      '5000',
      '--strict',
      '--output',
      '/tmp/identity.json',
    ],
  );
  assert.throws(
    () => identityCollisionChildCommand('production', '/tmp/identity.json'),
    /Unknown protected identity-collision profile/,
  );
});

test('adds only fixed identity-profile metadata to the sanitized inventory environment', () => {
  assert.deepEqual(
    buildIdentityCollisionChildEnvironment({
      baseEnvironment: {
        PATH: '/usr/bin',
        MONGODBURL: 'mongodb+srv://reader:secret@cluster.mongodb.net/Beta',
        YLABS_INVENTORY_PROFILE_ACTIVE: 'true',
        YLABS_INVENTORY_SOURCE_COMMIT: 'a'.repeat(40),
      },
      profileName: 'beta-inventory',
      inventoryProfilePath: '/secure/beta-inventory.env',
    }),
    {
      PATH: '/usr/bin',
      MONGODBURL: 'mongodb+srv://reader:secret@cluster.mongodb.net/Beta',
      YLABS_INVENTORY_PROFILE_ACTIVE: 'true',
      YLABS_INVENTORY_SOURCE_COMMIT: 'a'.repeat(40),
      YLABS_IDENTITY_AUDIT_PROFILE_ACTIVE: 'true',
      YLABS_INVENTORY_PROFILE_NAME: 'beta-inventory',
      YLABS_INVENTORY_PROFILE_PATH: '/secure/beta-inventory.env',
      YLABS_SKIP_LOCAL_DOTENV: 'true',
    },
  );
});

test('keeps protected profile paths out of launcher filesystem errors', () => {
  const sentinel = '/tmp/private-phase0-package/sentinel-inventory.env';
  assert.throws(
    () =>
      readIdentityCollisionInventoryProfile(sentinel, () => {
        throw Object.assign(new Error(`EACCES: open '${sentinel}'`), { code: 'EACCES' });
      }),
    (error) => {
      const serialized = serializeIdentityCollisionLauncherError(error);
      assert.equal(
        serialized,
        'ERROR: Unable to read the protected identity-collision inventory profile.',
      );
      assert.equal(serialized.includes(sentinel), false);
      return true;
    },
  );
  assert.equal(
    serializeIdentityCollisionLauncherError(
      Object.assign(new Error(`ENOENT: open '${sentinel}'`), { code: 'ENOENT' }),
    ),
    'ERROR: Protected identity-collision filesystem operation failed.',
  );
});

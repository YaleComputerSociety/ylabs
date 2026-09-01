import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildPhase2IdentityPlanChildEnvironment,
  phase2IdentityPlanChildCommand,
} from './phase2-identity-plan-operator-core.mjs';
import {
  readPhase2IdentityPlanProfile,
  serializePhase2IdentityPlanLauncherError,
} from './run-phase2-identity-plan-profile.mjs';

test('builds a fixed strict read-only Phase 2 identity-plan command', () => {
  assert.deepEqual(
    phase2IdentityPlanChildCommand('production-copy-inventory', '/tmp/phase2.json'),
    [
      '--cwd',
      'server',
      'model-refactor:identity-plan',
      '--environment',
      'production-copy',
      '--document-limit',
      '100000',
      '--quarantine-limit',
      '25000',
      '--max-time-ms',
      '5000',
      '--strict',
      '--output',
      '/tmp/phase2.json',
    ],
  );
  assert.throws(
    () => phase2IdentityPlanChildCommand('production', '/tmp/phase2.json'),
    /Unknown protected Phase 2 identity-plan profile/,
  );
});

test('uses only the existing fixed protected inventory metadata', () => {
  assert.deepEqual(
    buildPhase2IdentityPlanChildEnvironment({
      baseEnvironment: {
        PATH: '/usr/bin',
        MONGODBURL: 'mongodb+srv://user:pass@cluster.mongodb.net/Beta',
        YLABS_INVENTORY_PROFILE_ACTIVE: 'true',
        YLABS_INVENTORY_SOURCE_COMMIT: 'a'.repeat(40),
      },
      profileName: 'beta-inventory',
      inventoryProfilePath: '/secure/beta-inventory.env',
    }),
    {
      PATH: '/usr/bin',
      MONGODBURL: 'mongodb+srv://user:pass@cluster.mongodb.net/Beta',
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
  const sentinel = '/tmp/private-phase2/sentinel-inventory.env';
  assert.throws(
    () =>
      readPhase2IdentityPlanProfile(sentinel, () => {
        throw Object.assign(new Error(`EACCES: open '${sentinel}'`), { code: 'EACCES' });
      }),
    (error) => {
      const serialized = serializePhase2IdentityPlanLauncherError(error);
      assert.equal(
        serialized,
        'ERROR: Unable to read the protected Phase 2 identity-plan profile.',
      );
      assert.equal(serialized.includes(sentinel), false);
      return true;
    },
  );
  assert.equal(
    serializePhase2IdentityPlanLauncherError(
      Object.assign(new Error(`ENOENT: open '${sentinel}'`), { code: 'ENOENT' }),
    ),
    'ERROR: Protected Phase 2 identity-plan filesystem operation failed.',
  );
});

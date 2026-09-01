import { INVENTORY_PROFILES } from './model-inventory-operator-core.mjs';

export function buildIdentityCollisionChildEnvironment(args) {
  return {
    ...args.baseEnvironment,
    YLABS_IDENTITY_AUDIT_PROFILE_ACTIVE: 'true',
    YLABS_INVENTORY_PROFILE_NAME: args.profileName,
    YLABS_INVENTORY_PROFILE_PATH: args.inventoryProfilePath,
    YLABS_SKIP_LOCAL_DOTENV: 'true',
  };
}

export function identityCollisionChildCommand(profileName, output) {
  const profile = INVENTORY_PROFILES[profileName];
  if (!profile) {
    throw new Error(`Unknown protected identity-collision profile: ${profileName}`);
  }
  return [
    '--cwd',
    'server',
    'model-refactor:identity-collisions',
    '--environment',
    profile.environment,
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
    output,
  ];
}

import { buildIdentityCollisionChildEnvironment } from './identity-collision-operator-core.mjs';
import { INVENTORY_PROFILES } from './model-inventory-operator-core.mjs';

export function buildPhase2IdentityPlanChildEnvironment(args) {
  return buildIdentityCollisionChildEnvironment(args);
}

export function phase2IdentityPlanChildCommand(profileName, output) {
  const profile = INVENTORY_PROFILES[profileName];
  if (!profile) {
    throw new Error(`Unknown protected Phase 2 identity-plan profile: ${profileName}`);
  }
  return [
    '--cwd',
    'server',
    'model-refactor:identity-plan',
    '--environment',
    profile.environment,
    '--document-limit',
    '100000',
    '--quarantine-limit',
    '25000',
    '--max-time-ms',
    '5000',
    '--strict',
    '--output',
    output,
  ];
}

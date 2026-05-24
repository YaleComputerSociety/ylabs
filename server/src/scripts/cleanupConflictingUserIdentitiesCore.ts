import {
  normalizePersonName,
  type UserIdentityCollision,
  type UserIdentityField,
} from './dedupeUsersByIdentityCore';

export interface ConflictingUserIdentityCleanup {
  userId: string;
  identityField: UserIdentityField;
  identityValue: string;
  replacementValue?: string;
  unsetFields: string[];
}

export interface ConflictingUserIdentityCleanupPlan {
  candidateGroups: number;
  cleanupUsers: ConflictingUserIdentityCleanup[];
  skippedSameNameGroups: number;
}

function fallbackEmailForNetid(netid: unknown): string | undefined {
  const value = String(netid || '').trim().toLowerCase();
  return value ? `${value}@yale.edu` : undefined;
}

function unsetFieldsForIdentity(field: UserIdentityField): string[] {
  switch (field) {
    case 'orcid':
      return ['orcid', 'orcidWorksSyncedAt'];
    case 'openAlexId':
      return ['openAlexId', 'openAlexWorksSyncedAt'];
    case 'googleScholarId':
      return ['googleScholarId', 'googleScholarMetricsUpdatedAt'];
    case 'email':
    case 'netid':
    default:
      return [];
  }
}

export function buildConflictingUserIdentityCleanupPlan(
  collisions: UserIdentityCollision[],
): ConflictingUserIdentityCleanupPlan {
  const cleanupUsers: ConflictingUserIdentityCleanup[] = [];
  let skippedSameNameGroups = 0;

  for (const collision of collisions) {
    const users = collision.users.filter((user) => user.id);
    if (users.length <= 1) continue;

    const normalizedNames = new Set(
      users.map((user) => normalizePersonName(user)).filter(Boolean),
    );
    if (normalizedNames.size <= 1) {
      skippedSameNameGroups++;
      continue;
    }

    for (const user of users) {
      if (collision.identityField === 'netid') continue;

      const replacementValue =
        collision.identityField === 'email' ? fallbackEmailForNetid(user.netid) : undefined;
      cleanupUsers.push({
        userId: user.id,
        identityField: collision.identityField,
        identityValue: collision.identityValue,
        replacementValue,
        unsetFields: unsetFieldsForIdentity(collision.identityField),
      });
    }
  }

  return {
    candidateGroups: collisions.length,
    cleanupUsers,
    skippedSameNameGroups,
  };
}

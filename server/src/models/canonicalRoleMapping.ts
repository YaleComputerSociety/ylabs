import type {
  RoleAssignmentReviewStatus,
  RoleAssignmentRole,
  RoleAssignmentState,
} from './roleAssignment';

export const CANONICAL_ROLE_BY_LEGACY: Readonly<Record<string, RoleAssignmentRole>> = Object.freeze(
  {
    pi: 'PI',
    'co-pi': 'CO_PI',
    director: 'DIRECTOR',
    'co-director': 'CO_DIRECTOR',
    'core-faculty': 'CORE_FACULTY',
    affiliated: 'AFFILIATED',
    affiliate: 'AFFILIATED',
    alumni: 'AFFILIATED',
    staff: 'STAFF',
    postdoc: 'POSTDOC',
    'grad-student': 'GRADUATE_STUDENT',
    undergrad: 'UNDERGRADUATE',
  },
);

export const LEGACY_ROLE_BY_CANONICAL: Readonly<Record<RoleAssignmentRole, string>> = Object.freeze(
  {
    PI: 'pi',
    CO_PI: 'co-pi',
    DIRECTOR: 'director',
    CO_DIRECTOR: 'co-director',
    CORE_FACULTY: 'core-faculty',
    AFFILIATED: 'affiliated',
    STAFF: 'staff',
    POSTDOC: 'postdoc',
    GRADUATE_STUDENT: 'grad-student',
    UNDERGRADUATE: 'undergrad',
  },
);

export function canonicalRoleForLegacy(
  legacyRole: string | null | undefined,
): RoleAssignmentRole | undefined {
  return CANONICAL_ROLE_BY_LEGACY[(legacyRole || '').trim().toLowerCase()];
}

export interface LegacyMembershipStateFacts {
  evidenceStatus?: string | null;
  isCurrentMember?: boolean;
  role?: string | null;
  endedAt?: Date | string | null;
  leftAt?: Date | string | null;
}

export function roleStateForLegacyMembership(
  membership: LegacyMembershipStateFacts,
): RoleAssignmentState {
  if (
    (membership.evidenceStatus || '').trim().toLowerCase() === 'historical' ||
    membership.isCurrentMember === false ||
    (membership.role || '').trim().toLowerCase() === 'alumni' ||
    membership.endedAt ||
    membership.leftAt
  ) {
    return 'HISTORICAL';
  }
  if (membership.evidenceStatus === 'verified' && membership.isCurrentMember === true) {
    return 'CURRENT';
  }
  return 'UNKNOWN';
}

export function reviewStatusForLegacyMembership(
  membership: { archived?: boolean; evidenceStatus?: string | null },
  state: RoleAssignmentState,
  resolution: string | undefined,
): RoleAssignmentReviewStatus {
  return membership.archived !== true &&
    state === 'CURRENT' &&
    resolution === 'CANONICAL_SOURCE_REFERENCE' &&
    membership.evidenceStatus === 'verified'
    ? 'APPROVED'
    : 'UNREVIEWED';
}

export function clampConfidence(value: unknown): number {
  return Math.min(1, Math.max(0, Number(value) || 0));
}

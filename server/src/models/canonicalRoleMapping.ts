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

/**
 * THE LEAD ROLE SET HAS ONE OWNER, AND IT LIVES HERE IN BOTH VOCABULARIES.
 *
 * A role exists in two forms that are never interchangeable. `role_assignments`
 * stores the CANONICAL value (`PI`); a served member object carries the LEGACY
 * label (`pi`), derived at `researchEntityMembershipAccessor` on the way out. The
 * two sets are disjoint, so comparing a value from one against a set from the
 * other matches nothing and returns silently empty. That is worse than an error,
 * because an empty result is indistinguishable from "there are no lead edges":
 * measured on Development, the same population counts 0 through the legacy labels
 * and 7,520 through the canonical values (#3204).
 *
 * `LEAD_ROLE_CANONICAL_VALUES` is derived from the legacy labels through the
 * mapping above rather than written out again, so the two cannot drift apart, and
 * it is typed `RoleAssignmentRole[]` so passing legacy labels to a query that
 * expects stored values is a compile error rather than a wrong zero. That typing
 * is why 20 of the 21 stored-edge filters were already correct and the one that
 * was not had passed a `string[]`.
 *
 * Use `LEAD_ROLE_LEGACY_LABELS` to test a SERVED member's role, and
 * `LEAD_ROLE_CANONICAL_VALUES` to filter STORED `role_assignments`. Never a
 * literal, and never the other one.
 *
 * This is deliberately NOT the same as the narrower `['PI','DIRECTOR']` primary
 * lead set several scripts use; those ask a different question and collapsing them
 * into this set would change behaviour.
 */
export const LEAD_ROLE_LEGACY_LABELS: ReadonlySet<string> = Object.freeze(
  new Set(['pi', 'co-pi', 'director', 'co-director']),
);

export const LEAD_ROLE_CANONICAL_VALUES: readonly RoleAssignmentRole[] = Object.freeze(
  Array.from(LEAD_ROLE_LEGACY_LABELS).flatMap((legacyRole) => {
    const canonicalRole = canonicalRoleForLegacy(legacyRole);
    return canonicalRole ? [canonicalRole] : [];
  }),
);

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

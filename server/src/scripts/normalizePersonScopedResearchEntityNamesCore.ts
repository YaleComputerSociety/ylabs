import {
  isPersonScopedResearchEntity,
  isUnrecoverablePersonScopedEntityName,
  labResearchEntityNameFromStaleFacultyResearchSuffix,
  personScopedResearchEntityNameFromPersonName,
} from '../utils/researchHomeNameIdentityAuthority';

export const PERSON_SCOPED_NAME_FIELDS = ['name', 'displayName'] as const;

export type PersonScopedNameField = (typeof PERSON_SCOPED_NAME_FIELDS)[number];

export interface PersonScopedNameCandidate {
  entityType?: unknown;
  kind?: unknown;
  name?: unknown;
  displayName?: unknown;
  studentVisibilityTier?: unknown;
  manuallyLockedFields?: unknown;
}

export interface PersonScopedNamePlan {
  renames: Array<{ field: PersonScopedNameField; from: string; to: string }>;
  regateForUnusableName: boolean;
  skippedLockedFields: PersonScopedNameField[];
}

const textValue = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

const lockedFields = (value: unknown): Set<string> =>
  new Set(Array.isArray(value) ? value.map((field) => String(field)) : []);

/**
 * What this row needs, read from the row's CURRENT stored values rather than from
 * any recorded intent, so a second run of the repair settles with an empty plan
 * instead of writing again (#2858).
 *
 * The three arms are independent because they have different remedies. A bare person
 * name is recoverable, so it is renamed to the value the roster scrapers already
 * write. A `LAB` row still wearing the person-scoped suffix is recoverable the same
 * way, from its own type. A named professorship or a bare host name is not, so the
 * only honest outcome there is a re-gate that lets the `unusable_name` blocker hold
 * the row: there is nothing to rename it to, and a blank heading would be worse than
 * a held row.
 */
export function planPersonScopedNameNormalization(
  entity: PersonScopedNameCandidate,
): PersonScopedNamePlan {
  const plan: PersonScopedNamePlan = {
    renames: [],
    regateForUnusableName: false,
    skippedLockedFields: [],
  };
  if (!isPersonScopedResearchEntity(entity)) return plan;
  const locked = lockedFields(entity.manuallyLockedFields);

  for (const field of PERSON_SCOPED_NAME_FIELDS) {
    const current = textValue(entity[field]);
    if (!current) continue;
    const identity = {
      candidateName: current,
      entityType: entity.entityType,
      kind: entity.kind,
    };
    const derived =
      personScopedResearchEntityNameFromPersonName(identity) ||
      labResearchEntityNameFromStaleFacultyResearchSuffix(identity);
    if (!derived || derived === current) continue;
    if (locked.has(field)) {
      plan.skippedLockedFields.push(field);
      continue;
    }
    plan.renames.push({ field, from: current, to: derived });
  }

  plan.regateForUnusableName = isUnrecoverablePersonScopedEntityName(entity.name);
  return plan;
}

export const personScopedNamePlanIsEmpty = (plan: PersonScopedNamePlan): boolean =>
  plan.renames.length === 0 && !plan.regateForUnusableName;

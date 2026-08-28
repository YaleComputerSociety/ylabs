import { isFacultyResearchTextEntity } from '../utils/researchEntityDescriptionText';
import {
  describesResearchHome,
  isHighConfidencePersonBio,
  isPersonCentricLead,
} from '../utils/researchHomeDescriptionSelection';

export interface PersonCentricLabDescriptionEntityInput {
  id: string;
  slug?: string;
  kind?: unknown;
  entityType?: unknown;
  fullDescription?: unknown;
  manuallyLockedFields?: unknown;
}

const textValue = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

function isOrganizationEntity(entity: PersonCentricLabDescriptionEntityInput): boolean {
  return !isFacultyResearchTextEntity({
    kind: typeof entity.kind === 'string' ? entity.kind : undefined,
    entityType: typeof entity.entityType === 'string' ? entity.entityType : undefined,
  });
}

function isLockedField(entity: PersonCentricLabDescriptionEntityInput, field: string): boolean {
  return Array.isArray(entity.manuallyLockedFields) && entity.manuallyLockedFields.includes(field);
}

export function selectPersonCentricLabDescriptionTargets<
  T extends PersonCentricLabDescriptionEntityInput,
>(entities: T[]): T[] {
  return entities.filter(
    (entity) =>
      isOrganizationEntity(entity) &&
      !isLockedField(entity, 'fullDescription') &&
      isPersonCentricLead(textValue(entity.fullDescription)),
  );
}

export type PersonCentricLabDescriptionAction = 're-derived' | 'cleared' | 'unchanged';

export interface ReDerivedLabDescription {
  fullDescription: string;
  shortDescription: string;
}

export interface PersonCentricLabDescriptionPlan {
  set: Record<string, string>;
  action: PersonCentricLabDescriptionAction;
  hasWrites: boolean;
}

// Blanking without a replacement is only safe for a high-confidence person
// bio; a looser name-verb lead can be a legitimate research-rich academic bio,
// so it is left as-is when no better lab paragraph exists (mirrors the
// fail-closed bar isHighConfidencePersonBio uses at write time).
export function planPersonCentricLabDescriptionRewrite(
  originalFullDescription: unknown,
  reDerived: ReDerivedLabDescription | null,
): PersonCentricLabDescriptionPlan {
  const originalText = textValue(originalFullDescription);
  const reDerivedText = reDerived ? textValue(reDerived.fullDescription) : '';
  const usable =
    reDerived &&
    reDerivedText &&
    reDerivedText.toLowerCase() !== originalText.toLowerCase() &&
    describesResearchHome(reDerivedText) &&
    !isPersonCentricLead(reDerivedText)
      ? reDerived
      : null;

  if (usable) {
    return {
      set: {
        fullDescription: usable.fullDescription,
        shortDescription: usable.shortDescription || '',
      },
      action: 're-derived',
      hasWrites: true,
    };
  }

  if (isHighConfidencePersonBio(originalText)) {
    return {
      set: { fullDescription: '', shortDescription: '' },
      action: 'cleared',
      hasWrites: true,
    };
  }

  return { set: {}, action: 'unchanged', hasWrites: false };
}

export function filterPersonCentricLabDescriptionPlanByManualLocks(
  plan: PersonCentricLabDescriptionPlan,
  manuallyLockedFields: readonly string[] | undefined,
): PersonCentricLabDescriptionPlan {
  const locked = new Set(manuallyLockedFields ?? []);
  if (locked.has('fullDescription')) {
    return { set: {}, action: 'unchanged', hasWrites: false };
  }
  const set = { ...plan.set };
  if (locked.has('shortDescription')) delete set.shortDescription;
  const action: PersonCentricLabDescriptionAction =
    Object.keys(set).length === 0 ? 'unchanged' : plan.action;
  return { set, action, hasWrites: Object.keys(set).length > 0 };
}

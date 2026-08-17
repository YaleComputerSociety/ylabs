import { inferPiNameFromLabName } from '../scrapers/sources/ysmAtoZScraper';

export const MEDICINE_DEPARTMENT_PATTERN = /medicine|health|nursing|public health/i;

export interface SurnameInferredPiCandidateUser {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  primaryDepartment?: string | null;
}

export interface SurnameInferredPiMemberInput {
  memberId: string;
  entityId: string;
  entitySlug?: string;
  entityName?: string;
  linkedUser: SurnameInferredPiCandidateUser | null;
  sameSurnameFaculty: SurnameInferredPiCandidateUser[];
}

export type SurnameInferredPiVerdict = 'keep' | 'retire';

export interface SurnameInferredPiClassification {
  memberId: string;
  entityId: string;
  entitySlug?: string;
  entityName?: string;
  linkedUserId?: string;
  linkedUserName?: string;
  linkedUserDepartment?: string;
  verdict: SurnameInferredPiVerdict;
  reason: string;
  correctedUserId?: string;
}

const normalize = (value: string | null | undefined): string => (value || '').trim().toLowerCase();

const fullName = (user: SurnameInferredPiCandidateUser | null): string =>
  user ? [user.firstName, user.lastName].map((part) => (part || '').trim()).filter(Boolean).join(' ') : '';

const isMedicineDepartment = (user: SurnameInferredPiCandidateUser): boolean =>
  MEDICINE_DEPARTMENT_PATTERN.test(String(user.primaryDepartment || ''));

export function classifySurnameInferredPiMember(
  input: SurnameInferredPiMemberInput,
): SurnameInferredPiClassification {
  const base = {
    memberId: input.memberId,
    entityId: input.entityId,
    entitySlug: input.entitySlug,
    entityName: input.entityName,
    linkedUserId: input.linkedUser?.id,
    linkedUserName: fullName(input.linkedUser) || undefined,
    linkedUserDepartment: input.linkedUser?.primaryDepartment || undefined,
  };

  if (!input.linkedUser?.id) {
    return { ...base, verdict: 'retire', reason: 'pi_member_has_no_resolvable_user' };
  }

  const nameHint = inferPiNameFromLabName(input.entityName || '');
  if (!nameHint?.lastName) {
    return { ...base, verdict: 'keep', reason: 'entity_name_yields_no_surname_hint' };
  }

  if (normalize(nameHint.lastName) !== normalize(input.linkedUser.lastName)) {
    return {
      ...base,
      verdict: 'retire',
      reason: 'linked_pi_surname_differs_from_lab_name_surname',
    };
  }

  if (nameHint.firstName.trim()) {
    const matchesFirstName = normalize(nameHint.firstName) === normalize(input.linkedUser.firstName);
    return matchesFirstName
      ? { ...base, verdict: 'keep', reason: 'lab_name_full_name_matches_linked_pi' }
      : { ...base, verdict: 'retire', reason: 'lab_name_first_name_differs_from_linked_pi' };
  }

  const medicineFaculty = input.sameSurnameFaculty.filter(isMedicineDepartment);
  if (medicineFaculty.length === 1 && medicineFaculty[0].id === input.linkedUser.id) {
    return { ...base, verdict: 'keep', reason: 'unique_medicine_department_surname_match' };
  }
  if (medicineFaculty.length === 1) {
    return {
      ...base,
      verdict: 'retire',
      reason: 'surname_only_link_points_to_wrong_medicine_faculty',
      correctedUserId: medicineFaculty[0].id,
    };
  }
  if (medicineFaculty.length > 1) {
    return {
      ...base,
      verdict: 'retire',
      reason: 'surname_only_link_is_ambiguous_across_medicine_faculty',
    };
  }
  return {
    ...base,
    verdict: 'retire',
    reason: 'surname_only_link_has_no_medicine_department_match',
  };
}

export function summarizeSurnameInferredPiClassifications(
  classifications: SurnameInferredPiClassification[],
): { total: number; keep: number; retire: number; retireByReason: Record<string, number> } {
  const retire = classifications.filter((item) => item.verdict === 'retire');
  const retireByReason: Record<string, number> = {};
  for (const item of retire) {
    retireByReason[item.reason] = (retireByReason[item.reason] || 0) + 1;
  }
  return {
    total: classifications.length,
    keep: classifications.length - retire.length,
    retire: retire.length,
    retireByReason,
  };
}

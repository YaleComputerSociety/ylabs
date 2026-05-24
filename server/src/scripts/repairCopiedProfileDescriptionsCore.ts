export const RESEARCH_ENTITY_DESCRIPTION_FIELDS = [
  'description',
  'shortDescription',
  'fullDescription',
] as const;

export type ResearchEntityDescriptionField =
  (typeof RESEARCH_ENTITY_DESCRIPTION_FIELDS)[number];

export interface RepairProfileDescriptionEntity {
  id: string;
  slug: string;
  name: string;
  description?: unknown;
  shortDescription?: unknown;
  fullDescription?: unknown;
  manuallyLockedFields?: string[];
}

export interface RepairProfileDescriptionMember {
  researchEntityId: string;
  userId: string;
  role?: string;
  isCurrentMember?: boolean;
}

export interface RepairProfileDescriptionUser {
  id: string;
  netid?: string;
  name?: string;
  bio?: unknown;
}

export interface RepairProfileDescriptionObservation {
  id: string;
  entityKey?: string;
  entityId?: string;
  field: string;
  value?: unknown;
  sourceName?: string;
  confidence?: number;
  observedAt?: Date;
  superseded?: boolean;
}

export interface ReplacementDescriptionValue {
  value: unknown;
  confidence: number;
  sourceName: string;
}

export interface CopiedProfileDescriptionRepair {
  researchEntityId: string;
  slug: string;
  name: string;
  piNetids: string[];
  staleObservationIds: string[];
  staleFields: ResearchEntityDescriptionField[];
  copiedCurrentFields: ResearchEntityDescriptionField[];
  replacementFields: Record<ResearchEntityDescriptionField, ReplacementDescriptionValue | null>;
}

export interface CopiedProfileDescriptionRepairPlan {
  repairs: CopiedProfileDescriptionRepair[];
  skipped: Array<{
    researchEntityId: string;
    slug: string;
    reason: 'no-lead-profile-bio' | 'manual-description-lock';
  }>;
}

const LEAD_ROLES = new Set(['pi', 'co-pi', 'director', 'co-director']);
const STALE_SOURCE_NAME = 'dept-faculty-roster';

function normalizedComparableText(value: unknown): string {
  return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function isCopiedProfileBioText(value: unknown, bios: Set<string>): boolean {
  const normalized = normalizedComparableText(value);
  if (!normalized) return false;
  for (const bio of bios) {
    if (normalized === bio) return true;
    if (bio.startsWith(normalized)) return true;
  }
  return false;
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

export function chooseReplacementDescriptionValue(
  observations: RepairProfileDescriptionObservation[],
): ReplacementDescriptionValue | null {
  const candidates = observations
    .filter((observation) => {
      const value = normalizedComparableText(observation.value);
      return value && observation.superseded !== true;
    })
    .sort((a, b) => {
      const confidenceDiff = (Number(b.confidence) || 0) - (Number(a.confidence) || 0);
      if (confidenceDiff !== 0) return confidenceDiff;
      return (
        new Date(b.observedAt || 0).getTime() -
        new Date(a.observedAt || 0).getTime()
      );
    });
  const best = candidates[0];
  if (!best) return null;
  return {
    value: best.value,
    confidence: Number(best.confidence) || 0,
    sourceName: best.sourceName || '',
  };
}

export function buildCopiedProfileDescriptionRepairPlan({
  entities,
  members,
  users,
  observations,
}: {
  entities: RepairProfileDescriptionEntity[];
  members: RepairProfileDescriptionMember[];
  users: RepairProfileDescriptionUser[];
  observations: RepairProfileDescriptionObservation[];
}): CopiedProfileDescriptionRepairPlan {
  const usersById = new Map(users.map((user) => [user.id, user]));
  const membersByEntityId = new Map<string, RepairProfileDescriptionMember[]>();
  for (const member of members) {
    if (member.isCurrentMember === false || !LEAD_ROLES.has(member.role || '')) continue;
    const existing = membersByEntityId.get(member.researchEntityId) || [];
    existing.push(member);
    membersByEntityId.set(member.researchEntityId, existing);
  }

  const observationsByEntity = new Map<string, RepairProfileDescriptionObservation[]>();
  for (const observation of observations) {
    for (const key of [observation.entityId, observation.entityKey].filter(Boolean) as string[]) {
      const existing = observationsByEntity.get(key) || [];
      existing.push(observation);
      observationsByEntity.set(key, existing);
    }
  }

  const repairs: CopiedProfileDescriptionRepair[] = [];
  const skipped: CopiedProfileDescriptionRepairPlan['skipped'] = [];

  for (const entity of entities) {
    const lockedFields = new Set(entity.manuallyLockedFields || []);
    if (RESEARCH_ENTITY_DESCRIPTION_FIELDS.some((field) => lockedFields.has(field))) {
      skipped.push({
        researchEntityId: entity.id,
        slug: entity.slug,
        reason: 'manual-description-lock',
      });
      continue;
    }

    const leadUsers = (membersByEntityId.get(entity.id) || [])
      .map((member) => usersById.get(member.userId))
      .filter((user): user is RepairProfileDescriptionUser => !!user);
    const bios = new Set(
      leadUsers.map((user) => normalizedComparableText(user.bio)).filter(Boolean),
    );
    if (bios.size === 0) {
      skipped.push({
        researchEntityId: entity.id,
        slug: entity.slug,
        reason: 'no-lead-profile-bio',
      });
      continue;
    }

    const entityObservations = uniqueStrings([entity.id, entity.slug]).flatMap(
      (key) => observationsByEntity.get(key) || [],
    );
    const staleObservations = entityObservations.filter(
      (observation) =>
        observation.superseded !== true &&
        observation.sourceName === STALE_SOURCE_NAME &&
        RESEARCH_ENTITY_DESCRIPTION_FIELDS.includes(
          observation.field as ResearchEntityDescriptionField,
        ) &&
        isCopiedProfileBioText(observation.value, bios),
    );
    const copiedCurrentFields = RESEARCH_ENTITY_DESCRIPTION_FIELDS.filter((field) =>
      isCopiedProfileBioText(entity[field], bios),
    );

    if (staleObservations.length === 0 && copiedCurrentFields.length === 0) continue;

    const replacementFields = Object.fromEntries(
      RESEARCH_ENTITY_DESCRIPTION_FIELDS.map((field) => {
        const staleIds = new Set(
          staleObservations
            .filter((observation) => observation.field === field)
            .map((observation) => observation.id),
        );
        const replacements = entityObservations.filter(
          (observation) =>
            observation.field === field &&
            !staleIds.has(observation.id) &&
            !isCopiedProfileBioText(observation.value, bios),
        );
        return [field, chooseReplacementDescriptionValue(replacements)];
      }),
    ) as Record<ResearchEntityDescriptionField, ReplacementDescriptionValue | null>;

    repairs.push({
      researchEntityId: entity.id,
      slug: entity.slug,
      name: entity.name,
      piNetids: uniqueStrings(leadUsers.map((user) => user.netid || '')),
      staleObservationIds: uniqueStrings(staleObservations.map((observation) => observation.id)),
      staleFields: uniqueStrings(
        staleObservations.map((observation) => observation.field),
      ) as ResearchEntityDescriptionField[],
      copiedCurrentFields,
      replacementFields,
    });
  }

  return { repairs, skipped };
}

/**
 * Computes the "best first" browse-ranking score for a ResearchEntity.
 *
 * This score drives the default (no-query) ordering on /research: students
 * landing on the browse page see the research homes they can most plausibly
 * act on first. It ranks on profile completeness (source-backed description, an
 * attached identified lead, an official source URL) reusing the existing
 * quality-state classification so there is one source of truth for those
 * states, plus a small umbrella-type demotion. Access-plausibility signals do
 * not contribute to rank (see the 2026-08-25 "Simple Directory First"
 * decision): reaching out is the universal action, so ordering is by data
 * quality and relevance, not by a computed access grade.
 *
 * Higher score = better. Pure function (no DB access) so it is fully testable;
 * persistence/sync orchestration lives in researchEntityBrowseRankService.ts.
 */
import {
  buildResearchEntityQualitySummary,
  ResearchEntityQualitySummary,
} from './researchEntityQuality';
import {
  mapResearchGroupKindToEntityType,
  ResearchEntityType,
} from '../models/researchAccessTypes';

export interface ResearchEntityBrowseRankInput {
  entity: Record<string, any>;
  leadMembers?: Array<Record<string, any>>;
  /**
   * True when the entity is the source of at least one active affiliation
   * relationship (it hosts labs, groups, research areas, or programs). Gates the
   * umbrella demotion so a leaf "Center" that hosts nothing is not penalized.
   */
  hostsAffiliatedResearchHomes?: boolean;
}

/** Description-state contribution (source-backed + complete card is best). */
const descriptionPoints = (summary: ResearchEntityQualitySummary): number => {
  if (summary.descriptionState === 'source_backed') {
    return summary.cardState === 'complete' ? 30 : 18;
  }
  if (summary.descriptionState === 'profile_synthesis') return 8;
  if (summary.descriptionState === 'thin') return 2;
  return 0; // missing
};

/** Lead-state contribution (an identified PI/lead is best; a conflict hurts). */
const leadPoints = (summary: ResearchEntityQualitySummary): number => {
  switch (summary.leadState) {
    case 'lead_attached':
      return 25;
    case 'lead_weak':
      return 8;
    case 'lead_conflict':
      return -10;
    default:
      return 0; // lead_missing
  }
};

const resolveEntityType = (entity: Record<string, any>): ResearchEntityType =>
  (entity.entityType || mapResearchGroupKindToEntityType(entity.kind)) as ResearchEntityType;

/**
 * Type-based demotion. Umbrella organizations (a center or institute that hosts
 * many labs) are valid research homes but are not the single joinable lab or
 * project a student is usually looking for, so they are ranked below comparable
 * direct research homes rather than excluded. The magnitude is small relative to
 * the completeness and access terms, so a strong umbrella entity can still
 * surface above a weak lab.
 *
 * The umbrella demotion is applied by behavior, not by name: it only affects an
 * org-type entity that actually hosts affiliated research homes. A leaf entity
 * that happens to be typed CENTER/INSTITUTE/INITIATIVE but hosts nothing is a
 * direct research home and is not demoted.
 */
const ENTITY_TYPE_RANK_ADJUSTMENT: Partial<Record<ResearchEntityType, number>> = {
  CENTER: -25,
  INSTITUTE: -18,
  INITIATIVE: -10,
};

const UMBRELLA_GATED_TYPES = new Set<ResearchEntityType>(['CENTER', 'INSTITUTE', 'INITIATIVE']);

const entityTypeRankAdjustment = (
  entity: Record<string, any>,
  hostsAffiliatedResearchHomes = false,
): number => {
  const entityType = resolveEntityType(entity);
  const adjustment = ENTITY_TYPE_RANK_ADJUSTMENT[entityType] ?? 0;
  if (adjustment === 0) return 0;
  if (UMBRELLA_GATED_TYPES.has(entityType) && !hostsAffiliatedResearchHomes) return 0;
  return adjustment;
};

export function computeResearchEntityBrowseRank({
  entity,
  leadMembers = [],
  hostsAffiliatedResearchHomes = false,
}: ResearchEntityBrowseRankInput): number {
  const summary = buildResearchEntityQualitySummary({ entity, leadMembers });

  let score = 0;
  score += descriptionPoints(summary);
  score += leadPoints(summary);
  if (summary.repairFlags.includes('missing_source_url')) {
    // Reward a real official source URL; its absence is already implied here.
  } else {
    score += 10;
  }
  if (summary.repairFlags.includes('duplicate_risk')) score -= 14;
  score += entityTypeRankAdjustment(entity, hostsAffiliatedResearchHomes);

  return score;
}

export const __testing = {
  ENTITY_TYPE_RANK_ADJUSTMENT,
  UMBRELLA_GATED_TYPES,
  descriptionPoints,
  leadPoints,
  entityTypeRankAdjustment,
};

/**
 * Computes the "best first" browse-ranking score for a ResearchEntity.
 *
 * This score drives the default (no-query) ordering on /research: students
 * landing on the browse page see the research homes they can most plausibly
 * act on first. It combines two things:
 *   - Profile completeness (source-backed description, an attached identified
 *     lead, an official source URL) — reusing the existing quality-state
 *     classification so there is one source of truth for those states.
 *   - Strength-weighted undergrad access signals. NOT a flat "has any signal"
 *     boost: the vast majority of entities carry the manufactured
 *     low-confidence REACH_OUT_PLAUSIBLE fallback, so a flat boost would
 *     discriminate nothing. Strong, evidence-backed signals (current/past
 *     undergrads) outweigh weak ones; an explicit "not available" signal
 *     pushes the entity down. Strong signals are only derivable from lab-style
 *     microsites (roster/join/contact pages), so for shapes that cannot publish
 *     those (department-directory and individual-profile homes) the access term
 *     is neutralized to a mid-tier baseline: their missing strong signal is
 *     uninformative and completeness carries the score, rather than pinning ~39%
 *     of the corpus to the access floor purely by source shape.
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
  /** signalType values of the entity's active (non-archived) AccessSignals. */
  accessSignalTypes?: string[];
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

/**
 * Strength-weighted access contribution. Takes the single strongest signal the
 * entity carries (signals do not stack), and lets an explicit
 * NOT_CURRENTLY_AVAILABLE pull the score below zero.
 */
const ACCESS_SIGNAL_POINTS: Record<string, number> = {
  CURRENT_UNDERGRADS: 40,
  PAST_UNDERGRADS: 36,
  APPLICATION_FORM_EXISTS: 22,
  FELLOWSHIP_COMPATIBLE: 20,
  CONTACT_INSTRUCTIONS_EXIST: 16,
  REACH_OUT_PLAUSIBLE: 5,
  NOT_CURRENTLY_AVAILABLE: -20,
};

const accessPoints = (accessSignalTypes: string[]): number => {
  if (accessSignalTypes.length === 0) return 0;
  const scored = accessSignalTypes.map((type) => ACCESS_SIGNAL_POINTS[type] ?? 0);
  const best = Math.max(...scored);
  // A "not available" signal still drags an otherwise-zero entity down.
  const worst = Math.min(...scored);
  if (best <= 0) return worst;
  return best;
};

/**
 * Research-home shapes whose only sources are a department-directory row
 * (FACULTY_RESEARCH_AREA) or an individual faculty profile (INDIVIDUAL_RESEARCH).
 * These never publish a roster, join page, or contact microsite, so the strong
 * undergrad-access signals (CURRENT/PAST_UNDERGRADS, APPLICATION_FORM_EXISTS,
 * CONTACT_INSTRUCTIONS_EXIST) are structurally unobtainable for them. Absence of
 * those signals is uninformative for these shapes and must not be read as low
 * undergrad access - unlike an observable lab that published a roster page and
 * still listed no undergrads, whose weak signal is mildly informative.
 */
const ACCESS_UNOBSERVABLE_ENTITY_TYPES = new Set<ResearchEntityType>([
  'FACULTY_RESEARCH_AREA',
  'INDIVIDUAL_RESEARCH',
]);

/**
 * Neutral access credit for shapes that cannot structurally earn a strong
 * signal. Placed in the mid-tier of the observed access range so completeness
 * (description + lead + official URL) decides these entities' rank rather than a
 * missing +40/+36 term pinning the whole class to the REACH_OUT_PLAUSIBLE floor.
 * A genuinely stronger observed signal still outranks it, and an explicit
 * NOT_CURRENTLY_AVAILABLE still pulls the entity down. Tunable pending Dev
 * browse-mix dogfood.
 */
const NEUTRAL_ACCESS_BASELINE = 20;

/**
 * Shape-aware access contribution. Observable shapes are scored on their raw
 * signals. For a shape that cannot structurally observe strong signals, the
 * missing strong term is neutralized to a mid-tier baseline (never a floor)
 * unless the entity carries an explicit negative signal, so the whole class is
 * not demoted for evidence it never had the source shape to produce.
 */
const accessContribution = (
  accessSignalTypes: string[],
  entityType: ResearchEntityType,
): number => {
  const observed = accessPoints(accessSignalTypes);
  if (!ACCESS_UNOBSERVABLE_ENTITY_TYPES.has(entityType)) return observed;
  if (observed < 0) return observed;
  return Math.max(observed, NEUTRAL_ACCESS_BASELINE);
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
 * direct research home and is not demoted. PROGRAM demotion is unconditional
 * because it reflects a program offering rather than a joinable lab.
 */
const ENTITY_TYPE_RANK_ADJUSTMENT: Partial<Record<ResearchEntityType, number>> = {
  CENTER: -25,
  INSTITUTE: -18,
  PROGRAM: -10,
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
  accessSignalTypes = [],
  hostsAffiliatedResearchHomes = false,
}: ResearchEntityBrowseRankInput): number {
  const summary = buildResearchEntityQualitySummary({ entity, leadMembers });

  let score = 0;
  score += descriptionPoints(summary);
  score += leadPoints(summary);
  score += accessContribution(accessSignalTypes, resolveEntityType(entity));
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
  ACCESS_SIGNAL_POINTS,
  ENTITY_TYPE_RANK_ADJUSTMENT,
  UMBRELLA_GATED_TYPES,
  ACCESS_UNOBSERVABLE_ENTITY_TYPES,
  NEUTRAL_ACCESS_BASELINE,
  descriptionPoints,
  leadPoints,
  accessPoints,
  accessContribution,
  entityTypeRankAdjustment,
};

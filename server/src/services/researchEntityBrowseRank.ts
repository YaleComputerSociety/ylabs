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
 *     pushes the entity down.
 *
 * Higher score = better. Pure function (no DB access) so it is fully testable;
 * persistence/sync orchestration lives in researchEntityBrowseRankService.ts.
 */
import {
  buildResearchEntityQualitySummary,
  ResearchEntityQualitySummary,
} from './researchEntityQuality';

export interface ResearchEntityBrowseRankInput {
  entity: Record<string, any>;
  leadMembers?: Array<Record<string, any>>;
  /** signalType values of the entity's active (non-archived) AccessSignals. */
  accessSignalTypes?: string[];
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

export function computeResearchEntityBrowseRank({
  entity,
  leadMembers = [],
  accessSignalTypes = [],
}: ResearchEntityBrowseRankInput): number {
  const summary = buildResearchEntityQualitySummary({ entity, leadMembers });

  let score = 0;
  score += descriptionPoints(summary);
  score += leadPoints(summary);
  score += accessPoints(accessSignalTypes);
  if (summary.repairFlags.includes('missing_source_url')) {
    // Reward a real official source URL; its absence is already implied here.
  } else {
    score += 10;
  }
  if (summary.repairFlags.includes('duplicate_risk')) score -= 14;

  return score;
}

export const __testing = {
  ACCESS_SIGNAL_POINTS,
  descriptionPoints,
  leadPoints,
  accessPoints,
};

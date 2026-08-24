import {
  deriveShortDescriptionFromFullDescription,
  shortDescriptionQuality,
} from '../utils/researchEntityDescriptionQuality';
import {
  sanitizeResearchEntityShortDescription,
  stripTrailingResearchHomeAffiliationClause,
} from '../utils/descriptionHygiene';

export interface TopicLabelListRepairEntityFacts {
  id: string;
  slug?: string;
  name?: string;
  entityType?: unknown;
  shortDescription?: unknown;
  fullDescription?: unknown;
  researchAreas?: unknown;
}

export type TopicLabelListRepairAction =
  | 'unchanged'
  | 'sanitized'
  | 'derived-from-full'
  | 'cleared';

export interface TopicLabelListRepairPlanRow {
  id: string;
  slug?: string;
  name?: string;
  before: string;
  after: string;
  action: TopicLabelListRepairAction;
  changed: boolean;
}

const textValue = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

/**
 * Plans a repair for one `LAB`/`FACULTY_RESEARCH_AREA` entity's stored
 * shortDescription so it matches what the serve + gate path (#1616) now
 * produces:
 * - `sanitized`: the read-time sanitizer already strips a trailing
 *   institution-affiliation clause ("Studies American Politics at Yale
 *   University." -> "Studies American Politics.") and other chrome; when the
 *   result still clears the quality bar, persist it so stored == served
 *   (e.g. "Studies Art, Islamic Art and Architecture at Yale University." ->
 *   "Studies Art, Islamic Art and Architecture.").
 * - `derived-from-full`: when the sanitized short no longer clears the bar
 *   (a topic-label-list dump, an ungrounded cherry-pick like "Studies Texas
 *   from the first." over a Morocco full, or an affiliation strip that leaves
 *   too little), re-derive a faithful short from the entity's own full.
 * - `cleared`: when nothing usable can be derived, clear the bad short rather
 *   than keep serving it; the live gate then drops the entity below
 *   student_ready until a real description is scraped.
 */
export function planTopicLabelListRepairRow(
  facts: TopicLabelListRepairEntityFacts,
): TopicLabelListRepairPlanRow {
  const before = textValue(facts.shortDescription);
  const full = textValue(facts.fullDescription);
  const base = { id: facts.id, slug: facts.slug, name: facts.name, before };

  // Only repair a short that is bad in one of the specific #1616 ways: flagged
  // a topic-label-list dump or an ungrounded single-clause cherry-pick, or
  // carrying a strippable trailing institution-affiliation clause. A short
  // that merely fails quality for an unrelated reason (and would be re-derived
  // at serve time anyway) is left untouched so this repair never becomes a
  // corpus-wide short-description rewrite.
  const beforeFlags = shortDescriptionQuality(before, full, facts.researchAreas, {
    entityType: facts.entityType,
  }).flags;
  const hasAffiliationClause =
    stripTrailingResearchHomeAffiliationClause(before) !== before;
  const isTargeted =
    beforeFlags.includes('topic-label-list') ||
    beforeFlags.includes('ungrounded-topic-short') ||
    hasAffiliationClause;
  if (!isTargeted) {
    return { ...base, after: before, action: 'unchanged', changed: false };
  }

  const sanitized = sanitizeResearchEntityShortDescription(before);
  const sanitizedQuality = shortDescriptionQuality(sanitized, full, facts.researchAreas, {
    entityType: facts.entityType,
  });
  if (sanitized && sanitizedQuality.isUseful) {
    return sanitized === before
      ? { ...base, after: before, action: 'unchanged', changed: false }
      : { ...base, after: sanitized, action: 'sanitized', changed: true };
  }

  const derived = sanitizeResearchEntityShortDescription(
    deriveShortDescriptionFromFullDescription(full),
  );
  if (derived && derived !== before) {
    const derivedQuality = shortDescriptionQuality(derived, full, facts.researchAreas, {
      entityType: facts.entityType,
    });
    if (derivedQuality.isUseful) {
      return { ...base, after: derived, action: 'derived-from-full', changed: true };
    }
  }

  if (!before) {
    return { ...base, after: before, action: 'unchanged', changed: false };
  }
  return { ...base, after: '', action: 'cleared', changed: true };
}

export interface TopicLabelListRepairSummary {
  considered: number;
  changed: number;
  sanitized: number;
  derivedFromFull: number;
  cleared: number;
}

export function summarizeTopicLabelListRepair(
  rows: TopicLabelListRepairPlanRow[],
): TopicLabelListRepairSummary {
  let changed = 0;
  let sanitized = 0;
  let derivedFromFull = 0;
  let cleared = 0;
  for (const row of rows) {
    if (row.changed) changed += 1;
    if (row.action === 'sanitized') sanitized += 1;
    if (row.action === 'derived-from-full') derivedFromFull += 1;
    if (row.action === 'cleared') cleared += 1;
  }
  return { considered: rows.length, changed, sanitized, derivedFromFull, cleared };
}

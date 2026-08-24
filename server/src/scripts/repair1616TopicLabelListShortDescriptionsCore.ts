import {
  deriveShortDescriptionFromFullDescription,
  shortDescriptionQuality,
} from '../utils/researchEntityDescriptionQuality';
import { sanitizeResearchEntityShortDescription } from '../utils/descriptionHygiene';

export interface TopicLabelListRepairEntityFacts {
  id: string;
  slug?: string;
  name?: string;
  entityType?: unknown;
  shortDescription?: unknown;
  fullDescription?: unknown;
  researchAreas?: unknown;
}

export type TopicLabelListRepairAction = 'unchanged' | 'derived-from-full' | 'cleared';

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
 * Plans a repair for one `LAB`/`FACULTY_RESEARCH_AREA` entity flagged
 * `topic-label-list` by `shortDescriptionQuality` (#1616): the entity's own
 * fullDescription is checked for a real sentence that would make a faithful,
 * source-backed short (`deriveShortDescriptionFromFullDescription`), and only
 * if none passes the same quality bar is the bad short cleared rather than
 * left serving the label dump, affiliation fragment, or bare-list echo.
 */
export function planTopicLabelListRepairRow(
  facts: TopicLabelListRepairEntityFacts,
): TopicLabelListRepairPlanRow {
  const before = textValue(facts.shortDescription);
  const full = textValue(facts.fullDescription);
  const base = { id: facts.id, slug: facts.slug, name: facts.name, before };

  const currentQuality = shortDescriptionQuality(before, full, facts.researchAreas, {
    entityType: facts.entityType,
  });
  if (!currentQuality.flags.includes('topic-label-list')) {
    return { ...base, after: before, action: 'unchanged', changed: false };
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
  flagged: number;
  derivedFromFull: number;
  cleared: number;
}

export function summarizeTopicLabelListRepair(
  rows: TopicLabelListRepairPlanRow[],
): TopicLabelListRepairSummary {
  let flagged = 0;
  let derivedFromFull = 0;
  let cleared = 0;
  for (const row of rows) {
    if (row.action !== 'unchanged') flagged += 1;
    if (row.action === 'derived-from-full') derivedFromFull += 1;
    if (row.action === 'cleared') cleared += 1;
  }
  return { considered: rows.length, flagged, derivedFromFull, cleared };
}

/**
 * Rows named after a lab that own that lab, mistyped `FACULTY_RESEARCH_AREA`.
 *
 * Each row was judged individually rather than matched by a predicate, because
 * the population splits three ways and only this outcome is a type correction
 * (#2446). The other two outcomes are deliberately absent: three rows have a
 * separate `LAB` row for the same lab, where a type flip would mint the duplicate
 * it is meant to repair, and one row is named after a centre it does not own.
 *
 * `evidence` is the lab's own site, distinct from the person's profile page and
 * from any shared department roster index, and verified not to be cited by any
 * other `LAB` row.
 */
export interface LabTypeCorrection {
  slug: string;
  expectedName: string;
  evidence: string;
}

export const LAB_TYPE_CORRECTIONS: readonly LabTypeCorrection[] = [
  {
    slug: 'dept-mcdb-ronald-breaker',
    expectedName: 'The Breaker Laboratory',
    evidence: 'https://breaker.yale.edu/',
  },
  {
    slug: 'ysm-faculty-john-murray',
    expectedName: 'Murray Lab',
    evidence: 'http://murraylab.yale.edu/',
  },
  {
    slug: 'dept-physics-steve-lamoreaux',
    expectedName: 'Steve Lamoreaux Research Lab',
    evidence: 'http://www.yale.edu/lamoreauxgroup/',
  },
  {
    slug: 'dept-physics-eduardo-higino-da-silva-neto',
    expectedName: 'da Silva Neto Lab',
    evidence: 'http://campuspress.yale.edu/dasilvaneto',
  },
  {
    slug: 'ysm-faculty-david-spiegel',
    expectedName: 'David Spiegel Lab',
    evidence: 'https://www.spiegellab.org/',
  },
  {
    slug: 'dept-seas-dionysis-kalogerias',
    expectedName: 'Risk-Aware Decision, Inference and Optimization (RADIO) Lab',
    evidence: 'https://www.dkalogerias.org/',
  },
  {
    slug: 'harris-ah2323',
    expectedName: 'Expanding Engagement Lab',
    evidence: 'https://www.allisonpharris.com/',
  },
  {
    slug: 'ysm-faculty-hemant-tagare',
    expectedName: 'Hemant Tagare Lab',
    evidence: 'http://noodle.med.yale.edu/hdtag/profile.html',
  },
] as const;

export interface LabTypeCorrectionEntity {
  slug: string;
  name?: unknown;
  entityType?: unknown;
  kind?: unknown;
  archived?: unknown;
  manuallyLockedFields?: unknown;
  studentVisibilityTier?: unknown;
}

export type LabTypeCorrectionOutcome =
  | 'plan'
  | 'already-lab'
  | 'missing'
  | 'archived'
  | 'name-changed'
  | 'locked';

export interface LabTypeCorrectionPlanRow {
  slug: string;
  outcome: LabTypeCorrectionOutcome;
  beforeEntityType?: string;
  beforeKind?: string;
  beforeTier?: string;
  afterEntityType?: string;
  afterKind?: string;
  update?: Record<string, unknown>;
  note?: string;
}

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/**
 * `entityType` is decided once at mint time and never re-derived, and the roster
 * source's assertion sits at confidence 0.7-0.8, so a plain field write is
 * reverted by the next materialization of that row. Locking the field is what
 * makes a per-row human judgement durable, and it is the same mechanism the gate
 * already honours through `manuallyLockedFields`.
 */
export const LAB_TYPE_CORRECTION_LOCK_FIELD = 'entityType';

export function planLabTypeCorrections(
  entities: LabTypeCorrectionEntity[],
  corrections: readonly LabTypeCorrection[] = LAB_TYPE_CORRECTIONS,
): LabTypeCorrectionPlanRow[] {
  const bySlug = new Map(entities.map((entity) => [entity.slug, entity]));
  return corrections.map((correction) => {
    const entity = bySlug.get(correction.slug);
    if (!entity) return { slug: correction.slug, outcome: 'missing' };

    const beforeEntityType = text(entity.entityType);
    const beforeKind = text(entity.kind);
    const beforeTier = text(entity.studentVisibilityTier);
    const base = { slug: correction.slug, beforeEntityType, beforeKind, beforeTier };

    if (entity.archived === true) return { ...base, outcome: 'archived' };
    if (beforeEntityType === 'LAB') return { ...base, outcome: 'already-lab' };
    // A renamed row is no longer the row that was judged, so it must be
    // re-judged rather than corrected on a stale premise.
    if (text(entity.name).trim() !== correction.expectedName) {
      return {
        ...base,
        outcome: 'name-changed',
        note: `expected "${correction.expectedName}", found "${text(entity.name).trim()}"`,
      };
    }
    const locked = asStringArray(entity.manuallyLockedFields);
    if (locked.includes(LAB_TYPE_CORRECTION_LOCK_FIELD)) return { ...base, outcome: 'locked' };

    return {
      ...base,
      outcome: 'plan',
      afterEntityType: 'LAB',
      afterKind: 'lab',
      update: {
        entityType: 'LAB',
        kind: 'lab',
        manuallyLockedFields: [...locked, LAB_TYPE_CORRECTION_LOCK_FIELD],
      },
    };
  });
}

export function summarizeLabTypeCorrections(
  rows: LabTypeCorrectionPlanRow[],
): Record<LabTypeCorrectionOutcome, number> {
  const summary: Record<LabTypeCorrectionOutcome, number> = {
    plan: 0,
    'already-lab': 0,
    missing: 0,
    archived: 0,
    'name-changed': 0,
    locked: 0,
  };
  for (const row of rows) summary[row.outcome] += 1;
  return summary;
}

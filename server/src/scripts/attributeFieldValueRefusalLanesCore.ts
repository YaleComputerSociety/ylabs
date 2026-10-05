import {
  attributeRefusedValueLanes,
  type FieldValueRefusal,
  type LaneAttributableObservation,
} from '../utils/researchEntityFieldValueRefusals';

export interface RefusalAttributionRow {
  slug: string;
  fieldValueRefusals?: unknown;
}

export interface RefusalLaneAttributionPlan {
  slug: string;
  field: string;
  index: number;
  valueKey: string;
  attributedSourceNames: string[];
}

export type UnattributedRefusalReason = 'declared' | 'unchanged' | 'no-matching-observation';

export interface RefusalLaneAttributionOutcome {
  refusalsScanned: number;
  plans: RefusalLaneAttributionPlan[];
  skipped: Record<UnattributedRefusalReason, number>;
  unattributableByFieldAndRule: Record<string, number>;
  multiLanePlans: number;
}

const refusalsByField = (container: unknown): Array<[string, FieldValueRefusal[]]> => {
  if (!container || typeof container !== 'object') return [];
  const entries =
    container instanceof Map
      ? [...container.entries()]
      : Object.entries(container as Record<string, unknown>);
  return entries.filter((entry): entry is [string, FieldValueRefusal[]] => Array.isArray(entry[1]));
};

const sameLanes = (a: readonly string[] | undefined, b: readonly string[]): boolean =>
  Array.isArray(a) && a.length === b.length && a.every((lane, i) => lane === b[i]);

/**
 * The attribution each refusal on these rows is missing. A declared `sourceName` is never
 * overwritten: an operator who named a lane knew something the log may not show. A stored
 * attribution only grows: a lane that asserted the value did so even after
 * `observations:prune-dead` removes the row that showed it, so a pruned log never
 * un-attributes a refusal. That is also what lets the stage run every sweep and plan
 * nothing once the corpus is attributed.
 */
export function planRefusalLaneAttributions(
  rows: readonly RefusalAttributionRow[],
  observationsBySlug: ReadonlyMap<string, readonly LaneAttributableObservation[]>,
): RefusalLaneAttributionOutcome {
  const outcome: RefusalLaneAttributionOutcome = {
    refusalsScanned: 0,
    plans: [],
    skipped: { declared: 0, unchanged: 0, 'no-matching-observation': 0 },
    unattributableByFieldAndRule: {},
    multiLanePlans: 0,
  };
  for (const row of rows) {
    const observations = observationsBySlug.get(row.slug) ?? [];
    for (const [field, refusals] of refusalsByField(row.fieldValueRefusals)) {
      refusals.forEach((refusal, index) => {
        outcome.refusalsScanned += 1;
        if (refusal.sourceName?.trim()) {
          outcome.skipped.declared += 1;
          return;
        }
        const stored = Array.isArray(refusal.attributedSourceNames)
          ? refusal.attributedSourceNames
          : [];
        const lanes = [
          ...new Set([
            ...stored,
            ...attributeRefusedValueLanes(field, refusal.valueKey, observations),
          ]),
        ].sort();
        if (lanes.length === 0) {
          outcome.skipped['no-matching-observation'] += 1;
          const bucket = `${field}/${refusal.rule}`;
          outcome.unattributableByFieldAndRule[bucket] =
            (outcome.unattributableByFieldAndRule[bucket] ?? 0) + 1;
          return;
        }
        if (sameLanes(refusal.attributedSourceNames, lanes)) {
          outcome.skipped.unchanged += 1;
          return;
        }
        if (lanes.length > 1) outcome.multiLanePlans += 1;
        outcome.plans.push({
          slug: row.slug,
          field,
          index,
          valueKey: refusal.valueKey,
          attributedSourceNames: lanes,
        });
      });
    }
  }
  return outcome;
}

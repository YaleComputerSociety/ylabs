import crypto from 'crypto';
import { MATERIALIZER_MANAGED_FIELDS } from '../scrapers/entityMaterializer';
import {
  FIELD_VALUE_REFUSALS_PATH,
  fieldValueRefusalKey,
  liveFieldValueRefusals,
} from '../utils/researchEntityFieldValueRefusals';

export interface EngineBenchmarkLabel {
  entityKey: string;
  field: string;
  valueKey: string;
  rule: string;
}

/** One row's replayed engine output: what resolve planned, and what the gate then said. */
export interface ReplayedRow {
  entityKey: string;
  plannedSet: Record<string, unknown>;
  plannedUnset: Record<string, unknown>;
  tier: string;
  computedTier: string;
  reasons: string[];
  unfrozenReads: string[];
}

export interface EngineFieldScore {
  field: string;
  resolved: number;
  cleared: number;
  labeledEntityResolved: number;
  knownWrong: number;
  changedFromPrevious?: number;
}

export interface EngineReplayScore {
  rowsReplayed: number;
  rowsWithIncompleteInput: number;
  unfrozenReads: string[];
  resolved: number;
  cleared: number;
  knownWrong: number;
  labelsMatched: number;
  labelCount: number;
  outputFingerprint: string;
  byField: EngineFieldScore[];
  gateTiers: Array<{ tier: string; rows: number }>;
}

/**
 * Fields the materializer stamps from the clock or from run bookkeeping rather than
 * deriving from evidence. Masked in the fingerprint for the same reason the lane
 * scorecard masks `readAt`: unmasked, every replay differs and the instrument reports
 * a regression on every run, which is the fastest way to make it ignored.
 */
export const ENGINE_FINGERPRINT_MASKED_FIELDS: ReadonlySet<string> = new Set([
  ...MATERIALIZER_MANAGED_FIELDS,
  'updatedAt',
  'createdAt',
  'studentVisibilityComputedAt',
  'studentVisibilityEvaluatedAt',
  'lastScrapedAt',
  'lastMaterializedAt',
]);

const stableValue = (value: unknown): unknown => {
  if (value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, stableValue(entry)]),
    );
  }
  return value;
};

/**
 * One line per resolved field, per cleared field, and per gate verdict, sorted, so a
 * replay that visits rows in another order fingerprints the same and any change in what
 * the engine resolved or how the gate then judged it changes the digest.
 *
 * The gate verdict is inside the fingerprint on purpose: resolve and gate are one
 * pipeline from a student's point of view, and a change that alters no field but moves a
 * row out of `student_ready` is the change that matters most.
 */
export function engineOutputFingerprint(rows: readonly ReplayedRow[]): string {
  const lines: string[] = [];
  for (const row of rows) {
    for (const [field, value] of Object.entries(row.plannedSet)) {
      if (ENGINE_FINGERPRINT_MASKED_FIELDS.has(field)) continue;
      lines.push(JSON.stringify(['set', row.entityKey, field, stableValue(value)]));
    }
    for (const field of Object.keys(row.plannedUnset)) {
      if (ENGINE_FINGERPRINT_MASKED_FIELDS.has(field)) continue;
      lines.push(JSON.stringify(['unset', row.entityKey, field]));
    }
    lines.push(
      JSON.stringify(['gate', row.entityKey, row.tier, row.computedTier, [...row.reasons].sort()]),
    );
  }
  lines.sort();
  return crypto.createHash('sha256').update(lines.join('\n')).digest('hex');
}

const labelsBySlug = (
  labels: readonly EngineBenchmarkLabel[],
): Map<string, EngineBenchmarkLabel[]> => {
  const bySlug = new Map<string, EngineBenchmarkLabel[]>();
  for (const label of labels)
    bySlug.set(label.entityKey, [...(bySlug.get(label.entityKey) ?? []), label]);
  return bySlug;
};

/**
 * How many values the engine resolved that a frozen refusal already names as wrong, over
 * the population a refusal could have named. Same shape as the lane scorecard's ratio and
 * for the same reason (#3514): a value no label covers is unjudged, not correct, so the
 * ratio a reader wants is `knownWrong / labeledEntityResolved`.
 *
 * A refusal is keyed on the value, so this compares the resolved value's own refusal key
 * rather than the raw text: the two differ wherever the key folds a default document leaf.
 */
export function scoreEngineReplay(
  rows: readonly ReplayedRow[],
  labels: readonly EngineBenchmarkLabel[],
): EngineReplayScore {
  const bySlug = labelsBySlug(labels);
  const byField = new Map<string, EngineFieldScore>();
  const matchedLabels = new Set<string>();
  const tierRows = new Map<string, number>();
  const unfrozenReads = new Set<string>();
  let knownWrong = 0;
  let resolved = 0;
  let cleared = 0;
  let rowsWithIncompleteInput = 0;

  for (const row of rows) {
    if (row.unfrozenReads.length > 0) rowsWithIncompleteInput += 1;
    for (const read of row.unfrozenReads) unfrozenReads.add(read);
    tierRows.set(row.tier, (tierRows.get(row.tier) ?? 0) + 1);
    const applicable = bySlug.get(row.entityKey) ?? [];

    for (const [field, value] of Object.entries(row.plannedSet)) {
      if (ENGINE_FINGERPRINT_MASKED_FIELDS.has(field)) continue;
      const score = byField.get(field) ?? {
        field,
        resolved: 0,
        cleared: 0,
        labeledEntityResolved: 0,
        knownWrong: 0,
      };
      byField.set(field, score);
      score.resolved += 1;
      resolved += 1;
      const fieldLabels = applicable.filter((label) => label.field === field);
      if (fieldLabels.length === 0) continue;
      score.labeledEntityResolved += 1;
      const valueKey = fieldValueRefusalKey(field, value);
      const hits = fieldLabels.filter((label) => label.valueKey === valueKey);
      if (hits.length === 0) continue;
      score.knownWrong += 1;
      knownWrong += 1;
      for (const label of hits)
        matchedLabels.add(`${label.entityKey}|${label.field}|${label.valueKey}`);
    }

    for (const field of Object.keys(row.plannedUnset)) {
      if (ENGINE_FINGERPRINT_MASKED_FIELDS.has(field)) continue;
      const score = byField.get(field) ?? {
        field,
        resolved: 0,
        cleared: 0,
        labeledEntityResolved: 0,
        knownWrong: 0,
      };
      byField.set(field, score);
      score.cleared += 1;
      cleared += 1;
    }
  }

  return {
    rowsReplayed: rows.length,
    rowsWithIncompleteInput,
    unfrozenReads: [...unfrozenReads].sort(),
    resolved,
    cleared,
    knownWrong,
    labelsMatched: matchedLabels.size,
    labelCount: labels.length,
    outputFingerprint: engineOutputFingerprint(rows),
    byField: [...byField.values()].sort((a, b) => a.field.localeCompare(b.field)),
    gateTiers: [...tierRows.entries()]
      .map(([tier, count]) => ({ tier, rows: count }))
      .sort((a, b) => a.tier.localeCompare(b.tier)),
  };
}

export interface EngineFieldDelta {
  field: string;
  resolvedDelta: number;
  clearedDelta: number;
  knownWrongDelta: number;
}

export interface EngineSnapshotDelta {
  byField: EngineFieldDelta[];
  gateTiers: Array<{ tier: string; rowsDelta: number }>;
}

/**
 * How this replay's per-field and per-tier counts moved since the previous stored
 * snapshot (#3589).
 *
 * Counts, not rows, because a snapshot stores no row identifier: an entity key is a slug,
 * and a slug beside a defect judgement is the pairing the person-identifier convention
 * exists to prevent. So the stored trend answers "which field moved, and by how much",
 * and the operator who needs to know which rows moved re-runs the replay with
 * `diffEngineReplays`, which never leaves the process.
 */
export function diffEngineSnapshots(
  current: Pick<EngineReplayScore, 'byField' | 'gateTiers'>,
  previous: Pick<EngineReplayScore, 'byField' | 'gateTiers'> | null,
): EngineSnapshotDelta {
  const previousByField = new Map((previous?.byField ?? []).map((score) => [score.field, score]));
  const previousTiers = new Map(
    (previous?.gateTiers ?? []).map((entry) => [entry.tier, entry.rows]),
  );
  const fields = [
    ...new Set([
      ...current.byField.map((score) => score.field),
      ...(previous?.byField ?? []).map((score) => score.field),
    ]),
  ].sort();
  const currentByField = new Map(current.byField.map((score) => [score.field, score]));
  const tiers = [
    ...new Set([
      ...current.gateTiers.map((entry) => entry.tier),
      ...(previous?.gateTiers ?? []).map((entry) => entry.tier),
    ]),
  ].sort();
  const currentTiers = new Map(current.gateTiers.map((entry) => [entry.tier, entry.rows]));
  return {
    byField: fields.map((field) => {
      const after = currentByField.get(field);
      const before = previousByField.get(field);
      return {
        field,
        resolvedDelta: (after?.resolved ?? 0) - (before?.resolved ?? 0),
        clearedDelta: (after?.cleared ?? 0) - (before?.cleared ?? 0),
        knownWrongDelta: (after?.knownWrong ?? 0) - (before?.knownWrong ?? 0),
      };
    }),
    gateTiers: tiers.map((tier) => ({
      tier,
      rowsDelta: (currentTiers.get(tier) ?? 0) - (previousTiers.get(tier) ?? 0),
    })),
  };
}

const rowFieldValues = (row: ReplayedRow): Map<string, string> => {
  const values = new Map<string, string>();
  for (const [field, value] of Object.entries(row.plannedSet)) {
    if (ENGINE_FINGERPRINT_MASKED_FIELDS.has(field)) continue;
    values.set(field, JSON.stringify(stableValue(value)));
  }
  for (const field of Object.keys(row.plannedUnset)) {
    if (ENGINE_FINGERPRINT_MASKED_FIELDS.has(field)) continue;
    values.set(field, '\u0000cleared');
  }
  return values;
};

export interface EngineReplayDiff {
  rowsChangedFromPrevious: number;
  gateTierChangedFromPrevious: number;
  byField: Array<{ field: string; changedFromPrevious: number }>;
}

/**
 * Where one replay differs from another, per field and per gate verdict.
 *
 * Both replays are in memory, so this is the instrument for the determinism check: when
 * two replays of unchanged code disagree, this says which field disagreed, which is the
 * difference between "the engine reads something unfrozen" and a usable bug report. It
 * never reaches a stored snapshot, because it is keyed by entity key.
 *
 * A row the other replay did not cover counts as unchanged rather than as a difference: a
 * benchmark that grew reports its new rows as new, and counting them as regressions would
 * make every capture look like one.
 */
export function diffEngineReplays(
  current: readonly ReplayedRow[],
  previous: readonly ReplayedRow[],
): EngineReplayDiff {
  const previousByKey = new Map(previous.map((row) => [row.entityKey, row]));
  const changedByField = new Map<string, number>();
  let rowsChanged = 0;
  let gateChanged = 0;

  for (const row of current) {
    const before = previousByKey.get(row.entityKey);
    if (!before) continue;
    const beforeValues = rowFieldValues(before);
    const afterValues = rowFieldValues(row);
    let rowChanged = false;
    for (const field of new Set([...beforeValues.keys(), ...afterValues.keys()])) {
      if (beforeValues.get(field) === afterValues.get(field)) continue;
      rowChanged = true;
      changedByField.set(field, (changedByField.get(field) ?? 0) + 1);
    }
    if (before.tier !== row.tier || before.computedTier !== row.computedTier) {
      gateChanged += 1;
      rowChanged = true;
    }
    if (rowChanged) rowsChanged += 1;
  }

  return {
    rowsChangedFromPrevious: rowsChanged,
    gateTierChangedFromPrevious: gateChanged,
    byField: [...changedByField.entries()]
      .map(([field, changedFromPrevious]) => ({ field, changedFromPrevious }))
      .sort((a, b) => a.field.localeCompare(b.field)),
  };
}

/**
 * The refusal labels a captured row already carries, as scoring labels. Read off the
 * stored document rather than recomputed, because a refusal is the operator's judgement
 * and the benchmark's job is to hold it still, not to re-derive it.
 */
export function labelsFromCapturedRows(
  rows: readonly { entityKey?: string; entityDoc?: Record<string, unknown> | null }[],
): EngineBenchmarkLabel[] {
  const labels: EngineBenchmarkLabel[] = [];
  for (const row of rows) {
    const entityKey = row.entityKey ?? '';
    if (!entityKey) continue;
    const container = row.entityDoc?.[FIELD_VALUE_REFUSALS_PATH];
    if (!container || typeof container !== 'object') continue;
    const fields =
      container instanceof Map ? [...container.keys()] : Object.keys(container as object);
    for (const field of fields) {
      for (const refusal of liveFieldValueRefusals(container, String(field))) {
        labels.push({
          entityKey,
          field: String(field),
          valueKey: refusal.valueKey,
          rule: String(refusal.rule),
        });
      }
    }
  }
  return labels;
}

import crypto from 'crypto';
import type { ObservedEntityType } from '../models/observation';
import { isRefusedObservationField } from '../scrapers/observationFieldSanitizer';
import {
  observationAssertsRefusedValue,
  refusalLaneEvidenceFields,
} from '../utils/researchEntityFieldValueRefusals';

export interface BenchmarkLabel {
  entityKey: string;
  field: string;
  valueKey: string;
  rule: string;
}

export interface PlannedObservation {
  entityType?: unknown;
  entityKey?: unknown;
  entityId?: unknown;
  field?: unknown;
  value?: unknown;
}

export interface FieldScore {
  field: string;
  emitted: number;
  labeledEntityEmitted: number;
  knownWrong: number;
}

export interface LaneReplayScore {
  emitted: number;
  refusedAtIngest: number;
  knownWrong: number;
  labelsMatched: number;
  labelCount: number;
  outputFingerprint: string;
  byField: FieldScore[];
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const idText = (value: unknown): string =>
  value === undefined || value === null ? '' : String(value).trim();

function labelsBySlug(labels: readonly BenchmarkLabel[]): Map<string, BenchmarkLabel[]> {
  const bySlug = new Map<string, BenchmarkLabel[]>();
  for (const label of labels)
    bySlug.set(label.entityKey, [...(bySlug.get(label.entityKey) ?? []), label]);
  return bySlug;
}

const LANE_STAMPED_INSTANT_KEY = 'readAt';

const withoutWallClock = (key: string, value: unknown): unknown =>
  key === LANE_STAMPED_INSTANT_KEY ? 'instant' : value;

/**
 * Order-independent, so a lane that emits the same values in a different order replays to
 * the same fingerprint, and any change in what it emits changes it. A `readAt` key is
 * masked because it is the moment the lane read the page, as in the roster health record's
 * `read.readAt`, and that clock would make every replay differ. Any other date, including a
 * page-stated one serialized as a full instant, still counts.
 */
export function plannedOutputFingerprint(
  observations: readonly PlannedObservation[],
  runClockFields: ReadonlySet<string> = new Set(),
): string {
  const lines = observations
    .map((observation) =>
      JSON.stringify(
        [
          text(observation.entityType),
          text(observation.entityKey) || idText(observation.entityId),
          text(observation.field),
          runClockFields.has(text(observation.field)) ? 'instant' : (observation.value ?? null),
        ],
        withoutWallClock,
      ),
    )
    .sort();
  return crypto.createHash('sha256').update(lines.join('\n')).digest('hex');
}

/**
 * How many of a lane's planned values a frozen refusal already names as wrong, over the
 * population a refusal could have named. A value no label covers is unjudged, so the ratio
 * a reader wants is `knownWrong / labeledEntityEmitted`, never `1 - knownWrong / emitted`.
 */
export function scoreLaneReplay(
  observations: readonly PlannedObservation[],
  labels: readonly BenchmarkLabel[],
  slugByEntityId: ReadonlyMap<string, string> = new Map(),
  runClockFields: ReadonlySet<string> = new Set(),
): LaneReplayScore {
  const bySlug = labelsBySlug(labels);
  const byField = new Map<string, FieldScore>();
  const matchedLabels = new Set<string>();
  let knownWrong = 0;
  let refusedAtIngest = 0;

  for (const observation of observations) {
    const field = text(observation.field);
    if (!field) continue;
    if (isRefusedObservationField(text(observation.entityType) as ObservedEntityType, field)) {
      refusedAtIngest += 1;
      continue;
    }
    const score = byField.get(field) ?? {
      field,
      emitted: 0,
      labeledEntityEmitted: 0,
      knownWrong: 0,
    };
    byField.set(field, score);
    score.emitted += 1;
    if (text(observation.entityType) !== 'researchEntity') continue;
    const slug =
      text(observation.entityKey) || slugByEntityId.get(idText(observation.entityId)) || '';
    const applicable = (bySlug.get(slug) ?? []).filter((label) =>
      refusalLaneEvidenceFields(label.field).includes(field),
    );
    if (applicable.length === 0) continue;
    score.labeledEntityEmitted += 1;
    const hits = applicable.filter((label) =>
      observationAssertsRefusedValue(label.field, label.valueKey, observation),
    );
    if (hits.length === 0) continue;
    score.knownWrong += 1;
    knownWrong += 1;
    for (const label of hits)
      matchedLabels.add(`${label.entityKey}|${label.field}|${label.valueKey}`);
  }

  return {
    emitted: observations.length - refusedAtIngest,
    refusedAtIngest,
    knownWrong,
    labelsMatched: matchedLabels.size,
    labelCount: labels.length,
    outputFingerprint: plannedOutputFingerprint(observations, runClockFields),
    byField: [...byField.values()].sort((a, b) => a.field.localeCompare(b.field)),
  };
}

export interface CountSpread {
  min: number;
  max: number;
  mean: number;
}

export interface LiveModelSpread {
  runs: number;
  distinctFingerprints: number;
  emitted: CountSpread;
  knownWrong: CountSpread;
  byField: Array<{ field: string; emitted: CountSpread; knownWrong: CountSpread }>;
}

const spreadOf = (counts: readonly number[]): CountSpread => ({
  min: Math.min(...counts),
  max: Math.max(...counts),
  mean: counts.reduce((sum, count) => sum + count, 0) / counts.length,
});

/**
 * The noise band of a lane whose model is called live, over repeated replays of the same
 * frozen pages. A field absent from a run counts as zero there, so a field one run emits and
 * another does not widens the band instead of vanishing from it.
 */
export function summarizeLiveModelRuns(scores: readonly LaneReplayScore[]): LiveModelSpread {
  if (scores.length === 0) throw new Error('a live-model spread needs at least one run');
  const fields = [...new Set(scores.flatMap((score) => score.byField.map((f) => f.field)))].sort();
  const fieldCount = (score: LaneReplayScore, field: string, key: 'emitted' | 'knownWrong') =>
    score.byField.find((entry) => entry.field === field)?.[key] ?? 0;
  return {
    runs: scores.length,
    distinctFingerprints: new Set(scores.map((score) => score.outputFingerprint)).size,
    emitted: spreadOf(scores.map((score) => score.emitted)),
    knownWrong: spreadOf(scores.map((score) => score.knownWrong)),
    byField: fields.map((field) => ({
      field,
      emitted: spreadOf(scores.map((score) => fieldCount(score, field, 'emitted'))),
      knownWrong: spreadOf(scores.map((score) => fieldCount(score, field, 'knownWrong'))),
    })),
  };
}

export interface GoldLabel {
  entityKey: string;
  field: string;
  expected: 'present' | 'absent';
  acceptable?: string[];
  judgedPageUrl?: string;
  note?: string;
}

export interface GoldFieldScore {
  field: string;
  labeled: number;
  truePositive: number;
  falsePositive: number;
  falseNegative: number;
  trueNegative: number;
  precision: number | null;
  recall: number | null;
}

const MIN_CONTAINED_QUOTE_CHARS = 20;

const normalizedGoldText = (value: string): string =>
  value
    .replace(/\[(?:email|phone) redacted\]/gi, ' ')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

/**
 * The comparable part of a planned value: an access verdict is judged on the verdict alone,
 * because the quote beside it is judged under its own field.
 */
export function goldValueKey(field: string, value: unknown): string {
  if (field === 'undergradAccessEvidence' && value && typeof value === 'object') {
    return normalizedGoldText(
      String((value as { openToUndergrads?: unknown }).openToUndergrads ?? ''),
    );
  }
  if (typeof value === 'string') return normalizedGoldText(value);
  return normalizedGoldText(JSON.stringify(value ?? null));
}

/**
 * A planned value matches an acceptable one when either contains the other, so a quote the
 * lane trims to a clause of a judged sentence still counts, but a fragment too short to carry
 * a claim does not.
 */
export function goldValueMatches(emitted: string, acceptable: readonly string[]): boolean {
  return acceptable.some((candidate) => {
    const judged = normalizedGoldText(candidate);
    if (!judged || !emitted) return false;
    if (emitted === judged || emitted.includes(judged)) return true;
    return emitted.length >= MIN_CONTAINED_QUOTE_CHARS && judged.includes(emitted);
  });
}

/**
 * Precision and recall against hand-judged labels, per field (#3588). Each label is one
 * `(entityKey, field)` judged against the frozen benchmark page: `absent` means the lane
 * should emit nothing, `present` lists the values a reader accepted. An emission on an
 * unlabeled pair is unjudged and counted nowhere, per #3514.
 */
export function scoreGoldLabels(
  observations: readonly PlannedObservation[],
  goldLabels: readonly GoldLabel[],
  slugByEntityId: ReadonlyMap<string, string> = new Map(),
): GoldFieldScore[] {
  const emittedByPair = new Map<string, string[]>();
  for (const observation of observations) {
    const field = text(observation.field);
    if (!field || text(observation.entityType) !== 'researchEntity') continue;
    if (isRefusedObservationField('researchEntity', field)) continue;
    const slug =
      text(observation.entityKey) || slugByEntityId.get(idText(observation.entityId)) || '';
    const key = `${slug}\u0000${field}`;
    emittedByPair.set(key, [
      ...(emittedByPair.get(key) ?? []),
      goldValueKey(field, observation.value),
    ]);
  }

  const byField = new Map<string, GoldFieldScore>();
  for (const label of goldLabels) {
    const score = byField.get(label.field) ?? {
      field: label.field,
      labeled: 0,
      truePositive: 0,
      falsePositive: 0,
      falseNegative: 0,
      trueNegative: 0,
      precision: null,
      recall: null,
    };
    byField.set(label.field, score);
    score.labeled += 1;
    const emitted = (emittedByPair.get(`${label.entityKey}\u0000${label.field}`) ?? []).filter(
      Boolean,
    );
    if (label.expected === 'absent') {
      if (emitted.length > 0) score.falsePositive += 1;
      else score.trueNegative += 1;
      continue;
    }
    if (emitted.length === 0) score.falseNegative += 1;
    else if (emitted.some((value) => goldValueMatches(value, label.acceptable ?? [])))
      score.truePositive += 1;
    else score.falsePositive += 1;
  }

  for (const score of byField.values()) {
    const claimed = score.truePositive + score.falsePositive;
    const expected = score.truePositive + score.falseNegative;
    score.precision = claimed > 0 ? score.truePositive / claimed : null;
    score.recall = expected > 0 ? score.truePositive / expected : null;
  }
  return [...byField.values()].sort((a, b) => a.field.localeCompare(b.field));
}

export interface GoldRateSpread {
  field: string;
  precision: CountSpread | null;
  recall: CountSpread | null;
}

/** The live-model band of precision and recall, over the runs where the rate was defined. */
export function summarizeGoldRuns(runs: readonly GoldFieldScore[][]): GoldRateSpread[] {
  const fields = [...new Set(runs.flatMap((run) => run.map((score) => score.field)))].sort();
  const rates = (field: string, key: 'precision' | 'recall') =>
    runs
      .map((run) => run.find((score) => score.field === field)?.[key])
      .filter((rate): rate is number => typeof rate === 'number');
  return fields.map((field) => {
    const precision = rates(field, 'precision');
    const recall = rates(field, 'recall');
    return {
      field,
      precision: precision.length > 0 ? spreadOf(precision) : null,
      recall: recall.length > 0 ? spreadOf(recall) : null,
    };
  });
}

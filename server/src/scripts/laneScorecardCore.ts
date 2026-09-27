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

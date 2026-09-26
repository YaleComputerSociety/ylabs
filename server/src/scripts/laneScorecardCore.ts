import crypto from 'crypto';
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

/**
 * Order-independent, so a lane that emits the same values in a different order replays to
 * the same fingerprint, and any change in what it emits changes it.
 */
export function plannedOutputFingerprint(observations: readonly PlannedObservation[]): string {
  const lines = observations
    .map((observation) =>
      JSON.stringify([
        text(observation.entityType),
        text(observation.entityKey) || idText(observation.entityId),
        text(observation.field),
        observation.value ?? null,
      ]),
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
): LaneReplayScore {
  const bySlug = labelsBySlug(labels);
  const byField = new Map<string, FieldScore>();
  const matchedLabels = new Set<string>();
  let knownWrong = 0;

  for (const observation of observations) {
    const field = text(observation.field);
    if (!field) continue;
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
    emitted: observations.length,
    knownWrong,
    labelsMatched: matchedLabels.size,
    labelCount: labels.length,
    outputFingerprint: plannedOutputFingerprint(observations),
    byField: [...byField.values()].sort((a, b) => a.field.localeCompare(b.field)),
  };
}

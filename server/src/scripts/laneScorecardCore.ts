import crypto from 'crypto';
import type { ObservedEntityType } from '../models/observation';
import { classificationFromObservedFacts } from '../scrapers/fellowshipClassificationDerivation';
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

export type GoldComparison = 'text' | 'url' | 'set' | 'deadline' | 'exact';

const GOLD_SCORED_ENTITY_TYPES: ReadonlySet<string> = new Set(['researchEntity', 'fellowship']);

const FELLOWSHIP_GOLD_COMPARISONS: ReadonlyMap<string, GoldComparison> = new Map([
  ['applicationLink', 'url'],
  ['deadline', 'deadline'],
  ['yearOfStudy', 'set'],
  ['termOfAward', 'set'],
  ['purpose', 'set'],
  ['requiresMentorBeforeApply', 'exact'],
  ['entryMode', 'exact'],
]);

/**
 * No lane emits these: the materializer derives them from a fellowship's observed facts
 * with the program classifier, so a gold label on one is scored on that derivation.
 */
const CLASSIFIER_DERIVED_GOLD_FIELDS: ReadonlySet<string> = new Set([
  'requiresMentorBeforeApply',
  'entryMode',
]);

export function goldComparisonFor(entityType: string, field: string): GoldComparison {
  if (entityType !== 'fellowship') return 'text';
  return FELLOWSHIP_GOLD_COMPARISONS.get(field) ?? 'text';
}

export interface GoldEmission {
  entityType: string;
  entityKey: string;
  field: string;
  value: unknown;
}

export function normalizedGoldUrl(value: string): string {
  const trimmed = value.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return trimmed;
  }
  const protocol = parsed.protocol === 'http:' ? 'https:' : parsed.protocol;
  const pathname = parsed.pathname.replace(/\/+$/, '');
  return `${protocol}//${parsed.host.toLowerCase()}${pathname}${parsed.search}`;
}

function goldSetKey(values: readonly unknown[]): string | undefined {
  if (!values.every((item) => typeof item === 'string')) return undefined;
  const items = (values as string[]).map(normalizedGoldText);
  return JSON.stringify([...new Set(items)].sort());
}

function parsedJsonArray(value: string): unknown[] | undefined {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function emittedGoldSetKey(value: unknown): string | undefined {
  if (Array.isArray(value)) return goldSetKey(value);
  if (typeof value !== 'string') return undefined;
  return goldSetKey(parsedJsonArray(value) ?? [value]);
}

function acceptableGoldSetKey(candidate: string): string | undefined {
  const values = parsedJsonArray(candidate);
  return values ? goldSetKey(values) : undefined;
}

const NEW_YORK_MINUTE_FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export function newYorkMinute(value: unknown): string | undefined {
  const date =
    value instanceof Date
      ? value
      : typeof value === 'string' || typeof value === 'number'
        ? new Date(value)
        : undefined;
  if (!date || !Number.isFinite(date.getTime())) return undefined;
  const parts = Object.fromEntries(
    NEW_YORK_MINUTE_FORMAT.formatToParts(date).map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

const DATE_ONLY_LABEL = /^\d{4}-\d{2}-\d{2}$/;
const NEW_YORK_MINUTE_LABEL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

function deadlineMatches(value: unknown, candidate: string): boolean {
  const emitted = newYorkMinute(value);
  const judged = candidate.trim();
  if (!emitted) return false;
  if (DATE_ONLY_LABEL.test(judged)) return emitted.slice(0, 10) === judged;
  if (NEW_YORK_MINUTE_LABEL.test(judged)) return emitted === judged;
  return false;
}

const exactGoldText = (value: unknown): string | undefined =>
  typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number'
    ? String(value).trim()
    : undefined;

function isEmittedGoldValue(emission: GoldEmission): boolean {
  const { entityType, field, value } = emission;
  if (goldComparisonFor(entityType, field) === 'text') return Boolean(goldValueKey(field, value));
  if (value === undefined || value === null || value === '') return false;
  return !(Array.isArray(value) && value.length === 0);
}

/**
 * Text fields keep containment, because a judged sentence and a lane's trimmed clause of it
 * are the same claim. Structured fellowship fields compare by their own kind, since a date,
 * a URL or a set contained in another is a different value, not a shorter quote of it.
 */
export function goldEmissionMatches(
  emission: Omit<GoldEmission, 'entityKey'>,
  acceptable: readonly string[],
): boolean {
  const { entityType, field, value } = emission;
  switch (goldComparisonFor(entityType, field)) {
    case 'url':
      return (
        typeof value === 'string' &&
        acceptable.some((candidate) => normalizedGoldUrl(candidate) === normalizedGoldUrl(value))
      );
    case 'set': {
      const emitted = emittedGoldSetKey(value);
      return (
        emitted !== undefined &&
        acceptable.some((candidate) => acceptableGoldSetKey(candidate) === emitted)
      );
    }
    case 'deadline':
      return acceptable.some((candidate) => deadlineMatches(value, candidate));
    case 'exact': {
      const emitted = exactGoldText(value);
      return emitted !== undefined && acceptable.some((candidate) => candidate.trim() === emitted);
    }
    default:
      return goldValueMatches(goldValueKey(field, value), acceptable);
  }
}

export function derivedFellowshipClassifierEmissions(
  factsByEntityKey: ReadonlyMap<string, ReadonlyArray<{ field: string; value?: unknown }>>,
): GoldEmission[] {
  const emissions: GoldEmission[] = [];
  for (const [entityKey, facts] of factsByEntityKey) {
    if (facts.length === 0) continue;
    const classification = classificationFromObservedFacts(facts) as unknown as Record<
      string,
      unknown
    >;
    for (const field of CLASSIFIER_DERIVED_GOLD_FIELDS) {
      const value = classification[field];
      if (value !== undefined)
        emissions.push({ entityType: 'fellowship', entityKey, field, value });
    }
  }
  return emissions;
}

/**
 * Precision and recall against hand-judged labels, per field (#3588). Each label is one
 * `(entityKey, field)` judged against the frozen benchmark page: `absent` means the lane
 * should emit nothing, `present` lists the values a reader accepted. A wrong value on a
 * `present` pair is both a false positive and a false negative, so recall is over every
 * `present` label. An emission on an unlabeled pair is unjudged and counted nowhere, per #3514.
 */
export function scoreGoldLabels(
  observations: readonly PlannedObservation[],
  goldLabels: readonly GoldLabel[],
  slugByEntityId: ReadonlyMap<string, string> = new Map(),
): GoldFieldScore[] {
  const emittedByPair = new Map<string, GoldEmission[]>();
  const record = (emission: GoldEmission) => {
    if (!isEmittedGoldValue(emission)) return;
    const key = `${emission.entityKey}\u0000${emission.field}`;
    emittedByPair.set(key, [...(emittedByPair.get(key) ?? []), emission]);
  };
  const fellowshipFacts = new Map<string, Array<{ field: string; value?: unknown }>>();
  for (const observation of observations) {
    const field = text(observation.field);
    const entityType = text(observation.entityType);
    if (!field || !GOLD_SCORED_ENTITY_TYPES.has(entityType)) continue;
    if (isRefusedObservationField(entityType as ObservedEntityType, field)) continue;
    const entityKey =
      text(observation.entityKey) || slugByEntityId.get(idText(observation.entityId)) || '';
    if (entityType === 'fellowship') {
      fellowshipFacts.set(entityKey, [
        ...(fellowshipFacts.get(entityKey) ?? []),
        { field, value: observation.value },
      ]);
      if (CLASSIFIER_DERIVED_GOLD_FIELDS.has(field)) continue;
    }
    record({ entityType, entityKey, field, value: observation.value });
  }
  for (const emission of derivedFellowshipClassifierEmissions(fellowshipFacts)) record(emission);

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
    const emitted = emittedByPair.get(`${label.entityKey}\u0000${label.field}`) ?? [];
    if (label.expected === 'absent') {
      if (emitted.length > 0) score.falsePositive += 1;
      else score.trueNegative += 1;
      continue;
    }
    if (emitted.some((emission) => goldEmissionMatches(emission, label.acceptable ?? []))) {
      score.truePositive += 1;
      continue;
    }
    score.falseNegative += 1;
    if (emitted.length > 0) score.falsePositive += 1;
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

export interface ReplayMissBaselineInput {
  unfrozenRequestCount?: unknown;
  codeSha?: unknown;
}

export interface StoredReplayRun {
  codeSha?: unknown;
  pagesMissed?: unknown;
  measuredAt?: unknown;
}

const measuredTime = (value: unknown): number => {
  const time = value instanceof Date ? value.getTime() : new Date(String(value ?? '')).getTime();
  return Number.isFinite(time) ? time : Number.POSITIVE_INFINITY;
};

/**
 * How many requests a replay of this benchmark may miss and still be a score. A capture that
 * recorded its unfrozen requests says so directly; an older one falls back to the first replay
 * taken at its own capture commit, which is the only replay known to have measured the same
 * code against the same pages. With neither, no miss can be explained.
 */
export function allowedReplayMisses(
  benchmark: ReplayMissBaselineInput,
  runs: readonly StoredReplayRun[],
): number | undefined {
  if (typeof benchmark.unfrozenRequestCount === 'number') return benchmark.unfrozenRequestCount;
  const captureSha = typeof benchmark.codeSha === 'string' ? benchmark.codeSha : '';
  if (!captureSha) return undefined;
  const baseline = [...runs]
    .filter((run) => run.codeSha === captureSha && typeof run.pagesMissed === 'number')
    .sort((a, b) => measuredTime(a.measuredAt) - measuredTime(b.measuredAt))[0];
  return baseline ? (baseline.pagesMissed as number) : undefined;
}

/**
 * Why a replay is not a score of the lane, if it is not. Missing more than the capture left
 * unfrozen means the lane asked for something the benchmark never held, most often a changed
 * prompt whose model requests no longer match the frozen answers, so the replay measured the
 * gap rather than the lane (#3816).
 */
export function staleReplayReason(
  pagesMissed: number,
  allowedMisses: number | undefined,
): string | undefined {
  if (allowedMisses === undefined) {
    return pagesMissed > 0
      ? `replay missed ${pagesMissed} request(s) and the benchmark records no clean baseline; recapture it`
      : undefined;
  }
  return pagesMissed > allowedMisses
    ? `replay missed ${pagesMissed} request(s) where the capture left ${allowedMisses} unfrozen; the lane now asks for something this benchmark never held, so recapture it`
    : undefined;
}

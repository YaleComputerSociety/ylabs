/**
 * Plans the retirement of live observations written by a lane config that exists on no git
 * ref (#5807). Such a config never landed, so no run of today's code reads its pages again,
 * and nothing supersedes or retracts what it wrote.
 *
 * A config is orphaned only when its id is absent from the code's current config set AND no
 * ref tip in any scanned repository defines it. A config that is merely suspended, unread or
 * waiting on an unmerged branch is present in one of those places and retracts nothing: "not
 * run recently" never counts.
 *
 * An observation is attributed to an orphaned config by evidence the run left behind, never by
 * age: its entity key carries the config's key namespace, or its run selected only orphaned
 * configs with `--only`. A key that a current namespace also prefixes is ambiguous, so it needs
 * the run's `--only` to attribute it. Either way the run must have recorded no `codeSha`: a
 * recorded commit missing from a stale clone is not proof the code never landed.
 */

export interface OrphanLaneDefinition {
  sourceName: string;
  currentConfigIds: readonly string[];
  currentKeyNamespaces: readonly string[];
  keyNamespaceOf?: (configId: string) => string;
}

export interface RequestedLaneConfig {
  sourceName: string;
  configId: string;
}

export interface LaneConfigRefPresence {
  sourceName: string;
  configId: string;
  refs: string[];
}

export type LaneConfigVerdict =
  | { status: 'orphaned' }
  | { status: 'present-in-code' }
  | { status: 'present-on-ref'; refs: string[] }
  | { status: 'unknown-lane' };

export interface StoredLaneObservation {
  id: string;
  sourceName: string;
  entityType: string;
  entityKey?: string;
  entityId?: string;
  field: string;
  value?: unknown;
  scrapeRunId?: string;
}

export interface StoredLaneRun {
  id: string;
  codeSha?: string;
  only: string[];
}

export type AttributionBasis = 'key-namespace' | 'run-only';

export interface AttributedObservation {
  observation: StoredLaneObservation;
  configId: string;
  basis: AttributionBasis;
}

export type HeldReason = 'run-recorded-code' | 'no-run';

export interface HeldObservation {
  observation: StoredLaneObservation;
  configId: string;
  reason: HeldReason;
}

export interface OrphanedLaneConfigCounts {
  observations: number;
  byEntityType: Record<string, number>;
  byField: Record<string, number>;
  byBasis: Record<string, number>;
  held: Record<string, number>;
}

export interface OrphanedLaneConfigPlan {
  verdicts: Array<RequestedLaneConfig & { verdict: LaneConfigVerdict }>;
  attributed: AttributedObservation[];
  held: HeldObservation[];
  countsByConfig: Record<string, OrphanedLaneConfigCounts>;
  observationIdsToRetire: string[];
}

export const LANE_CONFIG_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export const laneConfigLabel = (config: RequestedLaneConfig): string =>
  `${config.sourceName}:${config.configId}`;

export function parseRequestedLaneConfigs(value: string): RequestedLaneConfig[] {
  const entries = value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (entries.length === 0) throw new Error('--configs needs at least one <lane>:<config-id>');
  const seen = new Set<string>();
  const configs: RequestedLaneConfig[] = [];
  for (const entry of entries) {
    const separator = entry.lastIndexOf(':');
    const sourceName = separator > 0 ? entry.slice(0, separator).trim() : '';
    const configId =
      separator > 0
        ? entry
            .slice(separator + 1)
            .trim()
            .toLowerCase()
        : '';
    if (!sourceName || !LANE_CONFIG_ID_PATTERN.test(configId)) {
      throw new Error(`--configs entry ${JSON.stringify(entry)} is not <lane>:<config-id>`);
    }
    const label = laneConfigLabel({ sourceName, configId });
    if (seen.has(label)) continue;
    seen.add(label);
    configs.push({ sourceName, configId });
  }
  return configs;
}

/**
 * The git pattern a config definition matches on any branch: the id as the value of a
 * `deptKey`, `key` or `id` property. Kept broad on purpose, because a false match only keeps
 * a config alive, while a missed definition would retire evidence a real lane still owns.
 */
export function laneConfigDefinitionPattern(configId: string): RegExp {
  if (!LANE_CONFIG_ID_PATTERN.test(configId)) {
    throw new Error(`config id ${JSON.stringify(configId)} is not a plain lane config id`);
  }
  return new RegExp(`(^|[^A-Za-z0-9_])(deptKey|key|id)['"]?\\s*:\\s*['"\`]${configId}['"\`]`);
}

export const laneConfigIdLiterals = (configId: string): string[] =>
  ["'", '"', '`'].map((quote) => `${quote}${configId}${quote}`);

export function judgeLaneConfig(input: {
  config: RequestedLaneConfig;
  lanes: readonly OrphanLaneDefinition[];
  refPresence: readonly LaneConfigRefPresence[];
}): LaneConfigVerdict {
  const lane = input.lanes.find((candidate) => candidate.sourceName === input.config.sourceName);
  if (!lane) return { status: 'unknown-lane' };
  const configId = input.config.configId;
  if (lane.currentConfigIds.some((id) => id.toLowerCase() === configId)) {
    return { status: 'present-in-code' };
  }
  const namespace = lane.keyNamespaceOf?.(configId);
  if (namespace && lane.currentKeyNamespaces.includes(namespace)) {
    return { status: 'present-in-code' };
  }
  const refs = input.refPresence
    .filter(
      (presence) =>
        presence.sourceName === input.config.sourceName && presence.configId === configId,
    )
    .flatMap((presence) => presence.refs);
  if (refs.length > 0) return { status: 'present-on-ref', refs: [...new Set(refs)].sort() };
  return { status: 'orphaned' };
}

const KEY_NAMESPACE_PREFIX = { researchEntity: 'dept-', other: 'dept:' } as const;

/**
 * The namespace an entity key was minted under, chosen as the LONGEST namespace among the
 * lane's current ones and the orphaned ones that prefixes the key. Longest wins so a current
 * `yse` namespace never claims a `dept-yse-environment-...` key, and an orphaned namespace never
 * claims a key a longer current namespace minted.
 */
export function keyNamespaceForEntityKey(
  entityType: string,
  entityKey: string | undefined,
  namespaces: Iterable<string>,
): string | undefined {
  if (!entityKey) return undefined;
  const isResearchEntity = entityType === 'researchEntity' || entityType === 'researchGroup';
  const prefix = isResearchEntity
    ? KEY_NAMESPACE_PREFIX.researchEntity
    : KEY_NAMESPACE_PREFIX.other;
  const separator = isResearchEntity ? '-' : ':';
  if (!entityKey.startsWith(prefix)) return undefined;
  const rest = entityKey.slice(prefix.length);
  let best: string | undefined;
  for (const namespace of namespaces) {
    if (!rest.startsWith(`${namespace}${separator}`)) continue;
    if (!best || namespace.length > best.length) best = namespace;
  }
  return best;
}

const emptyCounts = (): OrphanedLaneConfigCounts => ({
  observations: 0,
  byEntityType: {},
  byField: {},
  byBasis: {},
  held: {},
});

const bump = (tally: Record<string, number>, key: string) => {
  tally[key] = (tally[key] ?? 0) + 1;
};

export function planOrphanedLaneConfigRetirement(input: {
  requested: readonly RequestedLaneConfig[];
  lanes: readonly OrphanLaneDefinition[];
  refPresence: readonly LaneConfigRefPresence[];
  observations: readonly StoredLaneObservation[];
  runs: readonly StoredLaneRun[];
}): OrphanedLaneConfigPlan {
  const verdicts = input.requested.map((config) => ({
    ...config,
    verdict: judgeLaneConfig({ config, lanes: input.lanes, refPresence: input.refPresence }),
  }));
  const orphanedByLane = new Map<string, Set<string>>();
  for (const entry of verdicts) {
    if (entry.verdict.status !== 'orphaned') continue;
    const ids = orphanedByLane.get(entry.sourceName) ?? new Set<string>();
    ids.add(entry.configId);
    orphanedByLane.set(entry.sourceName, ids);
  }
  const runsById = new Map(input.runs.map((run) => [run.id, run]));
  const laneBySource = new Map(input.lanes.map((lane) => [lane.sourceName, lane]));

  const countsByConfig: Record<string, OrphanedLaneConfigCounts> = {};
  for (const entry of verdicts) {
    if (entry.verdict.status === 'orphaned') countsByConfig[laneConfigLabel(entry)] = emptyCounts();
  }

  const attributed: AttributedObservation[] = [];
  const held: HeldObservation[] = [];
  for (const observation of input.observations) {
    const orphaned = orphanedByLane.get(observation.sourceName);
    const lane = laneBySource.get(observation.sourceName);
    if (!orphaned || !lane) continue;
    const attribution = attributeObservation(observation, lane, orphaned, runsById);
    if (!attribution) continue;
    const counts =
      countsByConfig[
        laneConfigLabel({ sourceName: lane.sourceName, configId: attribution.configId })
      ];
    const run = observation.scrapeRunId ? runsById.get(observation.scrapeRunId) : undefined;
    const heldReason: HeldReason | undefined = !run
      ? 'no-run'
      : run.codeSha
        ? 'run-recorded-code'
        : undefined;
    if (heldReason) {
      held.push({ observation, configId: attribution.configId, reason: heldReason });
      bump(counts.held, heldReason);
      continue;
    }
    attributed.push({ observation, ...attribution });
    counts.observations += 1;
    bump(counts.byEntityType, observation.entityType);
    bump(counts.byField, `${observation.entityType}.${observation.field}`);
    bump(counts.byBasis, attribution.basis);
  }

  return {
    verdicts,
    attributed,
    held,
    countsByConfig,
    observationIdsToRetire: [...new Set(attributed.map((entry) => entry.observation.id))].sort(),
  };
}

function attributeObservation(
  observation: StoredLaneObservation,
  lane: OrphanLaneDefinition,
  orphaned: ReadonlySet<string>,
  runsById: ReadonlyMap<string, StoredLaneRun>,
): { configId: string; basis: AttributionBasis } | undefined {
  if (lane.keyNamespaceOf) {
    const orphanedNamespaces = new Map<string, string>();
    for (const configId of orphaned)
      orphanedNamespaces.set(lane.keyNamespaceOf(configId), configId);
    const currentNamespace = keyNamespaceForEntityKey(
      observation.entityType,
      observation.entityKey,
      lane.currentKeyNamespaces,
    );
    const namespace = keyNamespaceForEntityKey(observation.entityType, observation.entityKey, [
      ...lane.currentKeyNamespaces,
      ...orphanedNamespaces.keys(),
    ]);
    if (namespace !== undefined && namespace === currentNamespace) return undefined;
    const configId = namespace === undefined ? undefined : orphanedNamespaces.get(namespace);
    if (configId && currentNamespace === undefined) return { configId, basis: 'key-namespace' };
  }
  const run = observation.scrapeRunId ? runsById.get(observation.scrapeRunId) : undefined;
  if (!run || run.only.length === 0) return undefined;
  if (!run.only.every((configId) => orphaned.has(configId))) return undefined;
  return { configId: [...run.only].sort()[0], basis: 'run-only' };
}

export function runOnlySelection(options: unknown): string[] {
  const only = (options as { only?: unknown } | null | undefined)?.only;
  const values = Array.isArray(only) ? only : typeof only === 'string' ? only.split(',') : [];
  return [
    ...new Set(
      values
        .map((value) =>
          String(value ?? '')
            .trim()
            .toLowerCase(),
        )
        .filter((value) => value.length > 0),
    ),
  ];
}

export interface ServedFieldChange {
  field: string;
  stored: unknown;
  projectedWithOrphans: unknown;
  projectedWithoutOrphans: unknown;
  creditedToRetired: boolean;
  becomesEmpty: boolean;
  becomesLessComplete: boolean;
}

const isEmptyValue = (value: unknown): boolean =>
  value === undefined ||
  value === null ||
  (typeof value === 'string' && value.trim() === '') ||
  (Array.isArray(value) && value.length === 0);

const isLessComplete = (before: unknown, after: unknown): boolean => {
  if (isEmptyValue(before)) return false;
  if (isEmptyValue(after)) return true;
  if (!Array.isArray(before) || !Array.isArray(after)) return false;
  const kept = new Set(after.map((item) => stableJson(item)));
  return before.some((item) => !kept.has(stableJson(item)));
};

const stableJson = (value: unknown): string =>
  JSON.stringify(value, (_key, inner) =>
    inner && typeof inner === 'object' && !Array.isArray(inner)
      ? Object.fromEntries(Object.entries(inner).sort(([a], [b]) => a.localeCompare(b)))
      : inner,
  ) ?? 'undefined';

/** Bookkeeping the projection rewrites on every pass, so it is not a served value. */
export const UNSERVED_PROJECTION_FIELDS = new Set([
  'confidenceByField',
  'fieldProvenance',
  'lastObservedAt',
  'lastMaterializedAt',
  'updatedAt',
  'sourceContentHash',
  'observationCount',
]);

const topLevelField = (path: string): string => path.split('.')[0];

/**
 * The served fields the retirement changes on one row: fields whose projected value differs
 * with and without the retired observations. The projection with them is compared against the
 * projection without them, not against the stored row, so drift the row would show on any
 * re-materialize is never reported as this retirement's effect.
 */
export function servedFieldChanges(input: {
  stored: Record<string, unknown>;
  withOrphans: { set: Record<string, unknown>; unset: Record<string, unknown> };
  withoutOrphans: { set: Record<string, unknown>; unset: Record<string, unknown> };
  creditedFields: ReadonlySet<string>;
}): ServedFieldChange[] {
  const project = (plan: { set: Record<string, unknown>; unset: Record<string, unknown> }) => {
    const projected: Record<string, unknown> = { ...input.stored };
    for (const [path, value] of Object.entries(plan.set)) {
      if (!path.includes('.')) projected[path] = value;
    }
    for (const path of Object.keys(plan.unset)) {
      if (!path.includes('.')) delete projected[path];
    }
    return projected;
  };
  const withOrphans = project(input.withOrphans);
  const withoutOrphans = project(input.withoutOrphans);
  const fields = new Set(
    [
      ...Object.keys(input.withOrphans.set),
      ...Object.keys(input.withOrphans.unset),
      ...Object.keys(input.withoutOrphans.set),
      ...Object.keys(input.withoutOrphans.unset),
    ].map(topLevelField),
  );
  const changes: ServedFieldChange[] = [];
  for (const field of [...fields].sort()) {
    if (UNSERVED_PROJECTION_FIELDS.has(field)) continue;
    if (stableJson(withOrphans[field]) === stableJson(withoutOrphans[field])) continue;
    changes.push({
      field,
      stored: input.stored[field],
      projectedWithOrphans: withOrphans[field],
      projectedWithoutOrphans: withoutOrphans[field],
      creditedToRetired: input.creditedFields.has(field),
      becomesEmpty: !isEmptyValue(withOrphans[field]) && isEmptyValue(withoutOrphans[field]),
      becomesLessComplete:
        isLessComplete(withOrphans[field], withoutOrphans[field]) &&
        isLessComplete(input.stored[field], withoutOrphans[field]),
    });
  }
  return changes;
}

export function fieldsCreditedToRetired(
  fieldProvenance: unknown,
  retiredIds: ReadonlySet<string>,
): Set<string> {
  const credited = new Set<string>();
  if (!fieldProvenance || typeof fieldProvenance !== 'object') return credited;
  const entries =
    fieldProvenance instanceof Map
      ? [...fieldProvenance.entries()]
      : Object.entries(fieldProvenance as Record<string, unknown>);
  for (const [field, provenance] of entries) {
    const observationId = (provenance as { observationId?: unknown } | null)?.observationId;
    if (observationId && retiredIds.has(String(observationId))) credited.add(field);
  }
  return credited;
}

export interface HeldSoleEvidence {
  row: string;
  field: string;
  configIds: string[];
  values: unknown[];
  observationIds: string[];
  basis: 'engine-would-not-produce' | 'engine-projection';
}

export interface SoleEvidenceSplit {
  observationIdsToRetire: string[];
  heldSoleEvidence: HeldSoleEvidence[];
  withoutRow: number;
}

/** What the engine's projection of one row plans per field, with and without the orphans. */
export interface EngineFieldOutputs {
  withOrphans: Record<string, unknown>;
  withoutOrphans: Record<string, unknown>;
}

const engineItems = (value: unknown): string[] =>
  isEmptyValue(value) ? [] : (Array.isArray(value) ? value : [value]).map(stableJson);

/**
 * Whether the engine, projecting the row with the field's stored value cleared, produces every
 * item without the orphans that it produces with them, compared as the engine outputs them. An
 * orphan's raw value is never compared, because the engine normalises what it serves. An empty
 * output with the orphans means the projection cannot say what they back, so it counts as not
 * produced.
 */
export function engineStillProduces(withOrphans: unknown, withoutOrphans: unknown): boolean {
  const produced = engineItems(withOrphans);
  if (produced.length === 0) return false;
  const kept = new Set(engineItems(withoutOrphans));
  return produced.every((item) => kept.has(item));
}

/**
 * Retires an attributed observation only when the engine still produces its field's value from
 * the row's other evidence, unless the operator opts out. A row the engine was not asked to project
 * holds its observations, so a missing projection never reads as backing.
 */
export function splitByEngineProduction(input: {
  attributed: readonly AttributedObservation[];
  rowOf: (observation: StoredLaneObservation) => string | undefined;
  outputsByRow: ReadonlyMap<string, EngineFieldOutputs>;
  retireSoleEvidence: boolean;
}): SoleEvidenceSplit {
  const retire = new Set<string>();
  const held = new Map<string, HeldSoleEvidence>();
  let withoutRow = 0;
  for (const entry of input.attributed) {
    const row = input.rowOf(entry.observation);
    if (!row) {
      withoutRow += 1;
      retire.add(entry.observation.id);
      continue;
    }
    const outputs = input.outputsByRow.get(row);
    const field = entry.observation.field;
    const key = `${row}\u0000${field}`;
    if (
      input.retireSoleEvidence ||
      (outputs && engineStillProduces(outputs.withOrphans[field], outputs.withoutOrphans[field]))
    ) {
      retire.add(entry.observation.id);
      continue;
    }
    const group = held.get(key) ?? {
      row,
      field,
      configIds: [],
      values: [],
      observationIds: [],
      basis: 'engine-would-not-produce' as const,
    };
    if (!group.configIds.includes(entry.configId)) group.configIds.push(entry.configId);
    group.values.push(entry.observation.value);
    group.observationIds.push(entry.observation.id);
    held.set(key, group);
  }
  return {
    observationIdsToRetire: [...retire].sort(),
    heldSoleEvidence: [...held.values()].sort(
      (a, b) => a.row.localeCompare(b.row) || a.field.localeCompare(b.field),
    ),
    withoutRow,
  };
}

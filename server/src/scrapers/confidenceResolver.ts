/**
 * Pure-function aggregator: given a set of Observations for one (entity, field), pick a
 * winning value and compute a confidence score.
 *
 * Algorithm:
 *   1. If the field is in manuallyLockedFields on the entity, return the locked value.
 *   2. Group observations by serialized value.
 *   3. For each group: weight = sum(source.weight × recencyDecay(observedAt)).
 *   4. Apply an agreement bonus when more than one source contributes to a group.
 *   5. Return the highest-weighted group's value; flag conflict if runner-up is close.
 *
 * Deliberately pure — no DB calls — so it's testable in isolation.
 */

export interface ResolverObservation {
  field: string;
  value: unknown;
  sourceName: string;
  sourceUrl?: string;
  confidence: number;
  observedAt: Date;
}

export interface ResolvedField {
  value: unknown;
  confidence: number;
  contributingSources: string[];
  hasConflict: boolean;
  conflictingValues?: unknown[];
}

export interface ResolverOptions {
  manuallyLockedFields?: string[];
  manualValues?: Record<string, unknown>;
  recencyHalfLifeDays?: number;
  agreementBonusPerExtraSource?: number;
  conflictThreshold?: number;
  now?: Date;
  observationScore?: (observation: ResolverObservation, baseScore: number) => number;
}

const DEFAULTS = {
  recencyHalfLifeDays: 90,
  agreementBonusPerExtraSource: 0.1,
  conflictThreshold: 0.3,
};

function serializeValue(value: unknown): string {
  if (value === null || value === undefined) return '__null__';
  if (typeof value === 'string') return `s:${value.trim().toLowerCase()}`;
  if (typeof value === 'number' || typeof value === 'boolean') return `p:${String(value)}`;
  if (Array.isArray(value)) {
    const sorted = [...value].map((v) => serializeValue(v)).sort();
    return `a:[${sorted.join(',')}]`;
  }
  if (typeof value === 'object') {
    return `o:${JSON.stringify(value, Object.keys(value as object).sort())}`;
  }
  return `x:${String(value)}`;
}

function recencyDecay(observedAt: Date, now: Date, halfLifeDays: number): number {
  const ageMs = Math.max(0, now.getTime() - observedAt.getTime());
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  return Math.pow(0.5, ageDays / halfLifeDays);
}

export function resolveField(
  field: string,
  observations: ResolverObservation[],
  opts: ResolverOptions = {},
): ResolvedField | null {
  const halfLifeDays = opts.recencyHalfLifeDays ?? DEFAULTS.recencyHalfLifeDays;
  const agreementBonus = opts.agreementBonusPerExtraSource ?? DEFAULTS.agreementBonusPerExtraSource;
  const conflictThreshold = opts.conflictThreshold ?? DEFAULTS.conflictThreshold;
  const now = opts.now ?? new Date();

  if (opts.manuallyLockedFields?.includes(field)) {
    return {
      value: opts.manualValues?.[field],
      confidence: 1.0,
      contributingSources: ['manual'],
      hasConflict: false,
    };
  }

  const fieldObs = observations.filter((o) => o.field === field);
  if (fieldObs.length === 0) return null;

  const groups = new Map<
    string,
    { value: unknown; weight: number; sources: Set<string> }
  >();
  for (const obs of fieldObs) {
    const key = serializeValue(obs.value);
    const decay = recencyDecay(obs.observedAt, now, halfLifeDays);
    const baseContribution = obs.confidence * decay;
    const contribution = opts.observationScore
      ? opts.observationScore(obs, baseContribution)
      : baseContribution;
    let g = groups.get(key);
    if (!g) {
      g = { value: obs.value, weight: 0, sources: new Set() };
      groups.set(key, g);
    }
    g.weight += contribution;
    g.sources.add(obs.sourceName);
  }

  for (const g of groups.values()) {
    if (g.sources.size > 1) {
      g.weight *= 1 + agreementBonus * (g.sources.size - 1);
    }
  }

  const ranked = Array.from(groups.values()).sort((a, b) => b.weight - a.weight);
  const winner = ranked[0];
  const runnerUp = ranked[1];

  const totalWeight = ranked.reduce((acc, g) => acc + g.weight, 0);
  const confidence = totalWeight > 0 ? Math.min(1, winner.weight / totalWeight) : 0;

  let hasConflict = false;
  let conflictingValues: unknown[] | undefined;
  if (runnerUp) {
    const margin = (winner.weight - runnerUp.weight) / Math.max(winner.weight, 1e-9);
    if (margin < conflictThreshold) {
      hasConflict = true;
      conflictingValues = ranked.slice(0, 3).map((g) => g.value);
    }
  }

  return {
    value: winner.value,
    confidence,
    contributingSources: Array.from(winner.sources),
    hasConflict,
    conflictingValues,
  };
}

export function resolveAllFields(
  observations: ResolverObservation[],
  opts: ResolverOptions = {},
): Record<string, ResolvedField> {
  const fields = new Set(observations.map((o) => o.field));
  if (opts.manuallyLockedFields) {
    for (const f of opts.manuallyLockedFields) fields.add(f);
  }
  const out: Record<string, ResolvedField> = {};
  for (const field of fields) {
    const resolved = resolveField(field, observations, opts);
    if (resolved) out[field] = resolved;
  }
  return out;
}

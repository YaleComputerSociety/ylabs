import {
  QUALITY_GUARDED_PROSE_FIELDS,
  buildObservationFingerprint,
  proseValueIsUseful,
  usesLatestWinsFingerprint,
} from './observationStore';

export interface NormalizableObservation {
  _id: unknown;
  sourceName: string;
  entityType: string;
  entityId?: unknown;
  entityKey?: unknown;
  field: string;
  value: unknown;
  observedAt?: unknown;
  superseded?: boolean;
  observationFingerprint?: string;
}

export interface FingerprintRewrite {
  id: unknown;
  from?: string;
  to: string;
}

export interface Supersession {
  id: unknown;
  supersededBy: unknown;
}

export interface NormalizationPlan {
  fingerprintRewrites: FingerprintRewrite[];
  supersessions: Supersession[];
  counts: {
    scanned: number;
    fingerprintRewrites: number;
    unfingerprintable: number;
    activeGroupsCollapsed: number;
    supersessions: number;
    proseGroupsKeptOlderUsefulValue: number;
    proseGroupsAllValuesUnusable: number;
  };
}

const identityOf = (observation: NormalizableObservation): string => {
  const key = typeof observation.entityKey === 'string' ? observation.entityKey.trim() : '';
  if (key) return `key:${key.toLowerCase()}`;
  const id = observation.entityId ? String(observation.entityId) : '';
  return id ? `id:${id.toLowerCase()}` : '';
};

const observedTime = (value: unknown): number => {
  if (value instanceof Date) return value.getTime();
  const parsed = new Date(value as string | number).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
};

// Newest first, with _id as a stable tiebreak so two rows sharing an observedAt
// resolve identically across runs instead of depending on cursor order.
const byNewest = (a: NormalizableObservation, b: NormalizableObservation): number => {
  const delta = observedTime(b.observedAt) - observedTime(a.observedAt);
  if (delta !== 0) return delta;
  return String(b._id).localeCompare(String(a._id));
};

export const canonicalFingerprint = (observation: NormalizableObservation): string | undefined =>
  buildObservationFingerprint({
    sourceName: observation.sourceName,
    entityType: observation.entityType,
    entityId: observation.entityId,
    entityKey: typeof observation.entityKey === 'string' ? observation.entityKey : undefined,
    field: observation.field,
    value: observation.value,
  });

// The supersession key mirrors appendObservations: a latest-wins field keeps one row per
// (source, entity, field) regardless of how the text drifts, everything else keys on the
// full value fingerprint.
const supersessionKey = (
  observation: NormalizableObservation,
  fingerprint: string | undefined,
): string | undefined => {
  if (usesLatestWinsFingerprint(observation)) {
    const identity = identityOf(observation);
    if (!identity) return undefined;
    return JSON.stringify([
      'latest-wins',
      observation.sourceName.trim().toLowerCase(),
      observation.entityType.trim().toLowerCase(),
      identity,
      observation.field.trim().toLowerCase(),
    ]);
  }
  return fingerprint ? JSON.stringify(['fingerprint', fingerprint]) : undefined;
};

/**
 * Selects the row that stays active for one group of competing active observations.
 *
 * For prose fields this retroactively applies `isRegressiveProseRefresh`: the guard could not
 * fire while the id/key identity split hid the prior row (#2177), so the newest row in a damaged
 * group is often a regression over good prose that is still sitting active. Collapsing on newest
 * alone would make that regression permanent, so prefer the newest row whose value still passes
 * the prose quality bar and only fall back to newest when no value in the group is usable.
 */
export function selectRetainedObservation(group: NormalizableObservation[]): {
  retained: NormalizableObservation;
  keptOlderUsefulValue: boolean;
  allValuesUnusable: boolean;
} {
  const ordered = [...group].sort(byNewest);
  const newest = ordered[0];
  if (!QUALITY_GUARDED_PROSE_FIELDS.has(newest.field)) {
    return { retained: newest, keptOlderUsefulValue: false, allValuesUnusable: false };
  }
  const firstUseful = ordered.find((observation) =>
    proseValueIsUseful(observation.field, observation.value, {
      entityType: observation.entityType,
    }),
  );
  if (!firstUseful) {
    return { retained: newest, keptOlderUsefulValue: false, allValuesUnusable: true };
  }
  return {
    retained: firstUseful,
    keptOlderUsefulValue: firstUseful !== newest,
    allValuesUnusable: false,
  };
}

export function planObservationFingerprintNormalization(
  observations: NormalizableObservation[],
): NormalizationPlan {
  const fingerprintRewrites: FingerprintRewrite[] = [];
  const supersessions: Supersession[] = [];
  const counts: NormalizationPlan['counts'] = {
    scanned: observations.length,
    fingerprintRewrites: 0,
    unfingerprintable: 0,
    activeGroupsCollapsed: 0,
    supersessions: 0,
    proseGroupsKeptOlderUsefulValue: 0,
    proseGroupsAllValuesUnusable: 0,
  };

  const activeGroups = new Map<string, NormalizableObservation[]>();
  for (const observation of observations) {
    const fingerprint = canonicalFingerprint(observation);
    if (!fingerprint) {
      counts.unfingerprintable += 1;
    } else if (fingerprint !== observation.observationFingerprint) {
      fingerprintRewrites.push({
        id: observation._id,
        ...(observation.observationFingerprint ? { from: observation.observationFingerprint } : {}),
        to: fingerprint,
      });
    }
    if (observation.superseded === true) continue;
    const key = supersessionKey(observation, fingerprint);
    if (!key) continue;
    const group = activeGroups.get(key);
    if (group) group.push(observation);
    else activeGroups.set(key, [observation]);
  }

  for (const group of activeGroups.values()) {
    if (group.length < 2) continue;
    const { retained, keptOlderUsefulValue, allValuesUnusable } = selectRetainedObservation(group);
    counts.activeGroupsCollapsed += 1;
    if (keptOlderUsefulValue) counts.proseGroupsKeptOlderUsefulValue += 1;
    if (allValuesUnusable) counts.proseGroupsAllValuesUnusable += 1;
    for (const observation of group) {
      if (observation === retained) continue;
      supersessions.push({ id: observation._id, supersededBy: retained._id });
    }
  }

  counts.fingerprintRewrites = fingerprintRewrites.length;
  counts.supersessions = supersessions.length;
  return { fingerprintRewrites, supersessions, counts };
}

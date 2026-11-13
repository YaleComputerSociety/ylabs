import { Observation } from '../models/observation';

const CACHE_TTL_MS = 10 * 60 * 1000;

export type PrimaryDepartmentStatingKeys = ReadonlyMap<string, ReadonlySet<string>>;

/**
 * Every `user` key that states each `primaryDepartment` value, live or superseded but not
 * rolled back, read in one pass so the #6065 backing read finds the keys stating a stored value
 * without an unindexed query per researcher.
 */
export async function readPrimaryDepartmentStatingKeys(): Promise<PrimaryDepartmentStatingKeys> {
  const readings = (await Observation.find(
    {
      entityType: 'user',
      field: 'primaryDepartment',
      'rollback.rolledBackAt': { $exists: false },
      entityKey: { $exists: true },
    },
    { value: 1, entityKey: 1 },
  ).lean()) as Array<{ value?: unknown; entityKey?: unknown }>;
  const keysByValue = new Map<string, Set<string>>();
  for (const reading of readings) {
    if (typeof reading.value !== 'string' || typeof reading.entityKey !== 'string') continue;
    const keys = keysByValue.get(reading.value) ?? new Set<string>();
    keys.add(reading.entityKey);
    keysByValue.set(reading.value, keys);
  }
  return keysByValue;
}

let cached: { keys: Promise<PrimaryDepartmentStatingKeys>; expiresAt: number } | undefined;

/**
 * Scoped to one materialize batch: every batch entry point resets it before its first row, so
 * a batch reads the keys as they stood when it started and lanes that emit between batches are
 * seen by the next one. The TTL bounds a caller that never resets.
 */
export function primaryDepartmentStatingKeysForMaterialization(
  now: number = Date.now(),
): Promise<PrimaryDepartmentStatingKeys> {
  if (!cached || cached.expiresAt <= now) {
    const keys = readPrimaryDepartmentStatingKeys();
    cached = { keys, expiresAt: now + CACHE_TTL_MS };
    keys.catch(() => {
      if (cached?.keys === keys) cached = undefined;
    });
  }
  return cached.keys;
}

export function resetPrimaryDepartmentStatingKeysCache(): void {
  cached = undefined;
}

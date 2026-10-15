/**
 * A lane that once adopted a linked home's name as the row's own, and later judges the
 * same home to be someone else's, re-emits only the fields it still stands behind. The
 * older name stays live, because supersession is per field, and a name or enum field is
 * not declarable for retraction (`fieldRetraction.ts`). So the lane states the refusal
 * as evidence, and on every resolve it withdraws that lane's own older `name` and
 * `displayName` carrying the refused value, while another lane's name still counts
 * (#5053). Its `kind` and `entityType` then fall with it through
 * `withoutUnpairedProfileHomeIdentity`.
 */
import { laneScopeKey } from './laneRefusedWebsiteUrl';

export const REFUSED_RESEARCH_HOME_NAME_FIELD = 'refusedResearchHomeName';

const WITHDRAWABLE_NAME_FIELDS: ReadonlySet<string> = new Set(['name', 'displayName']);

type LaneNameObservation = {
  sourceName?: unknown;
  field?: unknown;
  value?: unknown;
  observedAt?: unknown;
  entityKey?: unknown;
  entityId?: unknown;
};

function observedTime(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function nameIdentity(value: unknown): string {
  return (typeof value === 'string' ? value : '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function refusalKey(observation: LaneNameObservation, rowIdentities: ReadonlySet<string>) {
  return JSON.stringify([
    laneScopeKey(observation, rowIdentities),
    nameIdentity(observation.value),
  ]);
}

export function withoutLaneRefusedResearchHomeNames<T extends LaneNameObservation>(
  observations: T[],
  rowIdentities: ReadonlySet<string>,
): T[] {
  const newestRefusal = new Map<string, number>();
  for (const observation of observations) {
    if (observation.field !== REFUSED_RESEARCH_HOME_NAME_FIELD) continue;
    if (!nameIdentity(observation.value)) continue;
    const key = refusalKey(observation, rowIdentities);
    newestRefusal.set(
      key,
      Math.max(newestRefusal.get(key) ?? 0, observedTime(observation.observedAt)),
    );
  }
  return observations.filter((observation) => {
    if (observation.field === REFUSED_RESEARCH_HOME_NAME_FIELD) return false;
    if (newestRefusal.size === 0) return true;
    if (!WITHDRAWABLE_NAME_FIELDS.has(String(observation.field ?? ''))) return true;
    const refusedAt = newestRefusal.get(refusalKey(observation, rowIdentities));
    return refusedAt === undefined || observedTime(observation.observedAt) >= refusedAt;
  });
}

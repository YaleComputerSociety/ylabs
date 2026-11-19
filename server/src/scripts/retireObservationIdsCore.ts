import { ownerDecisionBacking, type OwnerDecisionBacking } from './supersedeObservationsCore';

export const RETIRE_OBSERVATION_IDS_SCRIPT = 'observations:retire-ids';
export const RETIRE_OBSERVATION_IDS_AUDIT_ACTION = 'observation.retire-ids';
export const RETIRE_OBSERVATION_IDS_AUDIT_TARGET_TYPE = 'scrape_run';
export const RETIRE_OBSERVATION_IDS_REASON_PREFIX = `${RETIRE_OBSERVATION_IDS_SCRIPT}: `;
export const MAX_RETIRE_IDS_PER_RUN = 20_000;
export const RETIRE_AUDIT_BATCH_SIZE = 500;

export interface RetireCandidate {
  _id?: unknown;
  scrapeRunId?: unknown;
  sourceName?: unknown;
  superseded?: unknown;
  rollback?: { reason?: unknown } | null;
}

export type RetirePlanEntry =
  | { id: string; status: 'not-found' }
  | { id: string; status: 'other-run' }
  | { id: string; status: 'not-live' }
  | { id: string; status: 'owner-decided'; backing: OwnerDecisionBacking }
  | { id: string; status: 'already-retired' }
  | { id: string; status: 'retire' };

const idText = (value: unknown): string =>
  value === null || value === undefined ? '' : String(value).toLowerCase();

export function wasRetiredByThisTool(observation: RetireCandidate): boolean {
  return (
    observation.superseded === true &&
    String(observation.rollback?.reason ?? '').startsWith(RETIRE_OBSERVATION_IDS_REASON_PREFIX)
  );
}

export function planObservationIdRetirement(input: {
  runId: string;
  ids: readonly string[];
  observations: ReadonlyArray<RetireCandidate>;
  lockedBackingIds: ReadonlySet<string>;
}): { entries: RetirePlanEntry[]; refused: boolean } {
  const runId = idText(input.runId);
  const byId = new Map(
    input.observations.map((observation) => [idText(observation._id), observation]),
  );
  const entries = input.ids.map((rawId): RetirePlanEntry => {
    const id = idText(rawId);
    const observation = byId.get(id);
    if (!observation) return { id, status: 'not-found' };
    if (idText(observation.scrapeRunId) !== runId) return { id, status: 'other-run' };
    const backing = ownerDecisionBacking(observation, input.lockedBackingIds);
    if (backing) return { id, status: 'owner-decided', backing };
    if (wasRetiredByThisTool(observation)) return { id, status: 'already-retired' };
    if (observation.superseded === true) return { id, status: 'not-live' };
    return { id, status: 'retire' };
  });
  const refused = entries.some(
    (entry) => entry.status !== 'retire' && entry.status !== 'already-retired',
  );
  return { entries, refused };
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size)
    out.push(items.slice(index, index + size));
  return out;
}

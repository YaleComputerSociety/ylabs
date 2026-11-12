import { OPERATOR_AUTHORED_SOURCE_NAMES } from '../scrapers/seedSources';
import { fieldProvenanceEntries } from '../models/fieldProvenanceBacking';
import { OPERATOR_LED_GROUP_VERDICT_SOURCE } from './adoptLedGroupSiteCore';

export const SUPERSEDE_OBSERVATIONS_SCRIPT = 'observations:supersede';
export const SUPERSEDE_OBSERVATIONS_AUDIT_ACTION = 'observation.supersede';
export const SUPERSEDE_OBSERVATIONS_AUDIT_TARGET_TYPE = 'observation';
export const MAX_SUPERSEDE_IDS_PER_RUN = 25;

export const OWNER_DECIDED_SOURCE_NAMES: ReadonlySet<string> = new Set([
  ...OPERATOR_AUTHORED_SOURCE_NAMES,
  OPERATOR_LED_GROUP_VERDICT_SOURCE,
]);

export type OwnerDecisionBacking = 'operator-authored-source' | 'backs-a-locked-field';

export interface SupersedeCandidate {
  _id?: unknown;
  sourceName?: unknown;
  superseded?: unknown;
}

export interface LockedRowProvenance {
  manuallyLockedFields?: unknown;
  fieldProvenance?: unknown;
}

const idText = (value: unknown): string =>
  value === null || value === undefined ? '' : String(value).toLowerCase();

export function observationIdsBackingLockedFields(
  rows: ReadonlyArray<LockedRowProvenance>,
): Set<string> {
  const backing = new Set<string>();
  for (const row of rows) {
    const locked = new Set(
      Array.isArray(row.manuallyLockedFields) ? row.manuallyLockedFields.map(String) : [],
    );
    for (const [field, entry] of fieldProvenanceEntries(row.fieldProvenance)) {
      const observationId = idText((entry as { observationId?: unknown } | null)?.observationId);
      if (locked.has(field) && observationId) backing.add(observationId);
    }
  }
  return backing;
}

export function ownerDecisionBacking(
  observation: SupersedeCandidate,
  lockedBackingIds: ReadonlySet<string>,
): OwnerDecisionBacking | null {
  if (OWNER_DECIDED_SOURCE_NAMES.has(String(observation.sourceName ?? '').trim())) {
    return 'operator-authored-source';
  }
  if (lockedBackingIds.has(idText(observation._id))) return 'backs-a-locked-field';
  return null;
}

export type SupersedePlanEntry =
  | { id: string; status: 'not-found' }
  | { id: string; status: 'already-superseded' }
  | { id: string; status: 'owner-decided'; backing: OwnerDecisionBacking }
  | { id: string; status: 'supersede' };

export function planObservationSupersede(input: {
  ids: readonly string[];
  observations: ReadonlyArray<SupersedeCandidate>;
  lockedBackingIds: ReadonlySet<string>;
}): { entries: SupersedePlanEntry[]; refused: boolean } {
  const byId = new Map(
    input.observations.map((observation) => [idText(observation._id), observation]),
  );
  const entries = input.ids.map((rawId): SupersedePlanEntry => {
    const id = idText(rawId);
    const observation = byId.get(id);
    if (!observation) return { id, status: 'not-found' };
    const backing = ownerDecisionBacking(observation, input.lockedBackingIds);
    if (backing) return { id, status: 'owner-decided', backing };
    if (observation.superseded === true) return { id, status: 'already-superseded' };
    return { id, status: 'supersede' };
  });
  const refused = entries.some(
    (entry) => entry.status === 'not-found' || entry.status === 'owner-decided',
  );
  return { entries, refused };
}

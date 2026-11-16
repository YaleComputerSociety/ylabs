import mongoose from 'mongoose';
import { Observation } from '../models/observation';
import { withholdLastCitationRemovals } from '../services/lastCitationGuard';
import {
  fieldValueRefusalKey,
  liveFieldValueRefusals,
} from '../utils/researchEntityFieldValueRefusals';

export const fieldProvenancePath = (field: string): string => `fieldProvenance.${field}`;

const isEmptyValue = (value: unknown): boolean =>
  value === undefined ||
  value === null ||
  (typeof value === 'string' && value.trim() === '') ||
  (Array.isArray(value) && value.length === 0);

const sameValue = (field: string, a: unknown, b: unknown): boolean =>
  JSON.stringify(
    Array.isArray(a)
      ? a.map((entry) => fieldValueRefusalKey(field, entry))
      : fieldValueRefusalKey(field, a),
  ) ===
  JSON.stringify(
    Array.isArray(b)
      ? b.map((entry) => fieldValueRefusalKey(field, entry))
      : fieldValueRefusalKey(field, b),
  );

/**
 * Whether a row's `fieldProvenance.<field>` stops describing the field once it holds
 * `valueAfter` (#6318). A refusal that clears the field leaves nothing for the stamp to
 * describe. A refusal whose closure re-derivation puts another value there keeps the stamp
 * only when the observation it cites asserts that value, because a stamp names the evidence
 * for the stored value and a re-derived value has none of its own.
 */
export async function provenanceNoLongerDescribesValue(
  row: Record<string, unknown>,
  field: string,
  valueAfter: unknown,
): Promise<boolean> {
  const provenance = (row.fieldProvenance as Record<string, unknown> | undefined)?.[field] as
    { observationId?: unknown } | undefined;
  if (!provenance) return false;
  if (isEmptyValue(valueAfter)) return true;
  if (sameValue(field, valueAfter, row[field])) return false;
  const observationId = provenance.observationId;
  if (!observationId || !mongoose.isValidObjectId(observationId)) return true;
  const observation = await Observation.findById(observationId)
    .select('value')
    .lean<{ value?: unknown } | null>();
  return !observation || !sameValue(field, valueAfter, observation.value);
}

export interface StaleRefusalProvenance {
  id: string;
  field: string;
  sourceName: string;
}

/**
 * The stamps a row's live refusals already cleared the value of but not the provenance of:
 * the repair the refusal CLI now makes as it records, re-run from the stored refusal records
 * (#6318). It reads the records and never rewrites them, so the audit trail is unchanged.
 */
export async function staleRefusalProvenanceOf(
  row: Record<string, unknown>,
): Promise<StaleRefusalProvenance[]> {
  const refusals = row.fieldValueRefusals as Record<string, unknown> | undefined;
  if (!refusals) return [];
  const stale: StaleRefusalProvenance[] = [];
  for (const field of Object.keys(refusals)) {
    if (liveFieldValueRefusals(refusals, field).length === 0) continue;
    if (!(await provenanceNoLongerDescribesValue(row, field, row[field]))) continue;
    const provenance = (row.fieldProvenance as Record<string, { sourceName?: unknown }>)[field];
    stale.push({ id: String(row._id), field, sourceName: String(provenance?.sourceName ?? '') });
  }
  return stale;
}

/**
 * The `$unset` of every stamp that stops describing its field once the row holds `valuesAfter`,
 * less any stamp that is the row's last citation once `plannedSet` lands (#6320), which is
 * reported in `withheld`.
 */
export async function staleProvenanceUnset(
  row: Record<string, unknown>,
  valuesAfter: Record<string, unknown>,
  plannedSet: Record<string, unknown> = valuesAfter,
): Promise<{ unset: Record<string, ''>; withheld: string[] }> {
  const unset: Record<string, ''> = {};
  for (const [field, value] of Object.entries(valuesAfter)) {
    if (await provenanceNoLongerDescribesValue(row, field, value)) {
      unset[fieldProvenancePath(field)] = '';
    }
  }
  const guarded = withholdLastCitationRemovals(row, { set: plannedSet, unset });
  return { unset: guarded.unset as Record<string, ''>, withheld: guarded.withheld };
}

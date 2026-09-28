import { Observation } from '../models/observation';
import {
  fieldProvenanceEntries,
  fieldProvenanceEntryNamesALaneWithoutEvidence,
} from '../models/fieldProvenanceBacking';

export type SourceObservedFieldLookup = (input: {
  entityKey?: string;
  entityId?: string;
  field: string;
  sourceName: string;
}) => Promise<boolean>;

export const sourceEverObservedField: SourceObservedFieldLookup = async ({
  entityKey,
  entityId,
  field,
  sourceName,
}) => {
  const identifiers: Record<string, unknown>[] = [];
  if (entityKey) identifiers.push({ entityKey });
  if (entityId) identifiers.push({ entityId });
  if (identifiers.length === 0) return true;
  const found = await Observation.exists({
    entityType: 'researchEntity',
    field,
    sourceName,
    $or: identifiers,
  });
  return Boolean(found);
};

function textValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * The stored provenance entries this pass should retire because the lane they name
 * never observed that field on this row. Superseded observations count as observed on
 * purpose: a retracted claim is history and stays attributed.
 */
export async function planNeverBackedFieldProvenanceRetirement(input: {
  stored: Record<string, unknown> | null | undefined;
  set: Record<string, unknown>;
  unset: Record<string, unknown>;
  lockedFields: readonly string[];
  scopedFields?: readonly string[];
  sourceObservedField?: SourceObservedFieldLookup;
}): Promise<string[]> {
  if (!input.stored) return [];
  const lookup = input.sourceObservedField ?? sourceEverObservedField;
  const entityKey = textValue(input.stored.slug) || undefined;
  const entityId = input.stored._id ? String(input.stored._id) : undefined;
  const retired: string[] = [];
  for (const [field, entry] of fieldProvenanceEntries(input.stored.fieldProvenance)) {
    const path = `fieldProvenance.${field}`;
    if (path in input.set || path in input.unset) continue;
    if (input.lockedFields.includes(field)) continue;
    if (input.scopedFields && !input.scopedFields.includes(field)) continue;
    if (!fieldProvenanceEntryNamesALaneWithoutEvidence(entry)) continue;
    const sourceName = textValue((entry as { sourceName?: unknown }).sourceName);
    if (await lookup({ entityKey, entityId, field, sourceName })) continue;
    retired.push(field);
  }
  return retired;
}

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

export interface LiveFieldObservation {
  _id?: unknown;
  sourceId?: unknown;
  value?: unknown;
}

export type LiveFieldObservationLookup = (input: {
  entityKey?: string;
  entityId?: string;
  field: string;
  sourceName: string;
}) => Promise<LiveFieldObservation[]>;

export const liveObservationsOfField: LiveFieldObservationLookup = async ({
  entityKey,
  entityId,
  field,
  sourceName,
}) => {
  const identifiers: Record<string, unknown>[] = [];
  if (entityKey) identifiers.push({ entityKey });
  if (entityId) identifiers.push({ entityId });
  if (identifiers.length === 0) return [];
  return Observation.find({
    entityType: 'researchEntity',
    field,
    sourceName,
    superseded: false,
    $or: identifiers,
  })
    .select('_id sourceId value')
    .lean<LiveFieldObservation[]>();
};

function isPresent(value: unknown): boolean {
  return value !== undefined && value !== null && String(value).trim().length > 0;
}

function plainEntry(entry: unknown): Record<string, unknown> {
  const maybeDocument = entry as { toObject?: () => unknown };
  const plain = typeof maybeDocument.toObject === 'function' ? maybeDocument.toObject() : entry;
  return (plain ?? {}) as Record<string, unknown>;
}

// Key order is `fieldProvenanceSchema`'s, so the entry compares equal to what Mongoose stores.
function entryCitingObservation(
  entry: Record<string, unknown>,
  observation: LiveFieldObservation,
): Record<string, unknown> {
  const relinked: Record<string, unknown> = {};
  if (isPresent(observation.sourceId)) relinked.sourceId = observation.sourceId;
  relinked.sourceName = entry.sourceName;
  if (entry.sourceUrl !== undefined) relinked.sourceUrl = entry.sourceUrl;
  relinked.observationId = observation._id;
  if (entry.observedAt !== undefined) relinked.observedAt = entry.observedAt;
  if (entry.confidence !== undefined) relinked.confidence = entry.confidence;
  return relinked;
}

/**
 * Stored entries that name a lane without recording which of its observations they cite,
 * where exactly one live observation of that lane states the value the row will hold after
 * this pass. Each is rewritten citing that observation; an ambiguous or absent match is left
 * for the retirement stage or for history, never guessed.
 */
export async function planUnrecordedProvenanceObservationRelink(input: {
  stored: Record<string, unknown> | null | undefined;
  set: Record<string, unknown>;
  unset: Record<string, unknown>;
  lockedFields: readonly string[];
  scopedFields?: readonly string[];
  liveObservations?: LiveFieldObservationLookup;
}): Promise<Record<string, Record<string, unknown>>> {
  if (!input.stored) return {};
  const lookup = input.liveObservations ?? liveObservationsOfField;
  const entityKey = textValue(input.stored.slug) || undefined;
  const entityId = input.stored._id ? String(input.stored._id) : undefined;
  const relinked: Record<string, Record<string, unknown>> = {};
  for (const [field, entry] of fieldProvenanceEntries(input.stored.fieldProvenance)) {
    const path = `fieldProvenance.${field}`;
    if (path in input.set || path in input.unset || field in input.unset) continue;
    if (input.lockedFields.includes(field)) continue;
    if (input.scopedFields && !input.scopedFields.includes(field)) continue;
    if (!fieldProvenanceEntryNamesALaneWithoutEvidence(entry)) continue;
    const heldValue = field in input.set ? input.set[field] : input.stored[field];
    if (heldValue === undefined) continue;
    const record = plainEntry(entry);
    const sourceName = textValue(record.sourceName);
    const held = JSON.stringify(heldValue);
    const matching = (await lookup({ entityKey, entityId, field, sourceName })).filter(
      (observation) => isPresent(observation._id) && JSON.stringify(observation.value) === held,
    );
    if (matching.length !== 1) continue;
    relinked[field] = entryCitingObservation(record, matching[0]);
  }
  return relinked;
}

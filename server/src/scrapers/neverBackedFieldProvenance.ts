import { Observation } from '../models/observation';
import {
  mergedRowEvidenceIdentity,
  mergedRowEvidenceQueryClauses,
  type MergedInRowRef,
} from './mergedRowEvidenceIdentity';
import {
  fieldProvenanceEntries,
  fieldProvenanceEntryNamesALaneWithoutEvidence,
} from '../models/fieldProvenanceBacking';

export interface ProvenanceRowEvidenceIdentity {
  entityKeys: string[];
  entityIds: string[];
}

export type SourceObservedFieldLookup = (
  input: ProvenanceRowEvidenceIdentity & { field: string; sourceName: string },
) => Promise<boolean>;

function identityClauses(input: ProvenanceRowEvidenceIdentity): Array<Record<string, unknown>> {
  return mergedRowEvidenceQueryClauses([
    { entityIds: new Set(input.entityIds), entityKeys: new Set(input.entityKeys) },
  ]);
}

export const sourceEverObservedField: SourceObservedFieldLookup = async (input) => {
  const clauses = identityClauses(input);
  if (clauses.length === 0) return true;
  const found = await Observation.exists({
    entityType: 'researchEntity',
    field: input.field,
    sourceName: input.sourceName,
    $or: clauses,
  });
  return Boolean(found);
};

/**
 * The row's own key and id plus every merged-in row's, because a lane that observed a field
 * under a merged-in key backs the survivor's value as much as one that read the survivor (#3560).
 */
function provenanceRowEvidenceIdentity(
  stored: Record<string, unknown>,
  mergedInRows: ReadonlyArray<MergedInRowRef> = [],
): ProvenanceRowEvidenceIdentity {
  const identity = mergedRowEvidenceIdentity(stored, mergedInRows);
  return { entityKeys: [...identity.entityKeys], entityIds: [...identity.entityIds] };
}

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
  mergedInRows?: ReadonlyArray<MergedInRowRef>;
  sourceObservedField?: SourceObservedFieldLookup;
}): Promise<string[]> {
  if (!input.stored) return [];
  const lookup = input.sourceObservedField ?? sourceEverObservedField;
  const identity = provenanceRowEvidenceIdentity(input.stored, input.mergedInRows);
  const retired: string[] = [];
  for (const [field, entry] of fieldProvenanceEntries(input.stored.fieldProvenance)) {
    const path = `fieldProvenance.${field}`;
    if (path in input.set || path in input.unset) continue;
    if (input.lockedFields.includes(field)) continue;
    if (input.scopedFields && !input.scopedFields.includes(field)) continue;
    if (!fieldProvenanceEntryNamesALaneWithoutEvidence(entry)) continue;
    const sourceName = textValue((entry as { sourceName?: unknown }).sourceName);
    if (await lookup({ ...identity, field, sourceName })) continue;
    retired.push(field);
  }
  return retired;
}

/**
 * The locked fields whose provenance names a lane that never observed the field on this
 * row, which the retirement stage above deliberately leaves to the lock release path.
 */
export async function lockedNeverBackedProvenanceFields(input: {
  stored: Record<string, unknown> | null | undefined;
  mergedInRows?: ReadonlyArray<MergedInRowRef>;
  sourceObservedField?: SourceObservedFieldLookup;
}): Promise<string[]> {
  if (!input.stored) return [];
  const lookup = input.sourceObservedField ?? sourceEverObservedField;
  const locked = Array.isArray(input.stored.manuallyLockedFields)
    ? input.stored.manuallyLockedFields.filter(
        (field): field is string => typeof field === 'string',
      )
    : [];
  const identity = provenanceRowEvidenceIdentity(input.stored, input.mergedInRows);
  const fields: string[] = [];
  for (const [field, entry] of fieldProvenanceEntries(input.stored.fieldProvenance)) {
    if (!locked.includes(field)) continue;
    if (!fieldProvenanceEntryNamesALaneWithoutEvidence(entry)) continue;
    const sourceName = textValue((entry as { sourceName?: unknown }).sourceName);
    if (await lookup({ ...identity, field, sourceName })) continue;
    fields.push(field);
  }
  return fields;
}

export interface LiveFieldObservation {
  _id?: unknown;
  sourceId?: unknown;
  value?: unknown;
}

export type LiveFieldObservationLookup = (
  input: ProvenanceRowEvidenceIdentity & { field: string; sourceName: string },
) => Promise<LiveFieldObservation[]>;

export const liveObservationsOfField: LiveFieldObservationLookup = async (input) => {
  const clauses = identityClauses(input);
  if (clauses.length === 0) return [];
  return Observation.find({
    entityType: 'researchEntity',
    field: input.field,
    sourceName: input.sourceName,
    superseded: false,
    $or: clauses,
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
  mergedInRows?: ReadonlyArray<MergedInRowRef>;
  liveObservations?: LiveFieldObservationLookup;
}): Promise<Record<string, Record<string, unknown>>> {
  if (!input.stored) return {};
  const lookup = input.liveObservations ?? liveObservationsOfField;
  const identity = provenanceRowEvidenceIdentity(input.stored, input.mergedInRows);
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
    const matching = (await lookup({ ...identity, field, sourceName })).filter(
      (observation) => isPresent(observation._id) && JSON.stringify(observation.value) === held,
    );
    if (matching.length !== 1) continue;
    relinked[field] = entryCitingObservation(record, matching[0]);
  }
  return relinked;
}

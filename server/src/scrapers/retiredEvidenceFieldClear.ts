import mongoose from 'mongoose';
import { Observation } from '../models/observation';
import { liveFieldValueRefusals } from '../utils/researchEntityFieldValueRefusals';
import {
  mergedRowEvidenceIdentity,
  mergedRowEvidenceQueryClauses,
  type MergedInRowRef,
} from './mergedRowEvidenceIdentity';
import { OPERATOR_AUTHORED_SOURCE_NAMES } from './seedSources';

export const RETIRED_EVIDENCE_CLEARABLE_FIELDS: readonly string[] = [
  'website',
  'description',
  'fullDescription',
  'currentUndergradCount',
  'undergradEvidenceQuote',
];

const BODY_FIELDS = new Set(['description', 'fullDescription']);
const CARD_FIELD = 'shortDescription';

export interface CitedObservation {
  _id?: unknown;
  value?: unknown;
  superseded?: unknown;
  rollback?: { rolledBackAt?: unknown } | null;
}

export type CitedObservationLookup = (observationIds: string[]) => Promise<CitedObservation[]>;

export const citedObservationsById: CitedObservationLookup = async (observationIds) => {
  const ids = observationIds
    .filter((id) => mongoose.isValidObjectId(id))
    .map((id) => new mongoose.Types.ObjectId(id));
  if (ids.length === 0) return [];
  return Observation.collection
    .find({ _id: { $in: ids } }, { projection: { value: 1, superseded: 1, rollback: 1 } })
    .toArray() as Promise<CitedObservation[]>;
};

export type LiveFieldValueLookup = (input: {
  stored: Record<string, unknown>;
  mergedInRows: ReadonlyArray<MergedInRowRef>;
  fields: string[];
}) => Promise<Array<{ field?: unknown; value?: unknown }>>;

export const liveFieldValuesOnMergedRow: LiveFieldValueLookup = async (input) => {
  const clauses = mergedRowEvidenceQueryClauses([
    mergedRowEvidenceIdentity(input.stored, input.mergedInRows),
  ]);
  if (clauses.length === 0 || input.fields.length === 0) return [];
  return Observation.collection
    .find(
      {
        entityType: 'researchEntity',
        field: { $in: input.fields },
        superseded: false,
        'rollback.rolledBackAt': { $exists: false },
        $or: clauses,
      },
      { projection: { field: 1, value: 1 } },
    )
    .toArray() as Promise<Array<{ field?: unknown; value?: unknown }>>;
};

export function observationIsRetired(observation: CitedObservation): boolean {
  return observation.superseded === true || Boolean(observation.rollback?.rolledBackAt);
}

function comparableValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : JSON.stringify(value ?? null);
}

function isStoredValue(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (Array.isArray(value)) return value.length > 0;
  return comparableValue(value) !== '';
}

function provenanceEntry(
  stored: Record<string, unknown>,
  field: string,
): { observationId?: unknown; sourceName?: unknown } | undefined {
  const provenance = stored.fieldProvenance as Record<string, unknown> | undefined;
  return provenance?.[field] as { observationId?: unknown; sourceName?: unknown } | undefined;
}

function operatorAuthored(stored: Record<string, unknown>, field: string): boolean {
  return OPERATOR_AUTHORED_SOURCE_NAMES.includes(
    String(provenanceEntry(stored, field)?.sourceName ?? ''),
  );
}

export interface RetiredEvidenceFieldClearInput {
  stored: Record<string, unknown> | null | undefined;
  staged: Record<string, unknown>;
  unset: Record<string, unknown>;
  fieldsWithLiveObservation: ReadonlySet<string>;
  lockedFields: readonly string[];
  storedForm: (field: string, value: unknown) => unknown;
  mergedInRows?: ReadonlyArray<MergedInRowRef>;
  citedObservations?: CitedObservationLookup;
  liveFieldValues?: LiveFieldValueLookup;
}

export async function planRetiredEvidenceFieldClears(
  input: RetiredEvidenceFieldClearInput,
): Promise<string[]> {
  const stored = input.stored;
  if (!stored) return [];
  const operatorJudged = (field: string) =>
    input.lockedFields.includes(field) ||
    operatorAuthored(stored, field) ||
    liveFieldValueRefusals(stored.fieldValueRefusals, field).length > 0;
  const undecided = (field: string) =>
    !(field in input.staged) &&
    !(field in input.unset) &&
    !input.fieldsWithLiveObservation.has(field) &&
    !operatorJudged(field);

  const candidates = RETIRED_EVIDENCE_CLEARABLE_FIELDS.flatMap((field) => {
    if (!undecided(field) || !isStoredValue(stored[field])) return [];
    const observationId = provenanceEntry(stored, field)?.observationId;
    return observationId ? [{ field, observationId: String(observationId) }] : [];
  });
  if (candidates.length === 0) return [];

  const lookup = input.citedObservations ?? citedObservationsById;
  const cited = new Map(
    (await lookup(candidates.map((candidate) => candidate.observationId))).map((observation) => [
      String(observation._id),
      observation,
    ]),
  );
  const statesStoredValue = (field: string, value: unknown) =>
    comparableValue(input.storedForm(field, value)) === comparableValue(stored[field]);
  const retiredBacking = candidates.filter(({ field, observationId }) => {
    const observation = cited.get(observationId);
    return (
      observation !== undefined &&
      observationIsRetired(observation) &&
      statesStoredValue(field, observation.value)
    );
  });
  if (retiredBacking.length === 0) return [];

  const bodyRetired = retiredBacking.some(({ field }) => BODY_FIELDS.has(field));
  const liveLookup = input.liveFieldValues ?? liveFieldValuesOnMergedRow;
  const stillStated = new Set(
    (
      await liveLookup({
        stored,
        mergedInRows: input.mergedInRows ?? [],
        fields: [...retiredBacking.map(({ field }) => field), ...(bodyRetired ? [CARD_FIELD] : [])],
      })
    )
      .filter(({ field, value }) => statesStoredValue(String(field), value))
      .map(({ field }) => String(field)),
  );
  const cleared = retiredBacking
    .map(({ field }) => field)
    .filter((field) => !stillStated.has(field));

  const cardFollowsClearedBody =
    cleared.some((field) => BODY_FIELDS.has(field)) &&
    !input.fieldsWithLiveObservation.has(CARD_FIELD) &&
    !stillStated.has(CARD_FIELD) &&
    !operatorJudged(CARD_FIELD) &&
    (isStoredValue(stored[CARD_FIELD]) || CARD_FIELD in input.staged);
  return cardFollowsClearedBody ? [...cleared, CARD_FIELD] : cleared;
}

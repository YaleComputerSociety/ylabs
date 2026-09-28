import mongoose from 'mongoose';
import { Observation } from '../models/observation';

// Contact is fail-closed: a merged-in loser's observation, or one whose own key
// resolved onto this row, is another page's statement about another identity, so it
// may not name the person to contact here (#3609).
export const RESEARCH_ENTITY_CONTACT_FIELDS: readonly string[] = [
  'contactEmail',
  'contactName',
  'contactRole',
];

const CONTACT_FIELDS = new Set(RESEARCH_ENTITY_CONTACT_FIELDS);

export const CONTACT_FIELDS_SIGNAL_DERIVATION_KEY =
  'signal:CONTACT_INSTRUCTIONS_EXIST:CONTACT_FIELDS';

export interface ContactEvidenceRow {
  _id?: unknown;
  slug?: unknown;
}

interface KeyedObservation {
  entityId?: unknown;
  entityKey?: unknown;
}

const idText = (value: unknown): string => (value == null ? '' : String(value).trim());

export function observationIsKeyedToRow(
  observation: KeyedObservation,
  row: ContactEvidenceRow,
): boolean {
  const entityId = idText(observation.entityId);
  if (entityId) return entityId === idText(row._id);
  const entityKey = idText(observation.entityKey);
  return entityKey.length > 0 && entityKey === idText(row.slug);
}

export function isResearchEntityContactField(field: unknown): boolean {
  return typeof field === 'string' && CONTACT_FIELDS.has(field);
}

export function withoutForeignContactObservations<T extends KeyedObservation & { field?: unknown }>(
  observations: T[],
  row: ContactEvidenceRow,
): T[] {
  return observations.filter(
    (observation) =>
      !isResearchEntityContactField(observation.field) || observationIsKeyedToRow(observation, row),
  );
}

interface ContactSignalLike {
  _id?: unknown;
  researchEntityId?: unknown;
  derivationKey?: unknown;
  source?: { evidenceIds?: unknown[] } | null;
}

const toObjectId = (value: unknown): mongoose.Types.ObjectId | undefined => {
  const text = idText(value);
  return mongoose.isValidObjectId(text) && /^[a-f0-9]{24}$/i.test(text)
    ? new mongoose.Types.ObjectId(text)
    : undefined;
};

// The access materializer upserts and never archives, so a contact signal derived
// before #3609 is withheld here at serve time and kept as history.
export async function foreignContactFieldSignalIds(
  signals: readonly ContactSignalLike[],
  rows: readonly ContactEvidenceRow[],
): Promise<Set<string>> {
  const contactSignals = signals.filter(
    (signal) => signal.derivationKey === CONTACT_FIELDS_SIGNAL_DERIVATION_KEY,
  );
  if (contactSignals.length === 0) return new Set();
  const rowsById = new Map(rows.map((row) => [idText(row._id), row]));
  const evidenceIds = contactSignals
    .flatMap((signal) => signal.source?.evidenceIds ?? [])
    .map(toObjectId)
    .filter((id): id is mongoose.Types.ObjectId => Boolean(id));
  const evidence =
    evidenceIds.length > 0
      ? ((await Observation.find({ _id: { $in: evidenceIds } })
          .select('_id entityId entityKey')
          .lean()) as Array<KeyedObservation & { _id: unknown }>)
      : [];
  const evidenceById = new Map(
    evidence.map((observation) => [idText(observation._id), observation]),
  );

  const foreign = new Set<string>();
  for (const signal of contactSignals) {
    const row = rowsById.get(idText(signal.researchEntityId));
    const keyedToRow =
      row !== undefined &&
      (signal.source?.evidenceIds ?? []).some((id) => {
        const observation = evidenceById.get(idText(id));
        return observation !== undefined && observationIsKeyedToRow(observation, row);
      });
    if (!keyedToRow) foreign.add(idText(signal._id));
  }
  return foreign;
}

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

export const WITHHELD_CONTACT_VALUE_PREVIEW = '[contact value withheld]';

export function withoutForeignContactObservations<T extends KeyedObservation & { field?: unknown }>(
  observations: T[],
  row: ContactEvidenceRow,
): T[] {
  return observations.filter(
    (observation) =>
      !isResearchEntityContactField(observation.field) || observationIsKeyedToRow(observation, row),
  );
}

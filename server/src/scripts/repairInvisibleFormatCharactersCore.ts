/**
 * Planning for `data:repair-invisible-format-characters`.
 *
 * The ingest and materialize normalizers (`observationFieldSanitizer`) clean any
 * field a live observation still asserts, so a rematerialize corrects most stored
 * rows on its own. What it cannot reach is a field no live observation asserts:
 * the projection never plans a value for it, so the stored text keeps whatever it
 * was written with. Measured on Development after the rematerialize, that was
 * `recentGrants` abstracts and `profileSynthesisDescription`, which the served
 * detail payload still carried (#2874).
 *
 * This planner therefore reads the stored document and nothing else. It is keyed
 * on the probe "does the stored value still carry one", never on a plan or a
 * marker, so a second run reports zero because the corpus is clean rather than
 * because a flag says it already ran.
 */
import { withInvisibleFormatCharactersStripped } from '../scrapers/observationFieldSanitizer';

export interface InvisibleFormatCharacterRepairRow {
  collection: string;
  documentId: string;
  fields: string[];
  set: Record<string, unknown>;
}

export function planInvisibleFormatCharacterRepair(
  collection: string,
  documents: ReadonlyArray<Record<string, unknown>>,
): InvisibleFormatCharacterRepairRow[] {
  const rows: InvisibleFormatCharacterRepairRow[] = [];
  for (const document of documents) {
    const set: Record<string, unknown> = {};
    for (const [field, value] of Object.entries(document)) {
      if (field === '_id') continue;
      const normalized = withInvisibleFormatCharactersStripped(value);
      if (JSON.stringify(normalized) !== JSON.stringify(value)) set[field] = normalized;
    }
    const fields = Object.keys(set);
    if (fields.length === 0) continue;
    rows.push({ collection, documentId: String(document._id), fields, set });
  }
  return rows;
}

export function summarizeInvisibleFormatCharacterRepair(
  rows: ReadonlyArray<InvisibleFormatCharacterRepairRow>,
): { rows: number; byCollectionAndField: Record<string, number> } {
  const byCollectionAndField: Record<string, number> = {};
  for (const row of rows) {
    for (const field of row.fields) {
      const key = `${row.collection}.${field}`;
      byCollectionAndField[key] = (byCollectionAndField[key] ?? 0) + 1;
    }
  }
  return { rows: rows.length, byCollectionAndField };
}

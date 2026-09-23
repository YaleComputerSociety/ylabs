/**
 * Planning for `data:repair-glued-sentence-boundaries`.
 *
 * The ingest and materialize normalizers (`observationFieldSanitizer`) restore the
 * separator on any field a live observation still asserts, so a rematerialize
 * corrects those rows on its own. What it cannot reach is a field no live observation
 * asserts: the projection plans no value for it, so the stored text keeps whatever it
 * was written with. On Development that includes every body the LLM description lane
 * wrote, which is 17 of the 26 served rows #3096 counted.
 *
 * This planner therefore reads the stored document and nothing else. It is keyed on
 * the probe "does the stored value still glue a boundary", never on a plan or a
 * marker, so a second run reports zero because the corpus is clean rather than
 * because a flag says it already ran.
 */
import { withProseSentenceBoundariesRestored } from '../utils/proseSentenceBoundary';

export interface GluedSentenceBoundaryRepairRow {
  collection: string;
  documentId: string;
  fields: string[];
  set: Record<string, unknown>;
}

export function planGluedSentenceBoundaryRepair(
  collection: string,
  documents: ReadonlyArray<Record<string, unknown>>,
): GluedSentenceBoundaryRepairRow[] {
  const rows: GluedSentenceBoundaryRepairRow[] = [];
  for (const document of documents) {
    const set: Record<string, unknown> = {};
    for (const [field, value] of Object.entries(document)) {
      if (field === '_id') continue;
      const restored = withProseSentenceBoundariesRestored(field, value);
      if (JSON.stringify(restored) !== JSON.stringify(value)) set[field] = restored;
    }
    const fields = Object.keys(set);
    if (fields.length === 0) continue;
    rows.push({ collection, documentId: String(document._id), fields, set });
  }
  return rows;
}

export function summarizeGluedSentenceBoundaryRepair(
  rows: ReadonlyArray<GluedSentenceBoundaryRepairRow>,
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

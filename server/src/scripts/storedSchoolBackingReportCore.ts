import {
  STORED_SCHOOL_BACKING_CLASSES,
  storedSchoolBackingClass,
  storedSchoolIsBacked,
  type ResolvedSchoolReadings,
  type SchoolBackingRow,
  type SchoolCanonicalizer,
  type StoredSchoolBackingClass,
} from '../scrapers/storedSchoolBacking';
import { serializedDocumentId } from '../utils/idSerialization';

export interface StoredSchoolBackingReportRow extends SchoolBackingRow {
  served: boolean;
  fieldProvenance?: unknown;
  manuallyLockedFields?: unknown;
}

type ClassCounts = Record<StoredSchoolBackingClass, number>;

export interface StoredSchoolBackingSummary {
  rows: number;
  servedRows: number;
  byClass: ClassCounts;
  servedByClass: ClassCounts;
  servedNeverBackedByProvenanceSource: Record<string, number>;
  servedByProvenanceSource: Record<string, ClassCounts>;
  servedNeverBackedSchoolLocked: number;
  servedNeverBackedWithRivalReadings: number;
  servedNeverBackedWithNoReadings: number;
  servedBackedOnlyBySupersededReadings: number;
  servedBackedOnlyBySupersededReadingsByProvenanceSource: Record<string, number>;
}

export const NO_PROVENANCE_SOURCE = '(no provenance entry)';

const emptyClassCounts = (): ClassCounts =>
  Object.fromEntries(STORED_SCHOOL_BACKING_CLASSES.map((name) => [name, 0])) as ClassCounts;

function schoolProvenanceSource(fieldProvenance: unknown): string {
  const entry =
    fieldProvenance && typeof fieldProvenance === 'object'
      ? (fieldProvenance as Record<string, unknown>).school
      : undefined;
  const sourceName =
    entry && typeof entry === 'object' ? (entry as Record<string, unknown>).sourceName : undefined;
  return typeof sourceName === 'string' && sourceName.trim()
    ? sourceName.trim()
    : NO_PROVENANCE_SOURCE;
}

const schoolIsLocked = (row: StoredSchoolBackingReportRow): boolean =>
  Array.isArray(row.manuallyLockedFields) && row.manuallyLockedFields.includes('school');

/**
 * Counts every row's stored-school backing class (#6096), overall and for served rows, and
 * splits the served classes by the source the stored school is credited to. Counts only: the
 * report names no row, so it can be posted by predicate.
 */
export function summarizeStoredSchoolBacking(
  rows: readonly StoredSchoolBackingReportRow[],
  readingsByRow: ReadonlyMap<string, ResolvedSchoolReadings>,
  derivedSchoolByRow: ReadonlyMap<string, string>,
  canonicalizer: SchoolCanonicalizer,
): StoredSchoolBackingSummary {
  const summary: StoredSchoolBackingSummary = {
    rows: 0,
    servedRows: 0,
    byClass: emptyClassCounts(),
    servedByClass: emptyClassCounts(),
    servedNeverBackedByProvenanceSource: {},
    servedByProvenanceSource: {},
    servedNeverBackedSchoolLocked: 0,
    servedNeverBackedWithRivalReadings: 0,
    servedNeverBackedWithNoReadings: 0,
    servedBackedOnlyBySupersededReadings: 0,
    servedBackedOnlyBySupersededReadingsByProvenanceSource: {},
  };
  for (const row of rows) {
    const rowId = serializedDocumentId(row._id);
    if (!rowId) continue;
    const readings = readingsByRow.get(rowId) ?? { own: [], mergedIn: [] };
    const backing = storedSchoolBackingClass(
      row,
      readings,
      canonicalizer,
      derivedSchoolByRow.get(rowId) ?? '',
    );
    summary.rows += 1;
    summary.byClass[backing] += 1;
    if (!row.served) continue;
    summary.servedRows += 1;
    summary.servedByClass[backing] += 1;
    const source = schoolProvenanceSource(row.fieldProvenance);
    summary.servedByProvenanceSource[source] ??= emptyClassCounts();
    summary.servedByProvenanceSource[source][backing] += 1;
    if (
      backing === 'school-observation' &&
      !storedSchoolIsBacked(
        row.school,
        readings.own.filter((observation) => observation.superseded !== true),
        canonicalizer,
      )
    ) {
      summary.servedBackedOnlyBySupersededReadings += 1;
      summary.servedBackedOnlyBySupersededReadingsByProvenanceSource[source] =
        (summary.servedBackedOnlyBySupersededReadingsByProvenanceSource[source] ?? 0) + 1;
    }
    if (backing !== 'never-backed') continue;
    summary.servedNeverBackedByProvenanceSource[source] =
      (summary.servedNeverBackedByProvenanceSource[source] ?? 0) + 1;
    if (schoolIsLocked(row)) summary.servedNeverBackedSchoolLocked += 1;
    if (readings.own.length > 0) summary.servedNeverBackedWithRivalReadings += 1;
    else summary.servedNeverBackedWithNoReadings += 1;
  }
  return summary;
}

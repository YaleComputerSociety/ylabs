import type mongoose from 'mongoose';

// Declared here, not in the materializer, because the models layer imports nothing above it.
export const DERIVED_RESEARCH_AREA_SOURCE_NAME = 'description-derived-research-area';

// Only a derivation recomputed on every resolve belongs here; a one-shot repair never does.
export const NON_OBSERVATION_PROVENANCE_AUTHORITIES: Readonly<Record<string, string>> = {
  [DERIVED_RESEARCH_AREA_SOURCE_NAME]:
    "topics derived from the row's own description on every resolve; no page named the facet, so there is no observation to cite",
};

type ProvenanceRecord = {
  sourceName?: unknown;
  sourceId?: unknown;
  observationId?: unknown;
};

function isPresent(value: unknown): boolean {
  return value !== undefined && value !== null && String(value).trim().length > 0;
}

function asRecord(value: unknown): ProvenanceRecord | null {
  if (!value || typeof value !== 'object') return null;
  const maybeDocument = value as { toObject?: () => unknown };
  if (typeof maybeDocument.toObject === 'function') {
    const plain = maybeDocument.toObject();
    return plain && typeof plain === 'object' ? (plain as ProvenanceRecord) : null;
  }
  return value as ProvenanceRecord;
}

export function isNonObservationProvenanceAuthority(sourceName: unknown): boolean {
  return (
    typeof sourceName === 'string' &&
    Object.prototype.hasOwnProperty.call(NON_OBSERVATION_PROVENANCE_AUTHORITIES, sourceName.trim())
  );
}

export function fieldProvenanceEntryIsBacked(entry: unknown): boolean {
  const record = asRecord(entry);
  if (!record) return true;
  if (isPresent(record.observationId)) return true;
  return isNonObservationProvenanceAuthority(record.sourceName);
}

// Looser than the write rule on purpose: a stored bare `sourceId` is #2897 residue, which is history.
export function fieldProvenanceEntryNamesALaneWithoutEvidence(entry: unknown): boolean {
  const record = asRecord(entry);
  if (!record) return false;
  if (!isPresent(record.sourceName)) return false;
  if (isPresent(record.sourceId) || isPresent(record.observationId)) return false;
  return !isNonObservationProvenanceAuthority(record.sourceName);
}

export function fieldProvenanceEntries(fieldProvenance: unknown): Array<[string, unknown]> {
  if (!fieldProvenance || typeof fieldProvenance !== 'object') return [];
  if (fieldProvenance instanceof Map) return [...fieldProvenance.entries()];
  const maybeDocument = fieldProvenance as { toObject?: () => unknown };
  if (typeof maybeDocument.toObject === 'function') {
    return fieldProvenanceEntries(maybeDocument.toObject());
  }
  return Object.entries(fieldProvenance as Record<string, unknown>);
}

const WHOLE_ENTRY_PATH = /^fieldProvenance\.([^.]+)$/;
const SOURCE_NAME_SUBPATH = /^fieldProvenance\.([^.]+)\.sourceName$/;

function unbackedPathsInAssignment(assignment: unknown): string[] {
  if (!assignment || typeof assignment !== 'object') return [];
  const offending: string[] = [];
  for (const [path, value] of Object.entries(assignment as Record<string, unknown>)) {
    if (path === 'fieldProvenance') {
      for (const [field, entry] of fieldProvenanceEntries(value)) {
        if (!fieldProvenanceEntryIsBacked(entry)) offending.push(`fieldProvenance.${field}`);
      }
      continue;
    }
    if (WHOLE_ENTRY_PATH.test(path)) {
      if (!fieldProvenanceEntryIsBacked(value)) offending.push(path);
      continue;
    }
    if (SOURCE_NAME_SUBPATH.test(path) && !isNonObservationProvenanceAuthority(value)) {
      offending.push(path);
    }
  }
  return offending;
}

const ASSIGNING_OPERATORS = ['$set', '$setOnInsert'] as const;

export function unbackedFieldProvenanceWritePaths(update: unknown): string[] {
  if (!update || typeof update !== 'object') return [];
  if (Array.isArray(update))
    return update.flatMap((stage) => unbackedFieldProvenanceWritePaths(stage));
  const record = update as Record<string, unknown>;
  const topLevel = Object.fromEntries(
    Object.entries(record).filter(([key]) => !key.startsWith('$')),
  );
  return [
    ...unbackedPathsInAssignment(topLevel),
    ...ASSIGNING_OPERATORS.flatMap((operator) => unbackedPathsInAssignment(record[operator])),
  ];
}

export class UnbackedFieldProvenanceWriteError extends Error {
  readonly paths: string[];

  constructor(paths: string[]) {
    super(
      `Refused to persist fieldProvenance without evidence at ${paths.join(', ')}: an entry must carry the observationId of the observation it cites, or name a source in NON_OBSERVATION_PROVENANCE_AUTHORITIES (#3769).`,
    );
    this.name = 'UnbackedFieldProvenanceWriteError';
    this.paths = paths;
  }
}

export function assertFieldProvenanceWriteIsBacked(update: unknown): void {
  const paths = unbackedFieldProvenanceWritePaths(update);
  if (paths.length > 0) throw new UnbackedFieldProvenanceWriteError(paths);
}

type BulkWriteOperation = Record<
  string,
  { update?: unknown; replacement?: unknown; document?: unknown }
>;

function assertBulkWriteIsBacked(operations: unknown): void {
  if (!Array.isArray(operations)) return;
  for (const operation of operations as BulkWriteOperation[]) {
    for (const body of Object.values(operation ?? {})) {
      if (!body || typeof body !== 'object') continue;
      assertFieldProvenanceWriteIsBacked(body.update);
      assertFieldProvenanceWriteIsBacked(body.replacement);
      assertFieldProvenanceWriteIsBacked(body.document);
    }
  }
}

interface ProvenanceGuardedDocument {
  isNew: boolean;
  isModified(path: string): boolean;
  get(path: string): unknown;
}

function assertDocumentProvenanceIsBacked(document: ProvenanceGuardedDocument): void {
  if (!document.isNew && !document.isModified('fieldProvenance')) return;
  const offending = fieldProvenanceEntries(document.get('fieldProvenance'))
    .filter(([field]) => document.isNew || document.isModified(`fieldProvenance.${field}`))
    .filter(([, entry]) => !fieldProvenanceEntryIsBacked(entry))
    .map(([field]) => `fieldProvenance.${field}`);
  if (offending.length > 0) throw new UnbackedFieldProvenanceWriteError(offending);
}

const GUARDED_QUERY_WRITES = [
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
  'replaceOne',
  'findOneAndReplace',
] as const;

// A raw `collection` handle bypasses this, so no writer may author an entry through one.
export function registerFieldProvenanceBackingGuard(schema: mongoose.Schema): void {
  for (const operation of GUARDED_QUERY_WRITES) {
    schema.pre(operation, function guardQueryWrite(this: mongoose.Query<unknown, unknown>) {
      assertFieldProvenanceWriteIsBacked(this.getUpdate());
    });
  }
  schema.pre('save', function guardSave(this: ProvenanceGuardedDocument) {
    assertDocumentProvenanceIsBacked(this);
  });
  schema.pre(
    'insertMany',
    function guardInsertMany(next: (error?: Error) => void, documents: unknown) {
      try {
        const list = Array.isArray(documents) ? documents : [documents];
        for (const document of list) assertFieldProvenanceWriteIsBacked(document);
        next();
      } catch (error) {
        next(error as Error);
      }
    },
  );
  schema.pre(
    'bulkWrite',
    function guardBulkWrite(next: (error?: Error) => void, operations: unknown) {
      try {
        assertBulkWriteIsBacked(operations);
        next();
      } catch (error) {
        next(error as Error);
      }
    },
  );
}

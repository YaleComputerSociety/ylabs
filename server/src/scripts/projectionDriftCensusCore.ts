import { researchEntityFieldIsStranded } from './rematerializeResearchEntitiesCore';
import { resolveSafeJsonReportOutputPath } from './scriptWriteGuards';

/**
 * Divergence between a stored row and what the engine would project is not one
 * thing, and #2688 was read as one number because nothing separated the parts.
 *
 * - `unstorable`: the engine plans a field the ResearchEntity schema has no path
 *   for, so mongoose drops it on write and the divergence can never close. It is
 *   permanent and reports the same value on every run. Storability decides which
 *   class a divergence falls into, never whether one exists: a row that already
 *   stores the value the projection would have set does not diverge at all, so
 *   every class is reached only after the two sides compare unequal.
 * - `fill-empty`: the stored value is empty and projection would supply one, so
 *   the write can only add.
 * - `overwrite`: both sides hold a value and they differ, so whether projection
 *   is an improvement needs a per-field argument.
 * - `clear-stored`: the stored value is non-empty and projection would empty or
 *   unset it, so the write removes something a row holds today.
 *
 * Only `fill-empty` is safe by construction. Reporting a total that folds
 * `unstorable` in overstates the backlog by roughly the ratio of the two.
 */
export type ProjectionDriftClass = 'unstorable' | 'fill-empty' | 'overwrite' | 'clear-stored';

export const PROJECTION_DRIFT_CLASSES: readonly ProjectionDriftClass[] = [
  'unstorable',
  'fill-empty',
  'overwrite',
  'clear-stored',
];

/**
 * Keys the engine rewrites on every projection regardless of evidence, plus the
 * dotted provenance and confidence keys it writes alongside a field. Counting
 * them would make every row divergent and say nothing about the corpus.
 */
const PROJECTION_BOOKKEEPING_FIELDS = new Set([
  'confidenceByField',
  'fieldProvenance',
  'lastObservedAt',
  'updatedAt',
  'schemaVersion',
]);

export function isProjectionBookkeepingKey(field: string): boolean {
  if (PROJECTION_BOOKKEEPING_FIELDS.has(field)) return true;
  return field.startsWith('fieldProvenance.') || field.startsWith('confidenceByField.');
}

/**
 * Storability is read from the live mongoose schema rather than a hand-kept list,
 * because a list would drift from the schema and reintroduce the very phantom
 * divergence this census exists to separate out.
 */
export function researchEntityFieldIsStorable(
  schemaPaths: Iterable<string>,
  field: string,
): boolean {
  const prefix = `${field}.`;
  for (const schemaPath of schemaPaths) {
    if (schemaPath === field) return true;
    if (schemaPath.startsWith(prefix)) return true;
  }
  return false;
}

/**
 * Mongoose mints a fresh `_id` into every subdocument it casts and stores a
 * subdocument's keys in schema order rather than in the order the projection
 * emitted them, so a byte-for-byte identical value never compares equal to the
 * one already stored. Neither difference is projected content and no run can
 * close either, so the comparison is taken over a canonical form with the minted
 * id dropped and keys ordered.
 */
const MONGOOSE_MINTED_SUBDOCUMENT_ID = '_id';

function canonicalizeMongooseShape(value: unknown): unknown {
  if (value === undefined || value === null) return null;
  if (Array.isArray(value)) return value.map((entry) => canonicalizeMongooseShape(entry));
  if (typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => key !== MONGOOSE_MINTED_SUBDOCUMENT_ID)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalizeMongooseShape(entry)]),
  );
}

function normalizeForComparison(value: unknown): unknown {
  if (value === undefined || value === null) return null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((entry) => normalizeForComparison(entry));
  if (typeof value === 'object') {
    return canonicalizeMongooseShape(JSON.parse(JSON.stringify(value)));
  }
  return value;
}

export function projectedValuesEqual(left: unknown, right: unknown): boolean {
  try {
    return (
      JSON.stringify(normalizeForComparison(left)) === JSON.stringify(normalizeForComparison(right))
    );
  } catch {
    return false;
  }
}

/**
 * The stored side of the comparison was written through the schema, so it carries
 * mongoose's casts and its subdocument defaults while the planned side is still
 * the raw observation value. Comparing the two directly reports a permanent,
 * unclosable `overwrite` on every row whose fields cast (a grant's `startDate`
 * string against the stored `Date`, an absent `role` against the stored default),
 * which is exactly the phantom divergence this census exists to separate out, so
 * a planned value is cast the way the write would cast it before it is compared.
 */
export interface ProjectionDriftStorageSchema {
  paths: Record<string, unknown>;
  path(name: string): { cast: (...args: unknown[]) => unknown } | null | undefined;
}

function castPlannedValueForStorage(
  schema: ProjectionDriftStorageSchema,
  field: string,
  planned: unknown,
): unknown {
  if (planned === undefined || planned === null) return planned;
  const schemaType = schema.path(field);
  if (!schemaType || typeof schemaType.cast !== 'function') return planned;
  try {
    return schemaType.cast(planned);
  } catch {
    return planned;
  }
}

export interface ProjectionDriftFinding {
  field: string;
  driftClass: ProjectionDriftClass;
}

export interface ClassifyEntityProjectionDriftInput {
  stored: Record<string, unknown>;
  plannedSet: Record<string, unknown>;
  plannedUnset: Record<string, unknown>;
  schema: ProjectionDriftStorageSchema;
}

export function classifyEntityProjectionDrift(
  input: ClassifyEntityProjectionDriftInput,
): ProjectionDriftFinding[] {
  const schemaPaths = Object.keys(input.schema.paths);
  const findings: ProjectionDriftFinding[] = [];
  const seen = new Set<string>();

  const record = (field: string, planned: unknown, plannedIsUnset: boolean) => {
    if (seen.has(field) || isProjectionBookkeepingKey(field)) return;
    seen.add(field);
    const stored = input.stored[field];
    const plannedForStorage = plannedIsUnset
      ? undefined
      : castPlannedValueForStorage(input.schema, field, planned);
    if (!plannedIsUnset && projectedValuesEqual(stored, plannedForStorage)) return;
    const storedIsEmpty = researchEntityFieldIsStranded(stored);
    const plannedIsEmpty = plannedIsUnset || researchEntityFieldIsStranded(plannedForStorage);
    if (plannedIsEmpty && storedIsEmpty) return;
    if (!researchEntityFieldIsStorable(schemaPaths, field)) {
      findings.push({ field, driftClass: 'unstorable' });
      return;
    }
    if (plannedIsEmpty) {
      findings.push({ field, driftClass: 'clear-stored' });
      return;
    }
    findings.push({ field, driftClass: storedIsEmpty ? 'fill-empty' : 'overwrite' });
  };

  for (const [field, planned] of Object.entries(input.plannedSet)) record(field, planned, false);
  for (const field of Object.keys(input.plannedUnset)) record(field, undefined, true);
  return findings;
}

export interface ProjectionDriftEntityReport {
  slug: string;
  skipped?: string;
  error?: string;
  findings: ProjectionDriftFinding[];
}

export interface ProjectionDriftCensusSummary {
  rowsSampled: number;
  rowsSkipped: number;
  rowsFailed: number;
  rowsWithAnyDrift: number;
  rowsWithActionableDrift: number;
  rowsWithPermanentDriftOnly: number;
  rowsByClass: Record<ProjectionDriftClass, number>;
  fieldOccurrencesByClass: Record<ProjectionDriftClass, number>;
  fieldsByClass: Record<ProjectionDriftClass, Record<string, number>>;
}

function emptyClassCounts(): Record<ProjectionDriftClass, number> {
  return { unstorable: 0, 'fill-empty': 0, overwrite: 0, 'clear-stored': 0 };
}

export function summarizeProjectionDriftCensus(
  reports: ProjectionDriftEntityReport[],
): ProjectionDriftCensusSummary {
  const summary: ProjectionDriftCensusSummary = {
    rowsSampled: 0,
    rowsSkipped: 0,
    rowsFailed: 0,
    rowsWithAnyDrift: 0,
    rowsWithActionableDrift: 0,
    rowsWithPermanentDriftOnly: 0,
    rowsByClass: emptyClassCounts(),
    fieldOccurrencesByClass: emptyClassCounts(),
    fieldsByClass: { unstorable: {}, 'fill-empty': {}, overwrite: {}, 'clear-stored': {} },
  };

  for (const report of reports) {
    if (report.error) {
      summary.rowsFailed += 1;
      continue;
    }
    if (report.skipped) {
      summary.rowsSkipped += 1;
      continue;
    }
    summary.rowsSampled += 1;
    if (report.findings.length === 0) continue;
    summary.rowsWithAnyDrift += 1;

    const classes = new Set(report.findings.map((finding) => finding.driftClass));
    for (const driftClass of classes) summary.rowsByClass[driftClass] += 1;
    const actionable = Array.from(classes).filter((driftClass) => driftClass !== 'unstorable');
    if (actionable.length > 0) summary.rowsWithActionableDrift += 1;
    else summary.rowsWithPermanentDriftOnly += 1;

    for (const finding of report.findings) {
      summary.fieldOccurrencesByClass[finding.driftClass] += 1;
      const byField = summary.fieldsByClass[finding.driftClass];
      byField[finding.field] = (byField[finding.field] || 0) + 1;
    }
  }

  return summary;
}

export interface ProjectionDriftCensusArgs {
  sample: number;
  slugs: string[];
  includeArchived: boolean;
  output?: string;
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/i;

export function parseProjectionDriftCensusArgs(argv: string[]): ProjectionDriftCensusArgs {
  const args: ProjectionDriftCensusArgs = { sample: 200, slugs: [], includeArchived: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--include-archived') {
      args.includeArchived = true;
      continue;
    }
    if (arg.startsWith('--sample=')) {
      const parsed = Number.parseInt(arg.slice('--sample='.length), 10);
      if (!Number.isSafeInteger(parsed) || parsed <= 0) {
        throw new Error('--sample requires a positive integer');
      }
      args.sample = parsed;
      continue;
    }
    if (arg.startsWith('--slugs=')) {
      const slugs = arg
        .slice('--slugs='.length)
        .split(',')
        .map((slug) => slug.trim())
        .filter(Boolean);
      if (slugs.length === 0) throw new Error('--slugs requires at least one entity slug');
      for (const slug of slugs) {
        if (!SLUG_RE.test(slug)) throw new Error(`Invalid entity slug: ${slug}`);
      }
      args.slugs = Array.from(new Set(slugs));
      continue;
    }
    if (arg === '--output') {
      args.output = resolveSafeJsonReportOutputPath(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith('--output=')) {
      args.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
      continue;
    }
    throw new Error(`Unknown projection drift census argument: ${arg}`);
  }
  return args;
}

export function scaleProjectionDriftRowCount(
  rows: number,
  rowsDrawn: number,
  corpusRows: number,
): number {
  if (rowsDrawn <= 0) return 0;
  return Math.round((rows / rowsDrawn) * corpusRows);
}

export interface ProjectionDriftCorpusScale {
  rowsWithAnyDrift: number;
  rowsWithActionableDrift: number;
  rowsWithPermanentDriftOnly: number;
  rowsByClass: Record<ProjectionDriftClass, number>;
}

/**
 * Scaling is only valid against the population the rows were drawn from, which is
 * the random `$sample` over the live corpus; a caller-chosen `--slugs` list is not
 * a sample of anything, so the script omits this block rather than reporting that
 * every live row diverges because the one slug asked about does.
 *
 * The denominator is every row drawn rather than every row classified, because
 * `corpusRows` counts the archived and redirected rows a draw can land on and a
 * skipped row is not a repair target, so dividing by the classified count alone
 * would inflate the estimate by the skip rate.
 */
export function scaleProjectionDriftCensusToCorpus(
  summary: ProjectionDriftCensusSummary,
  corpusRows: number,
): ProjectionDriftCorpusScale {
  const rowsDrawn = summary.rowsSampled + summary.rowsSkipped + summary.rowsFailed;
  const scale = (rows: number) => scaleProjectionDriftRowCount(rows, rowsDrawn, corpusRows);
  return {
    rowsWithAnyDrift: scale(summary.rowsWithAnyDrift),
    rowsWithActionableDrift: scale(summary.rowsWithActionableDrift),
    rowsWithPermanentDriftOnly: scale(summary.rowsWithPermanentDriftOnly),
    rowsByClass: Object.fromEntries(
      PROJECTION_DRIFT_CLASSES.map((driftClass) => [
        driftClass,
        scale(summary.rowsByClass[driftClass]),
      ]),
    ) as Record<ProjectionDriftClass, number>,
  };
}

/**
 * A requested slug that names no document, or one the archived filter would have
 * hidden, has to carry a row of its own. Folding the existence filter into the
 * query instead dropped it from the report entirely, so `rowsSampled: 1,
 * rowsSkipped: 0` was indistinguishable from a two-slug run where one slug was
 * silently discarded.
 */
export function projectionDriftReportsForUnloadedSlugs(
  requestedSlugs: string[],
  loaded: ProjectionDriftEntityReport[],
): ProjectionDriftEntityReport[] {
  const loadedSlugs = new Set(loaded.map((report) => report.slug));
  return requestedSlugs
    .filter((slug) => !loadedSlugs.has(slug))
    .map((slug) => ({ slug, skipped: 'entity-not-found', findings: [] }));
}

export interface ProjectionDriftMaterializeResult {
  skipped?: string;
  plannedSet?: Record<string, unknown>;
  plannedUnset?: Record<string, unknown>;
}

/**
 * A row whose evidence is absent returns from `materializeEntity` with no plan at
 * all and, unlike every other early return, with no `skipped` either. Reading that
 * as an empty plan classifies the row as agreeing with its own projection, which is
 * the opposite claim: promotion copies materialized collections without the
 * observation store, so Beta and Production hold a full entity corpus against zero
 * observations and a census there would report a perfectly clean corpus. Nothing
 * was projected, so the row is a skip; it leaves the classified denominator while
 * `scaleProjectionDriftCensusToCorpus` still counts it in the draw.
 */
export function projectionDriftSkipReasonForResult(
  result: ProjectionDriftMaterializeResult,
): string | undefined {
  if (result.skipped) return result.skipped;
  if (!result.plannedSet && !result.plannedUnset) return 'no-projection-evidence';
  return undefined;
}

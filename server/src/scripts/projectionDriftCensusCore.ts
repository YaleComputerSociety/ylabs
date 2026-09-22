import { researchEntityFieldIsStranded } from './rematerializeResearchEntitiesCore';
import { resolveSafeJsonReportOutputPath } from './scriptWriteGuards';

/**
 * Divergence between a stored row and what the engine would project is not one
 * thing, and #2688 was read as one number because nothing separated the parts.
 *
 * - `unstorable`: the engine plans a field the ResearchEntity schema has no path
 *   for, so mongoose drops it on write and the divergence can never close. It is
 *   permanent and reports the same value on every run.
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

function normalizeForComparison(value: unknown): unknown {
  if (value === undefined || value === null) return null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((entry) => normalizeForComparison(entry));
  if (typeof value === 'object') return JSON.parse(JSON.stringify(value));
  return value;
}

export function projectedValuesEqual(left: unknown, right: unknown): boolean {
  return (
    JSON.stringify(normalizeForComparison(left)) === JSON.stringify(normalizeForComparison(right))
  );
}

export interface ProjectionDriftFinding {
  field: string;
  driftClass: ProjectionDriftClass;
}

export interface ClassifyEntityProjectionDriftInput {
  stored: Record<string, unknown>;
  plannedSet: Record<string, unknown>;
  plannedUnset: Record<string, unknown>;
  schemaPaths: Iterable<string>;
}

export function classifyEntityProjectionDrift(
  input: ClassifyEntityProjectionDriftInput,
): ProjectionDriftFinding[] {
  const schemaPaths = Array.from(input.schemaPaths);
  const findings: ProjectionDriftFinding[] = [];
  const seen = new Set<string>();

  const record = (field: string, planned: unknown, plannedIsUnset: boolean) => {
    if (seen.has(field) || isProjectionBookkeepingKey(field)) return;
    seen.add(field);
    if (!researchEntityFieldIsStorable(schemaPaths, field)) {
      findings.push({ field, driftClass: 'unstorable' });
      return;
    }
    const stored = input.stored[field];
    if (!plannedIsUnset && projectedValuesEqual(stored, planned)) return;
    const storedIsEmpty = researchEntityFieldIsStranded(stored);
    const plannedIsEmpty = plannedIsUnset || researchEntityFieldIsStranded(planned);
    if (plannedIsEmpty) {
      if (storedIsEmpty) return;
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
  rowsSampled: number,
  corpusRows: number,
): number {
  if (rowsSampled <= 0) return 0;
  return Math.round((rows / rowsSampled) * corpusRows);
}

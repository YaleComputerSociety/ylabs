import {
  resolveFieldRanked,
  type ResolvedField,
  type ResolverObservation,
} from './confidenceResolver';

export interface DepartmentSpecificityCatalog {
  canonical(name: string): string | undefined;
  parentDepartmentsFor(canonicalName: string): string[];
}

const canonicalOf = (
  catalog: DepartmentSpecificityCatalog,
  candidate: ResolvedField,
): string | undefined =>
  typeof candidate.value === 'string' ? catalog.canonical(candidate.value) : undefined;

/**
 * The department a researcher's pooled readings serve, keeping a stated SECTION over the
 * DEPARTMENT it sits directly under (docs/research-model.md, catalog altitudes). Pooling
 * every joining key lets a parent department that several rosters state outvote the one
 * profile that states the section, so the winner alone would narrow a correct section to
 * its parent. The rule fires only when the winner is a catalog department, exactly one
 * other candidate is a catalog section whose nearest ancestor is that department, and a
 * catalog is available; otherwise the resolver's winner stands.
 */
export function pooledDepartmentWithStatedSection(
  ranked: readonly ResolvedField[],
  catalog: DepartmentSpecificityCatalog | null,
): ResolvedField | undefined {
  const [winner, ...rest] = ranked;
  if (!winner || !catalog) return winner;
  const winnerUnit = canonicalOf(catalog, winner);
  if (!winnerUnit || catalog.parentDepartmentsFor(winnerUnit).length > 0) return winner;
  const sections = rest.filter((candidate) => {
    const unit = canonicalOf(catalog, candidate);
    return Boolean(unit) && catalog.parentDepartmentsFor(unit as string)[0] === winnerUnit;
  });
  const distinctSections = new Set(sections.map((candidate) => canonicalOf(catalog, candidate)));
  return distinctSections.size === 1 ? sections[0] : winner;
}

export interface PooledDepartmentReading {
  _id?: unknown;
  value?: unknown;
  sourceName?: unknown;
  confidence?: number;
  observedAt?: Date | string;
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const stableOrderKey = (reading: PooledDepartmentReading): string =>
  [
    text(reading.value),
    text(reading.sourceName),
    reading.observedAt ? new Date(reading.observedAt).toISOString() : '',
    String(reading._id ?? ''),
  ].join('\u0000');

/**
 * Resolves pooled department readings in a fixed order, because the resolver keeps the
 * first-seen value on an exact tie and the key being materialized would otherwise always
 * be read last, which makes a tie depend on which key ran.
 */
export function resolvePooledDepartment(
  readings: readonly PooledDepartmentReading[],
  catalog: DepartmentSpecificityCatalog | null,
  now: Date,
): ResolvedField | undefined {
  const ordered = [...readings].sort((left, right) => {
    const a = stableOrderKey(left);
    const b = stableOrderKey(right);
    return a < b ? -1 : a > b ? 1 : 0;
  });
  return pooledDepartmentWithStatedSection(
    resolveFieldRanked(
      'primaryDepartment',
      ordered.map((reading): ResolverObservation => ({
        field: 'primaryDepartment',
        value: reading.value,
        sourceName: text(reading.sourceName),
        confidence: reading.confidence ?? 0,
        observedAt: new Date(reading.observedAt ?? now),
      })),
      { now },
    ),
    catalog,
  );
}

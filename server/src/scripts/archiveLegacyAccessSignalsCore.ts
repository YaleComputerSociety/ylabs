export const ARCHIVE_LEGACY_ACCESS_SIGNALS_REASON = 'archive:legacy-access-signals';

export const PROTECTED_ACCESS_SIGNAL_SOURCES = [
  'lab-microsite-undergrad-llm',
  'department-undergrad-research',
  'manual-admin-edit',
] as const;

export interface LegacyAccessSignalPredicate {
  name: string;
  filter: Record<string, unknown>;
}

const liveReachOutFrom = (sourceName: string): Record<string, unknown> => ({
  type: 'REACH_OUT_PLAUSIBLE',
  'source.name': sourceName,
  archived: { $ne: true },
});

export const SOURCE_SCOPED_LEGACY_ACCESS_SIGNAL_PREDICATES: readonly LegacyAccessSignalPredicate[] =
  [
    { name: 'visibility-repair-queue', filter: liveReachOutFrom('visibility-repair-queue') },
    { name: 'dept-faculty-roster', filter: liveReachOutFrom('dept-faculty-roster') },
    {
      name: 'research-entity-cache-backfill',
      filter: liveReachOutFrom('research-entity-cache-backfill'),
    },
    {
      name: 'retired-logistics',
      filter: { type: { $in: ['CURRENT_AVAILABILITY', 'MODALITY'] }, archived: { $ne: true } },
    },
  ];

export const RETIRED_ACCESS_SIGNAL_TYPES = [
  'REACH_OUT_PLAUSIBLE',
  'CONTACT_INSTRUCTIONS_EXIST',
  'NOT_CURRENTLY_AVAILABLE',
  'FELLOWSHIP_COMPATIBLE',
  'COURSE_CREDIT_PATHWAY',
] as const;

export const RETIRED_TYPE_ACCESS_SIGNAL_PREDICATES: readonly LegacyAccessSignalPredicate[] =
  RETIRED_ACCESS_SIGNAL_TYPES.map((type) => ({
    name: type,
    filter: { type, archived: { $ne: true } },
  }));

export const LEGACY_ACCESS_SIGNAL_PREDICATES: readonly LegacyAccessSignalPredicate[] = [
  ...SOURCE_SCOPED_LEGACY_ACCESS_SIGNAL_PREDICATES,
  ...RETIRED_TYPE_ACCESS_SIGNAL_PREDICATES,
];

export interface LegacyAccessSignalRow {
  type?: unknown;
  archived?: unknown;
  source?: { name?: unknown };
}

const valueAtPath = (row: LegacyAccessSignalRow, key: string): unknown =>
  key.split('.').reduce<unknown>((value, part) => {
    if (!value || typeof value !== 'object') return undefined;
    return (value as Record<string, unknown>)[part];
  }, row);

function conditionHolds(actual: unknown, expected: unknown): boolean {
  if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
    const operators = expected as Record<string, unknown>;
    if ('$ne' in operators) return actual !== operators.$ne;
    if ('$in' in operators) {
      return Array.isArray(operators.$in) && operators.$in.includes(actual);
    }
    return false;
  }
  return actual === expected;
}

export function legacyAccessSignalPredicateMatches(
  predicate: LegacyAccessSignalPredicate,
  row: LegacyAccessSignalRow,
): boolean {
  return Object.entries(predicate.filter).every(([key, expected]) =>
    conditionHolds(valueAtPath(row, key), expected),
  );
}

export function assertLegacyAccessSignalsFullyArchived(presentAfter: Record<string, number>): void {
  const remaining = Object.entries(presentAfter).filter(([, count]) => count > 0);
  if (remaining.length === 0) return;
  throw new Error(
    `${ARCHIVE_LEGACY_ACCESS_SIGNALS_REASON} invariant violated: live targets remain after apply (${remaining
      .map(([name, count]) => `${name}=${count}`)
      .join(', ')}).`,
  );
}

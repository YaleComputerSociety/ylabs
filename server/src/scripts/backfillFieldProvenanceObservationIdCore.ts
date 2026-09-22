import type { ScraperEnvironment } from '../scrapers/scraperEnvironment';

export const BACKFILL_PROVENANCE_OBSERVATION_ID_CONFIRM_FLAG =
  '--confirm-provenance-observation-id';

export interface BackfillProvenanceObservationIdArgs {
  apply: boolean;
  confirm: boolean;
  limit: number;
  output?: string;
}

export function parseBackfillProvenanceObservationIdArgs(
  argv: string[],
): BackfillProvenanceObservationIdArgs {
  const args: BackfillProvenanceObservationIdArgs = { apply: false, confirm: false, limit: 0 };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') continue;
    if (arg === '--apply' || arg === '--mode=apply') {
      args.apply = true;
    } else if (arg === '--dry-run' || arg === '--mode=dry-run') {
      args.apply = false;
    } else if (arg === BACKFILL_PROVENANCE_OBSERVATION_ID_CONFIRM_FLAG) {
      args.confirm = true;
    } else if (arg.startsWith('--limit=')) {
      args.limit = parseLimit(arg.slice('--limit='.length));
    } else if (arg === '--limit') {
      args.limit = parseLimit(argv[index + 1]);
      index += 1;
    } else if (arg.startsWith('--output=')) {
      args.output = arg.slice('--output='.length);
    } else if (arg === '--output') {
      args.output = argv[index + 1];
      index += 1;
    } else {
      throw new Error(`Unknown provenance-observation-id argument: ${arg}`);
    }
  }
  return args;
}

function parseLimit(raw: string | undefined): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`--limit requires a non-negative integer; received ${raw}`);
  }
  return value;
}

export function assertBackfillProvenanceObservationIdApplyAllowed(
  args: BackfillProvenanceObservationIdArgs,
  dbLabel: string,
  environment: ScraperEnvironment,
): void {
  if (!args.apply) return;
  if (!args.confirm) {
    throw new Error(
      `${BACKFILL_PROVENANCE_OBSERVATION_ID_CONFIRM_FLAG} is required when --apply is set.`,
    );
  }
  if (environment === 'production' || /\/(prod|production)$/i.test(dbLabel)) {
    throw new Error(
      `provenance-observation-id --apply is blocked against a production database (environment: ${environment}, target: ${dbLabel}).`,
    );
  }
}

export const PROVENANCE_REPAIR_OUTCOMES = [
  'repaired',
  'repaired_source_unknown',
  'reordered',
  'already_correct',
  'source_id_is_a_source',
  'dangling_observation_id',
  'no_ids',
] as const;

export const FIELD_PROVENANCE_KEY_ORDER = [
  'sourceId',
  'sourceName',
  'sourceUrl',
  'observationId',
  'observedAt',
  'confidence',
] as const;

export type ProvenanceRepairOutcome = (typeof PROVENANCE_REPAIR_OUTCOMES)[number];

export interface ProvenanceEntryLike {
  sourceId?: unknown;
  sourceName?: unknown;
  sourceUrl?: unknown;
  observationId?: unknown;
  observedAt?: unknown;
  confidence?: unknown;
}

export interface ResolvedProvenanceReference {
  isObservation: boolean;
  isSource: boolean;
  observationSourceId?: unknown;
}

export interface ProvenanceRepairPlan {
  outcome: ProvenanceRepairOutcome;
  entry?: Record<string, unknown>;
}

/**
 * The whole entry is rewritten rather than the two ids patched, and its keys are
 * emitted in `fieldProvenanceSchema` declaration order, because the materializer
 * compares a re-projection against the stored value with `JSON.stringify`
 * (`materializerValuesDeepEqual`). A `$set` on a subpath appends the new key
 * after the existing ones, which would leave every repaired entry unequal to its
 * own re-projection and cost a spurious rewrite plus a search re-sync per entity
 * on the next materialize.
 */
function orderedProvenanceEntry(
  entry: ProvenanceEntryLike,
  ids: { sourceId?: unknown; observationId: unknown },
): Record<string, unknown> {
  return {
    ...(ids.sourceId ? { sourceId: ids.sourceId } : {}),
    ...(entry.sourceName !== undefined ? { sourceName: entry.sourceName } : {}),
    ...(entry.sourceUrl !== undefined ? { sourceUrl: entry.sourceUrl } : {}),
    observationId: ids.observationId,
    ...(entry.observedAt !== undefined ? { observedAt: entry.observedAt } : {}),
    ...(entry.confidence !== undefined ? { confidence: entry.confidence } : {}),
  };
}

/**
 * The id is already the right id, only under the wrong key (#2897), so the repair
 * is a move rather than a match: no heuristic recovers a reference this pass
 * cannot read directly.
 *
 * A reference that resolves in neither collection is reported rather than moved.
 * Writing it to `observationId` would hand observation retention a protection
 * entry pointing at a row that no longer exists, which is the same silent
 * no-protection state this issue is fixing.
 */
export function provenanceEntryKeyOrderIsCanonical(entry: Record<string, unknown>): boolean {
  const present = Object.keys(entry).filter((key) =>
    (FIELD_PROVENANCE_KEY_ORDER as readonly string[]).includes(key),
  );
  const expected = FIELD_PROVENANCE_KEY_ORDER.filter((key) => present.includes(key));
  return present.join(',') === expected.join(',');
}

export function planProvenanceRepair(
  entry: ProvenanceEntryLike,
  reference: ResolvedProvenanceReference | null,
): ProvenanceRepairPlan {
  if (entry.observationId) {
    // A patched subpath leaves `observationId` appended after the other keys,
    // which defeats the materializer's `JSON.stringify` no-op comparison just as
    // an out-of-order projection does, so an entry that is semantically right but
    // ordered wrong is still rewritten.
    if (provenanceEntryKeyOrderIsCanonical(entry as Record<string, unknown>)) {
      return { outcome: 'already_correct' };
    }
    return {
      outcome: 'reordered',
      entry: orderedProvenanceEntry(entry, {
        sourceId: entry.sourceId,
        observationId: entry.observationId,
      }),
    };
  }
  if (!entry.sourceId) return { outcome: 'no_ids' };
  if (!reference) return { outcome: 'dangling_observation_id' };
  if (reference.isSource && !reference.isObservation) return { outcome: 'source_id_is_a_source' };
  if (!reference.isObservation) return { outcome: 'dangling_observation_id' };

  if (reference.observationSourceId) {
    return {
      outcome: 'repaired',
      entry: orderedProvenanceEntry(entry, {
        sourceId: reference.observationSourceId,
        observationId: entry.sourceId,
      }),
    };
  }
  return {
    outcome: 'repaired_source_unknown',
    entry: orderedProvenanceEntry(entry, { observationId: entry.sourceId }),
  };
}

export type ProvenanceRepairTally = Record<ProvenanceRepairOutcome, number>;

export function emptyProvenanceRepairTally(): ProvenanceRepairTally {
  return PROVENANCE_REPAIR_OUTCOMES.reduce((tally, outcome) => {
    tally[outcome] = 0;
    return tally;
  }, {} as ProvenanceRepairTally);
}

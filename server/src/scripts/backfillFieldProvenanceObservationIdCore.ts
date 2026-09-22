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
  'already_correct',
  'source_id_is_a_source',
  'dangling_observation_id',
  'no_ids',
] as const;

export type ProvenanceRepairOutcome = (typeof PROVENANCE_REPAIR_OUTCOMES)[number];

export interface ProvenanceEntryLike {
  sourceId?: unknown;
  observationId?: unknown;
}

export interface ResolvedProvenanceReference {
  isObservation: boolean;
  isSource: boolean;
  observationSourceId?: unknown;
}

export interface ProvenanceRepairPlan {
  outcome: ProvenanceRepairOutcome;
  set?: { observationId: unknown; sourceId?: unknown };
  unsetSourceId?: boolean;
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
export function planProvenanceRepair(
  entry: ProvenanceEntryLike,
  reference: ResolvedProvenanceReference | null,
): ProvenanceRepairPlan {
  if (entry.observationId) return { outcome: 'already_correct' };
  if (!entry.sourceId) return { outcome: 'no_ids' };
  if (!reference) return { outcome: 'dangling_observation_id' };
  if (reference.isSource && !reference.isObservation) return { outcome: 'source_id_is_a_source' };
  if (!reference.isObservation) return { outcome: 'dangling_observation_id' };

  if (reference.observationSourceId) {
    return {
      outcome: 'repaired',
      set: { observationId: entry.sourceId, sourceId: reference.observationSourceId },
    };
  }
  return {
    outcome: 'repaired_source_unknown',
    set: { observationId: entry.sourceId },
    unsetSourceId: true,
  };
}

export type ProvenanceRepairTally = Record<ProvenanceRepairOutcome, number>;

export function emptyProvenanceRepairTally(): ProvenanceRepairTally {
  return PROVENANCE_REPAIR_OUTCOMES.reduce((tally, outcome) => {
    tally[outcome] = 0;
    return tally;
  }, {} as ProvenanceRepairTally);
}
